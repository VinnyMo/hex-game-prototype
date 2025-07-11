const io = require('socket.io-client');
const { performance } = require('perf_hooks');

async function testServerSpawn() {
    console.log('🧪 Testing Smart Spawn System via Server...\n');
    
    let client;
    
    try {
        // Connect to the server
        console.log('🔌 Connecting to server...');
        client = io('http://localhost:3000');
        
        await new Promise((resolve) => {
            client.on('connect', () => {
                console.log('✅ Connected to server');
                resolve();
            });
        });
        
        // Test 1: Single user creation
        console.log('\n👤 Testing single user creation...');
        const start1 = performance.now();
        
        const loginPromise = new Promise((resolve, reject) => {
            client.on('loginSuccess', (data) => {
                console.log(`✅ User created successfully with spawn point: ${data.user.capitol}`);
                resolve(data);
            });
            
            client.on('loginError', (error) => {
                console.log(`❌ Login failed: ${error}`);
                reject(error);
            });
            
            setTimeout(() => reject('Login timeout'), 10000);
        });
        
        client.emit('login', { username: 'test_' + (Date.now() % 10000), password: 'test123' });
        
        const loginResult = await loginPromise;
        const end1 = performance.now();
        
        console.log(`⏱️  User creation time: ${(end1 - start1).toFixed(2)}ms`);
        
        // Test 2: Multiple concurrent users
        console.log('\\n⚡ Testing concurrent user creation (10 users)...');
        const start2 = performance.now();
        
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(createUser(i));
        }
        
        const results = await Promise.allSettled(promises);
        const end2 = performance.now();
        
        const successful = results.filter(r => r.status === 'fulfilled').length;
        console.log(`✅ Successfully created ${successful}/10 users`);
        console.log(`⏱️  Total time: ${(end2 - start2).toFixed(2)}ms`);
        console.log(`📊 Average time per user: ${((end2 - start2) / 10).toFixed(2)}ms`);
        
        console.log('\\n🎉 Server spawn test completed successfully!');
        
    } catch (error) {
        console.error('\\n❌ Server spawn test failed:', error);
    } finally {
        if (client) {
            client.disconnect();
        }
        process.exit(0);
    }
}

function createUser(index) {
    return new Promise((resolve, reject) => {
        const userClient = io('http://localhost:3000');
        
        userClient.on('connect', () => {
            userClient.on('loginSuccess', (data) => {
                console.log(`  User ${index + 1}: Spawn point ${data.user.capitol}`);
                userClient.disconnect();
                resolve(data);
            });
            
            userClient.on('loginError', (error) => {
                userClient.disconnect();
                reject(error);
            });
            
            userClient.emit('login', { 
                username: 'test' + index + Date.now().toString().slice(-4), 
                password: 'test123' 
            });
        });
        
        setTimeout(() => {
            userClient.disconnect();
            reject('Connection timeout');
        }, 15000);
    });
}

// Check if server is running
const testClient = io('http://localhost:3000');
testClient.on('connect', () => {
    testClient.disconnect();
    testServerSpawn();
});

testClient.on('connect_error', () => {
    console.log('❌ Server not running. Please start the server first with: node server.js');
    process.exit(1);
});