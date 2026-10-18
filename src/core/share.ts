/**
 * 进度分享：把「图纸 + 已拼进度」塞进 URL 的 hash 里，别人打开链接就能看到
 * 你拼到哪儿了。全部在本地编解码，不经过任何服务器，也不上传任何东西。
 *
 * 只用到的颜色会被写进链接，并重新编号，所以 7 色的图纸链接很短；
 * 格子与进度都用 RLE，重复的空格 / 同色格几乎不占体积。
 * 最后再整体 deflate 一次（浏览器自带 CompressionStream），
 * 实测 64×64 的图从 3 千多字符降到 600 上下，手机聊天工具不会截断。
 *
 * 链接前缀故意做得一眼能区分：
 *   #progress=…  进度分享（看别人拼到哪儿了）
 *   #join=…      局域网协作的房间入口（还没接通，先占位）
 *   #p=…         老版本进度链接，仍然能打开
 */
import type { BeadColor, PatternDoc } from './types';
import { rleDecode, rleDecodeU8, rleEncode } from './rle';

/** 进度分享的 hash 前缀 */
export const SHARE_PREFIX = '#progress=';
/** 老版本前缀，只用来读，不再生成 */
export const LEGACY_PREFIX = '#p=';
/** 局域网协作的房间入口（占位，见 LAN 说明） */
export const JOIN_PREFIX = '#join=';

/** 超过这个长度就不再主动推荐复制（很多聊天工具会截断长链接） */
export const SHARE_SOFT_LIMIT = 4096;

interface CompactColor {
  c: string;
  n?: string;
  h: string;
  b?: string;
  p?: number;
  s?: number;
}

interface ShareJson {
  v: 2;
  n?: string;
  w: number;
  h: number;
  g?: number;
  k: CompactColor[];
  c: string;
  p: string;
  at?: number;
}

export interface ShareResult {
  url: string;
  length: number;
  tooLong: boolean;
  /** 压缩后省下的字符数，用于在面板上告诉用户「短链接」确实变短了 */
  saved?: number;
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

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  // 一次拼 32KB，避免超长字符串拼接在 Safari 上卡住
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 有没有浏览器原生的压缩流（Chrome 80+ / Safari 16.4+ / Firefox 113+） */
function hasDeflate(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function deflate(text: string): Promise<Uint8Array | null> {
  if (!hasDeflate()) return null;
  try {
    const input = new TextEncoder().encode(text);
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([input]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<string | null> {
  if (!hasDeflate()) return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
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

function pack(doc: PatternDoc): string {
  const used = usedPalette(doc);
  const remap = new Map<number, number>();
  const k: CompactColor[] = used.map((r, i) => {
    remap.set(r.index, i + 1);
    const col: CompactColor = { c: r.color.code, h: r.color.hex };
    // 色名能省就省：很多色号的名字是自动生成的，占了链接的一大半体积
    if (r.color.name && r.color.name.length <= 6) col.n = r.color.name;
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
    v: 2,
    n: doc.name || undefined,
    w: doc.width,
    h: doc.height,
    g: doc.pegboard || undefined,
    k,
    c: rleEncode(cells),
    p: rleEncode(doc.progress),
    at: doc.updatedAt || undefined,
  };
  return JSON.stringify(payload);
}

function pageOrigin(base?: string): string {
  const origin =
    base ??
    (typeof location !== 'undefined'
      ? location.origin + location.pathname
      : 'https://xiaob212.github.io/Perler-beads/');
  return origin.replace(/#.*$/, '');
}

/**
 * 把当前图纸与进度编码成一个可分享的链接。
 * 有原生压缩就用 deflate，没有就退回未压缩（老浏览器也能用）。
 */
export async function buildShareUrl(doc: PatternDoc, base?: string): Promise<ShareResult> {
  const json = pack(doc);
  const rawHash = SHARE_PREFIX + bytesToBase64Url(new TextEncoder().encode(json));
  const compressed = await deflate(json);
  if (!compressed) {
    const url = pageOrigin(base) + rawHash;
    return { url, length: url.length, tooLong: url.length > SHARE_SOFT_LIMIT };
  }
  const shortHash = SHARE_PREFIX + bytesToBase64Url(compressed);
  const url = pageOrigin(base) + shortHash;
  return {
    url,
    length: url.length,
    tooLong: url.length > SHARE_SOFT_LIMIT,
    saved: rawHash.length - shortHash.length,
  };
}

/** 从 location.hash 里解出一份图纸；不是分享链接就返回 null */
export async function decodeShare(hash: string): Promise<DecodedShare | null> {
  if (!hash) return null;
  let body = '';
  if (hash.startsWith(SHARE_PREFIX)) body = hash.slice(SHARE_PREFIX.length);
  else if (hash.startsWith(LEGACY_PREFIX)) body = hash.slice(LEGACY_PREFIX.length);
  else return null;
  try {
    const bytes = base64UrlToBytes(body);
    let json: string | null = null;
    // 先按压缩格式解（能判 deflate 头）；失败再按纯 JSON 当老链接处理
    const text = new TextDecoder().decode(bytes);
    if (text.startsWith('{')) json = text;
    else json = await inflate(bytes);
    if (!json) return null;
    const j = JSON.parse(json) as ShareJson;
    if (!j || (j.v !== 2 && (j as unknown as { v: number }).v !== 1)) return null;
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
    return {
      name: j.n || '分享的图纸',
      width,
      height,
      pegboard: Number.isFinite(Number(j.g)) ? Number(j.g) : 0,
      palette,
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
