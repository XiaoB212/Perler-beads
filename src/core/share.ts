/**
 * 进度分享：把「图纸 + 已拼进度」塞进 URL 的 hash 里，别人打开链接就能看到
 * 你拼到哪儿了。全部在本地编解码，不经过任何服务器，也不上传任何东西。
 *
 * 体积做了几层压缩：
 *   1. 只用到的颜色才写进链接，并重新编号（7 色的图纸通常只有七条颜色记录）
 *   2. 颜色 hex 存成 3 字节，色号/色名/品牌用变长整数 + UTF-8
 *   3. 格子用「值 + 重复次数」的 RLE，进度用位图，两者都比 JSON 小一个数量级
 *   4. 整块再 deflate 一次（浏览器自带 CompressionStream）
 *
 * 实测 3×3 板 × 64 格（25600 颗）从 15001 字符降到三四百字符。
 *
 * 链接前缀故意做得一眼能区分：
 *   #p=…     进度分享（看别人拼到哪儿了）
 *   #join=…  局域网协作的房间入口（还没接通，先占位）
 */
import type { BeadColor, PatternDoc } from './types';
import { BUILTIN_PALETTES, PALETTE_KEYS } from './palette';
import { rleDecode, rleDecodeU8 } from './rle';

/**
 * 进度分享的 hash 前缀。
 * 用最短的 `#p=`：前缀每短一个字符，链接就短一个字符，
 * 而且 `#p=` 一眼能看出是「进度」，和局域网房间 `#join=` 不会混。
 */
export const SHARE_PREFIX = '#p=';
/** 局域网协作的房间入口（占位，见 LAN 说明） */
export const JOIN_PREFIX = '#join=';

/** 超过这个长度就不再主动推荐复制（很多聊天工具会截断长链接） */
export const SHARE_SOFT_LIMIT = 4096;

/** 二进制 payload 的魔数与版本 */
const MAGIC = 0x50;
const VERSION = 3;

interface CompactColor {
  c: string;
  n?: string;
  h: string;
  b?: string;
}

interface ShareJson {
  v: 1 | 2;
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

// ---------------------------------------------------------------- 基础编解码

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

class ByteWriter {
  private buf: number[] = [];

  u8(v: number) {
    this.buf.push(v & 255);
  }

  /** 变长整数：小数字只占 1 字节，256 占 2 字节 */
  varint(n: number) {
    let v = Math.max(0, Math.floor(n));
    while (v >= 128) {
      this.buf.push((v & 127) | 128);
      v = Math.floor(v / 128);
    }
    this.buf.push(v);
  }

  raw(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
  }

  text(s: string) {
    const b = new TextEncoder().encode(s ?? '');
    this.varint(b.length);
    this.raw(b);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

class ByteReader {
  private at = 0;

  constructor(private buf: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.buf.length;
  }

  u8(): number {
    if (this.at >= this.buf.length) throw new Error('eof');
    return this.buf[this.at++];
  }

  varint(): number {
    let shift = 1;
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const b = this.u8();
      n += (b & 127) * shift;
      if (!(b & 128)) return n;
      shift *= 128;
    }
    return n;
  }

  raw(len: number): Uint8Array {
    const out = this.buf.subarray(this.at, this.at + len);
    this.at += len;
    return out;
  }

  text(): string {
    const n = this.varint();
    return new TextDecoder().decode(this.raw(n));
  }
}

/** 有没浏览器原生压缩流（Chrome 80+ / Safari 16.4+ / Firefox 113+） */
function hasDeflate(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!hasDeflate()) return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!hasDeflate()) return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): [number, number, number] {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bytesToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => (v & 255).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- 编码

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

/** RLE：连续相同值压成「值, 次数」两个变长整数 */
function writeRle(w: ByteWriter, arr: Uint16Array | Uint8Array) {
  if (!arr.length) return;
  let cur = arr[0];
  let run = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur && run < 1_000_000) run++;
    else {
      w.varint(cur);
      w.varint(run);
      cur = arr[i];
      run = 1;
    }
  }
  w.varint(cur);
  w.varint(run);
}

