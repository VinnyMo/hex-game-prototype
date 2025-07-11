# 🎮 Hex Game Prototype

A real-time multiplayer hexagonal tile-based strategy game built with Node.js, SQLite, and Socket.io. Players expand their territory by capturing tiles and exclamation marks in a persistent hex world.

## 🌟 Features

### Core Gameplay
- **Real-time multiplayer** territory expansion on a hexagonal grid
- **Persistent world** with SQLite database storage
- **Smart spawn system** with intelligent collision avoidance
- **Exclamation tile mechanics** for strategic resource gathering
- **Population growth** and territory management
- **Capitol protection** with disconnection penalties
- **Live leaderboards** with population and area rankings

### Technical Highlights
- **Performance optimized** for 1000+ players and 20,000+ tiles
- **Intelligent caching** with spatial optimization
- **Density-based exclamation control** (2.5% cap around territories)
- **Chunked tile loading** for fast initial experience
- **Real-time collision detection** and spawn validation
- **Database indexes** for sub-millisecond queries
- **Memory management** with explored tile limits

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Installation
```bash
git clone https://github.com/VinnyMo/hex-game-prototype.git
cd hex-game-prototype
npm install
```

### Running the Game
```bash
npm start
```
Visit `http://localhost:3000` to play!

## 🎯 How to Play

1. **Create Account**: Enter a username and password to spawn in the world
2. **Expand Territory**: Click adjacent tiles to claim them for your empire
3. **Capture Exclamations**: Click red "!" tiles to gain population boosts
4. **Grow Population**: Click your own tiles to increase their population
5. **Strategic Planning**: Balance expansion vs. fortification
6. **Compete**: Climb the leaderboards for population and territory size

### Game Mechanics
- **Adjacency Rule**: Can only claim tiles adjacent to your territory
- **Capitol Immunity**: Your starting capitol cannot be attacked
- **Population Combat**: Attack enemy tiles to reduce their population
- **Disconnection Penalty**: Offline tiles become vulnerable over time
- **Exclamation Spawning**: New "!" tiles appear around active players

## 🏗️ Architecture

### Backend Stack
- **Node.js** with Express for the web server
- **Socket.io** for real-time multiplayer communication  
- **SQLite** with WAL mode for persistent data storage
- **Worker threads** for background exclamation generation
- **Smart caching** with spatial sector mapping

### Frontend Stack
- **Vanilla JavaScript** with Canvas API for hex rendering
- **Real-time updates** via Socket.io client
- **Viewport culling** and chunked loading for performance
- **Minimap** with full territory overview
- **Responsive design** for desktop and mobile

### Performance Features
- **Database indexes** on coordinates, ownership, and population
- **Spatial optimization** with 200x200 hex sectors
- **Cached spawn points** with real-time validation  
- **Debounced rendering** at 60fps max
- **Memory limits** on explored tile tracking
- **Chunked initial loading** for sub-5-second startup

## 🔧 Development

### Project Structure
```
hex-game-prototype/
├── game-logic/           # Core game engine
│   ├── db.js            # Database connection and queries
│   ├── gameState.js     # Game state management  
│   ├── smartSpawnManager.js # Intelligent spawn system
│   ├── sockets.js       # Socket.io event handlers
│   ├── game.js          # Game rules and mechanics
│   └── exclamationWorker.js # Background tile generation
├── public/              # Client-side code
│   ├── js/             # JavaScript modules
│   ├── style.css       # Game styling
│   └── index.html      # Main game page
├── check-density.js    # Density analysis tool
├── db-analysis.js      # Database performance tool
└── README.md          # This file
```

### Key Configuration
- **Spawn Distance**: 150 hex minimum between players
- **Exclamation Density**: 2.5% cap around territories  
- **Cache Size**: 500 pre-validated spawn points
- **Tile Limit**: 1000 tiles per region query
- **Explored Limit**: 5000 tiles per client

### Analysis Tools
```bash
# Check exclamation density around players
node check-density.js

# Analyze database performance 
node db-analysis.js
```

## 📊 Performance Metrics

The game is optimized to handle:
- **Large territories**: 2000+ tiles per player
- **Many players**: 100+ concurrent users  
- **Fast loading**: <5 second initial load
- **Smooth gameplay**: 60fps rendering
- **Low memory**: Capped growth patterns

### Benchmarks
- Database queries: <1ms average
- Spawn point generation: <300ms for 500 points
- Initial tile loading: <3 seconds for large players
- Memory usage: <100MB for 5000 explored tiles

## 🤝 Contributing

### Getting Started
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Commit using conventional commits (`git commit -m 'feat: add amazing feature'`)
5. Push to your branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Development Guidelines  
- Follow existing code style and patterns
- Add performance considerations for new features
- Include analysis tools for significant changes
- Test with large datasets (1000+ tiles)
- Document any new configuration options

## 📈 Roadmap

- [ ] User authentication with secure password hashing
- [ ] Player alliances and team mechanics  
- [ ] Advanced territory visualization and analytics
- [ ] Mobile app with native performance
- [ ] Automated balancing based on player metrics
- [ ] Tournament and competitive play modes

## 🐛 Known Issues

- Database files grow large over time (mitigated with WAL cleanup)
- Very large territories (5000+ tiles) may have minor lag spikes
- Mobile touch controls need refinement for precision

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with performance optimization techniques for real-time gaming
- Inspired by classic territory expansion games
- Uses efficient hex grid algorithms for spatial calculations
- Optimized for both casual and competitive play styles

---

**🎯 Ready to conquer the hex world? Start playing at `http://localhost:3000`!**