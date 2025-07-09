const { Worker } = require('worker_threads');
const path = require('path');
const { getGridState, getUsers, setGridState, setUsers } = require('./gameState');
const { calculateLeaderboard, applyExclamationEffect, isAdjacentToUserTerritory } = require('./game');
const { generateRandomColor } = require('./utils');
const { log, error } = require('./logging');
const { getDb } = require('./db'); // Import getDb

// Define a radius for initial grid state sent to client
const INITIAL_GRID_RADIUS = 10; // Send tiles within this radius of capitol

function initializeSocket(io) {
    io.on('connection', (socket) => {
        log('Server: A user connected');

        socket.on('login', async ({ username, password }) => { // Made async
            log(`Server: Login attempt for username: ${username}`);
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                log(`Server: Login error - Username "${username}" is not alphanumeric.`);
                socket.emit('loginError', 'Username must be alphanumeric.');
                return;
            }
            if (username.length > 20) {
                log(`Server: Login error - Username "${username}" exceeds 20 characters.`);
                socket.emit('loginError', 'Username cannot exceed 20 characters.');
                return;
            }
            
            let users = await getUsers(); // Await getUsers
            let user = users[username];

            if (user) {
                log(`Server: User "${username}" found.`);
                if (user.password === password) {
                    log(`Server: Password for "${username}" matched. Login successful.`);
                    socket.emit('loginSuccess', { user: user, exploredTiles: user.exploredTiles });
                    
                    // Send partial grid state to the connecting user
                    const partialGridState = await getPartialGridState(user.capitol, INITIAL_GRID_RADIUS); // Get partial grid
                    const currentLeaderboard = calculateLeaderboard();
                    socket.emit('gameState', { gridState: partialGridState, users: users, leaderboard: currentLeaderboard });
                    log(`Server: Emitted initial partial gameState to ${username}.`);
                    socket.username = username;
                } else {
                    log(`Server: Invalid password for "${username}".`);
                    socket.emit('loginError', 'Invalid password.');
                }
            } else {
                log(`Server: User "${username}" not found. Creating new user.`);
                
                // Create a new worker for finding a spawn point
                const worker = new Worker(path.resolve(__dirname, 'spawnWorker.js'));
                worker.postMessage({ command: 'findSpawn' }); // No gridState parameter

                worker.on('message', async (response) => { // Made async
                    if (response.status === 'done') {
                        const spawnPoint = response.spawnPoint;

                        if (!spawnPoint) {
                            log(`Server: Failed to find a spawn point for new user "${username}".`);
                            socket.emit('loginError', 'Could not find a suitable spawn point. Please try again later.');
                            // worker.terminate(); // Let worker manage its own exit
                            return;
                        }

                        const newUser = {
                            username,
                            password, // In a real app, hash this!
                            color: generateRandomColor(),
                            capitol: spawnPoint,
                        };
                        newUser.exploredTiles = [newUser.capitol]; // Initialize with only the capitol tile after capitol is set
                        
                        // Update user in DB
                        await setUsers({ [username]: newUser }); // Await setUsers

                        // Update gridState in DB for capitol
                        await setGridState({ [newUser.capitol]: { owner: username, population: 1 } }); // Await setGridState

                        // Spawn 100 '!' tiles around the new user's capitol
                        const [capitolQ, capitolR] = newUser.capitol.split(',').map(Number);
                        const SPAWN_RADIUS = 50;
                        const NUM_EXCLAMATIONS = 100;

                        for (let i = 0; i < NUM_EXCLAMATIONS; i++) {
                            let attempts = 0;
                            const MAX_ATTEMPTS = 50; // Limit attempts to find a suitable tile for each '!'
                            let spawned = false;

                            while (attempts < MAX_ATTEMPTS && !spawned) {
                                const angle = Math.random() * 2 * Math.PI;
                                const distance = Math.random() * SPAWN_RADIUS;

                                const q = capitolQ + Math.round(distance * Math.cos(angle));
                                const r = capitolR + Math.round(distance * Math.sin(angle));
                                const key = `${q},${r}`;

                                // Check if the tile is unoccupied and doesn't already have an exclamation mark (from DB)
                                const existingTile = await getTileFromDb(q, r); // Get tile from DB
                                if (!existingTile || (!existingTile.owner && existingTile.hasExclamation !== 1)) {
                                    await setGridState({ [key]: { hasExclamation: true } }); // Update DB
                                    io.emit('tileUpdate', { key, tile: { hasExclamation: true } });
                                    spawned = true;
                                }
                                attempts++;
                            }
                        }
                        // Emit event to client that initial spawn is complete
                        socket.emit('initialSpawnComplete');
                        
                        log(`Server: New user "${username}" created and logged in.`);
                        socket.emit('loginSuccess', { user: newUser, exploredTiles: newUser.exploredTiles });
                        
                        // Send partial grid state to the new user
                        const partialGridState = await getPartialGridState(newUser.capitol, INITIAL_GRID_RADIUS); // Get partial grid
                        const updatedUsers = await getUsers(); // Get updated users for gameState
                        const currentLeaderboard = calculateLeaderboard();
                        socket.emit('gameState', { gridState: partialGridState, users: updatedUsers, leaderboard: currentLeaderboard });
                        
                        // Announce the new user's color and capitol to others
                        io.emit('userUpdate', { users: updatedUsers });
                        io.emit('tileUpdate', { key: newUser.capitol, tile: await getTileFromDb(capitolQ, capitolR) }); // Get tile from DB
                        socket.username = username;
                    }
                    // worker.terminate(); // Let worker manage its own exit
                });

                worker.on('error', (err) => {
                    error(`Worker error: ${err}`);
                    socket.emit('loginError', 'Failed to create user due to server error.');
                });

                worker.on('exit', (code) => {
                    if (code !== 0)
                        error(`Worker exited with non-zero exit code: ${code}`);
                });
            }
        });

        socket.on('syncExploredTiles', async (tiles) => { // Made async
            if (!socket.username) return;
            let users = await getUsers(); // Await getUsers
            if (users[socket.username]) {
                users[socket.username].exploredTiles = tiles;
                await setUsers({ [socket.username]: users[socket.username] }); // Update only this user in DB
            }
        });

        socket.on('hexClick', async ({ q, r }) => { // Made async
            if (!socket.username) return;

            const key = `${q},${r}`;
            let users = await getUsers(); // Await getUsers
            let gridState = await getGridState(); // Await getGridState (will be full grid for now)
            const user = users[socket.username];
            let tile = await getTileFromDb(q, r); // Get tile from DB

            const isCapitol = Object.values(users).some(u => u.capitol === key);

            if (tile && tile.hasExclamation) { // Check for boolean true
                if (!await isAdjacentToUserTerritory(q, r, user.username)) { // Await isAdjacentToUserTerritory
                    socket.emit('actionError', "You can only capture '!' tiles adjacent to your territory.");
                    return;
                }
                await applyExclamationEffect(q, r, user.username, io); // Await applyExclamationEffect
            } else if (tile && tile.owner !== user.username) { // Attack an enemy tile
                if (!await isAdjacentToUserTerritory(q, r, user.username)) { // Await isAdjacentToUserTerritory
                    socket.emit('actionError', 'You can only attack tiles adjacent to your territory.');
                    return;
                }
                if (isCapitol) { // Capitol is immortal
                    socket.emit('actionError', 'You cannot attack a capitol tile.');
                    return;
                }
                if (tile.population > 1) {
                    tile.population--;
                    await setGridState({ [key]: tile }); // Update DB
                } else {
                    tile.owner = user.username;
                    tile.population = 1; // Reset population to 1 when captured
                    await setGridState({ [key]: tile }); // Update DB
                }
            } else { // Conquer or reinforce own tile
                if (!tile) { // New tile
                    if (!await isAdjacentToUserTerritory(q, r, user.username)) { // Await isAdjacentToUserTerritory
                        socket.emit('actionError', 'You can only claim tiles adjacent to your territory.');
                        return;
                    }
                    await setGridState({ [key]: { owner: user.username, population: 1 } }); // Update DB
                } else if (tile.owner === user.username) { // Own tile
                    tile.population++;
                    await setGridState({ [key]: tile }); // Update DB
                }
            }
            // io.emit('tileUpdate', { key, tile: await getTileFromDb(q, r) }); // Get updated tile from DB and emit
            // Instead of emitting single tileUpdate, let's rely on batch updates or full state for now
            // For immediate feedback, we might need to re-evaluate this.
            // For now, we'll just emit the updated tile directly from the object we have
            io.emit('tileUpdate', { key, tile: await getTileFromDb(q, r) });
        });

        socket.on('disconnect', () => {
            
        });
    });
}

