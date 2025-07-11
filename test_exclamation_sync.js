const { initializeDatabase } = require('./game-logic/db');
const { getTile, setGridState } = require('./game-logic/gameState');

async function testExclamationSync() {
    console.log('🧪 Testing Exclamation Mark Synchronization...\n');
    
    try {
        // Initialize database
        await initializeDatabase();
        console.log('✅ Database initialized');
        
        // Test coordinates
        const testQ = 999;
        const testR = 999;
        const key = `${testQ},${testR}`;
        
        // Test 1: Create tile with exclamation mark
        console.log('\n📍 Test 1: Creating tile with exclamation mark...');
        await setGridState({ [key]: { hasExclamation: true } });
        
        const tile1 = await getTile(testQ, testR);
        console.log('Tile state:', tile1);
        
        if (tile1 && tile1.hasExclamation === true) {
            console.log('✅ Exclamation mark created correctly');
        } else {
            console.log('❌ Exclamation mark not created properly');
        }
        
        // Test 2: Remove exclamation mark (simulate capture)
        console.log('\n📍 Test 2: Removing exclamation mark (simulate capture)...');
        await setGridState({ [key]: { owner: 'testUser', population: 1, hasExclamation: false } });
        
        const tile2 = await getTile(testQ, testR);
        console.log('Tile state:', tile2);
        
        if (tile2 && tile2.hasExclamation === false && tile2.owner === 'testUser') {
            console.log('✅ Exclamation mark removed correctly, tile captured');
        } else {
            console.log('❌ Exclamation mark not removed properly');
        }
        
        // Test 3: Verify hasExclamation false is preserved
        console.log('\n📍 Test 3: Verifying hasExclamation: false is preserved...');
        
        if (tile2.hasOwnProperty('hasExclamation')) {
            console.log('✅ hasExclamation property is preserved in response');
        } else {
            console.log('❌ hasExclamation property was deleted from response');
        }
        
        // Test 4: Test with no exclamation mark
        console.log('\n📍 Test 4: Creating normal tile without exclamation...');
        const key2 = `${testQ + 1},${testR}`;
        await setGridState({ [key2]: { owner: 'testUser2', population: 2 } });
        
        const tile3 = await getTile(testQ + 1, testR);
        console.log('Normal tile state:', tile3);
        
        if (tile3 && (tile3.hasExclamation === false || !tile3.hasOwnProperty('hasExclamation'))) {
            console.log('✅ Normal tile has no exclamation mark');
        } else {
            console.log('❌ Normal tile incorrectly has exclamation mark');
        }
        
        // Clean up test tiles
        console.log('\n🧹 Cleaning up test tiles...');
        await setGridState({ [key]: null, [key2]: null });
        
        console.log('\n🎉 Exclamation mark synchronization test completed!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
    } finally {
        process.exit(0);
    }
}

testExclamationSync();