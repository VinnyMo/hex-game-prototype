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
        
        // Request full map data for minimap
        socket.emit('requestFullMap');
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

    // Handle extended tiles loading in background
    socket.on('extendedTiles', (state) => {
        // Merge extended tiles with existing state
        Object.assign(hexStates, state.gridState);
        ownedTilesCache.needsUpdate = true; // Update cache with new tiles
        debouncedRenderGrid(); // Render with new tiles
        console.log(`Loaded ${Object.keys(state.gridState).length} extended tiles`);
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
        requestViewportTiles(); // Request tiles for current viewport
    });

    // Handle single tile updates
    socket.on('tileUpdate', ({ key, tile }) => {
        if (tile) {
            hexStates[key] = tile;
        } else {
            delete hexStates[key];
        }
        
        // Mark cache for update if this affects owned tiles
        if (currentUser && (tile?.owner === currentUser.username || 
                           (hexStates[key] && hexStates[key].owner === currentUser.username))) {
            ownedTilesCache.needsUpdate = true;
        }
        debouncedRenderGrid(); // Use debounced render for performance
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
        const BATCH_SIZE = 100; // Increased batch size for better performance
        const DELAY = 16; // ~60fps timing

        if (tileUpdateQueue.length === 0) {
            isProcessingQueue = false;
            debouncedRenderGrid(); // Use debounced render
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

        debouncedRenderGrid(); // Use debounced render
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
        debouncedRenderGrid(); // Use debounced render for performance
    });
    
    // Handle full map data for minimap
    socket.on('fullMapData', ({ tiles }) => {
        // Update hexStates with full map data for minimap
        Object.assign(hexStates, tiles);
        renderGrid(); // Immediate render for full map data
    });
    
    // Handle view tiles data for real-time loading
    socket.on('viewTilesData', ({ tiles }) => {
        // Update hexStates with view tiles
        Object.assign(hexStates, tiles);
        debouncedRenderGrid(); // Use debounced render for performance
    });
    
    // Handle player stats from server
    socket.on('playerStatsData', (stats) => {
        updateStatsFromServer(stats);
    });
    
    // Debounced rendering for performance optimization
    let renderTimeout = null;
    function debouncedRenderGrid() {
        if (renderTimeout) clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            renderGrid();
            renderTimeout = null;
        }, 50); // 50ms debounce
    }
}