# Project Modularization

This document outlines the modular structure of the `hex_game_prototype` project after the refactoring. The project has been split into front-end and back-end modules to improve maintainability and scalability.

## Backend

The back-end code has been split from a single `server.js` file into a collection of modules located in the `game-logic/` directory.

### `game-logic/`

-   **`logging.js`**: This module is responsible for all logging-related functionalities. It sets up file-based logging for both server and client-side events.
-   **`utils.js`**: This module contains a collection of utility functions that are used throughout the back-end, such as `generateRandomColor`, `getHexNeighbors`, and `hexDistance`.
-   **`gameState.js`**: This module is responsible for managing the game's state. It handles loading and saving the `gridState` and `users` objects to and from their respective JSON files.
-   **`game.js`**: This module contains the core game logic, including the main game loop, event handlers for player actions, and other game-related logic.
-   **`sockets.js`**: This module is responsible for handling all socket events. It contains the `io.on('connection', ...)` block and all the socket event listeners.

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
