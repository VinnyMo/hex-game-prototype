const { initializeDatabase, getDb, safeDbOperation } = require('./db');
const { log, error } = require('./logging');

// Cache for frequently accessed data
const cache = {
    users: new Map(),
    tiles: new Map(),
    lastUserUpdate: 0,
    lastTileUpdate: 0,
    CACHE_TTL: 5000 // 5 seconds cache TTL
};

// Pending batch operations
const pendingOperations = {
    tiles: new Map(),
    users: new Map(),
    batchTimeout: null
};

async function loadGameState() {
    try {
        await initializeDatabase();
        log('Server: Database initialized and connected.');
    } catch (err) {
        error('Server: Failed to initialize database:', err);
        process.exit(1); // Exit if DB connection fails
    }
}

// saveGameState is no longer needed for every change, as updates are direct to DB
// However, we might keep a version for periodic full state backups if desired.
// For now, it's removed as individual setGridState/setUsers handle persistence.

async function getGridState() {
    return safeDbOperation(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            db.all("SELECT q, r, owner, population, hasExclamation, isDisconnected FROM tiles", [], (err, rows) => {
                if (err) {
                    error('Error getting grid state:', err);
                    reject(err);
                } else {
                    const gridState = {};
                    rows.forEach(row => {
                        const key = `${row.q},${row.r}`;
                        const tile = {
                            owner: row.owner,
                            population: row.population,
                            hasExclamation: row.hasExclamation === 1,
                            isDisconnected: row.isDisconnected === 1
                        };
                        
                        // Clean up nulls but preserve false boolean states for client sync
                        if (tile.owner === null) delete tile.owner;
                        if (tile.population === null) delete tile.population;
                        // Keep hasExclamation and isDisconnected even when false for proper client sync
                        
                        gridState[key] = tile;
                        cache.tiles.set(key, { ...tile, timestamp: Date.now() });
                    });
                    cache.lastTileUpdate = Date.now();
                    resolve(gridState);
                }
            });
        });
    });
}

async function getUsers() {
    // Check cache first
    const now = Date.now();
    if (cache.users.size > 0 && (now - cache.lastUserUpdate) < cache.CACHE_TTL) {
        const users = {};
        cache.users.forEach((user, username) => {
            users[username] = { ...user };
            delete users[username].timestamp;
        });
        return users;
    }

    return safeDbOperation(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            db.all("SELECT username, password, color, capitol, exploredTiles FROM users", [], (err, rows) => {
                if (err) {
                    error('Error getting users:', err);
                    reject(err);
                } else {
                    const users = {};
                    cache.users.clear();
                    
                    rows.forEach(row => {
                        const user = {
                            username: row.username,
                            password: row.password,
                            color: row.color,
                            capitol: row.capitol,
                            exploredTiles: row.exploredTiles ? JSON.parse(row.exploredTiles) : []
                        };
                        users[row.username] = user;
                        cache.users.set(row.username, { ...user, timestamp: now });
                    });
                    
                    cache.lastUserUpdate = now;
                    resolve(users);
                }
            });
        });
    });
}

async function setGridState(gridStateUpdates) {
    // Add to pending operations for batching
    Object.keys(gridStateUpdates).forEach(key => {
        const tile = gridStateUpdates[key];
        pendingOperations.tiles.set(key, tile);
        
        // Update cache immediately for consistency
        if (tile === null) {
            // Remove from cache if tile is being deleted
            cache.tiles.delete(key);
        } else {
            cache.tiles.set(key, { ...tile, timestamp: Date.now() });
        }
    });
    
    // Clear existing timeout and set new one
    if (pendingOperations.batchTimeout) {
        clearTimeout(pendingOperations.batchTimeout);
    }
    
    pendingOperations.batchTimeout = setTimeout(() => {
        flushPendingOperations();
    }, 250); // Increased from 100ms to 250ms for better batching with large operations
    
    // Force flush if we have too many pending operations to prevent memory issues
    if (pendingOperations.tiles.size > 500) {
        clearTimeout(pendingOperations.batchTimeout);
        setImmediate(() => flushPendingOperations());
    }
    
    return Promise.resolve();
}

