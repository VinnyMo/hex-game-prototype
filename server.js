const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { log, error } = require('./game-logic/logging');
const { loadGameState, flushPendingOperations } = require('./game-logic/gameState');
const { initializeSocket } = require('./game-logic/sockets');
const { exclamationWorkerPool } = require('./game-logic/workerPool');
const SmartSpawnManager = require('./game-logic/smartSpawnManager');
const { 
    calculateLeaderboard, 
    applyDisconnectionPenalty, 
    EXCLAMATION_SPAWN_INTERVAL 
} = require('./game-logic/game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize everything in proper order
async function initializeServer() {
    try {
        // Load initial game state (connects to DB)
        await loadGameState();
        log('Database initialization completed');
        
        // Initialize smart spawn manager after DB is ready
        const smartSpawnManager = new SmartSpawnManager();
        await smartSpawnManager.initialize();
        log('Smart spawn manager initialized');
        
        // Make spawn manager available globally for sockets
        global.smartSpawnManager = smartSpawnManager;
        
        // Initialize socket connections
        initializeSocket(io);
        log('Socket connections initialized');
        
    } catch (err) {
        error('Server initialization failed:', err);
        process.exit(1);
    }
}

// Start server initialization
initializeServer();

// Initialize worker pools
exclamationWorkerPool.initialize().catch(err => {
    error('Failed to initialize exclamation worker pool:', err);
});

// Periodic tasks
setInterval(async () => {
    const leaderboard = await calculateLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
}, 5000); // Broadcast leaderboard every 5 seconds
setInterval(async () => {
    // Add small random delay to prevent race conditions with exclamation effects
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
    applyDisconnectionPenalty(io);
}, 30 * 1000); // Apply disconnection penalty every 30 seconds (plus random delay)
setInterval(async () => {
    try {
        const response = await exclamationWorkerPool.executeTask({ 
            command: 'generateExclamations'
        });
        
        if (response.status === 'done' && response.changedTiles) {
            io.emit('batchTileUpdate', { changedTiles: response.changedTiles });
        }
    } catch (err) {
        error('Exclamation generation error:', err);
    }
}, EXCLAMATION_SPAWN_INTERVAL);

// Periodic database flush to ensure data persistence
setInterval(async () => {
    try {
        await flushPendingOperations();
    } catch (err) {
        error('Database flush error:', err);
    }
}, 5000); // Flush every 5 seconds

// Initialize maintenance intervals after server is ready
setTimeout(() => {
    // Spawn cache maintenance - every 2 minutes
    setInterval(async () => {
        try {
            if (global.smartSpawnManager) {
                await global.smartSpawnManager.performMaintenance();
            }
        } catch (err) {
            error('Spawn manager maintenance error:', err);
        }
    }, 120000); // Maintenance every 2 minutes

    // Log spawn manager stats every 5 minutes
    setInterval(() => {
        try {
            if (global.smartSpawnManager) {
                const stats = global.smartSpawnManager.getStats();
                log(`Spawn Manager Stats: Cache=${stats.cacheSize}, Sectors=${stats.sectorsTracked}, Generating=${stats.isGenerating}`);
            }
        } catch (err) {
            error('Spawn manager stats error:', err);
        }
    }, 300000); // Stats every 5 minutes
}, 5000); // Wait 5 seconds after server start 

server.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`);
});