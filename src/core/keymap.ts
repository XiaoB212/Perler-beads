/**
 * 可自定义快捷键。
 *
 * 键位表存在 localStorage，结构是「动作 id → 键位串」。
 * 键位串统一成小写、修饰键按 ctrl / alt / shift / meta 的顺序拼接，
 * 例如 "b"、"ctrl+z"、"shift+arrowleft"、"ctrl+shift+z"。
 */

export type ActionId =
  // 工具
  | 'tool.pencil'
  | 'tool.eraser'
  | 'tool.bucket'
  | 'tool.line'
  | 'tool.rect'
  | 'tool.ellipse'
  | 'tool.picker'
  | 'tool.pan'
  // 键盘绘画
  | 'cursor.up'
  | 'cursor.down'
  | 'cursor.left'
  | 'cursor.right'
  | 'cursor.paint'
  | 'cursor.erase'
  // 颜色与画笔
  | 'color.prev'
  | 'color.next'
  | 'brush.thinner'
  | 'brush.thicker'
  // 视图
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fit'
  | 'view.progress'
  | 'view.online'
  | 'view.grid'
  | 'view.pegboard'
  | 'view.boardIds'
  | 'view.codes'
  | 'view.symmetryX'
  | 'view.symmetryY'
  // 分板
  | 'board.focus'
  | 'board.next'
  | 'board.prev'
  // 文件与编辑
  | 'edit.undo'
  | 'edit.redo'
  | 'file.save'
  | 'file.export'
  | 'file.import'
  | 'file.new'
  | 'help'
  | 'escape';

export interface ActionDef {
  id: ActionId;
  group: string;
  label: string;
  /** 默认键位，空字符串表示默认没有绑定 */
  def: string;
}

/** 全部动作与默认键位（顺序即展示顺序） */
export const ACTIONS: ActionDef[] = [
  { id: 'tool.pencil', group: '工具', label: '画笔', def: 'b' },
  { id: 'tool.eraser', group: '工具', label: '橡皮', def: 'e' },
  { id: 'tool.bucket', group: '工具', label: '填充', def: 'g' },
  { id: 'tool.line', group: '工具', label: '直线', def: 'l' },
  { id: 'tool.rect', group: '工具', label: '矩形', def: 'r' },
  { id: 'tool.ellipse', group: '工具', label: '椭圆', def: 'o' },
  { id: 'tool.picker', group: '工具', label: '吸管', def: 'i' },
  { id: 'tool.pan', group: '工具', label: '平移', def: 'h' },

  { id: 'cursor.up', group: '键盘绘画', label: '光标上移', def: 'arrowup' },
  { id: 'cursor.down', group: '键盘绘画', label: '光标下移', def: 'arrowdown' },
  { id: 'cursor.left', group: '键盘绘画', label: '光标左移', def: 'arrowleft' },
  { id: 'cursor.right', group: '键盘绘画', label: '光标右移', def: 'arrowright' },
  { id: 'cursor.paint', group: '键盘绘画', label: '在光标格落笔', def: 'enter' },
  { id: 'cursor.erase', group: '键盘绘画', label: '清除光标格', def: 'delete' },

  { id: 'color.prev', group: '颜色', label: '上一个色号', def: ',' },
  { id: 'color.next', group: '颜色', label: '下一个色号', def: '.' },
  { id: 'brush.thinner', group: '颜色', label: '画笔变细', def: '[' },
  { id: 'brush.thicker', group: '颜色', label: '画笔变粗', def: ']' },

  { id: 'view.zoomIn', group: '视图', label: '放大', def: '=' },
  { id: 'view.zoomOut', group: '视图', label: '缩小', def: '-' },
  { id: 'view.fit', group: '视图', label: '适应窗口', def: '0' },
  { id: 'view.progress', group: '视图', label: '进度模式', def: 'p' },
  { id: 'view.online', group: '视图', label: '线上拼豆模式', def: 'shift+o' },
  { id: 'view.grid', group: '视图', label: '网格线', def: ';' },
  { id: 'view.pegboard', group: '视图', label: '拼豆板分界', def: '' },
  { id: 'view.boardIds', group: '视图', label: '板号标签', def: '' },
  { id: 'view.symmetryX', group: '视图', label: '左右对称', def: 'x' },
  { id: 'view.symmetryY', group: '视图', label: '上下对称', def: 'y' },
  { id: 'view.codes', group: '视图', label: '显示色号', def: 'c' },

  { id: 'board.focus', group: '分板', label: '聚焦光标所在的板', def: 'f' },
  { id: 'board.next', group: '分板', label: '下一块板', def: 'pagedown' },
  { id: 'board.prev', group: '分板', label: '上一块板', def: 'pageup' },

  { id: 'edit.undo', group: '文件与编辑', label: '撤销', def: 'ctrl+z' },
  { id: 'edit.redo', group: '文件与编辑', label: '重做', def: 'ctrl+shift+z' },
  { id: 'file.save', group: '文件与编辑', label: '保存到本地', def: 'ctrl+s' },
  { id: 'file.export', group: '文件与编辑', label: '打开导出', def: 'ctrl+e' },
  { id: 'file.import', group: '文件与编辑', label: '图片转图纸', def: 'ctrl+o' },
  { id: 'file.new', group: '文件与编辑', label: '新建图纸', def: 'n' },
  { id: 'help', group: '文件与编辑', label: '快捷键表', def: '?' },
  { id: 'escape', group: '文件与编辑', label: '关闭弹窗', def: 'escape' },
];

