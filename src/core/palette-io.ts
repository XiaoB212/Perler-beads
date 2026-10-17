import type { BeadColor } from './types';
import { downloadText, safeFileName } from './util';
import { hexToRgb, rgbToHex } from './color';

/* ------------------------------------------------------------------ *
 * 色卡文件：本项目自定义色卡的导入 / 导出
 *
 * 标准格式（导出的就是这个，导入时也认）：
 * {
 *   "format": "perler-studio-palette",
 *   "version": 1,
 *   "name": "我的色卡",
 *   "exportedAt": "2025-01-01T00:00:00.000Z",
 *   "colors": [{ "code": "A1", "name": "绯红", "hex": "#E23B4A", "brand": "MARD" }]
 * }
 *
 * 导入尽量宽容，常见写法都认：
 *   - 上面这种完整格式
 *   - 直接一个数组 [{ code, hex }, ...]
 *   - { colors: [...] } / { palette: [...] }
 *   - 每行「色号,色名,HEX」的 CSV / TSV（可以从 Excel 直接粘）
 * ------------------------------------------------------------------ */

export interface PaletteFileColor {
  code: string;
  name: string;
  hex: string;
  brand?: string;
  price?: number;
  stock?: number;
}

export interface PaletteFile {
  format: 'perler-studio-palette';
  version: 1;
  name: string;
  exportedAt: string;
  colors: PaletteFileColor[];
}

export interface ParseResult {
  name: string;
  colors: PaletteFileColor[];
  /** 被跳过的行（没有可用 HEX 之类） */
  skipped: number;
  /** 重复 HEX 被合并掉的数量 */
  merged: number;
}

/* ----------------------------- 导出 ----------------------------- */

export function paletteToColors(palette: BeadColor[]): PaletteFileColor[] {
  return palette.map((c) => ({
    code: c.code,
    name: c.name,
    hex: c.hex.toUpperCase(),
    ...(c.brand ? { brand: c.brand } : {}),
    ...(typeof c.price === 'number' ? { price: c.price } : {}),
    ...(typeof c.stock === 'number' ? { stock: c.stock } : {}),
  }));
}

export function buildPaletteFile(palette: BeadColor[], name: string): PaletteFile {
  return {
    format: 'perler-studio-palette',
    version: 1,
    name: name || '我的色卡',
    exportedAt: new Date().toISOString(),
    colors: paletteToColors(palette),
  };
}

export function paletteToJson(palette: BeadColor[], name: string): string {
  return JSON.stringify(buildPaletteFile(palette, name), null, 2);
}

export function exportPaletteJson(palette: BeadColor[], name: string) {
  downloadText(
    paletteToJson(palette, name),
    safeFileName(name || '我的色卡') + '.palette.json',
    'application/json',
  );
}

/** 导出成 CSV，方便在 Excel / 表格里批量改完再粘回来 */
export function paletteToCsv(palette: BeadColor[]): string {
  const rows = [['色号', '色名', 'HEX', '品牌', '单价(元/千颗)', '库存(颗)']];
  for (const c of palette) {
    rows.push([
      c.code,
      c.name,
      c.hex.toUpperCase(),
      c.brand ?? '',
      typeof c.price === 'number' ? String(c.price) : '',
      typeof c.stock === 'number' ? String(c.stock) : '',
    ]);
  }
  return rows
    .map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))
    .join('\n');
}

export function exportPaletteCsv(palette: BeadColor[], name: string) {
  // 带 BOM，Excel 打开中文不乱码
  downloadText('\ufeff' + paletteToCsv(palette), safeFileName(name || '我的色卡') + '-色卡.csv', 'text/csv');
}

/* ----------------------------- 导入 ----------------------------- */

/** 把 3 位 / 4 位 / 带 # 或不带 # 的写法统一成 #RRGGBB；不认识则返回 null */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  // 8 位带 alpha 的（部分色卡这么写），丢掉透明度
  if (/^[0-9a-f]{8}$/i.test(h)) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return '#' + h.toUpperCase();
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** 从任意一个对象里抽出一颗色；抽不到 HEX 返回 null */
function colorFromObject(o: Record<string, unknown>, index: number): PaletteFileColor | null {
  const hex =
    normalizeHex(o.hex) ??
    normalizeHex(o.color) ??
    normalizeHex(o.value) ??
    normalizeHex(o.rgb) ??
    normalizeHex(o.colour) ??
    // { rgb: [r, g, b] } 这种
    (Array.isArray(o.rgb) && o.rgb.length >= 3
      ? normalizeHex(
          rgbToHex({
            r: Number(o.rgb[0]),
            g: Number(o.rgb[1]),
            b: Number(o.rgb[2]),
          }),
        )
      : null);
  if (!hex) return null;
  const code = pickString(o, ['code', 'no', 'id', 'number', '色号']) ?? 'C' + (index + 1);
  const name = pickString(o, ['name', 'label', 'title', '色名', '名称']) ?? '';
  const brand = pickString(o, ['brand', 'vendor', 'factory', '品牌']);
  const price = pickNumber(o, ['price', 'unitPrice', '单价']);
  const stock = pickNumber(o, ['stock', '库存']);
  return {
    code,
    name,
    hex,
    ...(brand ? { brand } : {}),
    ...(typeof price === 'number' ? { price } : {}),
    ...(typeof stock === 'number' ? { stock } : {}),
  };
}

