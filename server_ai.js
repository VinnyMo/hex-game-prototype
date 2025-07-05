const path = require('path');
const fs = require('fs');

let io;
let gridState;
let users;
let calculateLeaderboard;
let getHexNeighbors;
let hexDistance;
let GRID_STATE_FILE;
let USERS_FILE;

const AI_USERNAME = '[AI]TheBeast';
const AI_COLOR = '#800080'; // Purple color for the AI
const AI_SPAWN_DISTANCE = 1000; // Approximately 1000 hexes away
const AI_TURN_INTERVAL = 60 * 1000; // Every minute

function init(socketIo, currentGridState, currentUsers, fileSystem, leaderboardCalculator, hexNeighborGetter, hexDistCalculator, gridStateFile, usersFile) {
    io = socketIo;
    gridState = currentGridState;
    users = currentUsers;
    calculateLeaderboard = leaderboardCalculator;
    getHexNeighbors = hexNeighborGetter;
    hexDistance = hexDistCalculator;
    GRID_STATE_FILE = gridStateFile;
    USERS_FILE = usersFile;
}

function findDistantSpawn() {
    const existingCapitols = Object.values(users).map(u => u.capitol);
    let q, r, key;
    let isSafe = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 1000;

    while (!isSafe && attempts < MAX_ATTEMPTS) {
        // Generate random coordinates far away
        q = Math.floor(Math.random() * 2000) - 1000; // Range from -1000 to 1000
        r = Math.floor(Math.random() * 2000) - 1000; // Range from -1000 to 1000
        key = `${q},${r}`;
        isSafe = true;

        // Check if the spot is already occupied
        if (gridState[key]) {
            isSafe = false;
            attempts++;
            continue;
        }

        // Check distance to all existing capitols
        for (const capitol of existingCapitols) {
            const [cq, cr] = capitol.split(',').map(Number);
            const distance = hexDistance(q, r, cq, cr);
            if (distance < AI_SPAWN_DISTANCE) {
                isSafe = false;
                break;
            }
        }
        attempts++;
    }

    if (!isSafe) {
        console.warn('AI: Could not find a sufficiently distant spawn point after many attempts. Spawning at a less ideal location.');
        // Fallback: find any unoccupied tile
        while (gridState[`${q},${r}`]) {
            q = Math.floor(Math.random() * 200) - 100;
            r = Math.floor(Math.random() * 200) - 100;
        }
        key = `${q},${r}`;
    }
    return key;
}

function aiTurn() {
    console.log('AI: [AI]TheBeast is taking its turn...');

    const aiUser = users[AI_USERNAME];
    if (!aiUser) {
        console.error('AI: AI user not found. Stopping AI turns.');
        clearInterval(aiInterval);
        return;
    }

    let aiOwnedTiles = [];
    for (const key in gridState) {
        if (gridState[key].owner === AI_USERNAME) {
            aiOwnedTiles.push(key);
        }
    }

    if (aiOwnedTiles.length === 0) {
        console.log('AI: [AI]TheBeast has no tiles. Re-spawning capitol.');
        aiUser.capitol = findDistantSpawn();
        gridState[aiUser.capitol] = { owner: AI_USERNAME, population: 1 };
        fs.writeFileSync(GRID_STATE_FILE, JSON.stringify(gridState, null, 2));
        io.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
        return;
    }

    let potentialNewTiles = new Map(); // Map<key, {q, r}>
    let closestEnemyTile = null;
    let minEnemyDistance = Infinity;

    // Find all bordering neutral tiles and the closest enemy tile
    for (const tileKey of aiOwnedTiles) {
        const [q, r] = tileKey.split(',').map(Number);
        const neighbors = getHexNeighbors(q, r);

        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.q},${neighbor.r}`;
            const neighborTile = gridState[neighborKey];

            if (!neighborTile) { // Neutral tile
                potentialNewTiles.set(neighborKey, neighbor);
            } else if (neighborTile.owner !== AI_USERNAME) { // Enemy tile
                const dist = hexDistance(q, r, neighbor.q, neighbor.r); // Distance from AI tile to enemy tile
                if (dist < minEnemyDistance) {
                    minEnemyDistance = dist;
                    closestEnemyTile = neighbor;
                }
            }
        }
    }

    if (potentialNewTiles.size === 0) {
        console.log('AI: No neutral bordering tiles to expand into.');
        return;
    }

    let bestTileToCapture = null;
    let maxDistanceToClosestEnemy = -1;

    // If there are no enemy tiles, just pick any bordering neutral tile
    if (!closestEnemyTile) {
        bestTileToCapture = potentialNewTiles.values().next().value;
        console.log('AI: No enemy tiles found. Capturing a random bordering neutral tile.');
    } else {
        // Find the neutral tile furthest from the closest enemy tile
        for (const [key, coords] of potentialNewTiles.entries()) {
            const dist = hexDistance(coords.q, coords.r, closestEnemyTile.q, closestEnemyTile.r);
            if (dist > maxDistanceToClosestEnemy) {
                maxDistanceToClosestEnemy = dist;
                bestTileToCapture = coords;
            }
        }
        console.log(`AI: Closest enemy tile at ${closestEnemyTile.q},${closestEnemyTile.r}. Capturing tile ${bestTileToCapture.q},${bestTileToCapture.r} (distance ${maxDistanceToClosestEnemy}).`);
    }

    if (bestTileToCapture) {
        const captureKey = `${bestTileToCapture.q},${bestTileToCapture.r}`;
        gridState[captureKey] = { owner: AI_USERNAME, population: 1 };
        fs.writeFileSync(GRID_STATE_FILE, JSON.stringify(gridState, null, 2));
        io.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
        console.log(`AI: [AI]TheBeast captured tile ${captureKey}`);
    } else {
        console.log('AI: No suitable tile found for capture.');
    }
}

let aiInterval;

function startAI() {
    // Ensure AI user exists before starting the interval
    if (!users[AI_USERNAME]) {
        console.log(`AI: Creating new AI user ${AI_USERNAME}`);
        const aiCapitol = findDistantSpawn();
        users[AI_USERNAME] = {
            username: AI_USERNAME,
            password: 'AI_PASSWORD', // AI doesn't need a real password
            color: AI_COLOR,
            capitol: aiCapitol,
        };
        gridState[aiCapitol] = { owner: AI_USERNAME, population: 1 };
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        fs.writeFileSync(GRID_STATE_FILE, JSON.stringify(gridState, null, 2));
        io.emit('gameState', { gridState, users, leaderboard: calculateLeaderboard() });
    }

    aiInterval = setInterval(aiTurn, AI_TURN_INTERVAL);
    console.log(`AI: [AI]TheBeast AI started, taking a turn every ${AI_TURN_INTERVAL / 1000} seconds.`);
}

function stopAI() {
    if (aiInterval) {
        clearInterval(aiInterval);
        console.log('AI: [AI]TheBeast AI stopped.');
    }
}

module.exports = {
    init,
    startAI,
    stopAI,
    AI_USERNAME // Export for external reference if needed
};
