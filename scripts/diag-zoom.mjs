import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
for (const [w,h,label] of [[390,844,'mobile'],[1440,900,'desktop'],[820,1180,'tablet']]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
  await sleep(1500);
  const r = await page.evaluate(() => ({
    zoom: document.querySelector('.zoomval')?.textContent,
    wrapW: document.querySelector('.stage')?.clientWidth,
    wrapH: document.querySelector('.stage')?.clientHeight,
  }));
  console.log(label, JSON.stringify(r));
  await page.close();
}
await browser.close();
