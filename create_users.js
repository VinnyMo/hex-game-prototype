const puppeteer = require('puppeteer');
const readline = require('readline');

const BASE_URL = 'http://localhost:3000';
let browser;
let intervalId;

function generateRandomString(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

async function createNewUser() {
    let page;
    try {
        page = await browser.newPage();
        console.log(`[${new Date().toISOString()}] Navigating to ${BASE_URL}`);
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

        const username = 'user_' + generateRandomString(8);
        const password = generateRandomString(12);

        console.log(`[${new Date().toISOString()}] Attempting to create user: ${username}`);

        await page.type('#username', username);
        await page.type('#password', password);
        await page.click('#loginButton');

        // Wait for navigation or a specific element to appear after login
        // Adjust this based on your application's behavior after successful login
        await page.waitForSelector('#gameContainer', { timeout: 10000 })
            .then(() => {
                console.log(`[${new Date().toISOString()}] Successfully logged in as ${username}`);
            })
            .catch(async (error) => {
                const loginError = await page.$eval('#loginError', el => el.textContent).catch(() => '');
                if (loginError) {
                    console.error(`[${new Date().toISOString()}] Login failed for ${username}: ${loginError}`);
                } else {
                    console.error(`[${new Date().toISOString()}] Login failed for ${username} (timeout or unexpected error): ${error.message}`);
                }
            });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during user creation: ${error.message}`);
    } finally {
        if (page) {
            await page.close();
        }
    }
}

async function startUserCreation() {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] }); // Set to false for visual debugging
    console.log(`[${new Date().toISOString()}] Puppeteer browser launched.`);

    // Create the first user immediately
    await createNewUser();

    // Then create a new user every minute
    intervalId = setInterval(createNewUser, 60 * 1000); // 60 seconds

    console.log(`[${new Date().toISOString()}] User creation script started. Press 'q' and Enter to quit.`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });

    rl.on('line', (input) => {
        if (input.trim().toLowerCase() === 'q') {
            console.log(`[${new Date().toISOString()}] Quitting user creation script.`);
            clearInterval(intervalId);
            browser.close();
            rl.close();
            process.exit(0);
        }
    });
}

startUserCreation();
