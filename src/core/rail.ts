/**
 * 左侧工具栏（功能列表）的条目与顺序。
 *
 * 顺序存在本机 localStorage 里，用户可以自己调；以后新增的条目如果不在旧顺序里，
 * 会自动补到末尾，不会「升级之后突然少了一个按钮」。
 */

export type RailGroup = 'tool' | 'action' | 'file';

export interface RailDef {
  id: string;
  label: string;
  group: RailGroup;
}

/** 默认顺序：工具 → 模式 → 文件类 */
export const RAIL_DEFAULTS: RailDef[] = [
  { id: 'pencil', label: '画笔', group: 'tool' },
  { id: 'eraser', label: '橡皮', group: 'tool' },
  { id: 'bucket', label: '填充', group: 'tool' },
  { id: 'line', label: '直线', group: 'tool' },
  { id: 'rect', label: '矩形', group: 'tool' },
  { id: 'ellipse', label: '椭圆', group: 'tool' },
  { id: 'picker', label: '吸管', group: 'tool' },
  { id: 'pan', label: '平移', group: 'tool' },
  { id: 'wand', label: '抠图', group: 'action' },
  { id: 'progress', label: '进度', group: 'action' },
  { id: 'online', label: '线上', group: 'action' },
  { id: 'grid', label: '网格', group: 'action' },
  { id: 'symmetry', label: '对称', group: 'action' },
  { id: 'colors', label: '色号', group: 'file' },
  { id: 'projects', label: '图纸', group: 'file' },
  { id: 'guide', label: '手册', group: 'file' },
];

const KEY = 'perler-studio:rail-order';

/** 读顺序：去掉不认识的 id，补上缺的新条目 */
export function readRailOrder(): string[] {
  const known = RAIL_DEFAULTS.map((d) => d.id);
  let stored: string[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) stored = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    stored = [];
  }
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of stored) {
    if (known.includes(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of known) if (!seen.has(id)) order.push(id);
  return order;
}

export function writeRailOrder(order: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* 存不了就只在本次会话生效 */
  }
}

export function clearRailOrder(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/** 把某一条往上/往下挪一格（返回新数组，越界时原样返回） */
export function moveRailItem(order: string[], id: string, dir: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  next[i] = next[j];
  next[j] = id;
  return next;
}