/** RLE 编解码，用于工程文件体积压缩（重复空/同色单元非常多） */

export function rleEncode(arr: Uint16Array | Uint8Array): string {
  if (arr.length === 0) return '';
  const parts: string[] = [];
  let cur = arr[0];
  let count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur && count < 65535) {
      count++;
    } else {
      parts.push(`${cur}x${count}`);
      cur = arr[i];
      count = 1;
    }
  }
  parts.push(`${cur}x${count}`);
  return parts.join(',');
}

export function rleDecode(str: string, length: number): Uint16Array {
  const out = new Uint16Array(length);
  if (!str) return out;
  let idx = 0;
  for (const part of str.split(',')) {
    const sep = part.indexOf('x');
    if (sep < 0) continue;
    const value = Number(part.slice(0, sep));
    const count = Number(part.slice(sep + 1));
    if (!Number.isFinite(value) || !Number.isFinite(count)) continue;
    const end = Math.min(idx + count, length);
    if (value !== 0) out.fill(value, idx, end);
    idx = end;
    if (idx >= length) break;
  }
  return out;
}

export function rleDecodeU8(str: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (!str) return out;
  let idx = 0;
  for (const part of str.split(',')) {
    const sep = part.indexOf('x');
    if (sep < 0) continue;
    const value = Number(part.slice(0, sep));
    const count = Number(part.slice(sep + 1));
    if (!Number.isFinite(value) || !Number.isFinite(count)) continue;
    const end = Math.min(idx + count, length);
    if (value !== 0) out.fill(value, idx, end);
    idx = end;
    if (idx >= length) break;
  }
  return out;
}
