// 诊断导出预览 canvas 的实际渲染
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
await sleep(1200);
await page.evaluate(() => {
  [...document.querySelectorAll('.btn')].find((e) => e.textContent.includes('导出'))?.click();
});
await sleep(1500);

const info = await page.evaluate(() => {
  const box = document.querySelector('.preview-box');
  const cv = box?.querySelector('canvas');
  if (!cv) return { err: 'no canvas' };
  const cs = getComputedStyle(cv);
  const bs = getComputedStyle(box);
  const dlg = document.querySelector('.dialog');
  const ds = dlg ? getComputedStyle(dlg) : null;
  const ctx = cv.getContext('2d');
  const px = (x, y) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return `rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
  };
  return {
    cvW: cv.width,
    cvH: cv.height,
    cssW: cs.width,
    cssH: cs.height,
    opacity: cs.opacity,
    filter: cs.filter,
    mixBlend: cs.mixBlendMode,
    boxOpacity: bs.opacity,
    dlgOpacity: ds?.opacity,
    dlgAnim: ds?.animationName,
    samples: [px(150, 150), px(250, 250), px(300, 400), px(10, 10)],
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
