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
    socket.on('batchTileUpdate', ({ changedTiles }) => {
        for (const key in changedTiles) {
            const tile = changedTiles[key];
            if (tile) {
                hexStates[key] = tile;
            } else {
                delete hexStates[key];
            }
        }
        renderGrid();
        if (currentUser) {
            updateStats();
        }
    });

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