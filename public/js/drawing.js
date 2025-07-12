function drawHex(q, r) {
    const { cx: x, cy: y } = hexToPixel(q, r);
    const key = `${q},${r}`;
    const tile = hexStates[key];
    
    // Calculate population-based height with caching
    let populationHeight = 0;
    if (tile && tile.population > 1) {
        // Use cached height calculation if available
        if (!window.populationHeightCache) {
            window.populationHeightCache = new Map();
        }
        
        let cachedHeight = window.populationHeightCache.get(tile.population);
        if (cachedHeight === undefined) {
            // Height scales from 2-10 population, max height at 10+
            const heightFactor = Math.min(tile.population - 1, 9); // 1-9 range
            cachedHeight = heightFactor * 2; // 2 pixels per population level
            window.populationHeightCache.set(tile.population, cachedHeight);
        }
        populationHeight = cachedHeight;
    }
    
    // Check for animation state using object pooling
    let animationScale = 1;
    let animationBrightness = 1;
    if (window.tileAnimations && window.tileAnimations.has(key)) {
        const animation = window.tileAnimations.get(key);
        const elapsed = Date.now() - animation.startTime;
        const progress = Math.min(elapsed / animation.duration, 1);
        
        // Remove completed animations and return to pool
        if (progress >= 1) {
            window.tileAnimations.delete(key);
            // Return animation object to pool for reuse
            if (!window.animationPool) window.animationPool = [];
            if (window.animationPool.length < 100) { // Limit pool size
                animation.startTime = 0;
                animation.duration = 0;
                window.animationPool.push(animation);
            }
        } else {
            // Easing function for smooth animation
            const easedProgress = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            
            // Animation effects: scale pulse and brightness
            if (progress <= 0.5) {
                // First half: scale up and brighten
                animationScale = 1 + (easedProgress * 2) * 0.1; // Scale up to 1.1
                animationBrightness = 1 + (easedProgress * 2) * 0.5; // Brighten to 1.5
            } else {
                // Second half: scale back down and return to normal brightness
                const secondHalf = (easedProgress - 0.5) * 2;
                animationScale = 1.1 - secondHalf * 0.1; // Scale back to 1
                animationBrightness = 1.5 - secondHalf * 0.5; // Return to 1
            }
        }
    }

    ctx.save();
    
    // Apply animation scaling
    if (animationScale !== 1) {
        ctx.translate(x, y);
        ctx.scale(animationScale, animationScale);
        ctx.translate(-x, -y);
    }

    // Draw population height layers (3D effect)
    if (populationHeight > 0) {
        // Draw multiple offset layers to create depth effect
        const layers = Math.ceil(populationHeight / 2);
        for (let layer = layers; layer > 0; layer--) {
            const offsetY = layer * 1.5; // Slight vertical offset for each layer
            const layerOpacity = 0.3 + (layer / layers) * 0.4; // Darker layers at bottom
            
            ctx.globalAlpha = layerOpacity;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 3 * i;
                const hx = x + HEX_SIZE * Math.cos(angle);
                const hy = y - offsetY + HEX_SIZE * Math.sin(angle);
                if (i === 0) {
                    ctx.moveTo(hx, hy);
                } else {
                    ctx.lineTo(hx, hy);
                }
            }
            ctx.closePath();
            
            // Use a darker shade for depth layers
            ctx.fillStyle = '#2a2a2a';
            ctx.fill();
        }
        ctx.globalAlpha = 1.0; // Reset alpha
    }

    // Draw main hex (elevated if has population)
    const mainY = y - populationHeight;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i;
        const hx = x + HEX_SIZE * Math.cos(angle);
        const hy = mainY + HEX_SIZE * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(hx, hy);
        } else {
            ctx.lineTo(hx, hy);
        }
    }
    ctx.closePath();

    let hexColor;
    if (tile && users[tile.owner]) {
        hexColor = users[tile.owner].color;
    } else {
        hexColor = 'white'; // Default to land
    }

    // Flashing red for disconnected tiles
    if (tile && tile.isDisconnected && flashState) {
        hexColor = 'red';
    }

    // Apply animation brightness
    if (animationBrightness !== 1) {
        // Handle different color formats
        let r, g, b;
        if (hexColor.startsWith('#')) {
            // Hex color
            r = parseInt(hexColor.slice(1, 3), 16);
            g = parseInt(hexColor.slice(3, 5), 16);
            b = parseInt(hexColor.slice(5, 7), 16);
        } else if (hexColor === 'white') {
            r = g = b = 255;
        } else if (hexColor === 'red') {
            r = 255; g = b = 0;
        } else {
            // Default fallback for other named colors
            r = g = b = 128;
        }
        
        const newR = Math.min(255, Math.round(r * animationBrightness));
        const newG = Math.min(255, Math.round(g * animationBrightness));
        const newB = Math.min(255, Math.round(b * animationBrightness));
        
        hexColor = `rgb(${newR}, ${newG}, ${newB})`;
    }

    ctx.fillStyle = hexColor;
    ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Optimized capitol cache with change detection
    if (!window.capitolCache) {
        window.capitolCache = {
            positions: new Set(),
            lastUpdate: 0,
            userHash: ''
        };
    }
    
    const now = Date.now();
    const userKeys = Object.keys(users).sort().join(',');
    
    // Only update cache if users changed or it's been more than 10 seconds
    if (userKeys !== window.capitolCache.userHash || now - window.capitolCache.lastUpdate > 10000) {
        window.capitolCache.positions.clear();
        Object.values(users).forEach(user => {
            if (user.capitol) {
                window.capitolCache.positions.add(user.capitol);
            }
        });
        window.capitolCache.lastUpdate = now;
        window.capitolCache.userHash = userKeys;
    }
    
    if (window.capitolCache.positions.has(key)) {
        drawStar(x, mainY, HEX_SIZE * 0.4, 5, 0.5);
    }

    if (tile && tile.population > 1) {
        const textColor = getContrastingTextColor(hexColor.replace('#', ''));
        ctx.fillStyle = textColor;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.population, x, mainY);
    } else if (tile && tile.hasExclamation === true) {
        ctx.fillStyle = 'red'; // Color for the exclamation mark
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', x, mainY);
    }
    
    ctx.restore();
}

