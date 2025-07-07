const { parentPort } = require('worker_threads');

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

const MIN_SPAWN_DISTANCE = 150; // Define here as it's used by findRandomSpawn

function findRandomSpawn(gridState) {
    let q, r, key;
    let attempts = 0;
    const MAX_ATTEMPTS = 10000; // Prevent infinite loops

    while (attempts < MAX_ATTEMPTS) {
        q = Math.floor(Math.random() * 400) - 200; // Increased range for better distribution
        r = Math.floor(Math.random() * 400) - 200; // Increased range for better distribution
        key = `${q},${r}`;

        // Check if the tile is occupied or has an exclamation mark
        if (gridState[key] && (gridState[key].owner || gridState[key].hasExclamation)) {
            attempts++;
            continue;
        }

        let tooClose = false;
        for (const existingKey in gridState) {
            const existingTile = gridState[existingKey];
            if (existingTile.owner || existingTile.hasExclamation) {
                const [eq, er] = existingKey.split(',').map(Number);
                if (hexDistance(q, r, eq, er) < MIN_SPAWN_DISTANCE) {
                    tooClose = true;
                    break;
                }
            }
        }

        if (!tooClose) {
            return key;
        }
        attempts++;
    }
    // Fallback to original random spawn if no ideal spot is found
    do {
        q = Math.floor(Math.random() * 200) - 100;
        r = Math.floor(Math.random() * 200) - 100;
        key = `${q},${r}`;
    } while (gridState[key]);
    return key;
}

parentPort.on('message', (message) => {
    if (message.command === 'findSpawn') {
        const spawnPoint = findRandomSpawn(message.gridState);
        parentPort.postMessage({ status: 'done', spawnPoint });
    }
});
