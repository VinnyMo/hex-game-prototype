#!/usr/bin/env node

const { initializeDatabase, getDb } = require('./game-logic/db');
const path = require('path');

/**
 * Database Performance Analysis Script
 * Analyzes the current state and performance characteristics of the SQLite game database
 */

class DatabaseAnalyzer {
    constructor() {
        this.db = null;
    }

    async initialize() {
        try {
            await initializeDatabase();
            this.db = getDb();
            console.log('✓ Connected to database successfully\n');
        } catch (error) {
            console.error('✗ Failed to connect to database:', error.message);
            process.exit(1);
        }
    }

    // Count total tiles, exclamation tiles, and owned tiles
    async analyzeTileCounts() {
        return new Promise((resolve, reject) => {
            console.log('📊 TILE STATISTICS');
            console.log('==================');

            const queries = [
                { name: 'Total Tiles', sql: 'SELECT COUNT(*) as count FROM tiles' },
                { name: 'Owned Tiles', sql: 'SELECT COUNT(*) as count FROM tiles WHERE owner IS NOT NULL' },
                { name: 'Exclamation Tiles', sql: 'SELECT COUNT(*) as count FROM tiles WHERE hasExclamation = 1' },
                { name: 'Disconnected Tiles', sql: 'SELECT COUNT(*) as count FROM tiles WHERE isDisconnected = 1' },
                { name: 'Populated Tiles', sql: 'SELECT COUNT(*) as count FROM tiles WHERE population > 0' }
            ];

            let completed = 0;
            const results = {};

            queries.forEach(query => {
                this.db.get(query.sql, (err, row) => {
                    if (err) {
                        console.error(`✗ Error running ${query.name} query:`, err.message);
                    } else {
                        results[query.name] = row.count;
                        console.log(`${query.name}: ${row.count.toLocaleString()}`);
                    }
                    
                    completed++;
                    if (completed === queries.length) {
                        console.log('');
                        resolve(results);
                    }
                });
            });
        });
    }

    // Analyze ownership distribution
    async analyzeOwnership() {
        return new Promise((resolve, reject) => {
            console.log('👥 OWNERSHIP DISTRIBUTION');
            console.log('========================');

            this.db.all(`
                SELECT owner, COUNT(*) as tile_count, 
                       AVG(population) as avg_population,
                       SUM(population) as total_population
                FROM tiles 
                WHERE owner IS NOT NULL 
                GROUP BY owner 
                ORDER BY tile_count DESC
            `, (err, rows) => {
                if (err) {
                    console.error('✗ Error analyzing ownership:', err.message);
                    resolve([]);
                } else {
                    rows.forEach(row => {
                        console.log(`${row.owner}: ${row.tile_count} tiles, Avg Pop: ${(row.avg_population || 0).toFixed(1)}, Total Pop: ${row.total_population || 0}`);
                    });
                    console.log('');
                    resolve(rows);
                }
            });
        });
    }

    // Analyze sector map size and distribution
    async analyzeSectorDistribution() {
        return new Promise((resolve, reject) => {
            console.log('🗺️  SECTOR MAP ANALYSIS');
            console.log('======================');

            const queries = [
                {
                    name: 'Coordinate Range',
                    sql: 'SELECT MIN(q) as min_q, MAX(q) as max_q, MIN(r) as min_r, MAX(r) as max_r FROM tiles'
                },
                {
                    name: 'Population Distribution',
                    sql: `SELECT 
                        CASE 
                            WHEN population = 0 THEN '0'
                            WHEN population <= 10 THEN '1-10'
                            WHEN population <= 50 THEN '11-50'
                            WHEN population <= 100 THEN '51-100'
                            ELSE '100+'
                        END as pop_range,
                        COUNT(*) as count
                    FROM tiles 
                    GROUP BY 
                        CASE 
                            WHEN population = 0 THEN '0'
                            WHEN population <= 10 THEN '1-10'
                            WHEN population <= 50 THEN '11-50'
                            WHEN population <= 100 THEN '51-100'
                            ELSE '100+'
                        END
                    ORDER BY count DESC`
                }
            ];

            let completed = 0;

            // Coordinate range analysis
            this.db.get(queries[0].sql, (err, row) => {
                if (err) {
                    console.error('✗ Error analyzing coordinate range:', err.message);
                } else {
                    const width = row.max_q - row.min_q + 1;
                    const height = row.max_r - row.min_r + 1;
                    console.log(`Map Size: ${width} x ${height} (Q: ${row.min_q} to ${row.max_q}, R: ${row.min_r} to ${row.max_r})`);
                    console.log(`Total Map Area: ${(width * height).toLocaleString()} potential tiles`);
                }
                
                completed++;
                if (completed === 2) resolve();
            });

            // Population distribution analysis
            this.db.all(queries[1].sql, (err, rows) => {
                if (err) {
                    console.error('✗ Error analyzing population distribution:', err.message);
                } else {
                    console.log('\nPopulation Distribution:');
                    rows.forEach(row => {
                        console.log(`  ${row.pop_range}: ${row.count.toLocaleString()} tiles`);
                    });
                }
                
                completed++;
                if (completed === 2) {
                    console.log('');
                    resolve();
                }
            });
        });
    }

