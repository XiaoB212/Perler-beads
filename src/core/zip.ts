/**
 * 极简 ZIP 打包器（store 模式，不压缩）。
 *
 * 为什么不引第三方库：项目一直坚持「零多余依赖 + 构建产物小」，
 * 而 ZIP 的 store 模式只需要 CRC32 + 几个定长头，写出来不到 150 行。
 * PNG 本身已经压过了，SVG 是文本但量不大，打成 store 包体积并不吃亏。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** 包内路径，用 / 分隔 */
  name: string;
  data: Uint8Array;
}

class ByteSink {
  private parts: Uint8Array[] = [];
  private length = 0;
  bytes(u8: Uint8Array) {
    this.parts.push(u8);
    this.length += u8.length;
  }
  u16(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  get size() {
    return this.length;
  }
  toBlob(type: string): Blob {
    return new Blob(this.parts as BlobPart[], { type });
  }
}

/** DOS 时间：打包时间就用当前时刻，解压后能看到「什么时候导的」 */
function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** 把若干文件打成一个 .zip（store 模式，不压缩） */
export function buildZip(entries: ZipEntry[], when = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const sink = new ByteSink();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const offset = sink.size;
    sink.u32(0x04034b50);
    sink.u16(20); // version needed
    sink.u16(0x0800); // UTF-8 文件名
    sink.u16(0); // store
    sink.u16(time);
    sink.u16(date);
    sink.u32(crc);
    sink.u32(e.data.length);
    sink.u32(e.data.length);
    sink.u16(name.length);
    sink.u16(0);
    sink.bytes(name);
    sink.bytes(e.data);
    central.push({ name, crc, size: e.data.length, offset });
  }

  const cdStart = sink.size;
  for (const c of central) {
    sink.u32(0x02014b50);
    sink.u16(20); // version made by
    sink.u16(20); // version needed
    sink.u16(0x0800);
    sink.u16(0);
    sink.u16(time);
    sink.u16(date);
    sink.u32(c.crc);
    sink.u32(c.size);
    sink.u32(c.size);
    sink.u16(c.name.length);
    sink.u16(0); // extra
    sink.u16(0); // comment
    sink.u16(0); // disk
    sink.u16(0); // internal attrs
    sink.u32(0); // external attrs
    sink.u32(c.offset);
    sink.bytes(c.name);
  }
  const cdSize = sink.size - cdStart;

  sink.u32(0x06054b50);
  sink.u16(0);
  sink.u16(0);
  sink.u16(central.length);
  sink.u16(central.length);
  sink.u32(cdSize);
  sink.u32(cdStart);
  sink.u16(0);

  return sink.toBlob('application/zip');
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
