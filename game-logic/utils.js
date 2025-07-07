function generateRandomColor() {
    let color;
    do {
        color = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
    } while (color.toLowerCase() === '#ffffff'); // Ensure the color is not white
    return color;
}

function getHexNeighbors(q, r) {
    const neighbors = [
        { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
    ];
    return neighbors.map(n => ({ q: q + n.dq, r: r + n.dr }));
}

function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

module.exports = {
    generateRandomColor,
    getHexNeighbors,
    hexDistance
};