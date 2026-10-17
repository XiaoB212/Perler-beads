// 进度勾选断言（修正坐标计算：按 zoom 与画布尺寸算图纸原点）
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.clear());
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1300);

const readPlaced = () => p.evaluate(() => {
  const c = [...document.querySelectorAll('.stat-card')].find((e) => e.querySelector('.k')?.textContent.includes('已拼'));
  return c?.querySelector('.v')?.textContent.trim();
});
const geom = () => p.evaluate(() => {
  const cv = document.querySelector('.stage-canvas');
  const r = cv.getBoundingClientRect();
  const pct = parseFloat(document.querySelector('.zoomval').textContent);
  const cell = 14 * (pct / 100);
  const size = document.querySelector('.doc-size').textContent.split('×').map(Number);
  return { x: r.x, y: r.y, w: r.width, h: r.height, cell, w0: size[0], h0: size[1] };
});

// 开进度模式
await p.evaluate(() => [...document.querySelectorAll('.tbar-chip')].find((e) => e.textContent.includes('进度'))?.click());
await sleep(400);
const g = await geom();
const ox = (g.w - g.w0 * g.cell) / 2;
const oy = (g.h - g.h0 * g.cell) / 2;
await p.mouse.click(g.x + ox + 14.5 * g.cell, g.y + oy + 8.5 * g.cell);
await sleep(500);
await p.evaluate(() => [...document.querySelectorAll('.side-tab')].find((e) => e.textContent.includes('用量'))?.click());
await sleep(500);
const before = await readPlaced();
await p.keyboard.down('Control'); await p.keyboard.press('KeyZ'); await p.keyboard.up('Control');
await sleep(600);
const undo = await readPlaced();
console.log(`进度勾选: 勾选后=${before} 撤销后=${undo}`);
console.log(Number(before) === 44 && Number(undo) === 43 ? 'PASS' : 'FAIL');
console.log('ERRORS:', errors.length ? [...new Set(errors)].join('|') : '(none)');
await browser.close();
