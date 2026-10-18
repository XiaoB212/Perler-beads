/**
 * 自动保存与版本备份。
 *
 * 两层：
 * 1. 自动保存 —— 按固定间隔把当前图纸静默写回「我的图纸」，不弹提示、不打断画画。
 * 2. 版本备份 —— 每隔一段时间留一个快照，画崩了可以退回任意一版。
 *    自动快照默认只留 5 个（老的自动删掉），手动留的版本默认不设上限。
 *
 * 全部存在 localStorage，不上传任何东西。空间不够时先丢最老的自动快照再重试。
 */
import type { PatternDoc } from './types';

export interface BackupMeta {
  id: string;
  docId: string;
  docName: string;
  /** 毫秒时间戳 */
  at: number;
  kind: 'auto' | 'manual';
  cells: number;
  placed: number;
  width: number;
  height: number;
  /** 序列化后的体积（字节），用来判断 localStorage 还剩多少空间 */
  bytes: number;
}

export interface AutoSaveConfig {
  /** 是否开启自动保存 */
  enabled: boolean;
  /** 自动保存间隔（毫秒），默认 2 分钟 */
  interval: number;
  /** 是否顺带留版本快照 */
  backup: boolean;
  /** 自动快照保留几个，默认 5 */
  keepAuto: number;
  /** 手动快照保留几个，0 = 不限 */
  keepManual: number;
}

const CFG_KEY = 'perler-studio:autosave';
const IDX_KEY = 'perler-studio:backups';
const BODY_PREFIX = 'perler-studio:backup:';

export const AUTOSAVE_MIN = 10_000;
export const AUTOSAVE_MAX = 30 * 60_000;

export const DEFAULT_AUTOSAVE: AutoSaveConfig = {
  enabled: true,
  interval: 120_000,
  backup: true,
  keepAuto: 5,
  keepManual: 0,
};

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

function safeDel(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 隐私模式下删不掉也无所谓 */
  }
}

export function readAutoSaveConfig(): AutoSaveConfig {
  const raw = safeGet(CFG_KEY);
  if (!raw) return { ...DEFAULT_AUTOSAVE };
  try {
    const j = JSON.parse(raw) as Partial<AutoSaveConfig>;
    return {
      enabled: typeof j.enabled === 'boolean' ? j.enabled : DEFAULT_AUTOSAVE.enabled,
      interval:
        Number.isFinite(Number(j.interval)) && Number(j.interval) > 0
          ? Math.max(AUTOSAVE_MIN, Math.min(AUTOSAVE_MAX, Math.round(Number(j.interval))))
          : DEFAULT_AUTOSAVE.interval,
      backup: typeof j.backup === 'boolean' ? j.backup : DEFAULT_AUTOSAVE.backup,
      keepAuto:
        Number.isFinite(Number(j.keepAuto)) && Number(j.keepAuto) > 0
          ? Math.max(1, Math.min(50, Math.round(Number(j.keepAuto))))
          : DEFAULT_AUTOSAVE.keepAuto,
      keepManual:
        Number.isFinite(Number(j.keepManual)) && Number(j.keepManual) >= 0
          ? Math.max(0, Math.min(200, Math.round(Number(j.keepManual))))
          : DEFAULT_AUTOSAVE.keepManual,
    };
  } catch {
    return { ...DEFAULT_AUTOSAVE };
  }
}

export function writeAutoSaveConfig(cfg: AutoSaveConfig) {
  safeSet(CFG_KEY, JSON.stringify(cfg));
}

export function readBackupIndex(): BackupMeta[] {
  const raw = safeGet(IDX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as BackupMeta[];
    if (!Array.isArray(list)) return [];
    // 索引里可能残留已被清掉的条目（配额清理时整条丢了），顺手过滤
    return list.filter((m) => m && m.id && safeGet(BODY_PREFIX + m.id) !== null);
  } catch {
    return [];
  }
}

function writeBackupIndex(list: BackupMeta[]) {
  // 只留最近 200 条索引，避免索引本身撑爆
  safeSet(IDX_KEY, JSON.stringify(list.slice(0, 200)));
}

interface BackupBody {
  format: 'perler-studio-backup';
  version: 1;
  id: string;
  at: number;
  kind: 'auto' | 'manual';
  doc: {
    id: string;
    name: string;
    width: number;
    height: number;
    pegboard: number;
    notes: string;
    palette: unknown;
    cells: string;
    progress: string;
  };
}

