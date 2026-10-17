import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.clear());
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1300);
const count = () => p.evaluate(() => { const c=[...document.querySelectorAll('.tbar-chip')].find(e=>/\d+ 颗/.test(e.textContent)); return c?.textContent.trim(); });
console.log('before', await count());
const box = await p.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// 点在左下角空白处
await p.mouse.click(box.x + box.w*0.5, box.y + box.h*0.88);
await sleep(600);
console.log('after click empty area', await count());
await p.screenshot({ path: '.shots/review3/z-paint2.png' });
await browser.close();
