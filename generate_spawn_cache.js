const fs = require('fs');
const path = require('path');

const GRID_STATE_PATH = path.join(__dirname, 'grid_state.json');
const SPAWN_CACHE_PATH = path.join(__dirname, 'spawn_cache.json');
const MIN_SPAWN_DISTANCE = 150; // Minimum distance between spawn points and existing tiles

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

function isValidSpawnPoint(q, r, gridState) {
    const key = `${q},${r}`;

    // Rule 1: Check if the tile is occupied or has an exclamation mark
    if (gridState[key] && (gridState[key].owner || gridState[key].hasExclamation)) {
        return false;
    }

    // Rule 2: Check minimum distance from any existing occupied or exclamation tile
    for (const existingKey in gridState) {
        const existingTile = gridState[existingKey];
        if (existingTile.owner || existingTile.hasExclamation) {
            const [eq, er] = existingKey.split(',').map(Number);
            if (hexDistance(q, r, eq, er) < MIN_SPAWN_DISTANCE) {
                return false;
            }
        }
    }
    return true;
}

async function generateSpawnCache() {
    console.log('Starting spawn cache generation...');
    let gridState;
    try {
        const gridStateRaw = await fs.promises.readFile(GRID_STATE_PATH, 'utf8');
        gridState = JSON.parse(gridStateRaw);
        console.log(`Successfully loaded grid state from ${GRID_STATE_PATH}. Total tiles: ${Object.keys(gridState).length}`);
    } catch (error) {
        console.error(`Error reading or parsing grid_state.json: ${error.message}`);
        return;
    }

    let sumQ = 0, sumR = 0, occupiedCount = 0;
    let maxDistanceFromCenter = 0;

    const occupiedTiles = [];

    // Collect occupied tiles and calculate sum for center
    for (const key in gridState) {
        const tile = gridState[key];
        if (tile.owner || tile.hasExclamation) {
            const [q, r] = key.split(',').map(Number);
            occupiedTiles.push({ q, r });
            sumQ += q;
            sumR += r;
            occupiedCount++;
        }
    }

    let centerX = 0;
    let centerY = 0;

    if (occupiedCount > 0) {
        // Calculate approximate center of the occupied grid in Cartesian coordinates
        const avgQ = sumQ / occupiedCount;
        const avgR = sumR / occupiedCount;
        const { x, y } = cubeToCartesian(avgQ, 0, avgR); // Using 0 for y in cube for axial conversion
        centerX = x;
        centerY = y;

        // Calculate max distance from this center to any occupied tile
        for (const tile of occupiedTiles) {
            const dist = hexDistance(Math.round(avgQ), Math.round(avgR), tile.q, tile.r);
            maxDistanceFromCenter = Math.max(maxDistanceFromCenter, dist);
        }
    } else {
        console.log('No occupied or exclamation tiles found. Defaulting center to (0,0).');
        // If no occupied tiles, default center is (0,0) and maxDistanceFromCenter is 0
    }

    let currentTargetRadius = maxDistanceFromCenter + MIN_SPAWN_DISTANCE;
    let validSpawnPoints = [];
    let retryCount = 0;
    const MAX_RETRIES = 2; // Now two retries: +150 and +1000

    while (retryCount <= MAX_RETRIES) {
        console.log(`Attempt ${retryCount + 1}: Target circumference radius: ${currentTargetRadius}`);
        const pointsOnCircumference = Math.ceil((2 * Math.PI * currentTargetRadius) / MIN_SPAWN_DISTANCE);
        console.log(`Attempting to place ${pointsOnCircumference} points on circumference.`);

        validSpawnPoints = []; // Reset for each attempt

        for (let i = 0; i < pointsOnCircumference; i++) {
            const angle = (i / pointsOnCircumference) * 2 * Math.PI;
            const cartX = centerX + currentTargetRadius * Math.cos(angle);
            const cartY = centerY + currentTargetRadius * Math.sin(angle);

            // Convert Cartesian back to cube, then axial, and round to nearest hex coordinate
            const { x: cubeX, y: cubeY, z: cubeZ } = cartesianToCube(cartX, cartY);
            const { q, r } = cubeToAxial(Math.round(cubeX), Math.round(cubeY), Math.round(cubeZ));

            if (isValidSpawnPoint(q, r, gridState)) {
                validSpawnPoints.push([q, r]);
            }
        }

        console.log(`Found ${validSpawnPoints.length} valid spawn points in attempt ${retryCount + 1}.`);

        if (validSpawnPoints.length > 0) {
            break; // Found points, exit retry loop
        } else if (retryCount < MAX_RETRIES) {
            if (retryCount === 0) {
                console.log(`No valid points found. Expanding radius by ${MIN_SPAWN_DISTANCE} for first retry.`);
                currentTargetRadius += MIN_SPAWN_DISTANCE; // First retry: +150
            } else if (retryCount === 1) {
                console.log(`No valid points found. Expanding radius by 1000 for second retry.`);
                currentTargetRadius += 1000; // Second retry: +1000
            }
        }
        retryCount++;
    }

    console.log(`Final result: Found a total of ${validSpawnPoints.length} valid spawn points.`);

    try {
        await fs.promises.writeFile(SPAWN_CACHE_PATH, JSON.stringify(validSpawnPoints, null, 2), 'utf8');
        console.log(`Successfully wrote ${validSpawnPoints.length} spawn points to ${SPAWN_CACHE_PATH}`);
    } catch (error) {
        console.error(`Error writing spawn_cache.json: ${error.message}`);
    }
    console.log('Spawn cache generation complete.');
}

generateSpawnCache();
