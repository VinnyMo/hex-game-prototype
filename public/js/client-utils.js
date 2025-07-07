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