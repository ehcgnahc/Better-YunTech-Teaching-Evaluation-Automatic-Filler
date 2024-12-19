const { app, BrowserWindow, ipcMain } = require('electron');
// const { fileURLToPath } = require('url');
const puppeteer = require('puppeteer-core');
const path = require('path');

// const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;

// 處理未知的錯誤
process.on('uncaughtException', (error) => {
    console.error("Uncaught exception:", error);
    cleanupResources().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
    console.error("Unhandled rejection:", reason);
    cleanupResources().then(() => process.exit(1));
});

// 釋放資源
app.on('before-quit', async () => {
    console.log("Application is quitting...");
    await cleanupResources();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        cleanupResources().then(() => app.quit());
    }
});

const OnlyOne = app.requestSingleInstanceLock();
if(OnlyOne){
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}else{
    app.quit();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true
        }
    })
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function fillForm(page, url) {
    await page.goto(url);
    await page.waitForSelector("#ctl00_MainContent_Submit", { visible: true });
    await page.evaluate(() => {
        const radios = document.querySelectorAll('input[type="radio"][value="4"]');
        radios.forEach(radio => radio.click());
    });
    await page.evaluate(() => {
        const radios = document.querySelectorAll('input[type="radio"][value="5"]');
        radios.forEach(radio => radio.click());
    });

    console.log(url, "filled");

    page.once('dialog', async dialog => { // 提示
        await dialog.accept();
    });
    await page.click("#ctl00_MainContent_Submit"); // 送出
}

