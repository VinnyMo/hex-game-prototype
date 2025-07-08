function setupSocketEventHandlers() {
    socket.on('loginSuccess', ({ user }) => {
        currentUser = user;
        loadingSpinner.style.display = 'none'; // Hide spinner on success
        loginContainer.style.display = 'none';
        gameContainer.style.display = 'block';
        
        // Load explored tiles from server
        if (user.exploredTiles) {
            exploredTiles = new Set(user.exploredTiles);
        }
        syncExploredTiles(); // Immediately sync after login to ensure server has latest
        // The 'gameState' event will handle the rest
    });

    socket.on('loginError', (message) => {
        loadingSpinner.style.display = 'none'; // Hide spinner on error
        loginContainer.style.display = 'flex'; // Show login form again
        loginError.textContent = message;
    });

    socket.on('initialSpawnComplete', () => {
        renderGrid(); // Re-render to update explored tiles after initial spawn
    });

    // --- Start of Optimized Event Handlers ---

    // This event now only fires once on login
    socket.on('gameState', (state) => {
        hexStates = state.gridState;
        users = state.users;
        leaderboard = state.leaderboard;
        if (currentUser) {
            updateStats();
            updateLeaderboard();
            recenterCapitol();
        }
        renderGrid(); // Render after recentering
    });

    // Handle single tile updates
    socket.on('tileUpdate', ({ key, tile }) => {
        if (tile) {
            hexStates[key] = tile;
        } else {
            delete hexStates[key];
        }
        // We could optimize rendering to only redraw the affected hex, but for now, a full rerender is simpler.
        renderGrid(); 
        if (currentUser) {
            updateStats();
        }
    });

    // Handle batch tile updates (e.g., from disconnection penalty)
    const tileUpdateQueue = [];
    let isProcessingQueue = false;

    socket.on('batchTileUpdate', ({ changedTiles }) => {
        // Add all new changes to the queue
        for (const key in changedTiles) {
            tileUpdateQueue.push({ key, tile: changedTiles[key] });
        }
        // If not already processing, start the processing loop
        if (!isProcessingQueue) {
            processTileUpdateQueue();
        }
    });

    function processTileUpdateQueue() {
        isProcessingQueue = true;
        const BATCH_SIZE = 50; // Process 50 tiles at a time
        const DELAY = 10; // Delay between batches in milliseconds

        if (tileUpdateQueue.length === 0) {
            isProcessingQueue = false;
            renderGrid(); // Ensure final render after all updates
            if (currentUser) {
                updateStats();
            }
            return;
        }

        let processedCount = 0;
        while (tileUpdateQueue.length > 0 && processedCount < BATCH_SIZE) {
            const { key, tile } = tileUpdateQueue.shift();
            if (tile) {
                hexStates[key] = tile;
            } else {
                delete hexStates[key];
            }
            processedCount++;
        }

        renderGrid(); // Render after processing a batch
        if (currentUser) {
            updateStats();
        }

        setTimeout(processTileUpdateQueue, DELAY);
    }

    // Handle leaderboard updates
    socket.on('leaderboardUpdate', (newLeaderboard) => {
        leaderboard = newLeaderboard;
        if (currentUser) {
            updateLeaderboard();
        }
    });

    // Handle user list updates (e.g., new player joins)
    socket.on('userUpdate', (data) => {
        users = data.users;
        renderGrid(); // Rerender to show new user's colors
    });
}