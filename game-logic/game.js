const { getGridState, getUsers, setGridState, setUsers, getTile, safeDbOperation } = require('./gameState');
const { getHexNeighbors, hexDistance, generateRandomColor } = require('./utils');
const { log, error } = require('./logging');
const { getDb, safeDbOperation: dbSafeOp } = require('./db');

const EXCLAMATION_SPAWN_INTERVAL = 30 * 1000; // 30 seconds
const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes

async function calculateLeaderboard() {
    return dbSafeOp(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            db.all("SELECT owner, population FROM tiles WHERE owner IS NOT NULL", [], (err, rows) => {
                if (err) {
                    error('Error calculating leaderboard:', err);
                    return reject(err);
                }
                const playerStats = {};
                rows.forEach(row => {
                    if (!playerStats[row.owner]) {
                        playerStats[row.owner] = { username: row.owner, population: 0, area: 0 };
                    }
                    // Handle null/undefined population values safely
                    const population = row.population || 0;
                    playerStats[row.owner].population += population;
                    playerStats[row.owner].area++;
                });

                const sortedByPopulation = Object.values(playerStats).sort((a, b) => b.population - a.population).slice(0, 5);
                const sortedByArea = Object.values(playerStats).sort((a, b) => b.area - a.area).slice(0, 5);

                resolve({ population: sortedByPopulation, area: sortedByArea });
            });
        });
    });
}

async function getConnectedTiles(startQ, startR, owner) {
    const visited = new Set();
    const queue = [`${startQ},${startR}`];
    const connectedTiles = new Set();

    while (queue.length > 0) {
        const currentKey = queue.shift();
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);

        const [q, r] = currentKey.split(',').map(Number);
        const tile = await getTile(q, r);
        
        if (tile && tile.owner === owner) {
            connectedTiles.add(currentKey);
            
            // Add neighbors to queue
            const neighbors = getHexNeighbors(q, r);
            neighbors.forEach(neighbor => {
                const neighborKey = `${neighbor.q},${neighbor.r}`;
                if (!visited.has(neighborKey)) {
                    queue.push(neighborKey);
                }
            });
        }
    }
    
    return Array.from(connectedTiles);
}

async function isAdjacentToUserTerritory(q, r, username) {
    const neighbors = getHexNeighbors(q, r);
    
    for (const neighbor of neighbors) {
        const tile = await getTile(neighbor.q, neighbor.r);
        if (tile && tile.owner === username) {
            return true;
        }
    }
    
    return false;
}

async function applyExclamationEffect(startQ, startR, username, io) {
    const users = await getUsers();
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

        let tile = await getTile(q, r);

        // Capture the exclamation tile itself
        if (!tile || tile.hasExclamation === true) {
            await setGridState({ [key]: { owner: username, population: 1, hasExclamation: false } });
            changedTilesForBroadcast[key] = { owner: username, population: 1, hasExclamation: false };
        }

        // Process neighbors
        const neighbors = getHexNeighbors(q, r);
        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.q},${neighbor.r}`;
            
            const isNeighborCapitol = Object.values(users).some(u => u.capitol === neighborKey);

            if (isNeighborCapitol) {
                log(`Server: Exclamation effect skipped for capitol tile at ${neighborKey}.`);
                continue;
            }

            let neighborTile = await getTile(neighbor.q, neighbor.r);

            if (!neighborTile) {
                // Empty tile, capture it
                await setGridState({ [neighborKey]: { owner: username, population: 1 } });
                changedTilesForBroadcast[neighborKey] = { owner: username, population: 1, hasExclamation: false };
            } else if (neighborTile.owner === username) {
                // Own tile, increase population
                const newPopulation = (neighborTile.population || 0) + 1;
                await setGridState({ [neighborKey]: { ...neighborTile, population: newPopulation } });
                changedTilesForBroadcast[neighborKey] = { owner: username, population: newPopulation, hasExclamation: false };
            } else {
                // Enemy tile, decrease population or capture
                if ((neighborTile.population || 0) > 1) {
                    const newPopulation = (neighborTile.population || 0) - 1;
                    await setGridState({ [neighborKey]: { ...neighborTile, population: newPopulation } });
                    changedTilesForBroadcast[neighborKey] = { owner: neighborTile.owner, population: newPopulation, hasExclamation: false };
                } else {
                    await setGridState({ [neighborKey]: { owner: username, population: 1 } });
                    changedTilesForBroadcast[neighborKey] = { owner: username, population: 1, hasExclamation: false };
                }
            }

            // If the neighbor also has an exclamation mark, add it to the queue
            if (neighborTile && neighborTile.hasExclamation === true && !visited.has(neighborKey)) {
                queue.push(neighbor);
            }
        }
    }
    io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
}

async function applyDisconnectionPenalty(io) {
    try {
        const users = await getUsers();
        const changedTilesForBroadcast = {};
        let stateChanged = false;

        for (const username in users) {
            const user = users[username];
            if (!user.capitol) continue;

            const [capitolQ, capitolR] = user.capitol.split(',').map(Number);
            const connectedTiles = new Set(await getConnectedTiles(capitolQ, capitolR, username));

            // Get all tiles owned by this user efficiently
            const userTiles = await dbSafeOp(() => {
                const db = getDb();
                return new Promise((resolve, reject) => {
                    db.all("SELECT q, r, population, isDisconnected FROM tiles WHERE owner = ?", [username], (err, rows) => {
                        if (err) return reject(err);
                        resolve(rows);
                    });
                });
            });

            for (const tileRow of userTiles) {
                const key = `${tileRow.q},${tileRow.r}`;
                const isConnected = connectedTiles.has(key);
                const isCurrentlyDisconnected = tileRow.isDisconnected === 1;

                if (!isConnected && !isCurrentlyDisconnected) {
                    // Mark as disconnected and reduce population
                    const newPopulation = Math.max(0, (tileRow.population || 1) - 1);
                    
                    if (newPopulation === 0) {
                        // Remove tile entirely
                        await setGridState({ [key]: null });
                        changedTilesForBroadcast[key] = null;
                    } else {
                        await setGridState({ [key]: { 
                            owner: username, 
                            population: newPopulation, 
                            isDisconnected: true 
                        }});
                        changedTilesForBroadcast[key] = { 
                            owner: username, 
                            population: newPopulation, 
                            isDisconnected: true 
                        };
                    }
                    stateChanged = true;
                } else if (isConnected && isCurrentlyDisconnected) {
                    // Reconnect tile
                    await setGridState({ [key]: { 
                        owner: username, 
                        population: tileRow.population,
                        isDisconnected: false 
                    }});
                    changedTilesForBroadcast[key] = { 
                        owner: username, 
                        population: tileRow.population,
                        isDisconnected: false 
                    };
                    stateChanged = true;
                }
            }
        }

        if (stateChanged) {
            io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
            log('Server: Applied disconnection penalties.');
        }
    } catch (err) {
        error('Error applying disconnection penalty:', err);
    }
}

module.exports = {
    calculateLeaderboard,
    getConnectedTiles,
    isAdjacentToUserTerritory,
    applyDisconnectionPenalty,
    applyExclamationEffect,
    EXCLAMATION_SPAWN_INTERVAL,
    EXCLAMATION_SPAWN_RADIUS
};