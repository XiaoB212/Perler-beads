export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function formatNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime = 'application/json') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function safeFileName(name: string): string {
  return (name || 'perler-pattern').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
