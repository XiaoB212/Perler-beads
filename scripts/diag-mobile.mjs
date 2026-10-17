import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1400);
const info = await page.evaluate(() => {
  const c = document.querySelector('.stage-canvas');
  const r = c.getBoundingClientRect();
  const wrap = c.parentElement;
  const wr = wrap.getBoundingClientRect();
  return { canvas: [r.width, r.height], wrap: [wr.width, wr.height], wrapCls: wrap.className, doc: document.querySelector('.doc-size')?.textContent };
});
console.log(JSON.stringify(info));
await browser.close();
