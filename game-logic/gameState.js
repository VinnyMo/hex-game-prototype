const { initializeDatabase, getDb } = require('./db');
const { log, error } = require('./logging');

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
                    gridState[key] = {
                        owner: row.owner,
                        population: row.population,
                        hasExclamation: row.hasExclamation === 1, // Convert INTEGER to boolean
                        isDisconnected: row.isDisconnected === 1 // Convert INTEGER to boolean
                    };
                    // Clean up nulls if they are not part of the schema
                    if (gridState[key].owner === null) delete gridState[key].owner;
                    if (gridState[key].population === null) delete gridState[key].population;
                    if (gridState[key].hasExclamation === false) delete gridState[key].hasExclamation;
                    if (gridState[key].isDisconnected === false) delete gridState[key].isDisconnected;
                });
                resolve(gridState);
            }
        });
    });
}

async function getUsers() {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.all("SELECT username, password, color, capitol, exploredTiles FROM users", [], (err, rows) => {
            if (err) {
                error('Error getting users:', err);
                reject(err);
            } else {
                const users = {};
                rows.forEach(row => {
                    users[row.username] = {
                        username: row.username,
                        password: row.password,
                        color: row.color,
                        capitol: row.capitol,
                        exploredTiles: row.exploredTiles ? JSON.parse(row.exploredTiles) : [] // Parse JSON string back to array
                    };
                });
                resolve(users);
            }
        });
    });
}

async function setGridState(gridStateUpdates) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");
            const stmt = db.prepare("INSERT OR REPLACE INTO tiles (q, r, owner, population, hasExclamation, isDisconnected) VALUES (?, ?, ?, ?, ?, ?)");
            
            for (const key in gridStateUpdates) {
                const [q, r] = key.split(',').map(Number);
                const tile = gridStateUpdates[key];
                // Convert boolean to INTEGER for SQLite
                const hasExclamation = tile.hasExclamation ? 1 : 0;
                const isDisconnected = tile.isDisconnected ? 1 : 0;
                stmt.run(q, r, tile.owner || null, tile.population || null, hasExclamation, isDisconnected);
            }
            stmt.finalize();
            db.run("COMMIT;", (err) => {
                if (err) {
                    error('Error committing grid state transaction:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

async function setUsers(userUpdates) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");
            const stmt = db.prepare("INSERT OR REPLACE INTO users (username, password, color, capitol, exploredTiles) VALUES (?, ?, ?, ?, ?)");
            
            for (const username in userUpdates) {
                const user = userUpdates[username];
                // Stringify exploredTiles array for storage
                const exploredTiles = JSON.stringify(user.exploredTiles || []);
                stmt.run(user.username, user.password, user.color, user.capitol, exploredTiles);
            }
            stmt.finalize();
            db.run("COMMIT;", (err) => {
                if (err) {
                    error('Error committing users transaction:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

module.exports = {
    loadGameState,
    getGridState,
    getUsers,
    setGridState,
    setUsers
};