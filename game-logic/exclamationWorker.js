const { parentPort } = require('worker_threads');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getHexNeighbors } = require('./utils');
const { log, error } = require('./logging');

const DB_PATH = path.join(__dirname, '..', 'game.db');
const EXCLAMATION_SPAWN_RADIUS = 100; // Radius in hexes, from game.js

let db; // Database connection for this worker

// Helper function to establish DB connection for the worker
function connectDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => { // Open as READ/WRITE
            if (err) {
                error('EW: Database connection error:', err.message);
                reject(err);
            } else {
                log('EW: Connected to SQLite database.');
                resolve(db);
            }
        });
    });
}

// Function to get or create DB connection for the worker
async function getDbConnection() {
    if (!db) {
        await connectDb();
    }
    return db;
}

async function generateExclamationMark() {
    log('EW: generateExclamationMark started.');
    const db = await getDbConnection();
    
    // Get users from DB
    const users = await new Promise((resolve, reject) => {
        db.all("SELECT username, capitol FROM users", [], (err, rows) => {
            if (err) return reject(err);
            const usersObj = {};
            rows.forEach(row => usersObj[row.username] = row);
            resolve(usersObj);
        });
    });
    log(`EW: Fetched ${Object.keys(users).length} users from DB.`);

    const activeUsers = Object.values(users).filter(user => user.capitol); // Only consider users with a capitol
    log(`EW: Found ${activeUsers.length} active users with capitols.`);
    if (activeUsers.length === 0) {
        log('EW: No active users with capitols found. Returning null.');
        return null; // No users to spawn around
    }

    const changedTilesForBroadcast = {};
    let stateChanged = false;

    for (const user of activeUsers) { // Iterate over each active user
        log(`EW: Processing user: ${user.username}`);
        // Get owned tiles for the current user from DB
        const ownedTiles = await new Promise((resolve, reject) => {
            db.all("SELECT q, r FROM tiles WHERE owner = ?", [user.username], (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(row => `${row.q},${row.r}`));
            });
        });
        log(`EW: User ${user.username} has ${ownedTiles.length} owned tiles.`);

        if (ownedTiles.length === 0) {
            log(`EW: User ${user.username} has no owned tiles to spawn '!' around. Skipping.`);
            continue; // Skip if user has no owned tiles
        }

        const randomOwnedTileKey = ownedTiles[Math.floor(Math.random() * ownedTiles.length)];
        const [spawnCenterQ, spawnCenterR] = randomOwnedTileKey.split(',').map(Number);
        log(`EW: Random owned tile for ${user.username}: ${randomOwnedTileKey}`);

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

            // Check if the tile is unoccupied and doesn't already have an exclamation mark (from DB)
            const existingTile = await new Promise((resolve, reject) => {
                db.get("SELECT owner, hasExclamation FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            if (!existingTile || (!existingTile.owner && existingTile.hasExclamation !== 1)) {
                // Update DB directly
                await new Promise((resolve, reject) => {
                    db.run("INSERT OR REPLACE INTO tiles (q, r, hasExclamation) VALUES (?, ?, 1)", [q, r], (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                changedTilesForBroadcast[key] = { hasExclamation: true };
                log(`EW: Spawned '!' at ${key} for user ${user.username}`); // Log for specific user
                stateChanged = true;
                spawnedForUser = true; // Mark as spawned for this user
            }
            attempts++;
        }
        if (!spawnedForUser) {
            log(`EW: Failed to spawn '!' for user ${user.username} after multiple attempts.`);
        }
    }

    if (stateChanged) {
        log('EW: Exclamation generation complete. State changed.');
        return changedTilesForBroadcast;
    } else {
        log('EW: Exclamation generation complete. No state changed.');
        return null;
    }
}

parentPort.on('message', async (message) => {
    if (message.command === 'generateExclamations') {
        const changedTiles = await generateExclamationMark();
        parentPort.postMessage({ status: 'done', changedTiles });
    }
});
