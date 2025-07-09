const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Worker } = require('worker_threads'); // Import Worker
const { log, error } = require('./game-logic/logging');
const { loadGameState, saveGameState, getGridState, getUsers, setGridState, setUsers } = require('./game-logic/gameState'); // Import getGridState, getUsers, setGridState, and setUsers
const { initializeSocket } = require('./game-logic/sockets');
const { 
    calculateLeaderboard, 
    applyDisconnectionPenalty, 
    EXCLAMATION_SPAWN_INTERVAL 
} = require('./game-logic/game'); // Removed generateExclamationMark

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load initial game state
loadGameState();

// Initialize socket connections
initializeSocket(io);

// Create exclamation worker
const exclamationWorker = new Worker(path.resolve(__dirname, 'game-logic', 'exclamationWorker.js'));
exclamationWorker.on('message', (response) => {
    if (response.status === 'done') {
        if (response.changedTiles) {
            io.emit('batchTileUpdate', { changedTiles: response.changedTiles });
        }
        // Update main thread's gridState and users with the new state from the worker
        setGridState(response.newGridState);
        setUsers(response.newUsers);
    }
});
exclamationWorker.on('error', (err) => {
    error(`Exclamation Worker error: ${err}`);
});
exclamationWorker.on('exit', (code) => {
    if (code !== 0) {
        error(`Exclamation Worker exited with non-zero exit code: ${code}`);
    }
});

// Periodic tasks
setInterval(saveGameState, 30 * 1000); // Save every 30 seconds
setInterval(() => {
    const leaderboard = calculateLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
}, 5000); // Broadcast leaderboard every 5 seconds
setInterval(() => applyDisconnectionPenalty(io), 30 * 1000); // Apply disconnection penalty every 30 seconds
setInterval(() => { // Send message to worker to generate exclamation marks
    exclamationWorker.postMessage({ 
        command: 'generateExclamations',
        gridState: getGridState(), // Pass current gridState
        users: getUsers() // Pass current users
    });
}, EXCLAMATION_SPAWN_INTERVAL); 

server.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`);
});