// Helper to get a single tile from DB
async function getTileFromDb(q, r) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.get("SELECT q, r, owner, population, hasExclamation, isDisconnected FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            const tile = {
                owner: row.owner,
                population: row.population,
                hasExclamation: row.hasExclamation === 1,
                isDisconnected: row.isDisconnected === 1
            };
            if (tile.owner === null) delete tile.owner;
            if (tile.population === null) delete tile.population;
            if (tile.hasExclamation === false) delete tile.hasExclamation;
            if (tile.isDisconnected === false) delete tile.isDisconnected;
            resolve(tile);
        });
    });
}

// Helper to get partial grid state for initial client load
async function getPartialGridState(centerCapitolKey, radius) {
    const [centerQ, centerR] = centerCapitolKey.split(',').map(Number);
    const db = getDb();
    return new Promise((resolve, reject) => {
        // This query is approximate for a hex grid, but good enough for initial load
        // It fetches tiles within a square bounding box around the center
        db.all(
            `SELECT q, r, owner, population, hasExclamation, isDisconnected FROM tiles
             WHERE q BETWEEN ? AND ? AND r BETWEEN ? AND ?`,
            [centerQ - radius, centerQ + radius, centerR - radius, centerR + radius],
            (err, rows) => {
                if (err) return reject(err);
                const partialGrid = {};
                rows.forEach(row => {
                    const key = `${row.q},${row.r}`;
                    partialGrid[key] = {
                        owner: row.owner,
                        population: row.population,
                        hasExclamation: row.hasExclamation === 1,
                        isDisconnected: row.isDisconnected === 1
                    };
                    if (partialGrid[key].owner === null) delete partialGrid[key].owner;
                    if (partialGrid[key].population === null) delete partialGrid[key].population;
                    if (partialGrid[key].hasExclamation === false) delete partialGrid[key].hasExclamation;
                    if (partialGrid[key].isDisconnected === false) delete partialGrid[key].isDisconnected;
                });
                resolve(partialGrid);
            }
        );
    });
}

module.exports = { initializeSocket };