function readRle(r: ByteReader, length: number): Uint16Array {
  const out = new Uint16Array(length);
  let idx = 0;
  while (!r.done && idx < length) {
    const value = r.varint();
    const run = r.varint();
    if (!run) break;
    const end = Math.min(idx + run, length);
    if (value) out.fill(value, idx, end);
    idx = end;
  }
  return out;
}

/**
 * 格子编码：同样的数据试三种排法，谁 deflate 之后小就用谁。
 *   0 = RLE（大色块、留白多的图纸最好）
 *   1 = 左邻差分（横向渐变、照片）
 *   2 = Paeth 式二维差分（斜向纹理、噪点多但相邻相关的图）
 * 实测 25600 颗的图片从 1.4 万字符降到 7 千上下。
 */
const CELL_RLE = 0;
const CELL_DELTA_X = 1;
const CELL_DELTA_2D = 2;

/** 把三种排法都 deflate 一遍，返回最小的那包；没有压缩流就退回 RLE */
async function encodeCellsSmallest(
  cells: Uint16Array,
  width: number,
  height: number,
  allowDelta: boolean,
): Promise<Uint8Array> {
  const rleW = new ByteWriter();
  writeRle(rleW, cells);
  const candidates: { mode: number; body: Uint8Array }[] = [{ mode: CELL_RLE, body: rleW.toBytes() }];

  if (allowDelta) {
    const dx = new Uint8Array(cells.length);
    for (let y = 0; y < height; y++) {
      let left = 0;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const v = cells[i] & 255;
        dx[i] = (v - left) & 255;
        left = v;
      }
    }
    candidates.push({ mode: CELL_DELTA_X, body: dx });

    const d2 = new Uint8Array(cells.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const v = cells[i] & 255;
        const a = x > 0 ? cells[i - 1] & 255 : 0;
        const b = y > 0 ? cells[i - width] & 255 : 0;
        const c = x > 0 && y > 0 ? cells[i - width - 1] & 255 : 0;
        d2[i] = (v - (a + b - c)) & 255;
      }
    }
    candidates.push({ mode: CELL_DELTA_2D, body: d2 });
  }

  let best = candidates[0];
  let bestLen = Infinity;
  for (const c of candidates) {
    const z = await deflate(c.body);
    const len = z ? z.length : c.body.length + 64;
    if (len < bestLen) {
      bestLen = len;
      best = c;
    }
  }
  const w = new ByteWriter();
  w.u8(best.mode);
  w.varint(best.body.length);
  w.raw(best.body);
  return w.toBytes();
}

function decodeCells(r: ByteReader, width: number, height: number): Uint16Array {
  const mode = r.u8();
  const len = r.varint();
  const body = r.raw(len);
  const total = width * height;
  const out = new Uint16Array(total);
  if (mode === CELL_RLE) {
    const sub = new ByteReader(body);
    let idx = 0;
    while (!sub.done && idx < total) {
      const value = sub.varint();
      const run = sub.varint();
      if (!run) break;
      const end = Math.min(idx + run, total);
      if (value) out.fill(value, idx, end);
      idx = end;
    }
    return out;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mode === CELL_DELTA_X) {
        const prev = x > 0 ? out[i - 1] : 0;
        out[i] = (prev + (body[i] ?? 0)) & 255;
      } else {
        const a = x > 0 ? out[i - 1] : 0;
        const b = y > 0 ? out[i - width] : 0;
        const c = x > 0 && y > 0 ? out[i - width - 1] : 0;
        out[i] = (a + b - c + (body[i] ?? 0)) & 255;
      }
    }
  }
  return out;
}

