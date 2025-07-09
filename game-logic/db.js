const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { log, error } = require('./logging');

const DB_PATH = path.join(__dirname, '..', 'game.db');
let db;

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                error('Database connection error:', err.message);
                reject(err);
            } else {
                log('Connected to the SQLite database.');
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
                                resolve(db);
                            }
                        });
                    }
                });
            }
        });
    });
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase first.');
    }
    return db;
}

module.exports = {
    initializeDatabase,
    getDb
};
