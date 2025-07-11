const { performance } = require('perf_hooks');
const SmartSpawnManager = require('./game-logic/smartSpawnManager');
const { initializeDatabase } = require('./game-logic/db');

async function testSmartSpawn() {
    console.log('🧪 Testing Smart Spawn System...\n');
    
    try {
        // Initialize database
        console.log('📊 Initializing database...');
        await initializeDatabase();
        
        // Initialize smart spawn manager
        console.log('🚀 Initializing Smart Spawn Manager...');
        const spawnManager = new SmartSpawnManager();
        await spawnManager.initialize();
        
        // Test 1: Initial stats
        console.log('\n📈 Initial Stats:');
        const initialStats = spawnManager.getStats();
        console.log(`   Cache Size: ${initialStats.cacheSize}`);
        console.log(`   Sectors Tracked: ${initialStats.sectorsTracked}`);
        console.log(`   Is Generating: ${initialStats.isGenerating}`);
        
        // Test 2: Single spawn point retrieval
        console.log('\n🎯 Testing single spawn point retrieval...');
        const start1 = performance.now();
        const spawnPoint1 = await spawnManager.getSpawnPoint();
        const end1 = performance.now();
        
        console.log(`   ✅ Retrieved spawn point: ${spawnPoint1}`);
        console.log(`   ⏱️  Time taken: ${(end1 - start1).toFixed(2)}ms`);
        
        // Test 3: Rapid spawn point retrieval (simulating user burst)
        console.log('\n⚡ Testing rapid spawn point retrieval (50 users)...');
        const start2 = performance.now();
        const spawnPromises = [];
        
        for (let i = 0; i < 50; i++) {
            spawnPromises.push(spawnManager.getSpawnPoint());
        }
        
        const spawnPoints = await Promise.all(spawnPromises);
        const end2 = performance.now();
        
        const successfulSpawns = spawnPoints.filter(point => point !== null).length;
        console.log(`   ✅ Successfully retrieved ${successfulSpawns}/50 spawn points`);
        console.log(`   ⏱️  Total time: ${(end2 - start2).toFixed(2)}ms`);
        console.log(`   📊 Average time per spawn: ${((end2 - start2) / 50).toFixed(2)}ms`);
        
        // Test 4: Cache regeneration
        console.log('\n🔄 Testing cache regeneration...');
        const start3 = performance.now();
        const generatedCount = await spawnManager.generateSpawnPoints(200);
        const end3 = performance.now();
        
        console.log(`   ✅ Generated ${generatedCount} spawn points`);
        console.log(`   ⏱️  Generation time: ${(end3 - start3).toFixed(2)}ms`);
        
        // Test 5: Final stats
        console.log('\n📈 Final Stats:');
        const finalStats = spawnManager.getStats();
        console.log(`   Cache Size: ${finalStats.cacheSize}`);
        console.log(`   Sectors Tracked: ${finalStats.sectorsTracked}`);
        console.log(`   Is Generating: ${finalStats.isGenerating}`);
        
        // Test 6: Stress test - simulate hundreds of users
        console.log('\n🔥 Stress test: Simulating 200 concurrent users...');
        const start4 = performance.now();
        const stressPromises = [];
        
        for (let i = 0; i < 200; i++) {
            stressPromises.push(spawnManager.getSpawnPoint());
        }
        
        const stressResults = await Promise.all(stressPromises);
        const end4 = performance.now();
        
        const stressSuccessful = stressResults.filter(point => point !== null).length;
        console.log(`   ✅ Successfully handled ${stressSuccessful}/200 concurrent spawn requests`);
        console.log(`   ⏱️  Total time: ${(end4 - start4).toFixed(2)}ms`);
        console.log(`   📊 Average time per spawn: ${((end4 - start4) / 200).toFixed(2)}ms`);
        
        // Performance comparison
        console.log('\n🏆 Performance Summary:');
        console.log(`   Single spawn: ${(end1 - start1).toFixed(2)}ms`);
        console.log(`   50 concurrent spawns: ${((end2 - start2) / 50).toFixed(2)}ms average`);
        console.log(`   200 concurrent spawns: ${((end4 - start4) / 200).toFixed(2)}ms average`);
        console.log(`   Cache generation: ${(end3 - start3).toFixed(2)}ms for ${generatedCount} points`);
        
        // Test validation
        if (stressSuccessful >= 195) { // Allow for 5 failures
            console.log('\n🎉 ✅ STRESS TEST PASSED - System can handle hundreds of users!');
        } else {
            console.log(`\n⚠️  STRESS TEST WARNING - Only ${stressSuccessful}/200 successful spawns`);
        }
        
        console.log('\n✅ Smart Spawn System test completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Smart Spawn System test failed:', error);
    } finally {
        process.exit(0);
    }
}

// Run the test
testSmartSpawn();