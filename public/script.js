// Polyfill for crypto.randomUUID
if (typeof window.crypto === 'undefined') {
    window.crypto = {}; // Ensure window.crypto exists
}
if (typeof window.crypto.randomUUID !== 'function') {
    window.crypto.randomUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    };
}


const canvas = document.getElementById('hexGridCanvas');
const ctx = canvas.getContext('2d');
const loginContainer = document.getElementById('loginContainer');
const gameContainer = document.getElementById('gameContainer');
const loginButton = document.getElementById('loginButton');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('loginError');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const HEX_SIZE = 40;
const HEX_WIDTH = HEX_SIZE * 2;
const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;

let cameraX = 0;
let cameraY = 0;
let isDragging = false;
let lastPointerX;
let lastPointerY;
let pointerDownX;
let pointerDownY;
const DRAG_THRESHOLD = 5;

let hexStates = {};
let users = {};
let leaderboard = {};
let currentUser = null;

const socket = io();



loginButton.addEventListener('click', () => {
    const username = usernameInput.value;
    const password = passwordInput.value;
    if (username && password) {
        socket.emit('login', { username, password });
    } else {
        loginError.textContent = 'Please enter both username and password.';
    }
});

socket.on('loginSuccess', ({ user }) => {
    currentUser = user;
    loginContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    // The 'gameState' event will handle the rest
});

socket.on('loginError', (message) => {
    loginError.textContent = message;
});

// --- Start of Optimized Event Handlers ---

// This event now only fires once on login
socket.on('gameState', (state) => {
    hexStates = state.gridState;
    users = state.users;
    leaderboard = state.leaderboard;
    renderGrid();
    if (currentUser) {
        updateStats();
        updateLeaderboard();
        recenterCapitol();
    }
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

// --- End of Optimized Event Handlers ---

function hexToWorld(q, r) {
    const x = HEX_SIZE * 3 / 2 * q;
    const y = HEX_SIZE * Math.sqrt(3) * (r + q / 2);
    return { x, y };
}

function worldToCanvas(worldX, worldY) {
    return {
        cx: worldX + canvas.width / 2 + cameraX,
        cy: worldY + canvas.height / 2 + cameraY
    };
}

function canvasToWorld(cx, cy) {
    return {
        worldX: cx - canvas.width / 2 - cameraX,
        worldY: cy - canvas.height / 2 - cameraY
    };
}

function worldToHex(worldX, worldY) {
    const q = (worldX * 2 / 3) / HEX_SIZE;
    const r = (-worldX / 3 + Math.sqrt(3) / 3 * worldY) / HEX_SIZE;
    let rx = Math.round(q);
    let ry = Math.round(r);
    let rz = Math.round(-q - r);

    const x_diff = Math.abs(rx - q);
    const y_diff = Math.abs(ry - r);
    const z_diff = Math.abs(rz - (-q - r));

    if (x_diff > y_diff && x_diff > z_diff) {
        rx = -ry - rz;
    } else if (y_diff > z_diff) {
        ry = -rx - rz;
    } else {
        rz = -rx - ry;
    }

    return { q: rx, r: ry };
}

function hexToPixel(q, r) {
    const { x: worldX, y: worldY } = hexToWorld(q, r);
    return worldToCanvas(worldX, worldY);
}

function pixelToHex(x, y) {
    const { worldX, worldY } = canvasToWorld(x, y);
    return worldToHex(worldX, worldY);
}

function getContrastingTextColor(hexColor) {
    if (hexColor.startsWith('#')) {
        hexColor = hexColor.slice(1);
    }
    const r = parseInt(hexColor.substr(0, 2), 16);
    const g = parseInt(hexColor.substr(2, 2), 16);
    const b = parseInt(hexColor.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? 'black' : 'white';
}

function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

let flashState = false;

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
    let hexColor = tile && users[tile.owner] ? users[tile.owner].color : 'white';

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

// Toggle flashState every 500ms and re-render
setInterval(() => {
    flashState = !flashState;
    renderGrid();
}, 500);

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



    for (let q = startQ; q <= endQ; q++) {
        for (let r = startR; r <= endR; r++) {
            drawHex(q, r);
        }
    }
    if (currentUser) {
        drawEnemyArrows();
        drawDisconnectedArrow();
    }
}

let lastClickTime = 0;
const CLICK_DEBOUNCE_TIME = 300; // milliseconds

const handlePointerDown = (e) => {
    if (currentUser) { // Only allow dragging if logged in
        isDragging = false;
        lastPointerX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : undefined);
        pointerDownX = lastPointerX;
        lastPointerY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : undefined);
        pointerDownY = lastPointerY;
    }
};

