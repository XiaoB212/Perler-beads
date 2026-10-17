import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
p.on('console', m => { if (m.text().startsWith('[D]')) console.log(m.text()); });
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.clear());
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1300);
// 打开进度模式（顶栏 chip）
await p.evaluate(() => [...document.querySelectorAll('.tbar-chip')].find(e=>e.textContent.includes('进度'))?.click());
await sleep(400);
const box = await p.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// 用 pointer 事件序列手动派发，确认事件到达
const hit = await p.evaluate((bx) => {
  const c = document.querySelector('.stage-canvas');
  const ev = new PointerEvent('pointerdown', { bubbles: true, clientX: bx.x + bx.w*0.5, clientY: bx.y + bx.h*0.45, pointerId: 1, isPrimary: true, button: 0 });
  c.dispatchEvent(ev);
  const ev2 = new PointerEvent('pointerup', { bubbles: true, clientX: bx.x + bx.w*0.5, clientY: bx.y + bx.h*0.45, pointerId: 1, isPrimary: true, button: 0 });
  c.dispatchEvent(ev2);
  return 'dispatched';
}, box);
await sleep(600);
const s = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.stat-card')];
  const c = cards.find(e => e.querySelector('.k')?.textContent.includes('已拼'));
  return c?.querySelector('.v')?.textContent.trim();
});
console.log('pointer dispatch ->', hit, '已拼=', s);
await browser.close();
