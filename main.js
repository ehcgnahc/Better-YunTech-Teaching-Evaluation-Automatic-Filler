import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core'; //ESM
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 400,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    })
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function main() {
    const browser = await puppeteer.launch({
        channel: 'chrome', // 自動尋找 Chrome.exe
        headless: false,
        slowMo: 10,
        defaultViewport: null,
    });

    const page = await browser.newPage(); // 開啟分頁
    await page.goto("https://webapp.yuntech.edu.tw/WebNewCAS/default.aspx"); // 前往網址
    await page.click('a[href="/WebNewCAS/login.aspx"]'); // 點擊登入
    await page.waitForSelector("#pLoginName", { visible: true });
    await page.waitForSelector("#pLoginPassword", { visible: true });
    await page.waitForSelector("#NumberCaptcha");

    const CaptchaSrc = await page.evaluate(() => {
        const img = document.querySelector("#NumberCaptcha");
        return img?.src;
    });

    createWindow();

    mainWindow.webContents.on('did-finish-load', () => {
        if(CaptchaSrc && CaptchaSrc.startsWith("data:image/png;base64,")){
            mainWindow.webContents.send('Captcha', CaptchaSrc);
        }else{
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
        if(CaptchaSrc && CaptchaSrc.startsWith("data:image/png;base64,")){
            mainWindow.webContents.send('Captcha', CaptchaSrc);
        }else{
            console.log("CAPTCHA Not Found");
            mainWindow.webContents.send('Captcha', null);
        }
    });

    ipcMain.on('login', async (event, { Username, Password, Captcha }) => {
        console.log('Username:', Username, 'Password:', Password, 'Captcha:', Captcha);

        await page.type("#pLoginName", Username); // 輸入帳號
        await page.type("#pLoginPassword", Password); // 輸入密碼
        await page.type("#ValidationCode", Captcha); // 輸入驗證碼
        // await page.screenshot({path: 'example.png'});
        await page.click("#LoginSubmitBtn"); // 登入

        try{
            const Toast = page.waitForSelector("#toast-container", { visible: true, timeout:10000 }).catch(() => null); // 等待訊息框出現
            
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

            if(result === "success"){
                console.log('login success');
                mainWindow.webContents.send('login-success');
            }else if(result === null){
                console.log('login timeout');
                mainWindow.webContents.send('login-error', "登入超時");
            }else if(result){
                console.log('login failed');
                const message = await page.evaluate(() => {
                    const toast = document.querySelector("#toast-container .toast-message");
                    return toast?.innerText;
                });
                console.log('login failed', message);
                mainWindow.webContents.send('login-failed', message);
            }
        }catch(error){
            console.error(error);
            mainWindow.webContents.send('login-error', error.message);
        }

        // await browser.close();
        // app.quit();
    });

    ipcMain.on('Refocus-Window', () => {
        console.log("Refocus-Window received");
        if(mainWindow){
            mainWindow.blur();
            setTimeout(() => {
                mainWindow.focus();
            }, 50);
        }
    });

    ipcMain.on('Close-Window', () => {
        console.log("Close-Window received");
        if(mainWindow){
            mainWindow.hide();
        }
    });
};

app.whenReady().then(main);