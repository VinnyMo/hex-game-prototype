const { parentPort } = require('worker_threads');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getHexNeighbors } = require('./utils');
const { log, error } = require('./logging');

const DB_PATH = path.join(__dirname, '..', 'game.db');
const EXCLAMATION_SPAWN_RADIUS = 50;
const MAX_EXCLAMATIONS_PER_BATCH = 3; // Limit exclamations per generation
const EXCLAMATION_DENSITY_LIMIT = 0.025; // 2.5% density cap around player territory

let db;
let isConnected = false;

function connectDb() {
    return new Promise((resolve, reject) => {
        if (isConnected && db) {
            resolve(db);
            return;
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                error('EW: Database connection error:', err.message);
                reject(err);
            } else {
                log('EW: Connected to SQLite database.');
                db.run('PRAGMA busy_timeout=5000');
                isConnected = true;
                resolve(db);
            }
        });
    });
}

async function getDbConnection() {
    if (!isConnected) {
        await connectDb();
    }
    return db;
}

// Check if exclamation density around user territory is above threshold
async function checkExclamationDensity(username) {
    const db = await getDbConnection();
    
    try {
        // Get all tiles owned by the user
        const ownedTiles = await new Promise((resolve, reject) => {
            db.all("SELECT q, r FROM tiles WHERE owner = ?", [username], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        
        if (ownedTiles.length === 0) return false;
        
        // Find bounding box of user's territory
        const minQ = Math.min(...ownedTiles.map(t => t.q));
        const maxQ = Math.max(...ownedTiles.map(t => t.q));
        const minR = Math.min(...ownedTiles.map(t => t.r));
        const maxR = Math.max(...ownedTiles.map(t => t.r));
        
        // Expand bounding box by spawn radius to check surrounding area
        const checkMinQ = minQ - EXCLAMATION_SPAWN_RADIUS;
        const checkMaxQ = maxQ + EXCLAMATION_SPAWN_RADIUS;
        const checkMinR = minR - EXCLAMATION_SPAWN_RADIUS;
        const checkMaxR = maxR + EXCLAMATION_SPAWN_RADIUS;
        
        // Count exclamation tiles in the surrounding area
        const exclamationCount = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM tiles 
                WHERE q BETWEEN ? AND ? 
                AND r BETWEEN ? AND ? 
                AND hasExclamation = 1
                AND owner IS NULL
            `, [checkMinQ, checkMaxQ, checkMinR, checkMaxR], (err, row) => {
                if (err) return reject(err);
                resolve(row.count || 0);
            });
        });
        
        // Calculate total possible tiles in the area (rough approximation)
        const areaWidth = checkMaxQ - checkMinQ + 1;
        const areaHeight = checkMaxR - checkMinR + 1;
        const totalPossibleTiles = areaWidth * areaHeight;
        
        // Calculate density
        const density = exclamationCount / totalPossibleTiles;
        
        log(`EW: User ${username} exclamation density: ${(density * 100).toFixed(1)}% (${exclamationCount}/${totalPossibleTiles})`);
        
        return density >= EXCLAMATION_DENSITY_LIMIT;
    } catch (err) {
        error('EW: Error checking exclamation density:', err);
        return false;
    }
}

async function generateExclamationMark() {
    log('EW: generateExclamationMark started.');
    const db = await getDbConnection();
    
    try {
        // Get active users more efficiently
        const users = await new Promise((resolve, reject) => {
            db.all("SELECT username, capitol FROM users WHERE capitol IS NOT NULL", [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        
        if (users.length === 0) {
            log('EW: No active users found.');
            return { status: 'done', changedTiles: [] };
        }
        
        log(`EW: Processing ${users.length} active users.`);
        
        const changedTiles = [];
        let exclamationsGenerated = 0;

        // Process users randomly to distribute exclamations fairly
        const shuffledUsers = users.sort(() => Math.random() - 0.5);

        for (const user of shuffledUsers) {
            if (exclamationsGenerated >= MAX_EXCLAMATIONS_PER_BATCH) {
                break;
            }

            // Check exclamation density before generating more
            const densityTooHigh = await checkExclamationDensity(user.username);
            if (densityTooHigh) {
                log(`EW: Skipping user ${user.username} - exclamation density above ${EXCLAMATION_DENSITY_LIMIT * 100}% threshold`);
                continue;
            }

            log(`EW: Processing user ${user.username} with capitol at ${user.capitol}.`);
            
            // Get owned tiles for this user
            const ownedTiles = await new Promise((resolve, reject) => {
                db.all("SELECT q, r FROM tiles WHERE owner = ?", [user.username], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });

            if (ownedTiles.length === 0) {
                log(`EW: User ${user.username} has no owned tiles. Skipping.`);
                continue;
            }

            // Pick a random owned tile as spawn center
            const randomTile = ownedTiles[Math.floor(Math.random() * ownedTiles.length)];
            const spawnCenterQ = randomTile.q;
            const spawnCenterR = randomTile.r;

            let attempts = 0;
            const MAX_ATTEMPTS = 10;
            let spawned = false;

            while (attempts < MAX_ATTEMPTS && !spawned && exclamationsGenerated < MAX_EXCLAMATIONS_PER_BATCH) {
                const angle = Math.random() * 2 * Math.PI;
                const distance = Math.random() * EXCLAMATION_SPAWN_RADIUS;

                const q = spawnCenterQ + Math.round(distance * Math.cos(angle));
                const r = spawnCenterR + Math.round(distance * Math.sin(angle));
                const key = `${q},${r}`;

                // Check if tile is available
                const existingTile = await new Promise((resolve, reject) => {
                    db.get("SELECT owner, hasExclamation FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    });
                });

                if (!existingTile || (!existingTile.owner && existingTile.hasExclamation !== 1)) {
                    // Place exclamation using transaction
                    const success = await new Promise((resolve, reject) => {
                        db.serialize(() => {
                            db.run("BEGIN TRANSACTION");
                            db.run("INSERT OR REPLACE INTO tiles (q, r, hasExclamation) VALUES (?, ?, 1)", [q, r], (err) => {
                                if (err) {
                                    db.run("ROLLBACK");
                                    resolve(false);
                                } else {
                                    db.run("COMMIT", (commitErr) => {
                                        if (commitErr) {
                                            resolve(false);
                                        } else {
                                            resolve(true);
                                        }
                                    });
                                }
                            });
                        });
                    });
                    
                    if (success) {
                        changedTiles.push({ key, tile: { hasExclamation: true } });
                        spawned = true;
                        exclamationsGenerated++;
                        log(`EW: Spawned '!' at ${key} for user ${user.username}.`);
                    }
                }
                attempts++;
            }

            if (!spawned) {
                log(`EW: Failed to spawn '!' for user ${user.username} after ${MAX_ATTEMPTS} attempts.`);
            }
        }

        log(`EW: generateExclamationMark completed. Generated ${changedTiles.length} exclamations.`);
        return { status: 'done', changedTiles };
    } catch (err) {
        error('EW: Error in generateExclamationMark:', err);
        return { status: 'error', error: err.message };
    }
}

parentPort.on('message', async (message) => {
    if (message.command === 'generateExclamations') {
        const result = await generateExclamationMark();
        parentPort.postMessage(result);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    if (db) {
        db.close();
        isConnected = false;
    }
});

log('EW: Exclamation worker started.');