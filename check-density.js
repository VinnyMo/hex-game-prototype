const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'game.db');
const EXCLAMATION_SPAWN_RADIUS = 50;
const EXCLAMATION_DENSITY_LIMIT = 0.025; // 2.5% density cap

let db;

function connectDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Database connection error:', err.message);
                reject(err);
            } else {
                console.log('Connected to SQLite database.');
                db.run('PRAGMA busy_timeout=5000');
                resolve(db);
            }
        });
    });
}

async function checkExclamationDensityForUser(username) {
    try {
        // Get all tiles owned by the user
        const ownedTiles = await new Promise((resolve, reject) => {
            db.all("SELECT q, r FROM tiles WHERE owner = ?", [username], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        
        if (ownedTiles.length === 0) {
            console.log(`❌ User "${username}" has no owned tiles.`);
            return null;
        }
        
        console.log(`📍 User "${username}" owns ${ownedTiles.length} tiles.`);
        
        // Find bounding box of user's territory
        const minQ = Math.min(...ownedTiles.map(t => t.q));
        const maxQ = Math.max(...ownedTiles.map(t => t.q));
        const minR = Math.min(...ownedTiles.map(t => t.r));
        const maxR = Math.max(...ownedTiles.map(t => t.r));
        
        console.log(`📦 Territory bounding box: Q[${minQ}, ${maxQ}], R[${minR}, ${maxR}]`);
        
        // Expand bounding box by spawn radius to check surrounding area
        const checkMinQ = minQ - EXCLAMATION_SPAWN_RADIUS;
        const checkMaxQ = maxQ + EXCLAMATION_SPAWN_RADIUS;
        const checkMinR = minR - EXCLAMATION_SPAWN_RADIUS;
        const checkMaxR = maxR + EXCLAMATION_SPAWN_RADIUS;
        
        console.log(`🔍 Expanded check area: Q[${checkMinQ}, ${checkMaxQ}], R[${checkMinR}, ${checkMaxR}]`);
        console.log(`   Expansion radius: ${EXCLAMATION_SPAWN_RADIUS} tiles`);
        
        // Count exclamation tiles in the surrounding area (unowned only)
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
        
        // Count tiles owned by the user in the check area
        const userOwnedInArea = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM tiles 
                WHERE q BETWEEN ? AND ? 
                AND r BETWEEN ? AND ? 
                AND owner = ?
            `, [checkMinQ, checkMaxQ, checkMinR, checkMaxR, username], (err, row) => {
                if (err) return reject(err);
                resolve(row.count || 0);
            });
        });
        
        // Also get the actual exclamation tiles for detailed info
        const exclamationTiles = await new Promise((resolve, reject) => {
            db.all(`
                SELECT q, r 
                FROM tiles 
                WHERE q BETWEEN ? AND ? 
                AND r BETWEEN ? AND ? 
                AND hasExclamation = 1
                AND owner IS NULL
            `, [checkMinQ, checkMaxQ, checkMinR, checkMaxR], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        
        // Calculate total possible tiles in the area (rough approximation)
        const areaWidth = checkMaxQ - checkMinQ + 1;
        const areaHeight = checkMaxR - checkMinR + 1;
        const totalGridTiles = areaWidth * areaHeight;
        
        // Subtract user-owned tiles to get available tiles for exclamations
        const availableTiles = totalGridTiles - userOwnedInArea;
        
        // Calculate density based on available (unowned) tiles
        const density = availableTiles > 0 ? exclamationCount / availableTiles : 0;
        const densityPercentage = (density * 100).toFixed(2);
        
        console.log('\n📊 DENSITY STATISTICS (REVISED):');
        console.log('='.repeat(50));
        console.log(`👤 User: ${username}`);
        console.log(`🎯 Exclamation tiles found: ${exclamationCount}`);
        console.log(`📐 Total grid area: ${totalGridTiles} tiles (${areaWidth} × ${areaHeight})`);
        console.log(`🏠 User-owned tiles in area: ${userOwnedInArea}`);
        console.log(`🆓 Available tiles for exclamations: ${availableTiles}`);
        console.log(`📈 Current density: ${densityPercentage}% (exclamations/available_tiles)`);
        console.log(`🚨 Density limit: ${(EXCLAMATION_DENSITY_LIMIT * 100).toFixed(1)}%`);
        console.log(`✅ Under limit: ${density < EXCLAMATION_DENSITY_LIMIT ? 'YES' : 'NO'}`);
        
        if (exclamationTiles.length > 0) {
            console.log('\n❗ Exclamation tile locations:');
            exclamationTiles.forEach((tile, index) => {
                console.log(`   ${index + 1}. (${tile.q}, ${tile.r})`);
            });
        }
        
        return {
            username,
            ownedTilesCount: ownedTiles.length,
            territoryBounds: { minQ, maxQ, minR, maxR },
            checkArea: { checkMinQ, checkMaxQ, checkMinR, checkMaxR },
            exclamationCount,
            totalGridTiles,
            userOwnedInArea,
            availableTiles,
            density,
            densityPercentage: parseFloat(densityPercentage),
            underLimit: density < EXCLAMATION_DENSITY_LIMIT,
            exclamationTiles
        };
        
    } catch (err) {
        console.error('Error checking exclamation density:', err);
        return null;
    }
}

async function main() {
    const username = 'ilikpie';
    
    console.log('🎮 Hex Game Exclamation Density Checker');
    console.log('='.repeat(50));
    console.log(`Checking density around user: ${username}\n`);
    
    try {
        await connectDb();
        
        const result = await checkExclamationDensityForUser(username);
        
        if (result) {
            console.log('\n✅ Analysis complete!');
        } else {
            console.log('\n❌ Analysis failed or user not found.');
        }
        
    } catch (err) {
        console.error('❌ Script error:', err);
    } finally {
        if (db) {
            db.close();
            console.log('\n🔌 Database connection closed.');
        }
    }
}

// Run the script
main().catch(console.error);