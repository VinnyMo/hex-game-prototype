function drawHex(q, r) {
    const { cx: x, cy: y } = hexToPixel(q, r);

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i;
        const hx = x + HEX_SIZE * Math.cos(angle);
        const hy = y + HEX_SIZE * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(hx, hy);
        } else {
            ctx.lineTo(hx, hy);
        }
    }
    ctx.closePath();

    const key = `${q},${r}`;
    const tile = hexStates[key];
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

    ctx.fillStyle = hexColor;
    ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (Object.values(users).some(user => user.capitol === key)) {
        drawStar(x, y, HEX_SIZE * 0.4, 5, 0.5);
    }

    if (tile && tile.population > 1) {
        const textColor = getContrastingTextColor(hexColor.replace('#', ''));
        ctx.fillStyle = textColor;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.population, x, y);
    } else if (tile && tile.hasExclamation) {
        ctx.fillStyle = 'red'; // Color for the exclamation mark
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', x, y);
    }
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
                drawHex(q, r);
            }
        }
    }

    // Merge the currently visible hexes with the persistently explored tiles
    if (isInitialSpawnComplete) {
        exploredTiles = new Set([...exploredTiles, ...currentFrameVisibleHexes]);
    }

    if (currentUser) {
        drawEnemyArrows();
        drawDisconnectedArrow();
    }
}

function drawEnemyArrows() {
    if (!currentUser) return;

    const myCapitolQ = parseInt(currentUser.capitol.split(',')[0]);
    const myCapitolR = parseInt(currentUser.capitol.split(',')[1]);

    const enemyCapitols = [];
    for (const username in users) {
        if (username !== currentUser.username) {
            const enemyUser = users[username];
            const [eq, er] = enemyUser.capitol.split(',').map(Number);
            const distance = hexDistance(myCapitolQ, myCapitolR, eq, er);
            enemyCapitols.push({ q: eq, r: er, distance: distance, color: enemyUser.color });
        }
    }

    enemyCapitols.sort((a, b) => a.distance - b.distance);

    const top3Enemies = enemyCapitols.slice(0, 3);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    top3Enemies.forEach(enemy => {
        const { cx: enemyPixelX, cy: enemyPixelY } = hexToPixel(enemy.q, enemy.r);

        // Check if the enemy capitol is currently visible on screen
        if (enemyPixelX > 0 && enemyPixelX < canvas.width && enemyPixelY > 0 && enemyPixelY < canvas.height) {
            return; // Skip drawing arrow if capitol is visible
        }

        const angle = Math.atan2(enemyPixelY - centerY, enemyPixelX - centerX);
        const arrowLength = 50;
        const arrowHeadSize = 15;

        const startX = centerX + Math.cos(angle) * (Math.min(centerX, centerY) - arrowLength - 20);
        const startY = centerY + Math.sin(angle) * (Math.min(centerX, centerY) - arrowLength - 20);
        const endX = centerX + Math.cos(angle) * (Math.min(centerX, centerY) - 20);
        const endY = centerY + Math.sin(angle) * (Math.min(centerX, centerY) - 20);

        ctx.save();
        ctx.translate(endX, endY);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowHeadSize, arrowHeadSize / 2);
        ctx.lineTo(-arrowHeadSize, -arrowHeadSize / 2);
        ctx.closePath();
        ctx.fillStyle = enemy.color;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength, 0);
        ctx.strokeStyle = enemy.color;
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.restore();
    });
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
        if (tile && tile.hasExclamation) {
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