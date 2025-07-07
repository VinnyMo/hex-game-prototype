const fs = require('fs');
const path = require('path');
const { log, error } = require('./logging');

const GRID_STATE_FILE = path.join(__dirname, '..', 'grid_state.json');
const USERS_FILE = path.join(__dirname, '..', 'users.json');

let gridState = {};
let users = {};

function loadGameState() {
    try {
        const gridData = fs.readFileSync(GRID_STATE_FILE, 'utf8');
        gridState = JSON.parse(gridData);
        log('Server: Grid state loaded from file.');
    } catch (err) {
        log('Server: No existing grid state file found. Initializing new state.');
    }

    try {
        const usersData = fs.readFileSync(USERS_FILE, 'utf8');
        users = JSON.parse(usersData);
        // Ensure each user has an exploredTiles array
        for (const userId in users) {
            if (!users[userId].exploredTiles) {
                users[userId].exploredTiles = [];
            }
        }
        log('Server: Users loaded from file.');
    } catch (err) {
        log('Server: No existing users file found. Initializing new users object.');
    }
}

let isSaving = false;
function saveGameState() {
    if (isSaving) return;
    isSaving = true;
    log('Server: Saving game state...');
    const gridStateString = JSON.stringify(gridState, null, 2);
    fs.writeFile(GRID_STATE_FILE, gridStateString, (err) => {
        if (err) {
            error('Error saving grid state:', err);
        }
        isSaving = false;
    });
    const usersString = JSON.stringify(users, null, 2);
    fs.writeFile(USERS_FILE, usersString, (err) => {
        if (err) {
            error('Error saving users:', err);
        }
    });
}

function getGridState() {
    return gridState;
}

function getUsers() {
    return users;
}

function setGridState(newGridState) {
    gridState = newGridState;
}

function setUsers(newUsers) {
    users = newUsers;
}

module.exports = {
    loadGameState,
    saveGameState,
    getGridState,
    getUsers,
    setGridState,
    setUsers
};