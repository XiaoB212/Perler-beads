import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1500);
const r = await page.evaluate(() => {
  const c = document.querySelector('.stage-canvas');
  const ctx = c.getContext('2d');
  return { w: c.style.width, h: c.style.height, zoomText: document.querySelector('.zoomval')?.textContent };
});
console.log(JSON.stringify(r));
// 尝试手动点「适应窗口」
await page.evaluate(() => { const b=[...document.querySelectorAll('.zbtn')].pop(); b?.click(); });
await sleep(600);
const r2 = await page.evaluate(() => ({ zoomText: document.querySelector('.zoomval')?.textContent }));
console.log('after fit:', JSON.stringify(r2));
await page.screenshot({ path: '.shots/review3/m1-fit.png' });
await browser.close();
