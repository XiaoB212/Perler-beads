// 交互测试：Esc 关闭弹窗、双指缩放、进度勾选、撤销
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

async function newPage(w, h) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE: ' + m.text()));
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
  await sleep(1200);
  return page;
}

const zoomVal = (p) => p.evaluate(() => document.querySelector('.zoomval')?.textContent);

// --- 1. Esc 关闭弹窗 ---
{
  const p = await newPage(1440, 900);
  await p.evaluate(() => [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('导出'))?.click());
  await sleep(800);
  const before = await p.evaluate(() => !!document.querySelector('.dialog'));
  await p.keyboard.press('Escape');
  await sleep(400);
  const after = await p.evaluate(() => !!document.querySelector('.dialog'));
  console.log(`Esc 关弹窗: 打开=${before} 关闭后=${after} → ${before && !after ? 'PASS' : 'FAIL'}`);
  await p.close();
}

// --- 2. 双指缩放 ---
{
  const p = await newPage(390, 844);
  const z0 = await zoomVal(p);
  const rect = await p.evaluate(() => {
    const c = document.querySelector('.stage-canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const cdp = await p.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 40, y: cy, id: 1 },
      { x: cx + 40, y: cy, id: 2 },
    ],
  });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 40 - i * 15, y: cy, id: 1 },
        { x: cx + 40 + i * 15, y: cy, id: 2 },
      ],
    });
    await sleep(40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  const z1 = await zoomVal(p);
  console.log(`双指缩放: ${z0} → ${z1} → ${z0 !== z1 ? 'PASS' : 'FAIL'}`);
  await p.screenshot({ path: '.shots/review3/z-pinch.png' });
  await p.close();
}

// --- 3. 进度模式勾选 + 撤销 ---
{
  const p = await newPage(1440, 900);
  // 打开进度模式
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.rail-btn')].find((e) => (e.title || '').includes('进度模式'));
    b?.click();
  });
  await sleep(300);
  const rect = await p.evaluate(() => {
    const c = document.querySelector('.stage-canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  // 点画布中心（蘑菇菌柄区域）
  await p.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
  await sleep(400);
  const placed1 = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.chip')].find((e) => e.textContent.includes('颗'));
    return t?.textContent.trim();
  });
  await p.keyboard.down('Control');
  await p.keyboard.press('KeyZ');
  await p.keyboard.up('Control');
  await sleep(400);
  const placed2 = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.chip')].find((e) => e.textContent.includes('颗'));
    return t?.textContent.trim();
  });
  console.log(`进度勾选: 勾选后 chip="${placed1}" 撤销后 chip="${placed2}"`);
  await p.close();
}

// --- 4. 回访（有 visited 但无文档）应仍显示示例 ---
{
  const p = await newPage(1440, 900);
  await p.evaluate(() => localStorage.setItem('perler-studio:visited', '1'));
  await p.reload({ waitUntil: 'networkidle2' });
  await sleep(1000);
  const t = await p.evaluate(() => document.querySelector('.doc-title-input')?.value);
  console.log(`回访首屏标题: "${t}" → ${/示例/.test(t || '') ? 'PASS' : 'FAIL'}`);
  await p.close();
}

console.log('=== ERRORS ===');
console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
await browser.close();
