const { getGridState, getUsers, setGridState, setUsers, getTile, getTilesInRegion, flushPendingOperations } = require('./gameState');
const { calculateLeaderboard, applyExclamationEffect, isAdjacentToUserTerritory } = require('./game');
const { generateRandomColor } = require('./utils');
const { log, error } = require('./logging');
const { getDb, safeDbOperation } = require('./db');

// Define a radius for initial grid state sent to client
const INITIAL_GRID_RADIUS = 10; // Send tiles within this radius of capitol

function initializeSocket(io) {
    io.on('connection', (socket) => {
        log('Server: A user connected');

        socket.on('login', async ({ username, password }) => {
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
            
            let users = await getUsers();
            let user = users[username];

            if (user) {
                log(`Server: User "${username}" found.`);
                if (user.password === password) {
                    log(`Server: Password for "${username}" matched. Login successful.`);
                    socket.emit('loginSuccess', { user: user, exploredTiles: user.exploredTiles });
                    
                    // Send initial game state with minimal tiles for fast loading
                    const [capitolQ, capitolR] = user.capitol.split(',').map(Number);
                    // Send only essential tiles first - just owned tiles + immediate neighbors
                    const essentialTiles = await getTilesInRegion(capitolQ, capitolR, 2); // Further reduced radius
                    const currentLeaderboard = await calculateLeaderboard();
                    socket.emit('gameState', { gridState: essentialTiles, users: users, leaderboard: currentLeaderboard });
                    
                    // Then send remaining tiles in background with longer delay to reduce server load
                    setTimeout(async () => {
                        const extendedTiles = await getTilesInRegion(capitolQ, capitolR, 5); // Reduced from INITIAL_GRID_RADIUS
                        socket.emit('extendedTiles', { gridState: extendedTiles });
                    }, 500); // Increased delay from 100ms to 500ms
                    log(`Server: Emitted initial partial gameState to ${username}.`);
                    socket.username = username;
                } else {
                    log(`Server: Invalid password for "${username}".`);
                    socket.emit('loginError', 'Invalid password.');
                }
            } else {
                log(`Server: User "${username}" not found. Creating new user.`);
                
                try {
                    // Use smart spawn manager for finding spawn point
                    const spawnPoint = await global.smartSpawnManager.getSpawnPoint();
                    
                    if (!spawnPoint) {
                        log(`Server: Failed to find a spawn point for new user "${username}".`);
                        socket.emit('loginError', 'Could not find a suitable spawn point. Please try again later.');
                        return;
                    }
                    
                    log(`Server: Found spawn point ${spawnPoint} for new user "${username}".`);

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

                        // Invalidate nearby spawn cache points
                        const [capitolQ, capitolR] = newUser.capitol.split(',').map(Number);
                        global.smartSpawnManager.onUserSpawned(capitolQ, capitolR);

                        // Emit success immediately to unblock login UI
                        socket.emit('loginSuccess', { user: newUser, exploredTiles: newUser.exploredTiles });
                        
                        // Send partial grid state to the new user
                        const [newCapitolQ, newCapitolR] = newUser.capitol.split(',').map(Number);
                        const partialGridState = await getTilesInRegion(newCapitolQ, newCapitolR, 2); // Reduced radius
                        const updatedUsers = await getUsers();
                        const currentLeaderboard = await calculateLeaderboard();
                        socket.emit('gameState', { gridState: partialGridState, users: updatedUsers, leaderboard: currentLeaderboard });
                        
                        // Announce the new user's color and capitol to others
                        io.emit('userUpdate', { users: updatedUsers });
                        io.emit('tileUpdate', { key: newUser.capitol, tile: await getTile(capitolQ, capitolR) });
                        socket.username = username;
                        
                        // Spawn exclamations asynchronously without blocking login
                        setImmediate(async () => {
                            try {
                                const SPAWN_RADIUS = 30; // Reduced from 50
                                const NUM_EXCLAMATIONS = 25; // Reduced from 100 for faster spawn
                                const spawnedTiles = new Map();

                                for (let i = 0; i < NUM_EXCLAMATIONS; i++) {
                                    let attempts = 0;
                                    const MAX_ATTEMPTS = 20; // Reduced attempts
                                    let spawned = false;

                                    while (attempts < MAX_ATTEMPTS && !spawned) {
                                        const angle = Math.random() * 2 * Math.PI;
                                        const distance = Math.random() * SPAWN_RADIUS;

                                        const q = capitolQ + Math.round(distance * Math.cos(angle));
                                        const r = capitolR + Math.round(distance * Math.sin(angle));
                                        const key = `${q},${r}`;

                                        // Check if the tile is unoccupied and doesn't already have an exclamation mark
                                        const existingTile = await getTile(q, r);
                                        if (!existingTile || (!existingTile.owner && !existingTile.hasExclamation)) {
                                            spawnedTiles.set(key, { hasExclamation: true });
                                            spawned = true;
                                        }
                                        attempts++;
                                    }
                                }
                                
                                // Batch update all spawned tiles for better performance
                                if (spawnedTiles.size > 0) {
                                    await setGridState(Object.fromEntries(spawnedTiles));
                                    // Emit batch update instead of individual updates
                                    io.emit('batchTileUpdate', { changedTiles: Object.fromEntries(spawnedTiles) });
                                }
                                
                                socket.emit('initialSpawnComplete');
                                log(`Server: Spawned ${spawnedTiles.size} exclamations for ${username} asynchronously.`);
                            } catch (err) {
                                error(`Error spawning exclamations for ${username}:`, err);
                            }
                        });
                        
                        log(`Server: New user "${username}" created and logged in.`);
                } catch (err) {
                    error(`Smart spawn manager error: ${err}`);
                    socket.emit('loginError', 'Failed to create user due to server error.');
                }
            }
        });

        socket.on('syncExploredTiles', async (tiles) => {
            if (!socket.username) return;
            let users = await getUsers(); // Await getUsers
            if (users[socket.username]) {
                users[socket.username].exploredTiles = tiles;
                await setUsers({ [socket.username]: users[socket.username] });
            }
        });

        socket.on('hexClick', async ({ q, r }) => {
            if (!socket.username) return;

            const key = `${q},${r}`;
            let users = await getUsers();
            const user = users[socket.username];
            let tile = await getTile(q, r);

            const isCapitol = Object.values(users).some(u => u.capitol === key);

            if (tile && tile.hasExclamation === true) { // Check for boolean true
                if (!await isAdjacentToUserTerritory(q, r, user.username)) { // Await isAdjacentToUserTerritory
                    socket.emit('actionError', "You can only capture '!' tiles adjacent to your territory.");
                    return;
                }
                await applyExclamationEffect(q, r, user.username, io); // Await applyExclamationEffect
                // Flush pending operations immediately to prevent disconnection penalty race condition
                await flushPendingOperations();
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
                    tile.population = 1;
                    await setGridState({ [key]: tile });
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
            // Emit the updated tile for immediate feedback
            const updatedTile = await getTile(q, r);
            io.emit('tileUpdate', { key, tile: updatedTile });
        });

        socket.on('requestFullMap', async () => {
            if (!socket.username) return;
            
            try {
                // Get all occupied tiles for minimap
                const allOccupiedTiles = await safeDbOperation(() => {
                    const db = getDb();
                    return new Promise((resolve, reject) => {
                        db.all("SELECT q, r, owner, hasExclamation FROM tiles WHERE owner IS NOT NULL OR hasExclamation = 1", [], (err, rows) => {
                            if (err) return reject(err);
                            const tiles = {};
                            rows.forEach(row => {
                                const key = `${row.q},${row.r}`;
                                tiles[key] = {
                                    owner: row.owner,
                                    hasExclamation: row.hasExclamation === 1
                                };
                                if (!tiles[key].owner) delete tiles[key].owner;
                                if (!tiles[key].hasExclamation) tiles[key].hasExclamation = false;
                            });
                            resolve(tiles);
                        });
                    });
                });
                
                socket.emit('fullMapData', { tiles: allOccupiedTiles });
                log(`Server: Sent full map data (${Object.keys(allOccupiedTiles).length} tiles) to ${socket.username}`);
            } catch (err) {
                error('Error getting full map data:', err);
            }
        });
        
        socket.on('requestTilesInView', async ({ minQ, maxQ, minR, maxR }) => {
            if (!socket.username) return;
            
            try {
                // Get tiles in the requested view area
                const viewTiles = await safeDbOperation(() => {
                    const db = getDb();
                    return new Promise((resolve, reject) => {
                        db.all(
                            `SELECT q, r, owner, population, hasExclamation, isDisconnected 
                             FROM tiles 
                             WHERE q BETWEEN ? AND ? AND r BETWEEN ? AND ?`,
                            [minQ, maxQ, minR, maxR],
                            (err, rows) => {
                                if (err) return reject(err);
                                const tiles = {};
                                rows.forEach(row => {
                                    const key = `${row.q},${row.r}`;
                                    tiles[key] = {
                                        owner: row.owner,
                                        population: row.population,
                                        hasExclamation: row.hasExclamation === 1,
                                        isDisconnected: row.isDisconnected === 1
                                    };
                                    if (!tiles[key].owner) delete tiles[key].owner;
                                    if (!tiles[key].population) delete tiles[key].population;
                                    // Keep boolean states for proper sync
                                });
                                resolve(tiles);
                            }
                        );
                    });
                });
                
                socket.emit('viewTilesData', { tiles: viewTiles });
            } catch (err) {
                error('Error getting view tiles:', err);
            }
        });

        socket.on('requestPlayerStats', async () => {
            if (!socket.username) return;
            
            try {
                // Get accurate stats directly from database
                const playerStats = await safeDbOperation(() => {
                    const db = getDb();
                    return new Promise((resolve, reject) => {
                        db.all("SELECT population FROM tiles WHERE owner = ?", [socket.username], (err, rows) => {
                            if (err) return reject(err);
                            let totalPopulation = 0;
                            let totalArea = rows.length;
                            
                            rows.forEach(row => {
                                const population = row.population || 0;
                                totalPopulation += population;
                            });
                            
                            resolve({ population: totalPopulation, area: totalArea });
                        });
                    });
                });
                
                socket.emit('playerStatsData', playerStats);
            } catch (err) {
                error('Error getting player stats:', err);
            }
        });

        socket.on('disconnect', () => {
            
        });
    });
}


module.exports = { initializeSocket };