let animationFrameId = null;

const handlePointerMove = (e) => {
    if (!currentUser || pointerDownX === undefined) return;

    const currentX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : undefined);
    const currentY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : undefined);

    if (!isDragging) {
        const dx = Math.abs(currentX - pointerDownX);
        const dy = Math.abs(currentY - pointerDownY);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            isDragging = true;
        }
    }

    if (isDragging) {
        const dx = currentX - lastPointerX;
        const dy = currentY - lastPointerY;
        cameraX += dx;
        cameraY += dy;

        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                renderGrid();
                animationFrameId = null;
            });
        }
    }

    lastPointerX = currentX;
    lastPointerY = currentY;
};

const handlePointerUp = (e) => {
    if (!currentUser) return;

    const upX = e.clientX !== undefined ? e.clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : undefined);
    const upY = e.clientY !== undefined ? e.clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : undefined);

    const currentTime = new Date().getTime();

    if (!isDragging && (currentTime - lastClickTime > CLICK_DEBOUNCE_TIME)) {
        handleHexClick(upX, upY);
        lastClickTime = currentTime;
    }
    isDragging = false;
    pointerDownX = undefined;
    pointerDownY = undefined;
};

canvas.addEventListener('mousedown', handlePointerDown);
canvas.addEventListener('mousemove', handlePointerMove);
canvas.addEventListener('mouseup', handlePointerUp);
canvas.addEventListener('mouseout', () => {
    isDragging = false;
    pointerDownX = undefined;
    pointerDownY = undefined;
});

canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
canvas.addEventListener('touchend', handlePointerUp, { passive: false });

function handleHexClick(x, y) {
    if (!currentUser) return;
    const { q, r } = pixelToHex(x, y, cameraX, cameraY);
    socket.emit('hexClick', { q, r });
}

function updateStats() {
    const populationStat = document.getElementById('populationStat');
    const areaStat = document.getElementById('areaStat');

    let totalPopulation = 0;
    let totalArea = 0;

    for (const key in hexStates) {
        const tile = hexStates[key];
        if (tile.owner === currentUser.username) {
            totalPopulation += tile.population;
            totalArea++;
        }
    }

    populationStat.textContent = totalPopulation;
    areaStat.textContent = totalArea;
}

function updateLeaderboard() {
    const populationLeaderboard = document.getElementById('populationLeaderboard');
    const areaLeaderboard = document.getElementById('areaLeaderboard');

    populationLeaderboard.innerHTML = '';
    areaLeaderboard.innerHTML = '';

    if (leaderboard.population) {
        leaderboard.population.forEach(entry => {
            const li = document.createElement('li');
            li.textContent = `${entry.username}: ${entry.population}`;
            populationLeaderboard.appendChild(li);
        });
    }

    if (leaderboard.area) {
        leaderboard.area.forEach(entry => {
            const li = document.createElement('li');
            li.textContent = `${entry.username}: ${entry.area}`;
            areaLeaderboard.appendChild(li);
        });
    }
}

const recenterButton = document.getElementById('recenterButton');
recenterButton.addEventListener('click', recenterCapitol);

function recenterCapitol() {
    if (!currentUser || !currentUser.capitol) return;
    const [q, r] = currentUser.capitol.split(',').map(Number);
    const { x: capitolWorldX, y: capitolWorldY } = hexToWorld(q, r);
    cameraX = -capitolWorldX;
    cameraY = -capitolWorldY;
    renderGrid();
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
    if (!currentUser || !flashState) return; // Only draw if flashState is true

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

// Initial render of the grid (for login screen)

const mapButton = document.getElementById('mapButton');
const mapOverlay = document.getElementById('mapOverlay');
const closeMapButton = document.getElementById('closeMapButton');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');

const MAP_SCALE = 0.01; // 1/100 scale

let mapCameraX = 0;
let mapCameraY = 0;
let isMapDragging = false;
let lastMapPointerX;
let lastMapPointerY;
let mapPointerDownX;
let mapPointerDownY;
let targetWorldX = null;
let targetWorldY = null;

mapButton.addEventListener('click', () => {
    if (currentUser) {
        mapOverlay.style.display = 'flex';
        mapCanvas.width = window.innerWidth;
        mapCanvas.height = window.innerHeight;
        // Center the map based on the current camera position
        mapCameraX = cameraX * MAP_SCALE;
        mapCameraY = cameraY * MAP_SCALE;
        drawMap();
    }
});

closeMapButton.addEventListener('click', () => {
    if (targetWorldX !== null && targetWorldY !== null) {
        cameraX = -targetWorldX;
        cameraY = -targetWorldY;
        targetWorldX = null; // Reset target
        targetWorldY = null; // Reset target
        renderGrid();
    }
    mapOverlay.style.display = 'none';
});

mapCanvas.addEventListener('mousedown', handleMapPointerDown);
mapCanvas.addEventListener('mousemove', handleMapPointerMove);
mapCanvas.addEventListener('mouseup', handleMapPointerUp);
mapCanvas.addEventListener('mouseout', () => {
    isMapDragging = false;
});

mapCanvas.addEventListener('touchstart', handleMapPointerDown, { passive: false });
mapCanvas.addEventListener('touchmove', handleMapPointerMove, { passive: false });
mapCanvas.addEventListener('touchend', handleMapPointerUp, { passive: false });

function handleMapPointerDown(e) {
    isMapDragging = false; // Assume it's a click until proven a drag
    lastMapPointerX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : undefined);
    mapPointerDownX = lastMapPointerX; // Store initial position for click detection
    lastMapPointerY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : undefined);
    mapPointerDownY = lastMapPointerY; // Store initial position for click detection

    // Clear target when a new interaction starts
    targetWorldX = null;
    targetWorldY = null;
    drawMap(); // Redraw to remove the X immediately
}

