const { getGridState, getUsers, setGridState, setUsers } = require('./gameState');
const { getHexNeighbors, hexDistance, generateRandomColor } = require('./utils');
const { log, error } = require('./logging');

const EXCLAMATION_SPAWN_INTERVAL = 60 * 1000; // 1 minute
const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes

function calculateLeaderboard() {
    const playerStats = {};
    const gridState = getGridState();

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
    const gridState = getGridState();

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
    const gridState = getGridState();

    for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r}`;
        const neighborTile = gridState[neighborKey];
        if (neighborTile && neighborTile.owner === username) {
            return true;
        }
    }
    return false;
}

function applyDisconnectionPenalty(io) {
    let stateChanged = false;
    const changedTilesForBroadcast = {};
    const gridState = getGridState();
    const users = getUsers();

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
                        log(`Server: Disconnected tile ${key} for ${username} lost population. New population: ${tile.population}`);
                        changedTilesForBroadcast[key] = tile;
                    } else if ((tile.population || 0) === 1) {
                        // If population drops to 0, the tile becomes neutral
                        delete gridState[key];
                        stateChanged = true;
                        changedTilesForBroadcast[key] = null; // Mark for deletion on client
                        log(`Server: Disconnected tile ${key} for ${username} lost all population and became neutral.`);
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
        log('Server: Broadcasted batch tile update due to disconnection penalty.');
    }
    setGridState(gridState);
}

function applyExclamationEffect(startQ, startR, username, io) {
    const gridState = getGridState();
    const users = getUsers();
    const queue = [{ q: startQ, r: startR }];
    const visited = new Set();
    const changedTilesForBroadcast = {};

    while (queue.length > 0) {
        const { q, r } = queue.shift();
        const key = `${q},${r}`;

        if (visited.has(key)) {
            continue;
        }
        visited.add(key);

        const tile = gridState[key];

        // Capture the exclamation tile itself
        if (!tile || tile.hasExclamation) {
            gridState[key] = { owner: username, population: 1 };
            if (tile && tile.hasExclamation) {
                delete gridState[key].hasExclamation; // Remove exclamation mark
            }
            changedTilesForBroadcast[key] = gridState[key];
        }

        // Process neighbors
        const neighbors = getHexNeighbors(q, r);
        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.q},${neighbor.r}`;
            const neighborTile = gridState[neighborKey];

            // Check if the neighbor tile is a capitol
            const isNeighborCapitol = Object.values(users).some(u => u.capitol === neighborKey);

            if (isNeighborCapitol) {
                log(`Server: Exclamation effect skipped for capitol tile at ${neighborKey}.`);
                continue; // Skip processing this tile if it's a capitol
            }

            if (!neighborTile) {
                // Empty tile, capture it
                gridState[neighborKey] = { owner: username, population: 1 };
                changedTilesForBroadcast[neighborKey] = gridState[neighborKey];
            } else if (neighborTile.owner === username) {
                // Own tile, increase population
                gridState[neighborKey].population = (neighborTile.population || 0) + 1;
                changedTilesForBroadcast[neighborKey] = gridState[neighborKey];
            } else {
                // Enemy tile, decrease population or capture
                if ((neighborTile.population || 0) > 1) {
                    gridState[neighborKey].population = (neighborTile.population || 0) - 1;
                    changedTilesForBroadcast[neighborKey] = gridState[neighborKey];
                } else {
                    gridState[neighborKey].owner = username;
                    gridState[neighborKey].population = 1;
                    changedTilesForBroadcast[neighborKey] = gridState[neighborKey];
                }
            }

            // If the neighbor also has an exclamation mark, add it to the queue
            if (gridState[neighborKey] && gridState[neighborKey].hasExclamation && !visited.has(neighborKey)) {
                queue.push(neighbor);
            }
        }
    }
    setGridState(gridState);
    io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
}

function generateExclamationMark(io) {
    const users = getUsers();
    const gridState = getGridState();
    const activeUsers = Object.values(users).filter(user => user.capitol); // Only consider users with a capitol
    if (activeUsers.length === 0) {
        return; // No users to spawn around
    }

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
            const distance = Math.random() * NEW_SPAWN_RADIUS; // Use new radius

            // Convert polar to hexagonal coordinates (approximate)
            const q = spawnCenterQ + Math.round(distance * Math.cos(angle));
            const r = spawnCenterR + Math.round(distance * Math.sin(angle));
            const key = `${q},${r}`;

            // Check if the tile is unoccupied and doesn't already have an exclamation mark
            if (!gridState[key] || (!gridState[key].owner && !gridState[key].hasExclamation)) {
                gridState[key] = { hasExclamation: true };
                io.emit('tileUpdate', { key, tile: gridState[key] });
                log(`Server: Spawned '!' at ${key} for user ${user.username}`); // Log for specific user
                setGridState(gridState);
                spawnedForUser = true; // Mark as spawned for this user
            }
            attempts++;
        }
        if (!spawnedForUser) {
            log(`Server: Failed to spawn '!' for user ${user.username} after multiple attempts.`);
        }
    });
}

module.exports = {
    calculateLeaderboard,
    getConnectedTiles,
    isAdjacentToUserTerritory,
    applyDisconnectionPenalty,
    applyExclamationEffect,
    generateExclamationMark,
    EXCLAMATION_SPAWN_INTERVAL
};