/**
 * 进度分享：把「图纸 + 已拼进度」塞进 URL 的 hash 里，别人打开链接就能看到
 * 你拼到哪儿了。全部在本地编解码，不经过任何服务器，也不上传任何东西。
 *
 * 只用到的颜色会被写进链接，并重新编号，所以 7 色的图纸链接很短；
 * 格子和进度都用 RLE，重复的空格 / 同色格几乎不占体积。
 */
import type { BeadColor, PatternDoc } from './types';
import { rleDecode, rleDecodeU8, rleEncode } from './rle';

/** hash 前缀，例如 https://…/#p=xxxx */
export const SHARE_PREFIX = '#p=';

/** 超过这个长度就不再主动推荐复制（很多聊天工具会截断长链接） */
export const SHARE_SOFT_LIMIT = 6000;

interface CompactColor {
  c: string;
  n: string;
  h: string;
  b?: string;
  p?: number;
  s?: number;
}

interface ShareJson {
  v: 1;
  n: string;
  w: number;
  h: number;
  g: number;
  k: CompactColor[];
  c: string;
  p: string;
  at?: number;
}

export interface ShareResult {
  url: string;
  length: number;
  tooLong: boolean;
}

export interface DecodedShare {
  name: string;
  width: number;
  height: number;
  pegboard: number;
  palette: BeadColor[];
  cells: Uint16Array;
  progress: Uint8Array;
  updatedAt: number;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 图纸上用到的颜色（含各自用了多少颗），按颗数降序 */
export function usedPalette(doc: PatternDoc): { index: number; color: BeadColor; count: number }[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (!v) continue;
    counts.set(v - 1, (counts.get(v - 1) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([index, count]) => ({ index, color: doc.palette[index], count }))
    .filter((r) => r.color)
    .sort((a, b) => b.count - a.count);
}

/** 把当前图纸与进度编码成一个可分享的链接 */
export function buildShareUrl(doc: PatternDoc, base?: string): ShareResult {
  const used = usedPalette(doc);
  const remap = new Map<number, number>();
  const k: CompactColor[] = used.map((r, i) => {
    remap.set(r.index, i + 1);
    const col: CompactColor = { c: r.color.code, n: r.color.name, h: r.color.hex };
    if (r.color.brand) col.b = r.color.brand;
    if (r.color.price) col.p = r.color.price;
    if (r.color.stock) col.s = r.color.stock;
    return col;
  });
  const cells = new Uint16Array(doc.cells.length);
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (!v) continue;
    cells[i] = remap.get(v - 1) ?? 0;
  }
  const payload: ShareJson = {
    v: 1,
    n: doc.name,
    w: doc.width,
    h: doc.height,
    g: doc.pegboard,
    k,
    c: rleEncode(cells),
    p: rleEncode(doc.progress),
    at: doc.updatedAt,
  };
  const hash = SHARE_PREFIX + toBase64Url(JSON.stringify(payload));
  const origin =
    base ??
    (typeof location !== 'undefined'
      ? location.origin + location.pathname
      : 'https://xiaob212.github.io/Perler-beads/');
  const url = origin.replace(/#.*$/, '') + hash;
  return { url, length: url.length, tooLong: url.length > SHARE_SOFT_LIMIT };
}

/** 从 location.hash 里解出一份图纸；不是分享链接就返回 null */
export function decodeShare(hash: string): DecodedShare | null {
  if (!hash || !hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const raw = fromBase64Url(hash.slice(SHARE_PREFIX.length));
    const j = JSON.parse(raw) as ShareJson;
    if (!j || j.v !== 1) return null;
    const width = Math.floor(Number(j.w));
    const height = Math.floor(Number(j.h));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const total = width * height;
    if (total > 1024 * 1024) return null;
    const palette: BeadColor[] = (j.k ?? []).map((c, i) => ({
      id: `shared-${i}`,
      brand: c.b ?? '',
      code: c.c ?? '',
      name: c.n ?? '',
      hex: c.h ?? '#000000',
      price: c.p,
      stock: c.s,
    }));
    const cells = rleDecode(j.c ?? '', total);
    const progress = rleDecodeU8(j.p ?? '', total);
    // 颜色表是空的（全空画布）时也允许打开
    return {
      name: j.n || '分享的图纸',
      width,
      height,
      pegboard: Number.isFinite(Number(j.g)) ? Number(j.g) : 0,
      palette: palette.length ? palette : [],
      cells,
      progress,
      updatedAt: Number(j.at) || Date.now(),
    };
  } catch {
    return null;
  }
}

/** 算一份图纸拼了多少（颗数与百分比） */
export function progressStat(cells: Uint16Array, progress: Uint8Array): {
  total: number;
  placed: number;
  percent: number;
} {
  let total = 0;
  let placed = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    total++;
    if (progress[i]) placed++;
  }
  return { total, placed, percent: total ? Math.round((placed / total) * 100) : 0 };
}