const KEY = 'perler-studio:keymap';

export type KeyMap = Record<string, string>;

export const DEFAULT_KEYMAP: KeyMap = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));

/** 键位串的展示文本（kbd 用） */
export function keyLabel(binding: string): string[] {
  if (!binding) return ['—'];
  const parts = binding.split('+').map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
    if (p === 'ctrl' || p === 'meta') return 'Ctrl';
    if (p === 'alt') return 'Alt';
    if (p === 'shift') return 'Shift';
    if (p === 'arrowup') return '↑';
    if (p === 'arrowdown') return '↓';
    if (p === 'arrowleft') return '←';
    if (p === 'arrowright') return '→';
    if (p === 'escape') return 'Esc';
    if (p === 'delete') return 'Del';
    if (p === 'backspace') return '⌫';
    if (p === 'enter') return 'Enter';
    if (p === 'space') return '空格';
    if (p === 'tab') return 'Tab';
    if (p === 'pageup') return 'PgUp';
    if (p === 'pagedown') return 'PgDn';
    if (p === ' ') return '空格';
    if (p.length === 1) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  });
}

/** 事件 → 规范化键位串 */
export function eventToBinding(e: KeyboardEvent | React.KeyboardEvent): string {
  const k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  // shift 不在这里加：要看最终是不是「字符键」，见下面
  // 带 Shift 时 e.key 是大写字母 / 符号，统一回小写基础键
  const code = e.code;
  let base = k.toLowerCase();
  if (/(^|\.)(Key[A-Z])$/.test(code) || /^Digit\d$/.test(code) || /^Numpad\d$/.test(code)) {
    base = code.replace(/^.*?Key([A-Z])$/, '$1').replace(/^(Digit|Numpad)(\d)$/, '$2').toLowerCase();
  } else if (k === ' ') {
    base = 'space';
  }
  // 符号键上的 Shift 只是「打出这个符号的方式」，不算独立修饰键：
  // 按 ? 就是 "?"，按 + 就是 "="，否则永远对不上默认键位。
  // 只有 Shift + 字母 / 数字 / 方向键 / F 键这类才真正带 shift。
  if (base === '+') base = '=';
  else if (base === '_') base = '-';
  const isNamed = base.length > 1;
  const isAlnum = /^[a-z0-9]$/.test(base);
  if (e.shiftKey && (isNamed || isAlnum)) parts.push('shift');

  parts.push(base);
  return parts.join('+');
}
export function loadKeymap(): KeyMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_KEYMAP };
    const parsed = JSON.parse(raw) as KeyMap;
    // 缺失的动作回落默认值（版本升级后新增动作不会变空）
    const out: KeyMap = { ...DEFAULT_KEYMAP };
    for (const a of ACTIONS) {
      if (typeof parsed[a.id] === 'string') out[a.id] = parsed[a.id];
    }
    return out;
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(map: KeyMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
}

/** 键位串 → 动作 id（找不到返回 null） */
export function resolveAction(binding: string, map: KeyMap): ActionId | null {
  if (!binding) return null;
  for (const a of ACTIONS) {
    if (map[a.id] === binding) return a.id;
  }
  // Shift 只当「加速」：Shift+方向键仍命中方向键动作
  if (binding.startsWith('shift+')) {
    const bare = binding.slice(6);
    for (const a of ACTIONS) {
      if (map[a.id] === bare) return a.id;
    }
  }
  return null;
}

/** 冲突检测：返回同一个键位上的其他动作 */
export function conflictedActions(binding: string, map: KeyMap, except: ActionId): ActionId[] {
  if (!binding) return [];
  const out: ActionId[] = [];
  for (const a of ACTIONS) {
    if (a.id !== except && map[a.id] === binding) out.push(a.id);
  }
  return out;
}

export function actionLabel(id: string): string {
  return ACTIONS.find((a) => a.id === id)?.label ?? id;
}
