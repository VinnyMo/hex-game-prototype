const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const SPAWN_CACHE_PATH = path.join(__dirname, '..', 'spawn_cache.json');
const MIN_SPAWN_DISTANCE = 150; // Define here as it's used by findRandomSpawn

function getHexNeighbors(q, r) {
    const neighbors = [
        { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
    ];
    return neighbors.map(n => ({ q: q + n.dq, r: r + n.dr }));
}

function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
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

async function findCachedSpawn(gridState) {
    let cachedPoints = [];
    try {
        const cacheRaw = await fs.promises.readFile(SPAWN_CACHE_PATH, 'utf8');
        cachedPoints = JSON.parse(cacheRaw);
    } catch (error) {
        console.error(`Error reading or parsing spawn_cache.json: ${error.message}`);
        return null;
    }

    const remainingCachedPoints = [];
    let foundSpawnPoint = null;

    for (let i = 0; i < cachedPoints.length; i++) {
        const [q, r] = cachedPoints[i];
        if (isValidSpawnPoint(q, r, gridState)) {
            foundSpawnPoint = `${q},${r}`;
            // Add remaining points from the cache to remainingCachedPoints
            for (let j = i + 1; j < cachedPoints.length; j++) {
                remainingCachedPoints.push(cachedPoints[j]);
            }
            break; // Found a valid point, stop checking
        } else {
            // If invalid, it's not added to remainingCachedPoints, effectively deleting it
        }
    }

    // Rewrite the cache file with remaining points
    try {
        await fs.promises.writeFile(SPAWN_CACHE_PATH, JSON.stringify(remainingCachedPoints, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error writing spawn_cache.json: ${error.message}`);
    }

    return foundSpawnPoint;
}

async function findRandomSpawn(gridState) {
    // Try cached spawn points first
    const cachedSpawn = await findCachedSpawn(gridState);
    if (cachedSpawn) {
        return cachedSpawn;
    }

    // If cache is exhausted or invalid, return null. The main thread will handle this.
    return null;
}

parentPort.on('message', async (message) => { // Added async here
    if (message.command === 'findSpawn') {
        const spawnPoint = await findRandomSpawn(message.gridState); // Added await here
        parentPort.postMessage({ status: 'done', spawnPoint });
    }
});