/** 极简 RLE（与 storage.ts 同款，避免循环依赖就各写一份） */
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

function trimByKind(list: BackupMeta[], kind: 'auto' | 'manual', keep: number): BackupMeta[] {
  if (keep <= 0) return list;
  const ofKind = list.filter((m) => m.kind === kind); // 索引按时间倒序
  if (ofKind.length <= keep) return list;
  const drop = new Set(ofKind.slice(keep).map((m) => m.id));
  for (const id of drop) safeDel(BODY_PREFIX + id);
  return list.filter((m) => !drop.has(m.id));
}

/** 存一个版本快照；返回快照 id，失败返回 null */
export function pushBackup(doc: PatternDoc, kind: 'auto' | 'manual'): string | null {
  const cfg = readAutoSaveConfig();
  const at = Date.now();
  const id = `${doc.id}-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const body: BackupBody = {
    format: 'perler-studio-backup',
    version: 1,
    id,
    at,
    kind,
    doc: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      pegboard: doc.pegboard,
      notes: doc.notes,
      palette: doc.palette,
      cells: enc(doc.cells),
      progress: enc(doc.progress),
    },
  };
  const json = JSON.stringify(body);
  let ok = safeSet(BODY_PREFIX + id, json);

  // 空间不够：先扔掉最老的自动快照，再试一次
  if (!ok) {
    let list = readBackupIndex();
    const autos = list.filter((m) => m.kind === 'auto').reverse(); // 从最老开始
    for (const m of autos) {
      safeDel(BODY_PREFIX + m.id);
      list = list.filter((x) => x.id !== m.id);
      if (safeSet(BODY_PREFIX + id, json)) {
        ok = true;
        writeBackupIndex(list);
        break;
      }
    }
    if (!ok) return null;
  }

  let count = 0;
  let placed = 0;
  for (let i = 0; i < doc.cells.length; i++) {
    if (!doc.cells[i]) continue;
    count++;
    if (doc.progress[i]) placed++;
  }
  const meta: BackupMeta = {
    id,
    docId: doc.id,
    docName: doc.name,
    at,
    kind,
    cells: count,
    placed,
    width: doc.width,
    height: doc.height,
    bytes: new Blob([json]).size,
  };
  let list = [meta, ...readBackupIndex().filter((m) => m.id !== id)];
  list = trimByKind(list, 'auto', kind === 'auto' ? Math.max(1, cfg.keepAuto) : cfg.keepAuto);
  list = trimByKind(list, 'manual', cfg.keepManual);
  writeBackupIndex(list);
  return id;
}

export function loadBackup(id: string): PatternDoc | null {
  const raw = safeGet(BODY_PREFIX + id);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as BackupBody;
    if (b.format !== 'perler-studio-backup') return null;
    const d = b.doc;
    const total = d.width * d.height;
    return {
      id: d.id,
      name: d.name,
      width: d.width,
      height: d.height,
      // 还原出来是一份新文档：另给 id，免得覆盖当前正在画的那份
      cells: dec(d.cells, total),
      progress: dec(d.progress, total) as unknown as Uint8Array,
      palette: d.palette as PatternDoc['palette'],
      pegboard: d.pegboard,
      notes: d.notes ?? '',
      createdAt: b.at,
      updatedAt: b.at,
    };
  } catch {
    return null;
  }
}

export function deleteBackup(id: string) {
  safeDel(BODY_PREFIX + id);
  writeBackupIndex(readBackupIndex().filter((m) => m.id !== id));
}

export function clearBackups(docId?: string) {
  const list = readBackupIndex();
  const keep: BackupMeta[] = [];
  for (const m of list) {
    if (docId && m.docId !== docId) keep.push(m);
    else safeDel(BODY_PREFIX + m.id);
  }
  writeBackupIndex(keep);
}

/** 某份图纸的备份，最近的在最前 */
export function backupsOf(docId: string): BackupMeta[] {
  return readBackupIndex()
    .filter((m) => m.docId === docId)
    .sort((a, b) => b.at - a.at);
}

/** 人类可读的「多久以前」 */
export function agoText(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(at).toLocaleDateString();
}
