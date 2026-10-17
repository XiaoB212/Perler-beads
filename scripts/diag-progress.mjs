import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.clear());
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1300);
await p.evaluate(() => [...document.querySelectorAll('.side-tab')].find((e) => e.textContent.includes('用量'))?.click());
await sleep(400);
const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>/进度/.test(e.textContent)).map(e=>e.className+'|'+e.textContent.trim()));
console.log('progress buttons:', JSON.stringify(btns));
await p.evaluate(() => { const t=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('进度模式')); t?.click(); });
await sleep(400);
const st = await p.evaluate(() => {
  const t=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('进度模式'));
  return t?.textContent.trim() + ' | cls=' + t?.className;
});
console.log('after toggle:', st);
const box = await p.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
console.log('box', JSON.stringify(box));
for (const fy of [0.40, 0.44, 0.48]) {
  await p.mouse.click(box.x + box.w * 0.5, box.y + box.h * fy);
  await sleep(300);
  const v = await p.evaluate(() => { const c=[...document.querySelectorAll('.stat-card')].find(e=>e.querySelector('.k')?.textContent.includes('已拼')); return c?.querySelector('.v')?.textContent.trim(); });
  console.log('fy', fy, '已拼=', v);
}
await browser.close();
