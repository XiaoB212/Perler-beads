import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.clear());
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1300);
// 开进度模式
await p.evaluate(() => [...document.querySelectorAll('.tbar-chip')].find(e=>e.textContent.includes('进度'))?.click());
await sleep(500);
const box = await p.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// 计算图纸实际位置：zoom 从 zoomval 读
const info = await p.evaluate(() => ({ zoom: document.querySelector('.zoomval')?.textContent, canvasW: document.querySelector('.stage-canvas').clientWidth, canvasH: document.querySelector('.stage-canvas').clientHeight }));
console.log('info', JSON.stringify(info));
const cell = 14; // 100%
const originX = (info.canvasW - 29*cell)/2;
const originY = (info.canvasH - 29*cell)/2;
// 点 (14, 8) 菌盖上的红点
const px = box.x + originX + 14.5*cell;
const py = box.y + originY + 8.5*cell;
console.log('click at', px.toFixed(0), py.toFixed(0));
await p.mouse.click(px, py);
await sleep(700);
await p.screenshot({ path: '.shots/review3/z-progress-click.png' });
// 打开用量看已拼
await p.evaluate(() => [...document.querySelectorAll('.side-tab')].find(e=>e.textContent.includes('用量'))?.click());
await sleep(500);
const placed = await p.evaluate(() => { const c=[...document.querySelectorAll('.stat-card')].find(e=>e.querySelector('.k')?.textContent.includes('已拼')); return c?.querySelector('.v')?.textContent.trim(); });
console.log('已拼 after click:', placed);
await browser.close();