function drawStar(cx, cy, outerRadius, numPoints, innerRadiusRatio) {
    const innerRadius = outerRadius * innerRadiusRatio;
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / numPoints;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < numPoints; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = 'gold';
    ctx.strokeStyle = 'darkgoldenrod';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
}

function renderGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hexTopLeft = pixelToHex(0, 0, cameraX, cameraY);
    const hexTopRight = pixelToHex(canvas.width, 0, cameraX, cameraY);
    const hexBottomLeft = pixelToHex(0, canvas.height, cameraX, cameraY);
    const hexBottomRight = pixelToHex(canvas.width, canvas.height, cameraX, cameraY);

    const minQ = Math.min(hexTopLeft.q, hexTopRight.q, hexBottomLeft.q, hexBottomRight.q);
    const maxQ = Math.max(hexTopLeft.q, hexTopRight.q, hexBottomLeft.q, hexBottomRight.q);
    const minR = Math.min(hexTopLeft.r, hexTopRight.r, hexBottomLeft.r, hexBottomRight.r);
    const maxR = Math.max(hexTopLeft.r, hexTopRight.r, hexBottomLeft.r, hexBottomRight.r);

    const buffer = 5;
    const startQ = minQ - buffer;
    const endQ = maxQ + buffer;
    const startR = minR - buffer;
    const endR = maxR + buffer;



    const currentFrameVisibleHexes = new Set();
    const visibleTilesToDraw = [];

    // First pass: collect all visible tiles and their heights
    for (let q = startQ; q <= endQ; q++) {
        for (let r = startR; r <= endR; r++) {
            const key = `${q},${r}`;
            const { cx, cy } = hexToPixel(q, r);

            // Check if the hex's bounding box (approximate) intersects the canvas
            // This ensures only hexes visible within the rectangular camera view are considered 'viewed' for this frame.
            const hexWidth = HEX_SIZE * 2;
            const hexHeight = HEX_SIZE * Math.sqrt(3);

            if (cx + hexWidth / 2 > 0 && cx - hexWidth / 2 < canvas.width &&
                cy + hexHeight / 2 > 0 && cy - hexHeight / 2 < canvas.height) {
                currentFrameVisibleHexes.add(key);
                
                // Calculate tile height for z-index sorting
                const tile = hexStates[key];
                const height = (tile && tile.population > 1) ? Math.min(tile.population - 1, 9) : 0;
                
                visibleTilesToDraw.push({ q, r, height });
            }
        }
    }

    // Sort tiles by height (shortest first, tallest last) for proper z-index rendering
    visibleTilesToDraw.sort((a, b) => a.height - b.height);

    // Second pass: draw tiles in height order
    for (const { q, r } of visibleTilesToDraw) {
        drawHex(q, r);
    }

    // Merge the currently visible hexes with the persistently explored tiles
    if (isInitialSpawnComplete) {
        exploredTiles = new Set([...exploredTiles, ...currentFrameVisibleHexes]);
        
        // More intelligent tile cache cleanup based on distance from user
        if (exploredTiles.size > 4000) { // Reduced from 5000 to 4000 for better memory management
            const userCenter = currentUser && currentUser.capitol ? currentUser.capitol.split(',').map(Number) : [0, 0];
            const [userQ, userR] = userCenter;
            
            // Sort tiles by distance from user, keeping closer ones
            const tilesWithDistance = [...exploredTiles].map(tile => {
                const [q, r] = tile.split(',').map(Number);
                const distance = Math.abs(q - userQ) + Math.abs(r - userR);
                return { tile, distance };
            });
            
            // Keep closest 3000 tiles + all owned tiles + all tiles with exclamations
            tilesWithDistance.sort((a, b) => a.distance - b.distance);
            const priorityTiles = new Set();
            
            // Always keep owned tiles and important tiles
            [...exploredTiles].forEach(tile => {
                const tileData = hexStates[tile];
                if (tileData && (tileData.owner === (currentUser ? currentUser.username : null) || tileData.hasExclamation)) {
                    priorityTiles.add(tile);
                }
            });
            
            // Add closest tiles up to limit
            let count = 0;
            const maxNormalTiles = 3000 - priorityTiles.size;
            for (const item of tilesWithDistance) {
                if (count >= maxNormalTiles) break;
                if (!priorityTiles.has(item.tile)) {
                    priorityTiles.add(item.tile);
                    count++;
                }
            }
            
            exploredTiles = priorityTiles;
            
            // Clean up hexStates cache for removed tiles
            Object.keys(hexStates).forEach(key => {
                if (!exploredTiles.has(key) && !currentFrameVisibleHexes.has(key)) {
                    delete hexStates[key];
                }
            });
        }
    }

    // Add owned tiles and their 5-block radius to exploredTiles (optimized with caching)
    if (currentUser && ownedTilesCache.needsUpdate) {
        updateOwnedTilesCache();
    }
    
    if (currentUser && ownedTilesCache.radiusTiles.size > 0) {
        exploredTiles = new Set([...exploredTiles, ...ownedTilesCache.radiusTiles]);
    }
}

