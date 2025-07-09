const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const SPAWN_CACHE_PATH = path.join(__dirname, 'spawn_cache.json');
const DB_PATH = path.join(__dirname, 'game.db');
const MIN_SPAWN_DISTANCE = 150; // Minimum distance between spawn points and existing tiles

let db; // Database connection for this script

// Helper function to establish DB connection for the script
function connectDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => { // Open as READONLY
            if (err) {
                console.error('GSC: Database connection error:', err.message);
                reject(err);
            } else {
                console.log('GSC: Connected to SQLite database (READONLY).');
                resolve(db);
            }
        });
    });
}

// Helper function to get or create DB connection for the script
async function getDbConnection() {
    if (!db) {
        await connectDb();
    }
    return db;
}

// Helper function to convert axial to cube coordinates
function axialToCube(q, r) {
    const x = q;
    const z = r;
    const y = -x - z;
    return { x, y, z };
}

// Helper function to convert cube to axial coordinates
function cubeToAxial(x, y, z) {
    const q = x;
    const r = z;
    return { q, r };
}

// Helper function to convert cube to Cartesian coordinates (for drawing/calculating angles)
function cubeToCartesian(x, y, z, hexSize = 1) {
    const cartX = hexSize * (x + z / 2);
    const cartY = hexSize * (z * Math.sqrt(3) / 2);
    return { x: cartX, y: cartY };
}

// Helper function to convert Cartesian to cube coordinates
function cartesianToCube(x, y, hexSize = 1) {
    const q = (x * 2 / 3) / hexSize;
    const r = (-x / 3 + y / Math.sqrt(3)) / hexSize;
    return axialToCube(q, r);
}

function hexDistance(q1, r1, q2, r2) {
    const { x: x1, y: y1, z: z1 } = axialToCube(q1, r1);
    const { x: x2, y: y2, z: z2 } = axialToCube(q2, r2);
    return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

async function isValidSpawnPoint(q, r) {
    const db = await getDbConnection();

    return new Promise((resolve, reject) => {
        db.get("SELECT owner, hasExclamation FROM tiles WHERE q = ? AND r = ?", [q, r], (err, row) => {
            if (err) {
                console.error('GSC: Error checking tile occupancy:', err.message);
                return reject(err);
            }

            // Rule 1: Check if the tile is occupied or has an exclamation mark
            if (row && (row.owner || row.hasExclamation === 1)) {
                return resolve(false);
            }

            // Rule 2: Check minimum distance from any existing occupied or exclamation tile
            db.all("SELECT q, r, owner, hasExclamation FROM tiles WHERE owner IS NOT NULL OR hasExclamation = 1", [], (err, existingTiles) => {
                if (err) {
                    console.error('GSC: Error getting existing tiles for distance check:', err.message);
                    return reject(err);
                }

                for (const existingTile of existingTiles) {
                    if (hexDistance(q, r, existingTile.q, existingTile.r) < MIN_SPAWN_DISTANCE) {
                        return resolve(false);
                    }
                }
                return resolve(true);
            });
        });
    });
}

async function generateSpawnCache() {
    console.log('Starting spawn cache generation...');
    const db = await getDbConnection();

    let sumQ = 0, sumR = 0, occupiedCount = 0;
    let maxDistanceFromCenter = 0;

    // Collect occupied tiles and calculate sum for center
    const occupiedTilesData = await new Promise((resolve, reject) => {
        db.all("SELECT q, r FROM tiles WHERE owner IS NOT NULL OR hasExclamation = 1", [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });

    if (occupiedTilesData.length > 0) {
        occupiedTilesData.forEach(tile => {
            sumQ += tile.q;
            sumR += tile.r;
            occupiedCount++;
        });

        // Calculate approximate center of the occupied grid in Cartesian coordinates
        const avgQ = sumQ / occupiedCount;
        const avgR = sumR / occupiedCount;
        const { x, y } = cubeToCartesian(avgQ, 0, avgR); // Using 0 for y in cube for axial conversion
        centerX = x;
        centerY = y;

        // Calculate max distance from this center to any occupied tile
        for (const tile of occupiedTilesData) {
            const dist = hexDistance(Math.round(avgQ), Math.round(avgR), tile.q, tile.r);
            maxDistanceFromCenter = Math.max(maxDistanceFromCenter, dist);
        }
    } else {
        console.log('GSC: No occupied or exclamation tiles found. Defaulting center to (0,0).');
        // If no occupied tiles, default center is (0,0) and maxDistanceFromCenter is 0
    }

    let currentTargetRadius = maxDistanceFromCenter + MIN_SPAWN_DISTANCE;
    let validSpawnPoints = [];
    let retryCount = 0;
    const MAX_RETRIES = 2; // Now two retries: +150 and +1000

    while (retryCount <= MAX_RETRIES) {
        console.log(`GSC: Attempt ${retryCount + 1}: Target circumference radius: ${currentTargetRadius}`);
        const pointsOnCircumference = Math.ceil((2 * Math.PI * currentTargetRadius) / MIN_SPAWN_DISTANCE);
        console.log(`GSC: Attempting to place ${pointsOnCircumference} points on circumference.`);

        validSpawnPoints = []; // Reset for each attempt

        for (let i = 0; i < pointsOnCircumference; i++) {
            const angle = (i / pointsOnCircumference) * 2 * Math.PI;
            const cartX = centerX + currentTargetRadius * Math.cos(angle);
            const cartY = centerY + currentTargetRadius * Math.sin(angle);

            // Convert Cartesian back to cube, then axial, and round to nearest hex coordinate
            const { x: cubeX, y: cubeY, z: cubeZ } = cartesianToCube(cartX, cartY);
            const { q, r } = cubeToAxial(Math.round(cubeX), Math.round(cubeY), Math.round(cubeZ));

            if (await isValidSpawnPoint(q, r)) {
                validSpawnPoints.push([q, r]);
            }
        }

        console.log(`GSC: Found ${validSpawnPoints.length} valid spawn points in attempt ${retryCount + 1}.`);

        if (validSpawnPoints.length > 0) {
            break; // Found points, exit retry loop
        } else if (retryCount < MAX_RETRIES) {
            if (retryCount === 0) {
                console.log(`GSC: No valid points found. Expanding radius by ${MIN_SPAWN_DISTANCE} for first retry.`);
                currentTargetRadius += MIN_SPAWN_DISTANCE; // First retry: +150
            } else if (retryCount === 1) {
                console.log(`GSC: No valid points found. Expanding radius by 1000 for second retry.`);
                currentTargetRadius += 1000; // Second retry: +1000
            }
        }
        retryCount++;
    }

    console.log(`GSC: Final result: Found a total of ${validSpawnPoints.length} valid spawn points.`);

    try {
        await fs.promises.writeFile(SPAWN_CACHE_PATH, JSON.stringify(validSpawnPoints, null, 2), 'utf8');
        console.log(`GSC: Successfully wrote ${validSpawnPoints.length} spawn points to ${SPAWN_CACHE_PATH}`);
    } catch (error) {
        console.error(`GSC: Error writing spawn_cache.json: ${error.message}`);
    }
    console.log('Spawn cache generation complete.');
}

generateSpawnCache();
