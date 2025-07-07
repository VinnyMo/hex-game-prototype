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

let exploredTiles = new Set();

function syncExploredTiles() {
    if (currentUser) {
        socket.emit('syncExploredTiles', Array.from(exploredTiles));
    }
}

const socket = io();

setupSocketEventHandlers();

loginButton.addEventListener('click', () => {
    const username = usernameInput.value;
    const password = passwordInput.value;
    if (username && password) {
        socket.emit('login', { username, password });
    } else {
        loginError.textContent = 'Please enter both username and password.';
    }
});

// Periodically sync explored tiles to the server
setInterval(syncExploredTiles, 30 * 1000); // Every 30 seconds

let flashState = false;
// Toggle flashState every 500ms and re-render
setInterval(() => {
    flashState = !flashState;
    renderGrid();
}, 500);

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