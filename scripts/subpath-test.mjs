// 子路径部署验证：模拟 GitHub Pages 的 /repo/ 路径
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = join(process.cwd(), 'dist');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/perler-studio/')) { res.writeHead(404); res.end('not found'); return; }
  p = p.slice('/perler-studio/'.length) || 'index.html';
  try {
    const buf = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(4180, '127.0.0.1', r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await browser.newPage();
p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE: ' + m.text()));
p.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url()));
await p.setViewport({ width: 1280, height: 860 });
await p.goto('http://127.0.0.1:4180/perler-studio/', { waitUntil: 'networkidle2' });
await sleep(1800);
const r = await p.evaluate(() => ({ title: document.querySelector('.doc-title-input')?.value, beads: [...document.querySelectorAll('.tbar-chip')].find(e => /\d+ 颗/.test(e.textContent))?.textContent.trim() }));
console.log('子路径部署:', JSON.stringify(r));
await p.screenshot({ path: '.shots/review3/z-subpath.png' });
console.log('ERRORS:', errors.length ? [...new Set(errors)].join('|') : '(none)');
await browser.close();
server.close();