async function main() {
    const { getEdgePath } = await import('edge-paths');
    const chromePaths = require('chrome-paths');
    const fs = require('fs');
    let browser;
    if(chromePaths.chromium && fs.existsSync(chromePaths.chromium)){
        browser = await puppeteer.launch({
            executablePath: chromePaths.chromium, // 使用 Chromium
            headless: true,
            slowMo: 5,
            defaultViewport: null,
        });
    }else{
        console.error("Chromium not found");
        try{
            browser = await puppeteer.launch({
                channel: 'chrome', // 使用 Chrome
                headless: true,
                slowMo: 5,
                defaultViewport: null,
            });
        }catch(chromeError){
            console.error("Chrome not found");
            try{
                const edgePath = getEdgePath();
                if(edgePath){
                    console.log(edgePath);
                    browser = await puppeteer.launch({
                        executablePath: edgePath, // 使用 edge
                        headless: true,
                        slowMo: 5,
                        defaultViewport: null,
                    });
                }else{
                    throw new Error("Edge not found");
                }
            }catch(edgeError){
                console.error(`Please install one of the following browsers to proceed:
                    - Microsoft Edge: https://www.microsoft.com/edge
                    - Google Chrome: https://www.google.com/chrome`);
                app.quit();
            }
        }
    }
    const page = await browser.newPage(); // 開啟分頁
    await page.goto("https://webapp.yuntech.edu.tw/WebNewCAS/default.aspx"); // 前往網址
    await page.click('a[href="/WebNewCAS/login.aspx"]'); // 點擊登入
    await page.waitForSelector("#pLoginName", { visible: true });
    await page.waitForSelector("#pLoginPassword", { visible: true });
    await page.waitForSelector("#NumberCaptcha", { visible: true });

    const CaptchaSrc = await page.evaluate(() => {
        const img = document.querySelector("#NumberCaptcha");
        return img?.src;
    });

    createWindow();

    mainWindow.webContents.on('did-finish-load', () => {
        if (CaptchaSrc && CaptchaSrc.startsWith("data:image/png;base64,")) {
            mainWindow.webContents.send('Captcha', CaptchaSrc);
        } else {
            console.log("CAPTCHA Not Found");
            mainWindow.webContents.send('Captcha', null);
        }
    });

    ipcMain.on('clearUsername', async () => {
        await page.waitForSelector("#pLoginName", { visible: true });
        await page.waitForSelector("#pLoginPassword", { visible: true });
        await page.waitForSelector("#NumberCaptcha");
        await page.evaluate(() => {
            document.querySelector("#pLoginName").value = "";
        });
    });

    ipcMain.on('reloadCaptcha', async () => {
        await page.click("#RefreshCaptchaBtn"); // 刷新驗證碼
        await page.waitForSelector("#NumberCaptcha");
        const CaptchaSrc = await page.evaluate(() => {
            const img = document.querySelector("#NumberCaptcha");
            return img?.src;
        });
        if (CaptchaSrc && CaptchaSrc.startsWith("data:image/png;base64,")) {
            mainWindow.webContents.send('Captcha', CaptchaSrc);
        } else {
            console.log("CAPTCHA Not Found");
            mainWindow.webContents.send('Captcha', null);
        }
    });

    ipcMain.on('login', async (event, { Username, Password, Captcha }) => {
        console.log('Username:', Username, 'Password:', Password, 'Captcha:', Captcha);

        await page.type("#pLoginName", Username); // 輸入帳號
        await page.type("#pLoginPassword", Password); // 輸入密碼
        await page.type("#ValidationCode", Captcha); // 輸入驗證碼
        await page.click("#LoginSubmitBtn"); // 登入

        try {
            const Toast = page.waitForSelector("#toast-container", { visible: true, timeout: 10000 }).catch(() => null); // 等待訊息框出現

            const result = await Promise.race([
                Toast, // 等待錯誤訊息
                new Promise(async (resolve) => {
                    let retries = 20; // 最大重試次數
                    while (retries--) {
                        if (page.url() === "https://webapp.yuntech.edu.tw/WebNewCAS/default.aspx") {
                            resolve("success");
                            return;
                        }
                        await new Promise((r) => setTimeout(r, 500)); // 等待 500ms
                    }
                    resolve(null); // 超時
                }),
            ]);

            if (result === "success") {
                console.log('login success');
                mainWindow.webContents.send('login-success');
                const dialogPromise = new Promise((resolve) => {
                    page.once('dialog', async (dialog) => {
                        await dialog.accept();
                        console.log('All form already Filled');
                        const client = await page.createCDPSession();
                        await client.send('Network.clearBrowserCookies');
                        await client.send('Network.clearBrowserCache');
                        await browser.close();
                        app.quit();
                        resolve(true);
                    });
                });

                const timeoutPromise = new Promise((resolve) => {
                    setTimeout(() => {
                        console.log('Dialog handling timeout.');
                        resolve(false);
                    }, 1000); // 超時設為 5 秒
                });

                await page.goto("https://webapp.yuntech.edu.tw/WebNewCAS/TeachSurvey/Survey/Default.aspx?ShowInfoMsg=1");
                const dialogResult = await Promise.race([dialogPromise, timeoutPromise]);
                if (!dialogResult){
                    await page.waitForSelector('#ctl00_MainContent_CancelButton', { visible: true });
                    await page.click("#ctl00_MainContent_CancelButton")

                    // const Course_Serial = await page.evaluate(() => { // 課號
                    //     const Course = Array.from(document.querySelectorAll("a[id^='ctl00_MainContent_StudCour_GridView_']"));
                    //     return Course
                    //         .filter(course => course.id.endsWith("Questionnaire"))
                    //         .map(course => ({
                    //             id: course.id,
                    //             hrefValue: course.href,
                    //             extractedValue: course.href.match(/current_subj=(\d+)/)?.[1] || null,
                    //         }));
                    // });

                    const Questionnaire = await page.evaluate(() => { // 未填的表單
                        const link = Array.from(document.querySelectorAll("a[id^='ctl00_MainContent_StudCour_GridView_']"));
                        return link
                            .filter(link => link.innerText.includes("填寫問卷"))
                            .map(link => link.href);
                    });

                    console.log(Questionnaire);

                    for (let i = 0; i < Questionnaire.length; i++) {
                        console.log("filling form", Questionnaire[i]);
                        await fillForm(page, Questionnaire[i]);
                    }
                }
                const client = await page.createCDPSession();
                await client.send('Network.clearBrowserCookies');
                await client.send('Network.clearBrowserCache');
                await browser.close();
                app.quit();
            } else if (result === null) {
                console.log('login timeout');
                mainWindow.webContents.send('login-error', "登入超時");
            } else if (result) {
                const message = await page.evaluate(() => {
                    const toast = document.querySelector("#toast-container .toast-message");
                    return toast?.innerText;
                });
                console.log('login failed', message);
                mainWindow.webContents.send('login-failed', message);
            }
        } catch (error) {
            console.error(error);
            mainWindow.webContents.send('login-error', error.message);
        }

        // await browser.close();
        // app.quit();
    });

    ipcMain.on('Refocus-Window', () => {
        console.log("Refocus-Window received");
        if (mainWindow) {
            mainWindow.blur();
            setTimeout(() => {
                mainWindow.focus();
            }, 50);
        }
    });

    ipcMain.on('Close-Window', () => {
        console.log("Close-Window received");
        if (mainWindow) {
            mainWindow.hide();
        }
    });
};

app.whenReady().then(main);