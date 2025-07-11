const { getTile } = require('./gameState');
const { hexDistance } = require('./utils');
const { log, error } = require('./logging');
const { getDb, safeDbOperation } = require('./db');
const fs = require('fs').promises;
const path = require('path');

const MIN_SPAWN_DISTANCE = 150;
const TARGET_CACHE_SIZE = 500; // Much larger cache for hundreds of users
const GRID_SECTOR_SIZE = 200; // Divide map into 200x200 hex sectors for spatial optimization
const SPAWN_CACHE_PATH = path.join(__dirname, '..', 'spawn_cache.json');
const SECTOR_CACHE_PATH = path.join(__dirname, '..', 'sector_cache.json');

class SmartSpawnManager {
    constructor() {
        this.spawnCache = [];
        this.sectorMap = new Map(); // Spatial optimization: group occupied tiles by sector
        this.lastSectorUpdate = 0;
        this.isGenerating = false;
        this.generationQueue = [];
    }

    // Initialize the spawn manager
    async initialize() {
        log('SmartSpawnManager: Initializing...');
        
        try {
            // Load existing spawn cache
            await this.loadSpawnCache();
            
            // Build spatial sector map
            await this.updateSectorMap();
            
            log(`SmartSpawnManager: Initialized with ${this.spawnCache.length} cached spawn points`);
        } catch (err) {
            error('SmartSpawnManager: Initialization failed:', err);
            // Continue without cache - will generate on-demand
        }
    }

    // Load spawn cache from file
    async loadSpawnCache() {
        try {
            const data = await fs.readFile(SPAWN_CACHE_PATH, 'utf8');
            this.spawnCache = JSON.parse(data);
            log(`SmartSpawnManager: Loaded ${this.spawnCache.length} spawn points from cache`);
        } catch (err) {
            log('SmartSpawnManager: No existing spawn cache found, will generate fresh cache');
            this.spawnCache = [];
        }
    }

    // Save spawn cache to file
    async saveSpawnCache() {
        try {
            await fs.writeFile(SPAWN_CACHE_PATH, JSON.stringify(this.spawnCache, null, 2));
            log(`SmartSpawnManager: Saved ${this.spawnCache.length} spawn points to cache`);
        } catch (err) {
            error('SmartSpawnManager: Failed to save spawn cache:', err);
        }
    }

    // Convert hex coordinates to sector key
    getSectorKey(q, r) {
        const sectorQ = Math.floor(q / GRID_SECTOR_SIZE);
        const sectorR = Math.floor(r / GRID_SECTOR_SIZE);
        return `${sectorQ},${sectorR}`;
    }

    // Get neighboring sector keys for distance checking
    getNeighboringSectors(sectorKey) {
        const [sectorQ, sectorR] = sectorKey.split(',').map(Number);
        const neighbors = [];
        
        for (let dq = -1; dq <= 1; dq++) {
            for (let dr = -1; dr <= 1; dr++) {
                neighbors.push(`${sectorQ + dq},${sectorR + dr}`);
            }
        }
        
        return neighbors;
    }