/** 简单但够用的 CSV 解析：支持引号包裹、引号内逗号与换行 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // 忽略，等 \n
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** 从「色号,色名,HEX」这类表格文本里读色卡 */
function parseTable(text: string): PaletteFileColor[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  const rows = parseCsv(text, delimiter);
  if (!rows.length) return [];
  // 判断第一行是不是表头：里面没有 HEX
  const looksHeader = !rows[0].some((c) => normalizeHex(c));
  const body = looksHeader ? rows.slice(1) : rows;
  const out: PaletteFileColor[] = [];
  body.forEach((r, i) => {
    const cells = r.map((c) => c.trim());
    const hexIdx = cells.findIndex((c) => normalizeHex(c));
    if (hexIdx < 0) return;
    const hex = normalizeHex(cells[hexIdx])!;
    const rest = cells.filter((_, j) => j !== hexIdx);
    // 约定：色号在前、色名在后；只有一个就当作色号
    const code = rest[0] || 'C' + (i + 1);
    const name = rest[1] || '';
    out.push({ code, name, hex });
  });
  return out;
}

function dedupe(colors: PaletteFileColor[]): { colors: PaletteFileColor[]; merged: number } {
  const seen = new Map<string, PaletteFileColor>();
  let merged = 0;
  for (const c of colors) {
    const key = c.hex.toUpperCase();
    if (seen.has(key)) {
      merged++;
      const prev = seen.get(key)!;
      // 保留信息更全的那条
      if (!prev.name && c.name) prev.name = c.name;
      if (!prev.code && c.code) prev.code = c.code;
      continue;
    }
    seen.set(key, { ...c });
  }
  return { colors: [...seen.values()], merged };
}

export function parsePaletteText(text: string): ParseResult {
  const raw = text.replace(/^\ufeff/, '').trim();
  if (!raw) return { name: '', colors: [], skipped: 0, merged: 0 };

  // 1) JSON
  if (raw.startsWith('{') || raw.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('JSON 格式有问题，检查一下逗号和引号');
    }
    let name = '';
    let arr: unknown[] = [];
    if (Array.isArray(data)) {
      arr = data;
    } else if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      name = typeof o.name === 'string' ? o.name : '';
      const cand = o.colors ?? o.palette ?? o.palette_colors ?? o.data;
      if (Array.isArray(cand)) arr = cand;
      else if (cand && typeof cand === 'object') {
        // { colors: { A1: "#fff" } } 这种映射写法
        arr = Object.entries(cand as Record<string, unknown>).map(([code, v]) =>
          typeof v === 'string' ? { code, hex: v } : { code, ...(v as object) },
        );
      }
    }
    const colors: PaletteFileColor[] = [];
    let skipped = 0;
    arr.forEach((item, i) => {
      if (typeof item === 'string') {
        const hex = normalizeHex(item);
        if (hex) colors.push({ code: 'C' + (i + 1), name: '', hex });
        else skipped++;
        return;
      }
      if (item && typeof item === 'object') {
        const c = colorFromObject(item as Record<string, unknown>, i);
        if (c) colors.push(c);
        else skipped++;
        return;
      }
      skipped++;
    });
    const d = dedupe(colors);
    return { name, colors: d.colors, skipped, merged: d.merged };
  }

  // 2) CSV / TSV / 空格分隔的表格
  const colors = parseTable(raw);
  const d = dedupe(colors);
  return { name: '', colors: d.colors, skipped: 0, merged: d.merged };
}

/** 把导入的色卡转成本图纸用的 BeadColor[] */
export function toBeadColors(colors: PaletteFileColor[], brandFallback = '自定义'): BeadColor[] {
  return colors.map((c, i) => ({
    id: 'imp-' + (Date.now().toString(36) + i),
    brand: c.brand || brandFallback,
    code: c.code || 'C' + (i + 1),
    name: c.name || '',
    hex: c.hex,
    custom: true,
    ...(typeof c.price === 'number' ? { price: c.price } : {}),
    ...(typeof c.stock === 'number' ? { stock: c.stock } : {}),
  }));
}

/** 按 CIEDE2000 最近色把旧色板映射到新色板（不够近就留空） */
export function mapByNearestHex(from: string, candidates: { hex: string }[]): number {
  const rgb = hexToRgb(from);
  const r1 = rgb.r,
    g1 = rgb.g,
    b1 = rgb.b;
  let best = 0;
  let bestD = Infinity;
  candidates.forEach((p, j) => {
    const pr = hexToRgb(p.hex);
    // 加权 RGB 距离，够快、够准，色卡颜色本身很密
    const rm = (r1 + pr.r) / 2;
    const dr = r1 - pr.r;
    const dg = g1 - pr.g;
    const db = b1 - pr.b;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  });
  return best;
}

/* ------------------------- 我的色卡（本地保存） ------------------------- */

const USER_KEY = 'perler-studio:user-palettes';

export interface UserPalette {
  id: string;
  name: string;
  colors: PaletteFileColor[];
  updatedAt: number;
}

export function listUserPalettes(): UserPalette[] {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return (data as UserPalette[])
      .filter((p) => p && typeof p.id === 'string' && Array.isArray(p.colors))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeUserPalettes(list: UserPalette[]) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* 存满了就算了，不阻塞使用 */
  }
}

export function saveUserPalette(name: string, palette: BeadColor[]): UserPalette {
  const list = listUserPalettes();
  const trimmed = (name || '我的色卡').trim().slice(0, 40);
  const existing = list.find((p) => p.name === trimmed);
  const item: UserPalette = {
    id: existing?.id ?? 'up-' + Date.now().toString(36),
    name: trimmed,
    colors: paletteToColors(palette),
    updatedAt: Date.now(),
  };
  const next = existing ? list.map((p) => (p.id === item.id ? item : p)) : [item, ...list];
  writeUserPalettes(next);
  return item;
}

export function deleteUserPalette(id: string) {
  writeUserPalettes(listUserPalettes().filter((p) => p.id !== id));
}

export function renameUserPalette(id: string, name: string) {
  writeUserPalettes(
    listUserPalettes().map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 40) || p.name } : p)),
  );
}
