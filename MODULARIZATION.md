# Project Modularization

This document outlines the modular structure of the `hex_game_prototype` project after the refactoring. The project has been split into front-end and back-end modules to improve maintainability and scalability.

## Backend

The back-end code has been split from a single `server.js` file into a collection of modules located in the `game-logic/` directory.

### `game-logic/`

-   **`db.js`**: This module handles the connection and initialization of the SQLite database (`game.db`).
-   **`exclamationWorker.js`**: This module runs in a separate worker thread and is responsible for periodically generating new '!' tiles on the map within the database.
-   **`logging.js`**: This module is responsible for all logging-related functionalities. It sets up file-based logging for both server and client-side events.
-   **`utils.js`**: This module contains a collection of utility functions that are used throughout the back-end, such as `generateRandomColor`, `getHexNeighbors`, and `hexDistance`.
-   **`gameState.js`**: This module is responsible for managing the game's state by providing functions to query and update the SQLite database for tile and user data. It abstracts the database interactions for the rest of the application.
-   **`game.js`**: This module contains the core game logic, including the main game loop, event handlers for player actions, and other game-related logic.
-   **`spawnWorker.js`**: This module runs in a separate worker thread and is responsible for CPU-intensive tasks like finding random spawn points. It now prioritizes checking a pre-generated cache file (`spawn_cache.json`) for available spawn points and removes used or invalid points from this cache to optimize performance.
-   **`generate_spawn_cache.js`**: This script is responsible for pre-calculating and generating a cache of valid spawn points (`spawn_cache.json`). It determines the current boundaries of the game grid and generates new spawn points along an expanded circumference, ensuring the map can grow infinitely. This script is intended to be run as a cron job to keep the cache updated.
-   **`sockets.js`**: This module is responsible for handling all socket events. It contains the `io.on('connection', ...)` block and all the socket event listeners. It now utilizes `worker_threads` for tasks like finding spawn points to improve performance.

## Root Directory

-   **`create_users.js`**: A script used for testing, which automates the creation of new users via the login screen using Puppeteer.

### `server.js`

The main `server.js` file has been refactored to be much cleaner and is now primarily responsible for setting up the server and initializing the game. It imports and uses the new modules from the `game-logic/` directory.

## Frontend

The front-end code has been split from a single `script.js` file into a collection of modules located in the `public/js/` directory.

### `public/js/`

-   **`client-utils.js`**: This module contains a collection of utility functions that are used throughout the front-end, such as `hexToWorld`, `worldToCanvas`, and `pixelToHex`.
-   **`drawing.js`**: This module is responsible for all canvas drawing-related functionalities. It contains functions like `drawHex`, `drawStar`, and `renderGrid`.
-   **`event-handlers.js`**: This module is responsible for handling all socket events on the client-side.
-   **`main.js`**: This module contains the main client-side logic, including the game loop, event listeners for user input, and other client-side logic.

### `public/index.html`

The `index.html` file has been updated to include the new script files from the `public/js/` directory.
