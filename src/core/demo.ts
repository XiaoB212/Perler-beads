import type { BeadColor, PatternDoc } from './types';
import { uid } from './util';

/**
 * 首次访问时展示的示例图纸（蘑菇），
 * 让新用户一进来就能看到真实效果，而不是一片空白网格。
 * 另外预设了一小段「已拼」进度，打开就能看到进度功能长什么样。
 */

const PALETTE: BeadColor[] = [
  { id: 'demo-1', brand: 'MARD', code: 'A02', name: '绯红', hex: '#E23B4A', price: 2.5 },
  { id: 'demo-2', brand: 'MARD', code: 'A05', name: '深红', hex: '#A81E2E', price: 2.5 },
  { id: 'demo-3', brand: 'MARD', code: 'J01', name: '奶白', hex: '#FDF2DF', price: 2.5 },
  { id: 'demo-4', brand: 'MARD', code: 'J04', name: '米灰', hex: '#DCC6A8', price: 2.5 },
  { id: 'demo-5', brand: 'MARD', code: 'K01', name: '纯白', hex: '#FFFFFF', price: 2.5 },
  { id: 'demo-6', brand: 'MARD', code: 'K11', name: '墨黑', hex: '#2B2233', price: 2.5 },
  { id: 'demo-7', brand: 'MARD', code: 'E03', name: '草绿', hex: '#5BB65A', price: 2.5 },
];

const RED = 1;
const RED_DARK = 2;
const CREAM = 3;
const CREAM_DARK = 4;
const WHITE = 5;
const INK = 6;
const GREEN = 7;

const W = 29;
const H = 29;

export function createDemoDoc(): PatternDoc {
  const cells = new Uint16Array(W * H);
  const progress = new Uint8Array(W * H);

  const put = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    cells[y * W + x] = v;
  };
  const insideEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  // ---- 菌盖：上半椭圆 ----
  const capCx = 14;
  const capCy = 15.5;
  const capRx = 13;
  const capRy = 12;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y > capCy) continue;
      if (!insideEllipse(x, y, capCx, capCy, capRx, capRy)) continue;
      // 底缘两圈用深红压边，让菌盖有厚度
      const nearEdge = !insideEllipse(x, y + 2, capCx, capCy, capRx, capRy);
      put(x, y, nearEdge ? RED_DARK : RED);
    }
  }

  // ---- 菌盖白点 ----
  const spots: [number, number, number, number][] = [
    [7.5, 9.5, 2.6, 2.3],
    [20.5, 8.5, 2.8, 2.5],
    [13.5, 5.0, 2.1, 1.8],
    [24.5, 13.5, 1.6, 1.4],
    [3.5, 13.5, 1.5, 1.3],
  ];
  for (const [cx, cy, rx, ry] of spots) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (cells[y * W + x] !== RED) continue;
        if (insideEllipse(x, y, cx, cy, rx, ry)) put(x, y, WHITE);
      }
    }
  }

  // ---- 菌柄 ----
  for (let y = 15; y <= 25; y++) {
    const t = (y - 15) / 10;
    const halfW = 5.6 - t * 0.9;
    const left = Math.round(capCx - halfW);
    const right = Math.round(capCx + halfW);
    for (let x = left; x <= right; x++) {
      const edge = x === left || x === right || y === 25;
      // 菌盖下方的阴影带
      const shade = y <= 16 && !edge;
      put(x, y, edge ? CREAM_DARK : shade ? CREAM_DARK : CREAM);
    }
  }
  // 菌柄底部收口
  for (let x = 10; x <= 18; x++) put(x, 26, CREAM_DARK);
  for (let x = 11; x <= 17; x++) put(x, 27, CREAM_DARK);

  // ---- 表情：两只眼睛 + 微笑 ----
  for (const ex of [11, 16]) {
    put(ex, 19, INK);
    put(ex + 1, 19, INK);
    put(ex, 20, INK);
    put(ex + 1, 20, INK);
  }
  // 微笑：一个浅浅的 U 形
  put(12, 22, INK);
  put(16, 22, INK);
  put(13, 23, INK);
  put(14, 23, INK);
  put(15, 23, INK);
  // 腮红：2×1 的两颗，比单颗更像腮红
  put(10, 21, RED_DARK);
  put(11, 21, RED_DARK);
  put(17, 21, RED_DARK);
  put(18, 21, RED_DARK);

  // ---- 脚下小草 ----
  const grass: [number, number][] = [
    [4, 26], [5, 26], [6, 25], [6, 26], [3, 27], [4, 27], [5, 27], [6, 27],
    [22, 26], [23, 25], [23, 26], [24, 26], [22, 27], [23, 27], [24, 27], [25, 27],
  ];
  for (const [x, y] of grass) put(x, y, GREEN);

  // ---- 预设一点已拼进度：最下面三行已拼好，打开就能看到进度效果 ----
  for (let y = 25; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cells[y * W + x]) progress[y * W + x] = 1;
    }
  }

  const now = Date.now();
  return {
    id: uid(),
    name: '示例 · 小蘑菇',
    width: W,
    height: H,
    cells,
    progress,
    palette: PALETTE.map((c) => ({ ...c })),
    pegboard: 29,
    createdAt: now,
    updatedAt: now,
    notes:
      '这是一张示例图纸：最下面三行已经标记为「已拼」，试着打开「进度模式」继续勾选，或者用「图片转图纸」把你的照片变成拼豆。所有内容只保存在本地浏览器。',
  };
}
