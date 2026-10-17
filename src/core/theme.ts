/**
 * 主题：亮 / 暗 / 跟随系统。
 * 只做三件事：读写 localStorage、给 <html> 挂 data-theme、给画布提供取色。
 */

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'perler-studio:theme';

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  return 'auto';
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 忽略 */
  }
  applyTheme(mode);
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'auto' ? systemTheme() : mode;
}

export function applyTheme(mode: ThemeMode) {
  const t = resolveTheme(mode);
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  // 移动端浏览器地址栏跟随主题
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#14161a' : '#ffffff');
}

/** 跟随系统切换（只在 mode 为 auto 时生效） */
export function watchSystemTheme() {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemeMode() === 'auto') applyTheme('auto');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** 读取当前主题下的一个 CSS 变量（画布用） */
export function cssVar(name: string, fallback = ''): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 画布配色：随主题变化的一组颜色 */
export interface StageColors {
  board: string;
  boardEdge: string;
  emptyA: string;
  emptyB: string;
  grid: string;
  gridStrong: string;
  hole: string;
  check: string;
  ruler: string;
  rulerBg: string;
  pegboard: string;
  symmetry: string;
  cursor: string;
  shadow: string;
}

export function stageColors(theme: ResolvedTheme): StageColors {
  if (theme === 'light') {
    return {
      board: '#ffffff',
      boardEdge: '#dcdcd4',
      emptyA: '#fdfdfb',
      emptyB: '#f4f4ee',
      grid: 'rgba(20,24,30,0.08)',
      gridStrong: 'rgba(20,24,30,0.22)',
      hole: 'rgba(20,24,30,0.13)',
      check: 'rgba(255,255,255,0.95)',
      ruler: '#8b9099',
      rulerBg: 'rgba(255,255,255,0.9)',
      pegboard: 'rgba(217,84,30,0.5)',
      symmetry: 'rgba(20,140,160,0.5)',
      cursor: 'rgba(20,24,30,0.6)',
      shadow: 'rgba(20,24,30,0.1)',
    };
  }
  return {
    board: '#17191e',
    boardEdge: '#2c3038',
    emptyA: '#1b1e24',
    emptyB: '#15181d',
    grid: 'rgba(255,255,255,0.085)',
    gridStrong: 'rgba(255,255,255,0.22)',
    hole: 'rgba(0,0,0,0.42)',
    check: 'rgba(255,255,255,0.92)',
    ruler: '#6b7280',
    rulerBg: 'rgba(14,16,19,0.9)',
    pegboard: 'rgba(255,138,76,0.5)',
    symmetry: 'rgba(77,212,255,0.5)',
    cursor: 'rgba(255,255,255,0.7)',
    shadow: 'rgba(0,0,0,0.5)',
  };
}
