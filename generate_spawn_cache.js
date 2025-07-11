const fs = require('fs');
const path = require('path');
const { initializeDatabase, safeDbOperation } = require('./game-logic/db');
const { getTile } = require('./game-logic/gameState');

const SPAWN_CACHE_PATH = path.join(__dirname, 'spawn_cache.json');
const MIN_SPAWN_DISTANCE = 150;
const CACHE_TARGET_SIZE = 100; // Target number of spawn points to maintain

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
    // Rule 1: Check if the tile is occupied or has an exclamation mark
    const tile = await getTile(q, r);
    if (tile && (tile.owner || tile.hasExclamation)) {
        return false;
    }

    // Rule 2: Check minimum distance from any existing occupied or exclamation tile
    // Use optimized database query with safeDbOperation
    return safeDbOperation(() => {
        const { getDb } = require('./game-logic/db');
        const db = getDb();
        
        return new Promise((resolve, reject) => {
            // More efficient query - only get coordinates for distance check
            db.all("SELECT q, r FROM tiles WHERE owner IS NOT NULL OR hasExclamation = 1", [], (err, existingTiles) => {
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
    console.log('🚀 Starting optimized spawn cache generation...');
    
    // Initialize database with optimizations
    await initializeDatabase();
    
    let sumQ = 0, sumR = 0, occupiedCount = 0;
    let maxDistanceFromCenter = 0;
    let centerX = 0, centerY = 0;

    // Collect occupied tiles using optimized database operation
    const occupiedTilesData = await safeDbOperation(() => {
        const { getDb } = require('./game-logic/db');
        const db = getDb();
        
        return new Promise((resolve, reject) => {
            db.all("SELECT q, r FROM tiles WHERE owner IS NOT NULL OR hasExclamation = 1", [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
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
        const { x, y } = cubeToCartesian(avgQ, 0, avgR);
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
    const MAX_RETRIES = 3;

    // Try to maintain existing cache first
    try {
        const existingCache = JSON.parse(await fs.promises.readFile(SPAWN_CACHE_PATH, 'utf8'));
        console.log(`📦 Found existing cache with ${existingCache.length} points`);
        
        // Validate existing points in batches for efficiency
        const batchSize = 10;
        for (let i = 0; i < existingCache.length; i += batchSize) {
            const batch = existingCache.slice(i, i + batchSize);
            const validBatch = await Promise.all(
                batch.map(async ([q, r]) => {
                    const isValid = await isValidSpawnPoint(q, r);
                    return isValid ? [q, r] : null;
                })
            );
            validSpawnPoints.push(...validBatch.filter(point => point !== null));
            
            if (validSpawnPoints.length >= CACHE_TARGET_SIZE) break;
        }
        
        console.log(`✅ Retained ${validSpawnPoints.length} valid points from existing cache`);
    } catch (err) {
        console.log('📝 No existing cache found, generating fresh cache');
    }

    // Generate new points if needed
    while (validSpawnPoints.length < CACHE_TARGET_SIZE && retryCount <= MAX_RETRIES) {
        console.log(`🎯 Attempt ${retryCount + 1}: Target radius ${currentTargetRadius}, need ${CACHE_TARGET_SIZE - validSpawnPoints.length} more points`);
        
        const pointsOnCircumference = Math.min(50, Math.ceil((2 * Math.PI * currentTargetRadius) / MIN_SPAWN_DISTANCE));
        const newPoints = [];

        // Generate points more efficiently with batch processing
        const angleStep = (2 * Math.PI) / pointsOnCircumference;
        for (let i = 0; i < pointsOnCircumference; i++) {
            const angle = i * angleStep + (Math.random() - 0.5) * 0.1; // Small random offset
            const radiusVariation = currentTargetRadius + (Math.random() - 0.5) * MIN_SPAWN_DISTANCE * 0.5;
            
            const cartX = centerX + radiusVariation * Math.cos(angle);
            const cartY = centerY + radiusVariation * Math.sin(angle);

            const { x: cubeX, y: cubeY, z: cubeZ } = cartesianToCube(cartX, cartY);
            const { q, r } = cubeToAxial(Math.round(cubeX), Math.round(cubeY), Math.round(cubeZ));

            newPoints.push([q, r]);
        }

        // Validate in batches
        const batchSize = 5;
        for (let i = 0; i < newPoints.length && validSpawnPoints.length < CACHE_TARGET_SIZE; i += batchSize) {
            const batch = newPoints.slice(i, i + batchSize);
            const validBatch = await Promise.all(
                batch.map(async ([q, r]) => {
                    const isValid = await isValidSpawnPoint(q, r);
                    return isValid ? [q, r] : null;
                })
            );
            validSpawnPoints.push(...validBatch.filter(point => point !== null));
        }

        console.log(`📊 Found ${validSpawnPoints.length}/${CACHE_TARGET_SIZE} valid spawn points so far`);

        if (validSpawnPoints.length >= CACHE_TARGET_SIZE) {
            break;
        }

        // Expand search radius for next attempt
        currentTargetRadius += MIN_SPAWN_DISTANCE + (retryCount * 200);
        retryCount++;
    }

    // Trim to target size if we have too many
    if (validSpawnPoints.length > CACHE_TARGET_SIZE) {
        validSpawnPoints = validSpawnPoints.slice(0, CACHE_TARGET_SIZE);
    }

    console.log(`🎉 Final result: Generated ${validSpawnPoints.length} valid spawn points`);

    try {
        await fs.promises.writeFile(SPAWN_CACHE_PATH, JSON.stringify(validSpawnPoints, null, 2), 'utf8');
        console.log(`💾 Successfully wrote ${validSpawnPoints.length} spawn points to cache`);
    } catch (error) {
        console.error(`❌ Error writing spawn_cache.json: ${error.message}`);
    }
    
    console.log('✅ Optimized spawn cache generation complete!');
    process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Cache generation interrupted');
    process.exit(0);
});

generateSpawnCache().catch(err => {
    console.error('❌ Cache generation failed:', err);
    process.exit(1);
});
