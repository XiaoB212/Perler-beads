import type { BeadColor, PatternDoc } from '../core/types';

const KEY_INDEX = 'perler-studio:index';
const KEY_PREFIX = 'perler-studio:doc:';

export interface IndexEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  thumb: string;
}

interface StoredDoc {
  format: 'perler-studio-local';
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  pegboard: number;
  notes: string;
  palette: BeadColor[];
  cells: string;
  progress: string;
  createdAt: number;
  updatedAt: number;
}

/** 极简 RLE，避免循环依赖 */
function enc(arr: Uint16Array | Uint8Array): string {
  if (!arr.length) return '';
  const out: string[] = [];
  let cur = arr[0];
  let count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur && count < 65535) count++;
    else {
      out.push(cur + 'x' + count);
      cur = arr[i];
      count = 1;
    }
  }
  out.push(cur + 'x' + count);
  return out.join(',');
}

function dec(str: string, len: number): Uint16Array {
  const out = new Uint16Array(len);
  if (!str) return out;
  let idx = 0;
  for (const part of str.split(',')) {
    const p = part.indexOf('x');
    if (p < 0) continue;
    const v = Number(part.slice(0, p));
    const c = Number(part.slice(p + 1));
    if (!Number.isFinite(v) || !Number.isFinite(c)) continue;
    const end = Math.min(idx + c, len);
    if (v !== 0) out.fill(v, idx, end);
    idx = end;
    if (idx >= len) break;
  }
  return out;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readIndex(): IndexEntry[] {
  const raw = safeGet(KEY_INDEX);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as IndexEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeIndex(list: IndexEntry[]) {
  safeSet(KEY_INDEX, JSON.stringify(list.slice(0, 40)));
}

export function saveDoc(doc: PatternDoc, thumb: string): boolean {
  const payload: StoredDoc = {
    format: 'perler-studio-local',
    version: 1,
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    pegboard: doc.pegboard,
    notes: doc.notes,
    palette: doc.palette,
    cells: enc(doc.cells),
    progress: enc(doc.progress),
    createdAt: doc.createdAt,
    updatedAt: Date.now(),
  };
  let ok = safeSet(KEY_PREFIX + doc.id, JSON.stringify(payload));
  if (!ok) {
    // 空间不足时，清理最旧的文档后重试一次
    const list = readIndex();
    for (const old of list.slice(8)) {
      try {
        localStorage.removeItem(KEY_PREFIX + old.id);
      } catch {
        /* ignore */
      }
    }
    writeIndex(list.slice(0, 8));
    ok = safeSet(KEY_PREFIX + doc.id, JSON.stringify(payload));
  }
  if (!ok) return false;
  const list = readIndex().filter((e) => e.id !== doc.id);
  list.unshift({
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    updatedAt: Date.now(),
    thumb,
  });
  writeIndex(list);
  return true;
}

export function loadDoc(id: string): PatternDoc | null {
  const raw = safeGet(KEY_PREFIX + id);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as StoredDoc;
    if (p.format !== 'perler-studio-local') return null;
    return {
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      cells: dec(p.cells, p.width * p.height),
      progress: dec(p.progress, p.width * p.height) as unknown as Uint8Array,
      palette: p.palette,
      pegboard: p.pegboard,
      notes: p.notes ?? '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  } catch {
    return null;
  }
}

export function deleteDoc(id: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    /* ignore */
  }
  writeIndex(readIndex().filter((e) => e.id !== id));
}

export function hasAnyLocal(): boolean {
  return readIndex().length > 0;
}
