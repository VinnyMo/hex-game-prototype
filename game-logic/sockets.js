const { getGridState, getUsers, setGridState, setUsers } = require('./gameState');
const { findRandomSpawn, calculateLeaderboard, applyExclamationEffect, isAdjacentToUserTerritory } = require('./game');
const { generateRandomColor } = require('./utils');
const { log, error } = require('./logging');

function initializeSocket(io) {
    io.on('connection', (socket) => {
        log('Server: A user connected');

        socket.on('login', ({ username, password }) => {
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
            let users = getUsers();
            let gridState = getGridState();
            if (users[username]) {
                log(`Server: User "${username}" found.`);
                if (users[username].password === password) {
                    log(`Server: Password for "${username}" matched. Login successful.`);
                    socket.emit('loginSuccess', { user: users[username], exploredTiles: users[username].exploredTiles });
                    // Send full state to the connecting user ONLY
                    socket.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
                    log(`Server: Emitted initial gameState to ${username}.`);
                    socket.username = username;
                } else {
                    log(`Server: Invalid password for "${username}".`);
                    socket.emit('loginError', 'Invalid password.');
                }
            } else {
                log(`Server: User "${username}" not found. Creating new user.`);
                const newUser = {
                    username,
                    password, // In a real app, hash this!
                    color: generateRandomColor(),
                    capitol: findRandomSpawn(),
                };
                newUser.exploredTiles = [newUser.capitol]; // Initialize with only the capitol tile after capitol is set
                users[username] = newUser;
                gridState[newUser.capitol] = { owner: username, population: 1 };

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

                        if (!gridState[key] || (!gridState[key].owner && !gridState[key].hasExclamation)) {
                            gridState[key] = { hasExclamation: true };
                            io.emit('tileUpdate', { key, tile: gridState[key] });
                            spawned = true;
                        }
                        attempts++;
                    }
                }
                // Emit event to client that initial spawn is complete
                socket.emit('initialSpawnComplete');
                setUsers(users);
                setGridState(gridState);
                
                log(`Server: New user "${username}" created and logged in.`);
                socket.emit('loginSuccess', { user: newUser, exploredTiles: newUser.exploredTiles });
                // Send full state to the new user
                socket.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
                // Announce the new user's color and capitol to others
                io.emit('userUpdate', { users });
                io.emit('tileUpdate', { key: newUser.capitol, tile: gridState[newUser.capitol] });
                socket.username = username;
            }
        });

        socket.on('syncExploredTiles', (tiles) => {
            if (!socket.username) return;
            let users = getUsers();
            users[socket.username].exploredTiles = tiles;
            setUsers(users);
        });

        socket.on('hexClick', ({ q, r }) => {
            if (!socket.username) return;

            const key = `${q},${r}`;
            let users = getUsers();
            let gridState = getGridState();
            const user = users[socket.username];
            const tile = gridState[key];

            const isCapitol = Object.values(users).some(u => u.capitol === key);

            if (tile && tile.hasExclamation) {
                if (!isAdjacentToUserTerritory(q, r, user.username)) {
                    socket.emit('actionError', "You can only capture '!' tiles adjacent to your territory.");
                    return;
                }
                applyExclamationEffect(q, r, user.username, new Set(), io);
            } else if (tile && tile.owner !== user.username) { // Attack an enemy tile
                if (!isAdjacentToUserTerritory(q, r, user.username)) {
                    socket.emit('actionError', 'You can only attack tiles adjacent to your territory.');
                    return;
                }
                if (isCapitol) { // Capitol is immortal
                    socket.emit('actionError', 'You cannot attack a capitol tile.');
                    return;
                }
                if (tile.population > 1) {
                    gridState[key].population--;
                } else {
                    gridState[key].owner = user.username;
                }
            } else { // Conquer or reinforce own tile
                if (!tile) { // New tile
                    if (!isAdjacentToUserTerritory(q, r, user.username)) {
                        socket.emit('actionError', 'You can only claim tiles adjacent to your territory.');
                        return;
                    }
                    gridState[key] = { owner: user.username, population: 1 };
                } else if (tile.owner === user.username) { // Own tile
                    gridState[key].population++;
                }
            }
            setGridState(gridState);
            io.emit('tileUpdate', { key, tile: gridState[key] });
        });

        socket.on('disconnect', () => {
            
        });
    });
}

module.exports = { initializeSocket };