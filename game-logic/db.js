const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { log, error } = require('./logging');

const DB_PATH = path.join(__dirname, '..', 'game.db');
let db;
let isInitialized = false;

// Connection pool and queue management
const operationQueue = [];
let isProcessingQueue = false;

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        if (isInitialized) {
            resolve(db);
            return;
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                error('Database connection error:', err.message);
                reject(err);
            } else {
                log('Connected to the SQLite database.');
                
                // Enable WAL mode for better concurrency
                db.run('PRAGMA journal_mode=WAL', (err) => {
                    if (err) {
                        error('Error setting WAL mode:', err.message);
                    } else {
                        log('Database WAL mode enabled.');
                    }
                });

                // Set reasonable timeout
                db.run('PRAGMA busy_timeout=30000');

                db.run(`CREATE TABLE IF NOT EXISTS tiles (
                    q INTEGER NOT NULL,
                    r INTEGER NOT NULL,
                    owner TEXT,
                    population INTEGER,
                    hasExclamation INTEGER,
                    isDisconnected INTEGER,
                    PRIMARY KEY (q, r)
                );`, (err) => {
                    if (err) {
                        error('Error creating tiles table:', err.message);
                        reject(err);
                    } else {
                        log('Tiles table ensured.');
                        db.run(`CREATE TABLE IF NOT EXISTS users (
                            username TEXT PRIMARY KEY,
                            password TEXT NOT NULL,
                            color TEXT,
                            capitol TEXT,
                            exploredTiles TEXT
                        );`, (err) => {
                            if (err) {
                                error('Error creating users table:', err.message);
                                reject(err);
                            } else {
                                log('Users table ensured.');
                                
                                // Create indexes for performance
                                createIndexes().then(() => {
                                    isInitialized = true;
                                    resolve(db);
                                }).catch(reject);
                            }
                        });
                    }
                });
            }
        });
    });
}

function createIndexes() {
    return new Promise((resolve, reject) => {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_tiles_owner ON tiles(owner);',
            'CREATE INDEX IF NOT EXISTS idx_tiles_hasExclamation ON tiles(hasExclamation);',
            'CREATE INDEX IF NOT EXISTS idx_tiles_coordinates ON tiles(q, r);',
            'CREATE INDEX IF NOT EXISTS idx_users_capitol ON users(capitol);',
            // Performance indexes for spawn validation and leaderboards
            'CREATE INDEX IF NOT EXISTS idx_tiles_population ON tiles(population);',
            'CREATE INDEX IF NOT EXISTS idx_tiles_owner_population ON tiles(owner, population);',
            'CREATE INDEX IF NOT EXISTS idx_tiles_exclamation_owner ON tiles(hasExclamation, owner);',
            'CREATE INDEX IF NOT EXISTS idx_tiles_owner_not_null ON tiles(owner) WHERE owner IS NOT NULL;'
        ];

        let completed = 0;
        let hasError = false;

        indexes.forEach(indexSql => {
            db.run(indexSql, (err) => {
                if (err && !hasError) {
                    hasError = true;
                    error('Error creating index:', err.message);
                    reject(err);
                } else {
                    completed++;
                    if (completed === indexes.length && !hasError) {
                        log('Database indexes created successfully.');
                        resolve();
                    }
                }
            });
        });
    });
}

// Queue-based database operation to prevent conflicts
function queueDbOperation(operation) {
    return new Promise((resolve, reject) => {
        operationQueue.push({ operation, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (isProcessingQueue || operationQueue.length === 0) {
        return;
    }
    
    isProcessingQueue = true;
    
    while (operationQueue.length > 0) {
        const { operation, resolve, reject } = operationQueue.shift();
        try {
            const result = await operation();
            resolve(result);
        } catch (err) {
            reject(err);
        }
    }
    
    isProcessingQueue = false;
}

function getDb() {
    if (!db || !isInitialized) {
        throw new Error('Database not initialized. Call initializeDatabase first.');
    }
    return db;
}

// Safe database operation wrapper
function safeDbOperation(operation) {
    return queueDbOperation(operation);
}

module.exports = {
    initializeDatabase,
    getDb,
    safeDbOperation,
    queueDbOperation
};