function drawDisconnectedArrow() {
    if (!currentUser) return;

    const myCapitolQ = parseInt(currentUser.capitol.split(',')[0]);
    const myCapitolR = parseInt(currentUser.capitol.split(',')[1]);

    let closestDisconnectedTile = null;
    let minDistance = Infinity;

    for (const key in hexStates) {
        const tile = hexStates[key];
        if (tile.owner === currentUser.username && tile.isDisconnected) {
            const [tq, tr] = key.split(',').map(Number);
            const distance = hexDistance(myCapitolQ, myCapitolR, tq, tr);
            if (distance < minDistance) {
                minDistance = distance;
                closestDisconnectedTile = { q: tq, r: tr };
            }
        }
    }

    if (closestDisconnectedTile) {
        const { cx: tilePixelX, cy: tilePixelY } = hexToPixel(closestDisconnectedTile.q, closestDisconnectedTile.r);

        // Check if the disconnected tile is currently visible on screen
        if (tilePixelX > 0 && tilePixelX < canvas.width && tilePixelY > 0 && tilePixelY < canvas.height) {
            return; // Skip drawing arrow if tile is visible
        }

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        const angle = Math.atan2(tilePixelY - centerY, tilePixelX - centerX);
        const arrowLength = 50;
        const arrowHeadSize = 15;

        ctx.save();
        ctx.translate(centerX + Math.cos(angle) * (Math.min(centerX, centerY) - 20), centerY + Math.sin(angle) * (Math.min(centerX, centerY) - 20));
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowHeadSize, arrowHeadSize / 2);
        ctx.lineTo(-arrowHeadSize, -arrowHeadSize / 2);
        ctx.closePath();
        ctx.fillStyle = 'red'; // Disconnected arrow is red
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength, 0);
        ctx.strokeStyle = 'red'; // Disconnected arrow is red
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.restore();
    }
}

