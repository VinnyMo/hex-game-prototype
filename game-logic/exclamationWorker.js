const { parentPort } = require('worker_threads');
const { getGridState, getUsers, setGridState, setUsers } = require('./gameState');
const { getHexNeighbors } = require('./utils');
const { log, error } = require('./logging');

const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes, from game.js

function generateExclamationMark() {
    const users = getUsers();
    const gridState = getGridState();
    const activeUsers = Object.values(users).filter(user => user.capitol); // Only consider users with a capitol
    if (activeUsers.length === 0) {
        return null; // No users to spawn around
    }

    const changedTilesForBroadcast = {};
    let stateChanged = false;

    activeUsers.forEach(user => { // Iterate over each active user
        let ownedTiles = [];
        for (const key in gridState) {
            const tile = gridState[key];
            if (tile.owner === user.username) {
                ownedTiles.push(key);
            }
        }

        if (ownedTiles.length === 0) {
            log(`Server: User ${user.username} has no owned tiles to spawn '!' around.`);
            return; // Skip if user has no owned tiles
        }

        const randomOwnedTileKey = ownedTiles[Math.floor(Math.random() * ownedTiles.length)];
        const [spawnCenterQ, spawnCenterR] = randomOwnedTileKey.split(',').map(Number);

        let attempts = 0;
        const MAX_ATTEMPTS = 50; // Limit attempts to find a suitable tile
        let spawnedForUser = false;
        const NEW_SPAWN_RADIUS = 50; // New radius as per user request

        while (attempts < MAX_ATTEMPTS && !spawnedForUser) {
            // Generate random coordinates within the radius
            const angle = Math.random() * 2 * Math.PI;
            const distance = Math.random() * NEW_SPAWN_RADIUS;

            // Convert polar to hexagonal coordinates (approximate)
            const q = spawnCenterQ + Math.round(distance * Math.cos(angle));
            const r = spawnCenterR + Math.round(distance * Math.sin(angle));
            const key = `${q},${r}`;

            // Check if the tile is unoccupied and doesn't already have an exclamation mark
            if (!gridState[key] || (!gridState[key].owner && !gridState[key].hasExclamation)) {
                gridState[key] = { hasExclamation: true };
                changedTilesForBroadcast[key] = gridState[key];
                log(`Server: Spawned '!' at ${key} for user ${user.username}`); // Log for specific user
                stateChanged = true;
                spawnedForUser = true; // Mark as spawned for this user
            }
            attempts++;
        }
        if (!spawnedForUser) {
            log(`Server: Failed to spawn '!' for user ${user.username} after multiple attempts.`);
        }
    });

    if (stateChanged) {
        setGridState(gridState);
        setUsers(users); // Ensure users state is also updated if needed (e.g., if a user was added/removed)
        return changedTilesForBroadcast;
    } else {
        return null;
    }
}

parentPort.on('message', (message) => {
    if (message.command === 'generateExclamations') {
        const changedTiles = generateExclamationMark();
        parentPort.postMessage({ status: 'done', changedTiles });
    }
});
