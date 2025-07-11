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
    let exclamationCascadeOrigin = null; // Track origin for cascade animations

    socket.on('batchTileUpdate', ({ changedTiles, cascadeOrigin = null }) => {
        // Check if this is an exclamation cascade with multiple changes
        const isExclamationCascade = cascadeOrigin && Object.keys(changedTiles).length > 1;
        
        if (isExclamationCascade) {
            // Handle exclamation cascade with visual wave effect
            handleExclamationCascade(changedTiles, cascadeOrigin);
        } else {
            // Regular batch update processing
            for (const key in changedTiles) {
                tileUpdateQueue.push({ key, tile: changedTiles[key] });
            }
            if (!isProcessingQueue) {
                processTileUpdateQueue();
            }
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

    // Handle exclamation cascade with visual wave effect
    function handleExclamationCascade(changedTiles, cascadeOrigin) {
        const tileCount = Object.keys(changedTiles).length;
        
        // Performance: Skip cascade animation for very large cascades to prevent frame drops
        if (tileCount > 50) {
            console.log(`Large cascade detected (${tileCount} tiles), skipping animation for performance`);
            // Apply all changes immediately without animation
            for (const key in changedTiles) {
                if (changedTiles[key]) {
                    hexStates[key] = changedTiles[key];
                } else {
                    delete hexStates[key];
                }
            }
            if (currentUser) {
                ownedTilesCache.needsUpdate = true;
            }
            renderGrid();
            if (currentUser) {
                updateStats();
            }
            return;
        }
        
        const [originQ, originR] = cascadeOrigin.split(',').map(Number);
        
        // Calculate distance from origin for each tile in the cascade
        const cascadeTiles = Object.keys(changedTiles).map(key => {
            const [q, r] = key.split(',').map(Number);
            const distance = getHexDistance(originQ, originR, q, r);
            return { key, tile: changedTiles[key], distance };
        });
        
        // Sort tiles by distance from origin (create wave effect)
        cascadeTiles.sort((a, b) => a.distance - b.distance);
        
        // Group tiles by distance for simultaneous updates
        const waveGroups = {};
        cascadeTiles.forEach(({ key, tile, distance }) => {
            if (!waveGroups[distance]) {
                waveGroups[distance] = [];
            }
            waveGroups[distance].push({ key, tile });
        });
        
        // Animate cascade waves with delays - reduced delay for better performance
        const CASCADE_WAVE_DELAY = 100; // Reduced from 150ms to 100ms
        let waveIndex = 0;
        
        for (const distance in waveGroups) {
            setTimeout(() => {
                const waveTiles = waveGroups[distance];
                
                // Apply all tiles in this wave simultaneously
                waveTiles.forEach(({ key, tile }) => {
                    if (tile) {
                        hexStates[key] = tile;
                    } else {
                        delete hexStates[key];
                    }
                });
                
                // Mark cache for update if this affects owned tiles
                if (currentUser) {
                    const affectsOwnedTiles = waveTiles.some(({ tile }) => 
                        tile?.owner === currentUser.username
                    );
                    if (affectsOwnedTiles) {
                        ownedTilesCache.needsUpdate = true;
                    }
                }
                
                // Use debounced render for better performance
                debouncedRenderGrid();
                if (currentUser) {
                    updateStats();
                }
                
                // Limit animations for performance - only animate first 20 tiles
                waveTiles.slice(0, 20).forEach(({ key }) => {
                    animateTileCapture(key);
                });
                
            }, waveIndex * CASCADE_WAVE_DELAY);
            waveIndex++;
        }
    }
    
    // Calculate hex distance between two tiles
    function getHexDistance(q1, r1, q2, r2) {
        return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
    }
    
    // Add visual capture animation to a tile
    function animateTileCapture(tileKey) {
        // Store animation state for canvas-based animation
        if (!window.tileAnimations) {
            window.tileAnimations = new Map();
        }
        
        // Performance: Limit maximum concurrent animations
        if (window.tileAnimations.size > 100) {
            console.log('Too many concurrent animations, skipping new animation');
            return;
        }
        
        // Start animation for this tile
        const animationStart = Date.now();
        window.tileAnimations.set(tileKey, {
            startTime: animationStart,
            duration: 200 // Reduced from 300ms to 200ms for better performance
        });
        
        // Remove animation after duration
        setTimeout(() => {
            window.tileAnimations.delete(tileKey);
        }, 200);
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