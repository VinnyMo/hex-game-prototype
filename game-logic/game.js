const { getGridState, getUsers, setGridState, setUsers, getTile, safeDbOperation } = require('./gameState');
const { getHexNeighbors, hexDistance, generateRandomColor } = require('./utils');
const { log, error } = require('./logging');
const { getDb, safeDbOperation: dbSafeOp } = require('./db');

const EXCLAMATION_SPAWN_INTERVAL = 30 * 1000; // 30 seconds
const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes

// Cache for leaderboard with longer TTL since it's computationally expensive
const leaderboardCache = {
    data: null,
    lastUpdate: 0,
    TTL: 30000 // 30 seconds cache for leaderboard
};

async function calculateLeaderboard(forceRefresh = false) {
    const now = Date.now();
    
    // Return cached data if available and not expired
    if (!forceRefresh && leaderboardCache.data && (now - leaderboardCache.lastUpdate) < leaderboardCache.TTL) {
        return leaderboardCache.data;
    }

    return dbSafeOp(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            // Use a more efficient approach with subqueries for top performers
            db.all(`
                WITH user_stats AS (
                    SELECT 
                        owner,
                        SUM(COALESCE(population, 0)) as total_population,
                        COUNT(*) as area
                    FROM tiles 
                    WHERE owner IS NOT NULL 
                    GROUP BY owner
                ),
                top_by_population AS (
                    SELECT owner, total_population, area, 'population' as rank_type
                    FROM user_stats
                    ORDER BY total_population DESC, area DESC
                    LIMIT 5
                ),
                top_by_area AS (
                    SELECT owner, total_population, area, 'area' as rank_type
                    FROM user_stats
                    ORDER BY area DESC, total_population DESC
                    LIMIT 5
                )
                SELECT * FROM top_by_population
                UNION ALL
                SELECT * FROM top_by_area
            `, [], (err, rows) => {
                if (err) {
                    error('Error calculating leaderboard:', err);
                    return reject(err);
                }
                
                const populationLeaders = [];
                const areaLeaders = [];
                
                rows.forEach(row => {
                    const player = {
                        username: row.owner,
                        population: row.total_population || 0,
                        area: row.area || 0
                    };
                    
                    if (row.rank_type === 'population') {
                        populationLeaders.push(player);
                    } else {
                        areaLeaders.push(player);
                    }
                });

                const result = { 
                    population: populationLeaders, 
                    area: areaLeaders 
                };
                
                // Update cache
                leaderboardCache.data = result;
                leaderboardCache.lastUpdate = now;
                
                resolve(result);
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
        
        // Only consider tiles that are owned by the user AND not marked as disconnected
        if (tile && tile.owner === owner && !tile.isDisconnected) {
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
    io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast, cascadeOrigin: `${startQ},${startR}` });
}

async function applyDisconnectionPenalty(io) {
    try {
        const users = await getUsers();
        const changedTilesForBroadcast = {};
        let stateChanged = false;

        // Batch all user tiles in a single query for better performance
        const allUserTiles = await dbSafeOp(() => {
            const db = getDb();
            return new Promise((resolve, reject) => {
                db.all(`
                    SELECT owner, q, r, population, isDisconnected 
                    FROM tiles 
                    WHERE owner IS NOT NULL
                    ORDER BY owner
                `, [], (err, rows) => {
                    if (err) return reject(err);
                    
                    // Group tiles by owner for efficient processing
                    const tilesByUser = {};
                    rows.forEach(row => {
                        if (!tilesByUser[row.owner]) {
                            tilesByUser[row.owner] = [];
                        }
                        tilesByUser[row.owner].push(row);
                    });
                    resolve(tilesByUser);
                });
            });
        });

        // Process each user's connectivity in parallel
        const userProcessingPromises = Object.keys(users).map(async (username) => {
            const user = users[username];
            if (!user.capitol || !allUserTiles[username]) return { username, changes: {} };

            const [capitolQ, capitolR] = user.capitol.split(',').map(Number);
            const connectedTiles = new Set(await getConnectedTiles(capitolQ, capitolR, username));
            const userChanges = {};

            for (const tileRow of allUserTiles[username]) {
                const key = `${tileRow.q},${tileRow.r}`;
                const isConnected = connectedTiles.has(key);
                const isCurrentlyDisconnected = tileRow.isDisconnected === 1;

                if (!isConnected && !isCurrentlyDisconnected) {
                    // Mark as disconnected and reduce population
                    const newPopulation = Math.max(0, (tileRow.population || 1) - 1);
                    
                    if (newPopulation === 0) {
                        // Remove tile entirely
                        userChanges[key] = null;
                    } else {
                        userChanges[key] = { 
                            owner: username, 
                            population: newPopulation, 
                            isDisconnected: true 
                        };
                    }
                } else if (isConnected && isCurrentlyDisconnected) {
                    // Reconnect tile
                    userChanges[key] = { 
                        owner: username, 
                        population: tileRow.population,
                        isDisconnected: false 
                    };
                }
            }

            return { username, changes: userChanges };
        });

        // Wait for all users to be processed and collect changes
        const allResults = await Promise.all(userProcessingPromises);
        
        // Batch all state changes together
        const batchedChanges = {};
        allResults.forEach(result => {
            Object.assign(batchedChanges, result.changes);
            Object.assign(changedTilesForBroadcast, result.changes);
        });

        // Apply all changes in a single batch operation
        if (Object.keys(batchedChanges).length > 0) {
            await setGridState(batchedChanges);
            io.emit('batchTileUpdate', { changedTiles: changedTilesForBroadcast });
            log(`Server: Applied disconnection penalties to ${Object.keys(batchedChanges).length} tiles.`);
            stateChanged = true;
        }

        if (!stateChanged) {
            log('Server: No disconnection penalties needed.');
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