async function flushPendingOperations() {
    if (pendingOperations.tiles.size === 0 && pendingOperations.users.size === 0) {
        return;
    }
    
    return safeDbOperation(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                
                // Process tile updates
                if (pendingOperations.tiles.size > 0) {
                    const insertStmt = db.prepare("INSERT OR REPLACE INTO tiles (q, r, owner, population, hasExclamation, isDisconnected) VALUES (?, ?, ?, ?, ?, ?)");
                    const deleteStmt = db.prepare("DELETE FROM tiles WHERE q = ? AND r = ?");
                    
                    pendingOperations.tiles.forEach((tile, key) => {
                        const [q, r] = key.split(',').map(Number);
                        
                        if (tile === null) {
                            // Handle tile deletion
                            deleteStmt.run(q, r);
                        } else {
                            const hasExclamation = (tile && tile.hasExclamation) ? 1 : 0;
                            const isDisconnected = (tile && tile.isDisconnected) ? 1 : 0;
                            insertStmt.run(q, r, tile.owner || null, tile.population || null, hasExclamation, isDisconnected);
                        }
                    });
                    
                    insertStmt.finalize();
                    deleteStmt.finalize();
                    pendingOperations.tiles.clear();
                }
                
                // Process user updates
                if (pendingOperations.users.size > 0) {
                    const insertStmt = db.prepare("INSERT OR REPLACE INTO users (username, password, color, capitol, exploredTiles) VALUES (?, ?, ?, ?, ?)");
                    const deleteStmt = db.prepare("DELETE FROM users WHERE username = ?");
                    
                    pendingOperations.users.forEach((user, username) => {
                        if (user === null) {
                            // Handle user deletion
                            deleteStmt.run(username);
                        } else {
                            const exploredTiles = JSON.stringify(user.exploredTiles || []);
                            insertStmt.run(user.username, user.password, user.color, user.capitol, exploredTiles);
                        }
                    });
                    
                    insertStmt.finalize();
                    deleteStmt.finalize();
                    pendingOperations.users.clear();
                }
                
                // Transaction auto-commits with serialize()
                cache.lastTileUpdate = Date.now();
                cache.lastUserUpdate = Date.now();
                resolve();
            });
        });
    });
}

async function setUsers(userUpdates) {
    // Add to pending operations for batching
    Object.keys(userUpdates).forEach(username => {
        const user = userUpdates[username];
        pendingOperations.users.set(username, user);
        // Update cache immediately for consistency
        if (user === null) {
            // Remove from cache if user is being deleted
            cache.users.delete(username);
        } else {
            cache.users.set(username, { ...user, timestamp: Date.now() });
        }
    });
    
    // Clear existing timeout and set new one
    if (pendingOperations.batchTimeout) {
        clearTimeout(pendingOperations.batchTimeout);
    }
    
    pendingOperations.batchTimeout = setTimeout(() => {
        flushPendingOperations();
    }, 250); // Increased from 100ms to 250ms for better batching with large operations
    
    return Promise.resolve();
}

// Get a single tile efficiently
async function getTile(q, r) {
    const key = `${q},${r}`;
    const now = Date.now();
    
    // Check cache first
    const cached = cache.tiles.get(key);
    if (cached && (now - cached.timestamp) < cache.CACHE_TTL) {
        const tile = { ...cached };
        delete tile.timestamp;
        return tile;
    }
    
    return safeDbOperation(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            db.get("SELECT q, r, owner, population, hasExclamation, isDisconnected FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
                if (err) {
                    error('Error getting tile:', err);
                    reject(err);
                } else if (!row) {
                    resolve(null);
                } else {
                    const tile = {
                        owner: row.owner,
                        population: row.population,
                        hasExclamation: row.hasExclamation === 1,
                        isDisconnected: row.isDisconnected === 1
                    };
                    
                    if (tile.owner === null) delete tile.owner;
                    if (tile.population === null) delete tile.population;
                    // Keep hasExclamation and isDisconnected even when false for proper client sync
                    
                    cache.tiles.set(key, { ...tile, timestamp: now });
                    resolve(tile);
                }
            });
        });
    });
}

// Get tiles in a region efficiently
async function getTilesInRegion(centerQ, centerR, radius) {
    return safeDbOperation(() => {
        const db = getDb();
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT q, r, owner, population, hasExclamation, isDisconnected FROM tiles
                 WHERE q BETWEEN ? AND ? AND r BETWEEN ? AND ?
                 AND (owner IS NOT NULL OR hasExclamation = 1 OR isDisconnected = 1)
                 LIMIT 1000`,
                [centerQ - radius, centerQ + radius, centerR - radius, centerR + radius],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const tiles = {};
                        const now = Date.now();
                        
                        rows.forEach(row => {
                            const key = `${row.q},${row.r}`;
                            const tile = {
                                owner: row.owner,
                                population: row.population,
                                hasExclamation: row.hasExclamation === 1,
                                isDisconnected: row.isDisconnected === 1
                            };
                            
                            if (tile.owner === null) delete tile.owner;
                            if (tile.population === null) delete tile.population;
                            // Keep hasExclamation and isDisconnected even when false for proper client sync
                            
                            tiles[key] = tile;
                            cache.tiles.set(key, { ...tile, timestamp: now });
                        });
                        
                        log(`getTilesInRegion: Loaded ${rows.length} tiles in region (${centerQ - radius},${centerR - radius}) to (${centerQ + radius},${centerR + radius})`);
                        resolve(tiles);
                    }
                }
            );
        });
    });
}

module.exports = {
    loadGameState,
    getGridState,
    getUsers,
    setGridState,
    setUsers,
    getTile,
    getTilesInRegion,
    flushPendingOperations
};