const { getGridState, getUsers, setGridState, setUsers } = require('./gameState');
const { getHexNeighbors, hexDistance, generateRandomColor } = require('./utils');
const { log, error } = require('./logging');
const { getDb } = require('./db');

const EXCLAMATION_SPAWN_INTERVAL = 60 * 1000; // 1 minute
const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes

async function calculateLeaderboard() {
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
                playerStats[row.owner].population += row.population;
                playerStats[row.owner].area++;
            });

            const sortedByPopulation = Object.values(playerStats).sort((a, b) => b.population - a.population).slice(0, 5);
            const sortedByArea = Object.values(playerStats).sort((a, b) => b.area - a.area).slice(0, 5);

            resolve({ population: sortedByPopulation, area: sortedByArea });
        });
    });
}

async function getConnectedTiles(startQ, startR, owner) {
    const db = getDb();
    const visited = new Set();
    const queue = [`${startQ},${startR}`];
    const connectedTiles = new Set();

    while (queue.length > 0) {
        const currentKey = queue.shift();
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);

        const [q, r] = currentKey.split(',').map(Number);
        
        const tile = await new Promise((resolve, reject) => {
            db.get("SELECT owner FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (tile && tile.owner === owner) {
            connectedTiles.add(currentKey);
            const neighbors = getHexNeighbors(q, r);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.q},${neighbor.r}`;
                const neighborTile = await new Promise((resolve, reject) => {
                    db.get("SELECT owner FROM tiles WHERE q = ? AND r = ?", [neighbor.q, neighbor.r], (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    });
                });
                if (!visited.has(neighborKey) && neighborTile && neighborTile.owner === owner) {
                    queue.push(neighborKey);
                }
            }
        }
    }
    return connectedTiles;
}

async function isAdjacentToUserTerritory(q, r, username) {
    const db = getDb();
    const neighbors = getHexNeighbors(q, r);

    for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r}`;
        const neighborTile = await new Promise((resolve, reject) => {
            db.get("SELECT owner FROM tiles WHERE q = ? AND r = ?", [neighbor.q, neighbor.r], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (neighborTile && neighborTile.owner === username) {
            return true;
        }
    }
    return false;
}

async function applyDisconnectionPenalty(io) {
    const db = getDb();
    let stateChanged = false;
    const changedTilesForBroadcast = {};

    const allTiles = await getGridState(); // Get all tiles from DB
    const users = await getUsers(); // Get all users from DB

    // First, clear all isDisconnected flags
    for (const key in allTiles) {
        const tile = allTiles[key];
        if (tile.isDisconnected) {
            await new Promise((resolve, reject) => {
                db.run("UPDATE tiles SET isDisconnected = 0 WHERE q = ? AND r = ?", [tile.q, tile.r], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            tile.isDisconnected = false; // Update in-memory object for broadcast
            stateChanged = true;
            changedTilesForBroadcast[key] = tile;
        }
    }

    for (const username in users) {
        const user = users[username];
        if (!user.capitol) continue; // Skip users without a capitol

        const [capitolQ, capitolR] = user.capitol.split(',').map(Number);
        const connectedTiles = await getConnectedTiles(capitolQ, capitolR, username);

        const userOwnedTiles = await new Promise((resolve, reject) => {
            db.all("SELECT q, r, owner, population, hasExclamation, isDisconnected FROM tiles WHERE owner = ?", [username], (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(row => {
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
                    return { key: `${row.q},${row.r}`, tile };
                }));
            });
        });

        for (const { key, tile } of userOwnedTiles) {
            const [q, r] = key.split(',').map(Number);
            if (!connectedTiles.has(key)) {
                // This tile is disconnected
                if (!tile.isDisconnected) {
                    await new Promise((resolve, reject) => {
                        db.run("UPDATE tiles SET isDisconnected = 1 WHERE q = ? AND r = ?", [q, r], (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                    tile.isDisconnected = true;
                    stateChanged = true;
                    changedTilesForBroadcast[key] = tile;
                }

                if ((tile.population || 0) > 1) {
                    const newPopulation = (tile.population || 0) - 1;
                    await new Promise((resolve, reject) => {
                        db.run("UPDATE tiles SET population = ? WHERE q = ? AND r = ?", [newPopulation, q, r], (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                    tile.population = newPopulation;
                    log(`Server: Disconnected tile ${key} for ${username} lost population. New population: ${tile.population}`);
                    changedTilesForBroadcast[key] = tile;
                } else if ((tile.population || 0) === 1) {
                    // If population drops to 0, the tile becomes neutral
                    await new Promise((resolve, reject) => {
                        db.run("DELETE FROM tiles WHERE q = ? AND r = ?", [q, r], (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                    stateChanged = true;
                    changedTilesForBroadcast[key] = null; // Mark for deletion on client
                    log(`Server: Disconnected tile ${key} for ${username} lost all population and became neutral.`);
                }
            } else if (tile.isDisconnected) {
                // Tile reconnected, clear the flag
                await new Promise((resolve, reject) => {
                    db.run("UPDATE tiles SET isDisconnected = 0 WHERE q = ? AND r = ?", [q, r], (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                tile.isDisconnected = false;
                stateChanged = true;
                changedTilesForBroadcast[key] = tile;
            }
        }
    }

    if (stateChanged) {
        io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
        log('Server: Broadcasted batch tile update due to disconnection penalty.');
    }
}

async function applyExclamationEffect(startQ, startR, username, io) {
    const db = getDb();
    const users = await getUsers(); // Get users from DB
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

        let tile = await new Promise((resolve, reject) => {
            db.get("SELECT owner, population, hasExclamation FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        // Capture the exclamation tile itself
        if (!tile || tile.hasExclamation === 1) {
            await new Promise((resolve, reject) => {
                db.run("INSERT OR REPLACE INTO tiles (q, r, owner, population, hasExclamation) VALUES (?, ?, ?, ?, ?)", 
                    [q, r, username, 1, 0], // Set hasExclamation to 0 (false)
                    (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            changedTilesForBroadcast[key] = { owner: username, population: 1 };
        }

        // Process neighbors
        const neighbors = getHexNeighbors(q, r);
        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.q},${neighbor.r}`;
            
            const isNeighborCapitol = Object.values(users).some(u => u.capitol === neighborKey);

            if (isNeighborCapitol) {
                log(`Server: Exclamation effect skipped for capitol tile at ${neighborKey}.`);
                continue; // Skip processing this tile if it's a capitol
            }

            let neighborTile = await new Promise((resolve, reject) => {
                db.get("SELECT owner, population, hasExclamation FROM tiles WHERE q = ? AND r = ?", [neighbor.q, neighbor.r], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            if (!neighborTile) {
                // Empty tile, capture it
                await new Promise((resolve, reject) => {
                    db.run("INSERT INTO tiles (q, r, owner, population) VALUES (?, ?, ?, ?)", [neighbor.q, neighbor.r, username, 1], (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                changedTilesForBroadcast[neighborKey] = { owner: username, population: 1 };
            } else if (neighborTile.owner === username) {
                // Own tile, increase population
                const newPopulation = (neighborTile.population || 0) + 1;
                await new Promise((resolve, reject) => {
                    db.run("UPDATE tiles SET population = ? WHERE q = ? AND r = ?", [newPopulation, neighbor.q, neighbor.r], (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                changedTilesForBroadcast[neighborKey] = { owner: username, population: newPopulation };
            } else {
                // Enemy tile, decrease population or capture
                if ((neighborTile.population || 0) > 1) {
                    const newPopulation = (neighborTile.population || 0) - 1;
                    await new Promise((resolve, reject) => {
                        db.run("UPDATE tiles SET population = ? WHERE q = ? AND r = ?", [newPopulation, neighbor.q, neighbor.r], (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                    changedTilesForBroadcast[neighborKey] = { owner: neighborTile.owner, population: newPopulation };
                } else {
                    await new Promise((resolve, reject) => {
                        db.run("INSERT OR REPLACE INTO tiles (q, r, owner, population) VALUES (?, ?, ?, ?)", [neighbor.q, neighbor.r, username, 1], (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                    changedTilesForBroadcast[neighborKey] = { owner: username, population: 1 };
                }
            }

            // If the neighbor also has an exclamation mark, add it to the queue
            if (neighborTile && neighborTile.hasExclamation === 1 && !visited.has(neighborKey)) {
                queue.push(neighbor);
            }
        }
    }
    io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
}

module.exports = {
    calculateLeaderboard,
    getConnectedTiles,
    isAdjacentToUserTerritory,
    applyDisconnectionPenalty,
    applyExclamationEffect,
    EXCLAMATION_SPAWN_INTERVAL
};