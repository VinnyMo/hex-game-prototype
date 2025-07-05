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
    recenterCapitol();
});

socket.on('loginError', (message) => {
    loginError.textContent = message;
});

socket.on('gameState', (state) => {
    hexStates = state.gridState;
    users = state.users;
    leaderboard = state.leaderboard;
    renderGrid();
    if (currentUser) {
        updateStats();
        updateLeaderboard();
    }
});

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

    leaderboard.population.forEach(entry => {
        const li = document.createElement('li');
        li.textContent = `${entry.username}: ${entry.population}`;
        populationLeaderboard.appendChild(li);
    });

    leaderboard.area.forEach(entry => {
        const li = document.createElement('li');
        li.textContent = `${entry.username}: ${entry.area}`;
        areaLeaderboard.appendChild(li);
    });
}

const recenterButton = document.getElementById('recenterButton');
recenterButton.addEventListener('click', recenterCapitol);

function recenterCapitol() {
    if (!currentUser) return;
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