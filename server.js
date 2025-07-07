const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');


const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;
const GRID_STATE_FILE = path.join(__dirname, 'grid_state.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Setup logging to files
const serverLogStream = fs.createWriteStream(path.join(__dirname, 'server.log'), { flags: 'w' });
const clientLogStream = fs.createWriteStream(path.join(__dirname, 'client.log'), { flags: 'w' });

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
    originalConsoleLog(...args);
    serverLogStream.write(new Date().toISOString() + ' [INFO] ' + args.join(' ') + '\n');
};

console.error = (...args) => {
    originalConsoleError(...args);
    serverLogStream.write(new Date().toISOString() + ' [ERROR] ' + args.join(' ') + '\n');
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let gridState = {};
let users = {};

// --- Start of Optimizations ---

function broadcastTileUpdate(key) {
    const tile = gridState[key];
    io.emit('tileUpdate', { key, tile: tile || null }); // Send null if tile is deleted
    console.log(`Server: Broadcasted update for tile ${key}`);
}

function generateRandomColor() {
    let color;
    do {
        color = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
    } while (color.toLowerCase() === '#ffffff'); // Ensure the color is not white
    return color;
}

function broadcastLeaderboard() {
    const leaderboard = calculateLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
}

let isSaving = false;
function saveGameState() {
    if (isSaving) return;
    isSaving = true;
    console.log('Server: Saving game state...');
    const gridStateString = JSON.stringify(gridState, null, 2);
    fs.writeFile(GRID_STATE_FILE, gridStateString, (err) => {
        if (err) {
            console.error('Error saving grid state:', err);
        }
        isSaving = false;
    });
    const usersString = JSON.stringify(users, null, 2);
    fs.writeFile(USERS_FILE, usersString, (err) => {
        if (err) {
            console.error('Error saving users:', err);
        }
    });
}

// Periodic saving and leaderboard broadcasts
setInterval(saveGameState, 30 * 1000); // Save every 30 seconds
setInterval(broadcastLeaderboard, 5000); // Broadcast leaderboard every 5 seconds

const EXCLAMATION_SPAWN_INTERVAL = 60 * 1000; // 1 minute
const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes

function generateExclamationMark() {
    const activeUsers = Object.values(users).filter(user => user.capitol); // Only consider users with a capitol
    if (activeUsers.length === 0) {
        return; // No users to spawn around
    }

    // Pick a random user to spawn near
    const randomUser = activeUsers[Math.floor(Math.random() * activeUsers.length)];
    const [userCapitolQ, userCapitolR] = randomUser.capitol.split(',').map(Number);

    let attempts = 0;
    const MAX_ATTEMPTS = 50; // Limit attempts to find a suitable tile

    while (attempts < MAX_ATTEMPTS) {
        // Generate random coordinates within the radius
        const angle = Math.random() * 2 * Math.PI;
        const distance = Math.random() * EXCLAMATION_SPAWN_RADIUS;

        // Convert polar to hexagonal coordinates (approximate)
        const q = userCapitolQ + Math.round(distance * Math.cos(angle));
        const r = userCapitolR + Math.round(distance * Math.sin(angle));
        const key = `${q},${r}`;

        // Check if the tile is unoccupied and doesn't already have an exclamation mark
        if (!gridState[key] || (!gridState[key].owner && !gridState[key].hasExclamation)) {
            gridState[key] = { hasExclamation: true };
            broadcastTileUpdate(key);
            console.log(`Server: Spawned '!' at ${key}`);
            return; // Successfully spawned
        }
        attempts++;
    }
    console.log(`Server: Failed to spawn '!' after multiple attempts.`);
}

setInterval(generateExclamationMark, EXCLAMATION_SPAWN_INTERVAL);

// --- End of Optimizations ---


// Helper functions (moved to global scope for AI access)
const MIN_SPAWN_DISTANCE = 150;

function findRandomSpawn() {
    let q, r, key;
    let attempts = 0;
    const MAX_ATTEMPTS = 10000; // Prevent infinite loops

    while (attempts < MAX_ATTEMPTS) {
        q = Math.floor(Math.random() * 400) - 200; // Increased range for better distribution
        r = Math.floor(Math.random() * 400) - 200; // Increased range for better distribution
        key = `${q},${r}`;

        // Check if the tile is occupied or has an exclamation mark
        if (gridState[key] && (gridState[key].owner || gridState[key].hasExclamation)) {
            attempts++;
            continue;
        }

        let tooClose = false;
        for (const existingKey in gridState) {
            const existingTile = gridState[existingKey];
            if (existingTile.owner || existingTile.hasExclamation) {
                const [eq, er] = existingKey.split(',').map(Number);
                if (hexDistance(q, r, eq, er) < MIN_SPAWN_DISTANCE) {
                    tooClose = true;
                    break;
                }
            }
        }

        if (!tooClose) {
            return key;
        }
        attempts++;
    }
    console.warn('Server: Could not find a suitable spawn point after many attempts. Spawning at a less ideal location.');
    // Fallback to original random spawn if no ideal spot is found
    do {
        q = Math.floor(Math.random() * 200) - 100;
        r = Math.floor(Math.random() * 200) - 100;
        key = `${q},${r}`;
    } while (gridState[key]);
    return key;
}

function getHexNeighbors(q, r) {
    const neighbors = [
        { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
    ];
    return neighbors.map(n => ({ q: q + n.dq, r: r + n.dr }));
}

function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

function calculateLeaderboard() {
    const playerStats = {};

    for (const key in gridState) {
        const tile = gridState[key];
        if (tile.owner) {
            if (!playerStats[tile.owner]) {
                playerStats[tile.owner] = { username: tile.owner, population: 0, area: 0 };
            }
            playerStats[tile.owner].population += tile.population;
            playerStats[tile.owner].area++;
        }
    }

    const sortedByPopulation = Object.values(playerStats).sort((a, b) => b.population - a.population).slice(0, 5);
    const sortedByArea = Object.values(playerStats).sort((a, b) => b.area - a.area).slice(0, 5);

    return { population: sortedByPopulation, area: sortedByArea };
}

function getConnectedTiles(startQ, startR, owner) {
    const visited = new Set();
    const queue = [`${startQ},${startR}`];
    const connectedTiles = new Set();

    while (queue.length > 0) {
        const currentKey = queue.shift();
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);

        const [q, r] = currentKey.split(',').map(Number);
        const tile = gridState[currentKey];

        if (tile && tile.owner === owner) {
            connectedTiles.add(currentKey);
            const neighbors = getHexNeighbors(q, r);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.q},${neighbor.r}`;
                if (!visited.has(neighborKey) && gridState[neighborKey] && gridState[neighborKey].owner === owner) {
                    queue.push(neighborKey);
                }
            }
        }
    }
    return connectedTiles;
}

function isAdjacentToUserTerritory(q, r, username) {
    const neighbors = getHexNeighbors(q, r);

    for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r}`;
        const neighborTile = gridState[neighborKey];
        if (neighborTile && neighborTile.owner === username) {
            return true;
        }
    }
    return false;
}

function applyDisconnectionPenalty() {
    let stateChanged = false;
    const changedTilesForBroadcast = {};

    // First, clear all isDisconnected flags
    for (const key in gridState) {
        if (gridState[key].isDisconnected) {
            gridState[key].isDisconnected = false;
            stateChanged = true;
            changedTilesForBroadcast[key] = gridState[key];
        }
    }

    for (const username in users) {
        const user = users[username];
        const [capitolQ, capitolR] = user.capitol.split(',').map(Number);
        const connectedTiles = getConnectedTiles(capitolQ, capitolR, username);

        for (const key in gridState) {
            const tile = gridState[key];
            if (tile.owner === username) {
                if (!connectedTiles.has(key)) {
                    // This tile is disconnected
                    if (!tile.isDisconnected) {
                        tile.isDisconnected = true;
                        stateChanged = true;
                        changedTilesForBroadcast[key] = tile;
                    }

                    if ((tile.population || 0) > 1) {
                        tile.population = (tile.population || 0) - 1;
                        console.log(`Server: Disconnected tile ${key} for ${username} lost population. New population: ${tile.population}`);
                        changedTilesForBroadcast[key] = tile;
                    } else if ((tile.population || 0) === 1) {
                        // If population drops to 0, the tile becomes neutral
                        delete gridState[key];
                        stateChanged = true;
                        changedTilesForBroadcast[key] = null; // Mark for deletion on client
                        console.log(`Server: Disconnected tile ${key} for ${username} lost all population and became neutral.`);
                    }
                } else if (tile.isDisconnected) {
                    // Tile reconnected, clear the flag
                    tile.isDisconnected = false;
                    stateChanged = true;
                    changedTilesForBroadcast[key] = tile;
                }
            }
        }
    }

    if (stateChanged) {
        // Sending a batch of updates is better than the whole state
        io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
        console.log('Server: Broadcasted batch tile update due to disconnection penalty.');
    }
}

function applyExclamationEffect(q, r, username, visited) {
    const key = `${q},${r}`;
    if (visited.has(key)) {
        return; // Already processed this tile in the current cascade
    }
    visited.add(key);

    const tile = gridState[key];

    // Capture the exclamation tile itself
    gridState[key] = { owner: username, population: 1 };
    broadcastTileUpdate(key); // Update the clicked tile

    // Process neighbors
    const neighbors = getHexNeighbors(q, r);
    for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r}`;
        const neighborTile = gridState[neighborKey];

        if (!neighborTile) {
            // Empty tile, capture it
            gridState[neighborKey] = { owner: username, population: 1 };
        } else if (neighborTile.owner === username) {
            // Own tile, increase population
            gridState[neighborKey].population = (neighborTile.population || 0) + 1;
        } else {
            // Enemy tile, decrease population or capture
            if ((neighborTile.population || 0) > 1) {
                gridState[neighborKey].population = (neighborTile.population || 0) - 1;
            } else {
                gridState[neighborKey].owner = username;
                gridState[neighborKey].population = 1;
            }
        }
        broadcastTileUpdate(neighborKey); // Update affected neighbor

        // If the neighbor also has an exclamation mark, trigger its effect recursively
        if (gridState[neighborKey] && gridState[neighborKey].hasExclamation) {
            delete gridState[neighborKey].hasExclamation; // Remove exclamation mark to prevent re-triggering
            applyExclamationEffect(neighbor.q, neighbor.r, username, visited);
        }
    }
}

// Load grid state and users from files
try {
    const gridData = fs.readFileSync(GRID_STATE_FILE, 'utf8');
    gridState = JSON.parse(gridData);
    console.log('Server: Grid state loaded from file.');
} catch (err) {
    console.warn('Server: No existing grid state file found. Initializing new state.');
}

try {
    const usersData = fs.readFileSync(USERS_FILE, 'utf8');
    users = JSON.parse(usersData);
    console.log('Server: Users loaded from file.');
} catch (err)
{
    console.warn('Server: No existing users file found. Initializing new users object.');
}

// Run disconnection penalty every 30 seconds
setInterval(applyDisconnectionPenalty, 30 * 1000);

io.on('connection', (socket) => {
    console.log('Server: A user connected');

    socket.on('login', ({ username, password }) => {
        console.log(`Server: Login attempt for username: ${username}`);
        if (!/^[a-zA-Z0-9]+$/.test(username)) {
            console.log(`Server: Login error - Username "${username}" is not alphanumeric.`);
            socket.emit('loginError', 'Username must be alphanumeric.');
            return;
        }
        if (users[username]) {
            console.log(`Server: User "${username}" found.`);
            if (users[username].password === password) {
                console.log(`Server: Password for "${username}" matched. Login successful.`);
                socket.emit('loginSuccess', { user: users[username] });
                // Send full state to the connecting user ONLY
                socket.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
                console.log(`Server: Emitted initial gameState to ${username}.`);
                socket.username = username;
            } else {
                console.log(`Server: Invalid password for "${username}".`);
                socket.emit('loginError', 'Invalid password.');
            }
        } else {
            console.log(`Server: User "${username}" not found. Creating new user.`);
            const newUser = {
                username,
                password, // In a real app, hash this!
                color: generateRandomColor(),
                capitol: findRandomSpawn(),
            };
            users[username] = newUser;
            gridState[newUser.capitol] = { owner: username, population: 1 };
            
            console.log(`Server: New user "${username}" created and logged in.`);
            socket.emit('loginSuccess', { user: newUser });
            // Send full state to the new user
            socket.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
            // Announce the new user's color and capitol to others
            io.emit('userUpdate', { users });
            broadcastTileUpdate(newUser.capitol);
            socket.username = username;
        }
    });

    socket.on('hexClick', ({ q, r }) => {
        if (!socket.username) return;

        const key = `${q},${r}`;
        const user = users[socket.username];
        const tile = gridState[key];

        const isCapitol = Object.values(users).some(u => u.capitol === key);

        if (tile && tile.hasExclamation) {
            applyExclamationEffect(q, r, user.username, new Set());
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

        broadcastTileUpdate(key);
    });

    socket.on('disconnect', () => {
        
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);

    
});