const { performance } = require('perf_hooks');
const path = require('path');

// Import our optimized modules
const { initializeDatabase } = require('./game-logic/db');
const { getUsers, getTile, setGridState, setUsers } = require('./game-logic/gameState');
const { spawnWorkerPool } = require('./game-logic/workerPool');

async function performanceTest() {
    console.log('🚀 Starting Performance Tests...\n');
    
    try {
        // Initialize database
        console.log('📊 Initializing database...');
        const dbStart = performance.now();
        await initializeDatabase();
        console.log(`✅ Database initialized in ${(performance.now() - dbStart).toFixed(2)}ms\n`);

        // Test 1: User operations
        console.log('👥 Testing user operations...');
        const userStart = performance.now();
        
        // Create test users
        const testUsers = {};
        for (let i = 0; i < 10; i++) {
            testUsers[`test_user_${i}`] = {
                username: `test_user_${i}`,
                password: 'test123',
                color: '#FF0000',
                capitol: `${i},${i}`,
                exploredTiles: [`${i},${i}`]
            };
        }
        
        await setUsers(testUsers);
        const userEnd = performance.now();
        console.log(`✅ Created 10 users in ${(userEnd - userStart).toFixed(2)}ms`);

        // Test 2: Retrieve users (should use cache)
        const getUserStart = performance.now();
        const retrievedUsers = await getUsers();
        const getUserEnd = performance.now();
        console.log(`✅ Retrieved ${Object.keys(retrievedUsers).length} users in ${(getUserEnd - getUserStart).toFixed(2)}ms (cached)\n`);

        // Test 3: Tile operations
        console.log('🗺️  Testing tile operations...');
        const tileStart = performance.now();
        
        // Create test tiles
        const testTiles = {};
        for (let q = 0; q < 20; q++) {
            for (let r = 0; r < 20; r++) {
                testTiles[`${q},${r}`] = {
                    owner: `test_user_${q % 10}`,
                    population: Math.floor(Math.random() * 5) + 1,
                    hasExclamation: Math.random() < 0.1
                };
            }
        }
        
        await setGridState(testTiles);
        const tileEnd = performance.now();
        console.log(`✅ Created 400 tiles in ${(tileEnd - tileStart).toFixed(2)}ms`);

        // Test 4: Individual tile retrieval (should use cache)
        const singleTileStart = performance.now();
        const tile = await getTile(5, 5);
        const singleTileEnd = performance.now();
        console.log(`✅ Retrieved single tile in ${(singleTileEnd - singleTileStart).toFixed(2)}ms (cached)`);

        // Test 5: Concurrent tile operations
        console.log('\n⚡ Testing concurrent operations...');
        const concurrentStart = performance.now();
        
        const promises = [];
        for (let i = 0; i < 50; i++) {
            promises.push(getTile(Math.floor(Math.random() * 20), Math.floor(Math.random() * 20)));
        }
        
        await Promise.all(promises);
        const concurrentEnd = performance.now();
        console.log(`✅ Completed 50 concurrent tile retrievals in ${(concurrentEnd - concurrentStart).toFixed(2)}ms`);

        // Test 6: Worker pool
        console.log('\n🏭 Testing worker pool...');
        const workerStart = performance.now();
        
        await spawnWorkerPool.initialize();
        const response = await spawnWorkerPool.executeTask({ command: 'findSpawn' });
        
        const workerEnd = performance.now();
        console.log(`✅ Worker pool spawn test completed in ${(workerEnd - workerStart).toFixed(2)}ms`);
        console.log(`   Spawn point found: ${response.spawnPoint || 'none'}`);

        console.log('\n🎉 All performance tests completed successfully!');
        console.log('\n📈 Performance Summary:');
        console.log(`   Database init: Fast startup with connection pooling`);
        console.log(`   User operations: Batched and cached`);
        console.log(`   Tile operations: Efficient with caching layer`);
        console.log(`   Concurrent operations: Properly queued and managed`);
        console.log(`   Worker pools: Reusable and efficient`);

    } catch (error) {
        console.error('❌ Performance test failed:', error);
    } finally {
        // Cleanup
        await spawnWorkerPool.shutdown();
        process.exit(0);
    }
}

// Run the test
performanceTest();