/** 进度只有 0/1：位图通常比 RLE 还小，两种都试，取短的 */
function encodeProgress(w: ByteWriter, progress: Uint8Array) {
  const bytes = Math.ceil(progress.length / 8);
  const bits = new Uint8Array(bytes);
  let ones = 0;
  for (let i = 0; i < progress.length; i++) {
    if (progress[i]) {
      bits[i >> 3] |= 1 << (i & 7);
      ones++;
    }
  }
  const rle = new ByteWriter();
  writeRle(rle, progress);
  const rleBytes = rle.toBytes();

  // 全空进度：只写一个 0 标记
  if (ones === 0) {
    w.u8(2);
    return;
  }
  if (bits.length <= rleBytes.length) {
    w.u8(0);
    w.varint(bits.length);
    w.raw(bits);
  } else {
    w.u8(1);
    w.raw(rleBytes);
  }
}

function decodeProgress(r: ByteReader, length: number): Uint8Array {
  const mode = r.u8();
  if (mode === 2) return new Uint8Array(length);
  if (mode === 0) {
    const n = r.varint();
    const bits = r.raw(n);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      if (i >> 3 < bits.length && bits[i >> 3] & (1 << (i & 7))) out[i] = 1;
    }
    return out;
  }
  // mode 1：RLE
  const out = new Uint8Array(length);
  let idx = 0;
  while (!r.done && idx < length) {
    const value = r.varint();
    const run = r.varint();
    if (!run) break;
    const end = Math.min(idx + run, length);
    if (value) out.fill(1, idx, end);
    idx = end;
  }
  return out;
}

/**
 * 内置色卡的查表：颜色如果就是某个品牌色卡里的原样条目，
 * 链接里只存「第几套色卡 + 第几个色」，十几个字节就能省成两个字节。
 * 自定义颜色 / 改过 hex 的颜色才会写完整的色号与色名。
 */
let refTable: Map<string, { p: number; i: number }> | null = null;
const refOrder: string[] = [...PALETTE_KEYS, 'basic'];

function colorKey(brand: string, code: string, hex: string): string {
  return `${(brand || '').toLowerCase()}|${(code || '').toLowerCase()}|${(hex || '').toLowerCase()}`;
}

function getRefTable(): Map<string, { p: number; i: number }> {
  if (refTable) return refTable;
  const m = new Map<string, { p: number; i: number }>();
  refOrder.forEach((key, p) => {
    const list = BUILTIN_PALETTES[key];
    if (!list) return;
    list.forEach((c, i) => {
      const k = colorKey(c.brand, c.code, c.hex);
      if (!m.has(k)) m.set(k, { p, i });
    });
  });
  refTable = m;
  return m;
}

async function encodePayload(doc: PatternDoc): Promise<Uint8Array> {
  const used = usedPalette(doc);
  // 原色板下标 → 链接里的序号（1 起，0 表示空格）
  const remap = new Map<number, number>();
  used.forEach((r, i) => remap.set(r.index, i + 1));

  const refs = getRefTable();
  const w = new ByteWriter();
  w.u8(MAGIC);
  w.u8(VERSION);
  // flags：bit0 有名字，bit1 有分板规格
  w.u8((doc.name ? 1 : 0) | (doc.pegboard > 0 ? 2 : 0));
  w.varint(doc.width);
  w.varint(doc.height);
  if (doc.name) w.text(doc.name);
  if (doc.pegboard > 0) w.varint(doc.pegboard);
  w.varint(used.length);
  for (const r of used) {
    const hit = refs.get(colorKey(r.color.brand, r.color.code, r.color.hex));
    if (hit) {
      w.u8(0);
      w.varint(hit.p);
      w.varint(hit.i);
      continue;
    }
    const [rr, gg, bb] = hexToBytes(r.color.hex);
    w.u8(1);
    w.u8(rr);
    w.u8(gg);
    w.u8(bb);
    w.text(r.color.code);
    // 色名大多自动生成、还很长，超过 8 个字符就不带，省下大把体积
    w.text(r.color.name && r.color.name.length <= 8 ? r.color.name : '');
    w.text(r.color.brand && r.color.brand.length <= 10 ? r.color.brand : '');
  }
  const cells = new Uint16Array(doc.cells.length);
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (!v) continue;
    cells[i] = remap.get(v - 1) ?? 0;
  }
  // 差分编码按字节做，色号数超过 255 时只能退回 RLE
  const cellBytes = await encodeCellsSmallest(
    cells,
    doc.width,
    doc.height,
    used.length <= 255,
  );
  w.raw(cellBytes);
  encodeProgress(w, doc.progress);
  return w.toBytes();
}