    // Update spatial sector map with current occupied tiles
    async updateSectorMap() {
        const start = Date.now();
        
        this.sectorMap.clear();
        
        // Get all occupied tiles efficiently
        const occupiedTiles = await safeDbOperation(() => {
            const db = getDb();
            return new Promise((resolve, reject) => {
                db.all("SELECT q, r FROM tiles WHERE owner IS NOT NULL OR hasExclamation = 1", [], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
        });

        // Group tiles by sector
        occupiedTiles.forEach(tile => {
            const sectorKey = this.getSectorKey(tile.q, tile.r);
            if (!this.sectorMap.has(sectorKey)) {
                this.sectorMap.set(sectorKey, []);
            }
            this.sectorMap.get(sectorKey).push({ q: tile.q, r: tile.r });
        });

        this.lastSectorUpdate = Date.now();
        
        log(`SmartSpawnManager: Updated sector map with ${occupiedTiles.length} tiles in ${Date.now() - start}ms`);
        log(`SmartSpawnManager: Created ${this.sectorMap.size} sectors`);
    }

    // Fast spawn point validation using spatial optimization
    async isValidSpawnPoint(q, r) {
        // First check spatial optimization without database call
        const sectorKey = this.getSectorKey(q, r);
        const neighboringSectors = this.getNeighboringSectors(sectorKey);
        
        for (const neighborSector of neighboringSectors) {
            const tilesInSector = this.sectorMap.get(neighborSector);
            if (!tilesInSector) continue;

            for (const occupiedTile of tilesInSector) {
                const distance = hexDistance(q, r, occupiedTile.q, occupiedTile.r);
                if (distance < MIN_SPAWN_DISTANCE) {
                    return false;
                }
            }
        }

        // Only check direct tile occupation if spatial check passes
        // This reduces database calls significantly
        const tile = await getTile(q, r);
        if (tile && (tile.owner || tile.hasExclamation)) {
            return false;
        }

        return true;
    }

    // Find map boundaries and center
    async getMapBounds() {
        return safeDbOperation(() => {
            const db = getDb();
            return new Promise((resolve, reject) => {
                db.get(`
                    SELECT 
                        MIN(q) as minQ, MAX(q) as maxQ,
                        MIN(r) as minR, MAX(r) as maxR,
                        AVG(q) as centerQ, AVG(r) as centerR,
                        COUNT(*) as tileCount
                    FROM tiles 
                    WHERE owner IS NOT NULL OR hasExclamation = 1
                `, (err, row) => {
                    if (err) return reject(err);
                    resolve(row || { minQ: 0, maxQ: 0, minR: 0, maxR: 0, centerQ: 0, centerR: 0, tileCount: 0 });
                });
            });
        });
    }

    // Smart spawn generation using multiple strategies
    async generateSpawnPoints(targetCount = TARGET_CACHE_SIZE) {
        if (this.isGenerating) {
            return new Promise((resolve) => {
                this.generationQueue.push(resolve);
            });
        }

        this.isGenerating = true;
        const startTime = Date.now();
        
        try {
            log(`SmartSpawnManager: Starting smart spawn generation for ${targetCount} points`);
            
            // Update sector map if stale (older than 5 minutes)
            if (Date.now() - this.lastSectorUpdate > 300000) {
                await this.updateSectorMap();
            }

            const mapBounds = await this.getMapBounds();
            const newSpawnPoints = [];

            // Strategy 1: Ring expansion from map center
            const centerQ = Math.round(mapBounds.centerQ || 0);
            const centerR = Math.round(mapBounds.centerR || 0);
            const mapRadius = Math.max(
                Math.abs(mapBounds.maxQ - mapBounds.minQ),
                Math.abs(mapBounds.maxR - mapBounds.minR)
            ) / 2;

            let searchRadius = mapRadius + MIN_SPAWN_DISTANCE;
            let attempts = 0;
            const maxAttempts = 10;

            while (newSpawnPoints.length < targetCount && attempts < maxAttempts) {
                log(`SmartSpawnManager: Ring search attempt ${attempts + 1}, radius ${searchRadius}`);
                
                const pointsOnRing = Math.max(20, Math.min(100, Math.ceil((2 * Math.PI * searchRadius) / (MIN_SPAWN_DISTANCE * 0.8))));
                const angleStep = (2 * Math.PI) / pointsOnRing;
                
                // Generate points in batches for efficiency
                const candidatePoints = [];
                for (let i = 0; i < pointsOnRing; i++) {
                    const angle = i * angleStep + (Math.random() - 0.5) * 0.2; // Small random offset
                    const radiusVariation = searchRadius + (Math.random() - 0.5) * MIN_SPAWN_DISTANCE * 0.3;
                    
                    const q = Math.round(centerQ + radiusVariation * Math.cos(angle));
                    const r = Math.round(centerR + radiusVariation * Math.sin(angle));
                    
                    candidatePoints.push({ q, r });
                }

                // Validate in parallel batches
                const batchSize = 10;
                for (let i = 0; i < candidatePoints.length && newSpawnPoints.length < targetCount; i += batchSize) {
                    const batch = candidatePoints.slice(i, i + batchSize);
                    const validationPromises = batch.map(async (point) => {
                        const isValid = await this.isValidSpawnPoint(point.q, point.r);
                        return isValid ? [point.q, point.r] : null;
                    });
                    
                    const validatedBatch = await Promise.all(validationPromises);
                    const validPoints = validatedBatch.filter(point => point !== null);
                    newSpawnPoints.push(...validPoints);
                }

                searchRadius += MIN_SPAWN_DISTANCE + (attempts * 100);
                attempts++;
            }

            // Strategy 2: If still need more points, use random search in empty sectors
            if (newSpawnPoints.length < targetCount) {
                log(`SmartSpawnManager: Using empty sector strategy for remaining ${targetCount - newSpawnPoints.length} points`);
                
                // Find sectors with no occupied tiles
                const emptySectors = this.findEmptySectors(mapBounds);
                
                for (const sectorKey of emptySectors) {
                    if (newSpawnPoints.length >= targetCount) break;
                    
                    const [sectorQ, sectorR] = sectorKey.split(',').map(Number);
                    const sectorPoints = this.generatePointsInSector(sectorQ, sectorR, 5);
                    
                    for (const point of sectorPoints) {
                        if (newSpawnPoints.length >= targetCount) break;
                        
                        if (await this.isValidSpawnPoint(point.q, point.r)) {
                            newSpawnPoints.push([point.q, point.r]);
                        }
                    }
                }
            }

            // Update cache
            this.spawnCache = newSpawnPoints;
            await this.saveSpawnCache();

            const duration = Date.now() - startTime;
            log(`SmartSpawnManager: Generated ${newSpawnPoints.length} spawn points in ${duration}ms`);

            // Resolve any queued requests
            this.generationQueue.forEach(resolve => resolve());
            this.generationQueue = [];

            return newSpawnPoints.length;
        } catch (err) {
            error('SmartSpawnManager: Spawn generation failed:', err);
            throw err;
        } finally {
            this.isGenerating = false;
        }
    }

    // Find sectors with no occupied tiles
    findEmptySectors(mapBounds) {
        const emptySectors = [];
        const minSectorQ = Math.floor((mapBounds.minQ - MIN_SPAWN_DISTANCE * 2) / GRID_SECTOR_SIZE);
        const maxSectorQ = Math.ceil((mapBounds.maxQ + MIN_SPAWN_DISTANCE * 2) / GRID_SECTOR_SIZE);
        const minSectorR = Math.floor((mapBounds.minR - MIN_SPAWN_DISTANCE * 2) / GRID_SECTOR_SIZE);
        const maxSectorR = Math.ceil((mapBounds.maxR + MIN_SPAWN_DISTANCE * 2) / GRID_SECTOR_SIZE);

        for (let sQ = minSectorQ; sQ <= maxSectorQ; sQ++) {
            for (let sR = minSectorR; sR <= maxSectorR; sR++) {
                const sectorKey = `${sQ},${sR}`;
                if (!this.sectorMap.has(sectorKey)) {
                    emptySectors.push(sectorKey);
                }
            }
        }

        return emptySectors.slice(0, 50); // Limit to prevent excessive computation
    }

    // Generate random points within a sector
    generatePointsInSector(sectorQ, sectorR, count) {
        const points = [];
        const baseQ = sectorQ * GRID_SECTOR_SIZE;
        const baseR = sectorR * GRID_SECTOR_SIZE;

        for (let i = 0; i < count; i++) {
            const q = baseQ + Math.floor(Math.random() * GRID_SECTOR_SIZE);
            const r = baseR + Math.floor(Math.random() * GRID_SECTOR_SIZE);
            points.push({ q, r });
        }

        return points;
    }

    // Get a spawn point from cache
    async getSpawnPoint() {
        // If cache is low, trigger background regeneration
        if (this.spawnCache.length < 50 && !this.isGenerating) {
            this.generateSpawnPoints().catch(err => {
                error('SmartSpawnManager: Background generation failed:', err);
            });
        }

        // If cache is empty, wait for generation
        if (this.spawnCache.length === 0) {
            if (this.isGenerating) {
                await new Promise(resolve => this.generationQueue.push(resolve));
            } else {
                await this.generateSpawnPoints();
            }
        }

        // Return a spawn point with real-time validation
        while (this.spawnCache.length > 0) {
            const spawnPoint = this.spawnCache.pop();
            
            // Validate that this spawn point is still available
            const isValid = await this.isValidSpawnPoint(spawnPoint[0], spawnPoint[1]);
            if (isValid) {
                // Save updated cache periodically
                if (this.spawnCache.length % 50 === 0) {
                    this.saveSpawnCache();
                }
                
                return `${spawnPoint[0]},${spawnPoint[1]}`;
            } else {
                // This spawn point is now occupied, discard it and try the next one
                log(`SmartSpawnManager: Discarded occupied spawn point ${spawnPoint[0]},${spawnPoint[1]}`);
            }
        }

        // If all cached points are invalid, force regeneration
        if (!this.isGenerating) {
            await this.generateSpawnPoints();
            return this.getSpawnPoint(); // Recursive call with fresh cache
        }

        return null;
    }

    // Get cache statistics
    getStats() {
        return {
            cacheSize: this.spawnCache.length,
            sectorsTracked: this.sectorMap.size,
            isGenerating: this.isGenerating,
            queuedRequests: this.generationQueue.length,
            lastSectorUpdate: new Date(this.lastSectorUpdate).toISOString()
        };
    }

    // Invalidate cached spawn points near a specific location
    invalidateSpawnPointsNear(q, r, radius = MIN_SPAWN_DISTANCE) {
        const initialSize = this.spawnCache.length;
        this.spawnCache = this.spawnCache.filter(point => {
            const distance = hexDistance(q, r, point[0], point[1]);
            return distance >= radius;
        });
        
        const removed = initialSize - this.spawnCache.length;
        if (removed > 0) {
            log(`SmartSpawnManager: Invalidated ${removed} spawn points near ${q},${r}`);
            this.saveSpawnCache();
        }
    }

    // Called when a new user is spawned to invalidate nearby cached points
    onUserSpawned(q, r) {
        this.invalidateSpawnPointsNear(q, r);
        // Update sector map to include the new occupied tile
        const sectorKey = this.getSectorKey(q, r);
        if (!this.sectorMap.has(sectorKey)) {
            this.sectorMap.set(sectorKey, []);
        }
        this.sectorMap.get(sectorKey).push({ q, r });
    }

    // Periodic maintenance - call this from server intervals
    async performMaintenance() {
        const stats = this.getStats();
        log(`SmartSpawnManager: Maintenance - Cache: ${stats.cacheSize}, Sectors: ${stats.sectorsTracked}`);

        // Update sector map every 5 minutes
        if (Date.now() - this.lastSectorUpdate > 300000) {
            await this.updateSectorMap();
        }

        // Ensure minimum cache size
        if (stats.cacheSize < 100 && !this.isGenerating) {
            log('SmartSpawnManager: Cache low, triggering regeneration');
            this.generateSpawnPoints().catch(err => {
                error('SmartSpawnManager: Maintenance generation failed:', err);
            });
        }
    }
}

module.exports = SmartSpawnManager;