let mapAnimationFrameId = null;

function handleMapPointerMove(e) {
    const currentX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : undefined);
    const currentY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : undefined);

    if (mapPointerDownX === undefined) return; // No pointer down event recorded

    if (!isMapDragging) {
        const dx = Math.abs(currentX - mapPointerDownX);
        const dy = Math.abs(currentY - mapPointerDownY);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            isMapDragging = true;
        }
    }

    if (isMapDragging) {
        const dx = currentX - lastMapPointerX;
        const dy = currentY - lastMapPointerY;

        mapCameraX += dx;
        mapCameraY += dy;

        if (!mapAnimationFrameId) {
            mapAnimationFrameId = requestAnimationFrame(() => {
                drawMap();
                mapAnimationFrameId = null;
            });
        }
    }

    lastMapPointerX = currentX;
    lastMapPointerY = currentY;
}

function handleMapPointerUp(e) {
    const upX = e.clientX !== undefined ? e.clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : undefined);
    const upY = e.clientY !== undefined ? e.clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : undefined);

    // If it was a click (not a drag)
    if (!isMapDragging && (Math.abs(upX - mapPointerDownX) < DRAG_THRESHOLD && Math.abs(upY - mapPointerDownY) < DRAG_THRESHOLD)) {
        handleMapClick(e);
    }
    isMapDragging = false;
    mapPointerDownX = undefined;
    mapPointerDownY = undefined;
}

function handleMapClick(e) {
    const mapClickX = e.clientX - mapCanvas.getBoundingClientRect().left;
    const mapClickY = e.clientY - mapCanvas.getBoundingClientRect().top;

    // Convert map canvas coordinates to world coordinates
    const worldX = (mapClickX - (mapCanvas.width / 2 + mapCameraX)) / MAP_SCALE;
    const worldY = (mapClickY - (mapCanvas.height / 2 + mapCameraY)) / MAP_SCALE;

    targetWorldX = worldX;
    targetWorldY = worldY;

    drawMap(); // Redraw map to show the X
}

function drawMap() {
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mapCtx.fillStyle = 'white';
    mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

    const scaledHexSize = HEX_SIZE * MAP_SCALE;

    // Find min/max q and r values from hexStates to determine map bounds
    let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const key in hexStates) {
        const [q, r] = key.split(',').map(Number);
        minQ = Math.min(minQ, q);
        maxQ = Math.max(maxQ, q);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
    }

    // Calculate world dimensions of the entire map
    const worldMinX = hexToWorld(minQ, minR).x;
    const worldMaxX = hexToWorld(maxQ, maxR).x;
    const worldMinY = hexToWorld(minQ, minR).y;
    const worldMaxY = hexToWorld(maxQ, maxR).y;

    const worldWidth = worldMaxX - worldMinX + HEX_WIDTH;
    const worldHeight = worldMaxY - worldMinY + HEX_HEIGHT;

    // Calculate offset to center the entire map in the mapCanvas initially
    // This is adjusted by mapCameraX/Y for panning
    const offsetX = mapCanvas.width / 2 + mapCameraX;
    const offsetY = mapCanvas.height / 2 + mapCameraY;

    for (const key in hexStates) {
        const [q, r] = key.split(',').map(Number);
        const tile = hexStates[key];

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

        let hexColor = tile && users[tile.owner] ? users[tile.owner].color : '#FFFFFF'; // Default to white for unowned tiles
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