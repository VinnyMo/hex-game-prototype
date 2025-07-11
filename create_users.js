const puppeteer = require('puppeteer');
const readline = require('readline');

const BASE_URL = 'http://localhost:3000';
const browsers = [];
const intervalIds = [];

function generateRandomString(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

async function createNewUser(browser, instanceId) {
    let page;
    try {
        page = await browser.newPage();
        console.log(`[${new Date().toISOString()}] [Instance ${instanceId}] Navigating to ${BASE_URL}`);
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

        const username = 'user_' + generateRandomString(8);
        const password = generateRandomString(12);

        console.log(`[${new Date().toISOString()}] [Instance ${instanceId}] Attempting to create user: ${username}`);

        await page.type('#username', username);
        await page.type('#password', password);
        await page.click('#loginButton');

        await page.waitForSelector('#gameContainer', { timeout: 10000 })
            .then(() => {
                console.log(`[${new Date().toISOString()}] [Instance ${instanceId}] Successfully logged in as ${username}`);
            })
            .catch(async (error) => {
                const loginError = await page.$eval('#loginError', el => el.textContent).catch(() => '');
                if (loginError) {
                    console.error(`[${new Date().toISOString()}] [Instance ${instanceId}] Login failed for ${username}: ${loginError}`);
                } else {
                    console.error(`[${new Date().toISOString()}] [Instance ${instanceId}] Login failed for ${username} (timeout or unexpected error): ${error.message}`);
                }
            });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] [Instance ${instanceId}] Error during user creation: ${error.message}`);
    } finally {
        if (page) {
            await page.close();
        }
    }
}

async function startInstance(instanceId, startDelay) {
    try {
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        browsers.push(browser);
        console.log(`[${new Date().toISOString()}] [Instance ${instanceId}] Puppeteer browser launched.`);

        if (startDelay > 0) {
            console.log(`[${new Date().toISOString()}] [Instance ${instanceId}] Waiting for ${startDelay / 1000}s before starting.`);
            await new Promise(resolve => setTimeout(resolve, startDelay));
        }

        // Create the first user immediately for this instance
        await createNewUser(browser, instanceId);

        // Then create a new user every 30 seconds
        const intervalId = setInterval(() => createNewUser(browser, instanceId), 30 * 1000);
        intervalIds.push(intervalId);

        console.log(`[${new Date().toISOString()}] [Instance ${instanceId}] User creation scheduled every 30 seconds.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] [Instance ${instanceId}] Failed to start instance: ${error.message}`);
    }
}

async function start() {
    startInstance(1, 0);
    startInstance(2, 15000); // Staggered by 15 seconds

    console.log(`[${new Date().toISOString()}] User creation script started. Press 'q' and Enter to quit.`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });

    rl.on('line', async (input) => {
        if (input.trim().toLowerCase() === 'q') {
            console.log(`[${new Date().toISOString()}] Quitting user creation script.`);
            intervalIds.forEach(clearInterval);
            for (const browser of browsers) {
                await browser.close();
            }
            rl.close();
            process.exit(0);
        }
    });
}

start();