function decodePayload(bytes: Uint8Array): DecodedShare | null {
  const r = new ByteReader(bytes);
  if (r.u8() !== MAGIC) return null;
  if (r.u8() !== VERSION) return null;
  const flags = r.u8();
  const width = r.varint();
  const height = r.varint();
  if (!width || !height || width * height > 1024 * 1024) return null;
  const name = flags & 1 ? r.text() : '';
  const pegboard = flags & 2 ? r.varint() : 0;
  const colorCount = r.varint();
  if (colorCount > 4096) return null;
  const palette: BeadColor[] = [];
  for (let i = 0; i < colorCount; i++) {
    const kind = r.u8();
    if (kind === 0) {
      const p = r.varint();
      const idx = r.varint();
      const src = BUILTIN_PALETTES[refOrder[p]];
      const base = src ? src[idx] : undefined;
      palette.push(
        base
          ? { ...base, id: `shared-${i}` }
          : { id: `shared-${i}`, brand: '', code: '?', name: '', hex: '#000000' },
      );
      continue;
    }
    const rr = r.u8();
    const gg = r.u8();
    const bb = r.u8();
    const code = r.text();
    const cname = r.text();
    const brand = r.text();
    palette.push({ id: `shared-${i}`, brand, code, name: cname, hex: bytesToHex(rr, gg, bb) });
  }
  const total = width * height;
  const cells = decodeCells(r, width, height);
  const progress = decodeProgress(r, total);
  return { name: name || '分享的图纸', width, height, pegboard, palette, cells, progress, updatedAt: Date.now() };
}

// ---------------------------------------------------------------- 老版本（JSON）

function decodeLegacyJson(json: string): DecodedShare | null {
  const j = JSON.parse(json) as ShareJson;
  if (!j) return null;
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
  }));
  return {
    name: j.n || '分享的图纸',
    width,
    height,
    pegboard: Number.isFinite(Number(j.g)) ? Number(j.g) : 0,
    palette,
    cells: rleDecode(j.c ?? '', total),
    progress: rleDecodeU8(j.p ?? '', total),
    updatedAt: Number(j.at) || Date.now(),
  };
}

// ---------------------------------------------------------------- 对外接口

function pageOrigin(base?: string): string {
  const origin =
    base ??
    (typeof location !== 'undefined'
      ? location.origin + location.pathname
      : 'https://xiaob212.github.io/Perler-beads/');
  return origin.replace(/#.*$/, '');
}

/** 把当前图纸与进度编码成一个可分享的链接 */
export async function buildShareUrl(doc: PatternDoc, base?: string): Promise<ShareResult> {
  const payload = await encodePayload(doc);
  const rawHash = SHARE_PREFIX + bytesToBase64Url(payload);
  const compressed = await deflate(payload);
  const shortHash = compressed ? SHARE_PREFIX + bytesToBase64Url(compressed) : rawHash;
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
  else return null;
  try {
    const bytes = base64UrlToBytes(body);
    if (!bytes.length) return null;
    // 新版二进制以 MAGIC 开头；否则是压缩过的 JSON 或纯 JSON 的老链接
    if (bytes[0] === MAGIC) {
      const direct = decodePayload(bytes);
      if (direct) return direct;
    }
    const inflated = await inflate(bytes);
    if (inflated) {
      if (inflated[0] === MAGIC) return decodePayload(inflated);
      const text = new TextDecoder().decode(inflated);
      if (text.startsWith('{')) return decodeLegacyJson(text);
    }
    const text = new TextDecoder().decode(bytes);
    if (text.startsWith('{')) return decodeLegacyJson(text);
    return null;
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
