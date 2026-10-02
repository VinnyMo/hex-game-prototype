# Hex Game Prototype

A browser-based multiplayer territory game on a hex grid. Claim adjacent tiles, build population, capture `!` tiles, and watch the world update through Socket.IO.

The project combines a Node.js server, a Canvas client, and SQLite persistence. It's a local-play prototype with room to keep developing the game mechanics and multiplayer experience.

[Run locally](#run-locally) · [How to play](#how-to-play) · [Source guide](#source-guide) · [Prototype limits](#prototype-limits)

## What it explores

- Real-time territory expansion and population-based combat
- Persistent tiles and player state in SQLite
- Spawn placement with cached candidate locations and collision checks
- Background workers for exclamation-tile generation
- Viewport-based tile requests, a minimap, and live leaderboards

The repository also contains implementation notes and diagnostic scripts for spawn behavior, synchronization, and database performance. Those experiments do not establish a tested player-capacity or frame-rate guarantee.

## Run locally

Use Node.js and npm compatible with the locked dependencies. The package does not declare a supported Node.js version range.

```bash
git clone https://github.com/VinnyMo/hex-game-prototype.git
cd hex-game-prototype
npm ci
node server.js
```

Open <http://localhost:3000>. `server.js` is the main server entry point; the repository does not define a `start` script in `package.json`.

**Use disposable test credentials and a local development environment.** The prototype stores passwords in plaintext and includes user objects in multiplayer messages, so authentication needs work before use with real players. The server listener is not explicitly limited to localhost; keep it isolated from public access.

The server reads and writes `game.db` in the project root. The included database and SQLite sidecar files preserve existing test-world state; the accounts were created with disposable test credentials. Work in a copy if you'd like to keep that starting world intact.

## How to play

1. Enter a disposable username and password. A new username creates a player and a starting capitol.
2. Click adjacent unclaimed tiles to expand your territory.
3. Click your own tiles to increase their population.
4. Capture adjacent `!` tiles for their population effect.
5. Attack adjacent enemy tiles, reducing their population until you can take them.
6. Follow the population and area leaderboards as the map changes.

Capitol tiles are protected from attack. The game also includes a periodic territory-disconnection penalty; the rules live in [`game-logic/game.js`](game-logic/game.js).

## Source guide

| Path | Purpose |
| --- | --- |
| [`server.js`](server.js) | Express/Socket.IO server and recurring game tasks |
| [`game-logic/sockets.js`](game-logic/sockets.js) | Login, player actions, and map messages |
| [`game-logic/game.js`](game-logic/game.js) | Game rules, effects, and leaderboard calculations |
| [`game-logic/gameState.js`](game-logic/gameState.js) | Game-state reads and batched persistence |
| [`game-logic/db.js`](game-logic/db.js) | SQLite schema, indexes, and queued operations |
| [`game-logic/smartSpawnManager.js`](game-logic/smartSpawnManager.js) | Spawn selection and cache management |
| [`game-logic/workerPool.js`](game-logic/workerPool.js) | Background worker coordination |
| [`public/`](public/) | Browser interface, rendering, and styles |

### Implementation notes

- [Modularization](MODULARIZATION.md)
- [Smart spawn system](SMART_SPAWN_SYSTEM.md)
- [Spawn cache optimization](SPAWN_CACHE_OPTIMIZATION.md)
- [Exclamation synchronization](EXCLAMATION_SYNC_FIX.md)
- [Optimization notes](OPTIMIZATION_SUMMARY.md)

These documents capture development work and design choices. Treat their numerical targets and historical measurements as notes to recheck in your own environment.

## Prototype limits

- `npm test` is a placeholder that exits with an error, not an automated test suite
- Standalone `test_*.js`, `performance_test.js`, and analysis scripts are development tools; inspect their server and database effects before running them
- Performance, browser compatibility, and deployment hardening need fresh validation

## License metadata

[`package.json`](package.json) declares ISC. A standalone license file is not included in the repository.
