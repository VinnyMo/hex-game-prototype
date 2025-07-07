const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { log, error } = require('./game-logic/logging');
const { loadGameState, saveGameState } = require('./game-logic/gameState');
const { initializeSocket } = require('./game-logic/sockets');
const { 
    calculateLeaderboard, 
    applyDisconnectionPenalty, 
    generateExclamationMark, 
    EXCLAMATION_SPAWN_INTERVAL 
} = require('./game-logic/game');

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

// Periodic tasks
setInterval(saveGameState, 30 * 1000); // Save every 30 seconds
setInterval(() => {
    const leaderboard = calculateLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
}, 5000); // Broadcast leaderboard every 5 seconds
setInterval(() => applyDisconnectionPenalty(io), 30 * 1000); // Apply disconnection penalty every 30 seconds
setInterval(() => generateExclamationMark(io), EXCLAMATION_SPAWN_INTERVAL); // Generate exclamation marks

server.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`);
});