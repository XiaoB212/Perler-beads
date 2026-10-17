import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
p.on('console', m => console.log('LOG:', m.text()));
p.on('pageerror', e => console.log('ERR:', e.message));
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.clear());
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1300);

// 记录事件是否到达 canvas
await p.evaluate(() => {
  const c = document.querySelector('.stage-canvas');
  ['pointerdown','pointermove','pointerup'].forEach(t => c.addEventListener(t, (e) => console.log('[D]' + t + ' ' + Math.round(e.clientX) + ',' + Math.round(e.clientY))));
});
const box = await p.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
console.log('box', JSON.stringify(box));
await p.mouse.move(box.x + box.w*0.5, box.y + box.h*0.45);
await p.mouse.down();
await sleep(200);
await p.mouse.up();
await sleep(500);
// 读画布像素变化：截取中间区域
await p.screenshot({ path: '.shots/review3/z-paint.png', clip: { x: box.x + box.w*0.3, y: box.y + box.h*0.3, width: 400, height: 400 } });
const chip = await p.evaluate(() => document.querySelector('.tbar-chip:last-of-type')?.textContent);
console.log('chip', chip);
await browser.close();