function drawMap() {
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mapCtx.fillStyle = 'black'; // Background for unexplored areas
    mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

    const scaledHexSize = HEX_SIZE * MAP_SCALE;

    // Calculate offset to center the entire map in the mapCanvas initially
    // This is adjusted by mapCameraX/Y for panning
    const offsetX = mapCanvas.width / 2 + mapCameraX;
    const offsetY = mapCanvas.height / 2 + mapCameraY;

    // Iterate over ALL explored tiles
    for (const key of exploredTiles) {
        const [q, r] = key.split(',').map(Number);
        const tile = hexStates[key]; // Check if it's an owned tile or has an exclamation

        const { x: worldX, y: worldY } = hexToWorld(q, r);

        // Scale and translate to map canvas coordinates
        const mapX = worldX * MAP_SCALE + offsetX;
        const mapY = worldY * MAP_SCALE + offsetY;

        mapCtx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i;
            const hx = mapX + scaledHexSize * Math.cos(angle);
            const hy = mapY + scaledHexSize * Math.sin(angle);
            if (i === 0) {
                mapCtx.moveTo(hx, hy);
            } else {
                mapCtx.lineTo(hx, hy);
            }
        }
        mapCtx.closePath();

        let hexColor;
        if (tile && tile.owner) {
            hexColor = users[tile.owner] ? users[tile.owner].color : '#FFFFFF'; // Owned tile color
        } else {
            hexColor = 'white'; // Default to land
        }
        mapCtx.fillStyle = hexColor;
        mapCtx.fill();

        // Draw capitol stars on the map
        if (Object.values(users).some(user => user.capitol === key)) {
            drawStarOnMap(mapX, mapY, scaledHexSize * 0.4, 5, 0.5);
        }

        // Draw exclamation mark on the map
        if (tile && tile.hasExclamation === true) {
            mapCtx.fillStyle = 'red'; // Color for the exclamation mark
            mapCtx.font = 'bold ' + (scaledHexSize * 0.8) + 'px Arial';
            mapCtx.textAlign = 'center';
            mapCtx.textBaseline = 'middle';
            mapCtx.fillText('!', mapX, mapY);
        }
    }

    // Draw the target X if set
    if (targetWorldX !== null && targetWorldY !== null) {
        const targetMapX = targetWorldX * MAP_SCALE + offsetX;
        const targetMapY = targetWorldY * MAP_SCALE + offsetY;

        mapCtx.strokeStyle = 'cyan';
        mapCtx.lineWidth = 3;

        const xSize = 10;
        mapCtx.beginPath();
        mapCtx.moveTo(targetMapX - xSize, targetMapY - xSize);
        mapCtx.lineTo(targetMapX + xSize, targetMapY + xSize);
        mapCtx.moveTo(targetMapX + xSize, targetMapY - xSize);
        mapCtx.lineTo(targetMapX - xSize, targetMapY + xSize);
        mapCtx.stroke();
    }
}

function drawStarOnMap(cx, cy, outerRadius, numPoints, innerRadiusRatio) {
    const innerRadius = outerRadius * innerRadiusRatio;
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / numPoints;

    mapCtx.beginPath();
    mapCtx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < numPoints; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        mapCtx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        mapCtx.lineTo(x, y);
        rot += step;
    }
    mapCtx.lineTo(cx, cy - outerRadius);
    mapCtx.closePath();
    mapCtx.fillStyle = 'gold';
    mapCtx.strokeStyle = 'darkgoldenrod';
    mapCtx.lineWidth = 1;
    mapCtx.fill();
    mapCtx.stroke();
}