    // Check for missing indexes and analyze query performance
    async analyzeIndexes() {
        return new Promise((resolve, reject) => {
            console.log('🔍 INDEX ANALYSIS');
            console.log('=================');

            // Get existing indexes
            this.db.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'", (err, indexes) => {
                if (err) {
                    console.error('✗ Error fetching indexes:', err.message);
                    resolve();
                    return;
                }

                console.log('Existing Indexes:');
                indexes.forEach(idx => {
                    console.log(`  - ${idx.name}`);
                });

                // Analyze potential missing indexes by checking common query patterns
                console.log('\nRecommended Additional Indexes:');
                
                // Check if we need compound indexes for common queries
                const recommendations = [
                    'Consider: CREATE INDEX idx_tiles_owner_population ON tiles(owner, population) - for ownership + population queries',
                    'Consider: CREATE INDEX idx_tiles_exclamation_owner ON tiles(hasExclamation, owner) - for exclamation + ownership queries',
                    'Consider: CREATE INDEX idx_tiles_population ON tiles(population) - for population-based queries'
                ];

                recommendations.forEach(rec => console.log(`  - ${rec}`));
                console.log('');
                resolve();
            });
        });
    }

    // Run EXPLAIN QUERY PLAN on common queries to identify performance issues
    async analyzeQueryPerformance() {
        return new Promise((resolve, reject) => {
            console.log('⚡ QUERY PERFORMANCE ANALYSIS');
            console.log('=============================');

            const commonQueries = [
                {
                    name: 'Find tiles by owner',
                    sql: 'EXPLAIN QUERY PLAN SELECT * FROM tiles WHERE owner = ?'
                },
                {
                    name: 'Find exclamation tiles',
                    sql: 'EXPLAIN QUERY PLAN SELECT * FROM tiles WHERE hasExclamation = 1'
                },
                {
                    name: 'Find tiles by coordinates',
                    sql: 'EXPLAIN QUERY PLAN SELECT * FROM tiles WHERE q = ? AND r = ?'
                },
                {
                    name: 'Population-based query',
                    sql: 'EXPLAIN QUERY PLAN SELECT * FROM tiles WHERE population > 0 ORDER BY population DESC'
                },
                {
                    name: 'User capitol lookup',
                    sql: 'EXPLAIN QUERY PLAN SELECT * FROM users WHERE capitol = ?'
                }
            ];

            let completed = 0;

            commonQueries.forEach(query => {
                this.db.all(query.sql, (err, rows) => {
                    if (err) {
                        console.error(`✗ Error analyzing query "${query.name}":`, err.message);
                    } else {
                        console.log(`\n${query.name}:`);
                        rows.forEach(row => {
                            const detail = row.detail || 'No details available';
                            console.log(`  ${detail}`);
                        });
                    }
                    
                    completed++;
                    if (completed === commonQueries.length) {
                        console.log('');
                        resolve();
                    }
                });
            });
        });
    }

    // Check database file size and statistics
    async analyzeDatabaseStats() {
        return new Promise((resolve, reject) => {
            console.log('💾 DATABASE STATISTICS');
            console.log('======================');

            // Get database page count and page size
            this.db.get('PRAGMA page_count', (err, pageCount) => {
                if (err) {
                    console.error('✗ Error getting page count:', err.message);
                    resolve();
                    return;
                }

                this.db.get('PRAGMA page_size', (err, pageSize) => {
                    if (err) {
                        console.error('✗ Error getting page size:', err.message);
                        resolve();
                        return;
                    }

                    const totalSize = pageCount.page_count * pageSize.page_size;
                    console.log(`Database Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
                    console.log(`Pages: ${pageCount.page_count.toLocaleString()}`);
                    console.log(`Page Size: ${pageSize.page_size} bytes`);

                    // Get other PRAGMA info
                    this.db.get('PRAGMA journal_mode', (err, journalMode) => {
                        if (!err) {
                            console.log(`Journal Mode: ${journalMode.journal_mode}`);
                        }

                        this.db.get('PRAGMA synchronous', (err, sync) => {
                            if (!err) {
                                console.log(`Synchronous Mode: ${sync.synchronous}`);
                            }

                            this.db.get('PRAGMA cache_size', (err, cacheSize) => {
                                if (!err) {
                                    console.log(`Cache Size: ${Math.abs(cacheSize.cache_size).toLocaleString()} pages`);
                                }
                                console.log('');
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    }

    // Run all analyses
    async runFullAnalysis() {
        console.log('🔍 DATABASE PERFORMANCE ANALYSIS');
        console.log('=================================\n');

        try {
            await this.analyzeTileCounts();
            await this.analyzeOwnership();
            await this.analyzeSectorDistribution();
            await this.analyzeIndexes();
            await this.analyzeQueryPerformance();
            await this.analyzeDatabaseStats();

            console.log('✅ Analysis completed successfully!');
            
        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
        } finally {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                    } else {
                        console.log('Database connection closed.');
                    }
                });
            }
        }
    }
}

// Run the analysis
async function main() {
    const analyzer = new DatabaseAnalyzer();
    await analyzer.initialize();
    await analyzer.runFullAnalysis();
}

// Execute if run directly
if (require.main === module) {
    main().catch(error => {
        console.error('Script failed:', error.message);
        process.exit(1);
    });
}

module.exports = DatabaseAnalyzer;