import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from './core/store';
import { applyTheme, getThemeMode, resolveTheme, setThemeMode as setThemeModePersist, watchSystemTheme, type ThemeMode } from './core/theme';
import CanvasStage from './components/CanvasStage';
import ColorPanel from './components/ColorPanel';
import UsagePanel from './components/UsagePanel';
import SettingsPanel from './components/SettingsPanel';
import ColorManager from './components/ColorManager';
import ImportDialog, { type ImportSeed, type MaskTool } from './components/ImportDialog';
import ExportDialog from './components/ExportDialog';
import NewCanvasDialog from './components/NewCanvasDialog';
import ProjectsDialog from './components/ProjectsDialog';
import ShortcutsDialog from './components/ShortcutsDialog';
import WelcomeDialog from './components/WelcomeDialog';
import CornerBadge from './components/CornerBadge';
import {
  IconBoard,
  IconBucket,
  IconChart,
  IconCheck,
  IconEllipse,
  IconEraser,
  IconFile,
  IconFolder,
  IconGrid,
  IconHand,
  IconImage,
  IconKeyboard,
  IconLayers,
  IconLine,
  IconMenu,
  IconPalette,
  IconPencil,
  IconPicker,
  IconPlus,
  IconRect,
  IconRedo,
  IconSettings,
  IconSparkle,
  IconSun,
  IconMoon,
  IconUndo,
  IconUpload,
  IconWand,
  IconBook,
} from './components/Icons';
import type { Tool } from './core/types';
import { eventToBinding, keyLabel, loadKeymap, resolveAction, type KeyMap } from './core/keymap';
import { docToThumb, parseProject, totalBeads } from './core/export';
import { readIndex, saveDoc } from './core/storage';
import {
  AUTOSAVE_MAX,
  AUTOSAVE_MIN,
  pushBackup,
  readAutoSaveConfig,
  writeAutoSaveConfig,
  type AutoSaveConfig,
} from './core/backup';
import { boardCount } from './core/board';
import { DEFAULT_PALETTE_KEY, palettePreset } from './core/palette';
import { decodeShare, progressStat } from './core/share';
import { noticeSeen } from './core/announce';
import { RAIL_DEFAULTS, clearRailOrder, moveRailItem, readRailOrder, writeRailOrder } from './core/rail';

type Dialog = null | 'new' | 'import' | 'export' | 'projects' | 'colors' | 'keys' | 'welcome';
type SideTab = 'colors' | 'usage' | 'settings';

/** 右侧面板宽度：可拖拽调整，拖完记在本地，下次打开还是这个宽度 */
const SIDE_W_KEY = 'perler-studio:side-width';
const SIDE_W_MIN = 240;
const SIDE_W_MAX = 620;
function readSideWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDE_W_KEY));
    if (Number.isFinite(n) && n >= SIDE_W_MIN && n <= SIDE_W_MAX) return Math.round(n);
  } catch {
    /* 隐私模式下 localStorage 会抛异常，用默认值即可 */
  }
  return 300;
}

const TOOLS: {
  key: Tool;
  label: string;
  icon: (p: { width: number; height: number }) => JSX.Element;
}[] = [
  { key: 'pencil', label: '画笔', icon: (p) => <IconPencil {...p} /> },
  { key: 'eraser', label: '橡皮', icon: (p) => <IconEraser {...p} /> },
  { key: 'bucket', label: '填充', icon: (p) => <IconBucket {...p} /> },
  { key: 'line', label: '直线', icon: (p) => <IconLine {...p} /> },
  { key: 'rect', label: '矩形', icon: (p) => <IconRect {...p} /> },
  { key: 'ellipse', label: '椭圆', icon: (p) => <IconEllipse {...p} /> },
  { key: 'picker', label: '吸管', icon: (p) => <IconPicker {...p} /> },
  { key: 'pan', label: '平移', icon: (p) => <IconHand {...p} /> },
];

/** 工具按钮的提示：键位从可自定义键位表里取，改了键位提示也跟着变 */
function toolHint(keymap: KeyMap, tool: Tool): string {
  const bound = keymap[`tool.${tool}`];
  return bound ? ` (${keyLabel(bound).join('+')})` : '';
}

/** 左侧功能列表的一行：工具、开关、还是打开某个对话框 */
interface RailItem {
  id: string;
  label: string;
  group: 'tool' | 'action' | 'file';
  icon: (p: { width: number; height: number }) => JSX.Element;
  active: boolean;
  title: string;
  run: () => void;
}

export default function App() {
  const doc = useEditor((s) => s.doc);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const dirty = useEditor((s) => s.dirty);
  const toast = useEditor((s) => s.toast);
  const renameDoc = useEditor((s) => s.renameDoc);
  const flags = useEditor((s) => s.flags);
  const toggleFlag = useEditor((s) => s.toggleFlag);
const setOnlineMode = useEditor((s) => s.setOnlineMode);
  const loadDocument = useEditor((s) => s.loadDocument);
  const notify = useEditor((s) => s.notify);
  const brushSize = useEditor((s) => s.brushSize);
  const setBrushSize = useEditor((s) => s.setBrushSize);
  const colorIndexSel = useEditor((s) => s.colorIndex);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const setZoom = useEditor((s) => s.setZoom);
  const requestFit = useEditor((s) => s.requestFit);
  const [keymap, setKeymap] = useState<KeyMap>(() => loadKeymap());

  const [dialog, setDialog] = useState<Dialog>(null);
  const [colorManagerTab, setColorManagerTab] = useState<'doc' | 'preset' | 'io'>('doc');
  const [tab, setTab] = useState<SideTab>('colors');
  const [sheet, setSheet] = useState<null | SideTab>(null);
  const [titleDraft, setTitleDraft] = useState(doc.name);
  const [dropped, setDropped] = useState<File | null>(null);
  /** 上次生成图纸时用的图片和参数：支持「重调图片」二次编辑 */
  const [lastSeed, setLastSeed] = useState<ImportSeed | null>(null);
  const [seedForOpen, setSeedForOpen] = useState<ImportSeed | null>(null);
  /** 从「抠图」按钮进来时直接落在魔棒上 */
  const [importTool, setImportTool] = useState<MaskTool>('move');
  const openImport = useCallback((seed: ImportSeed | null = null, tool: MaskTool = 'move') => {
    setSeedForOpen(seed);
    setImportTool(tool);
    setDialog('import');
  }, []);
  /** 左侧功能列表的顺序（可在设置里调） */
  /** 公告弹窗先看哪一页：公告 or 新手手册 */
  const [welcomeTab, setWelcomeTab] = useState<'notice' | 'guide'>('notice');
  const openWelcome = useCallback((tab: 'notice' | 'guide') => {
    setWelcomeTab(tab);
    setDialog('welcome');
  }, []);
  const [railOrder, setRailOrderState] = useState<string[]>(() => readRailOrder());
  const setRailOrder = useCallback((next: string[]) => {
    setRailOrderState(next);
    writeRailOrder(next);
  }, []);
  /** 第一次打开（或升到新版本）自动弹公告，点过「不再提示」就不会再弹 */
  useEffect(() => {
    if (!noticeSeen()) setDialog((cur) => cur ?? 'welcome');
  }, []);
  const [dragOver, setDragOver] = useState(false);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  const [resolved, setResolved] = useState(() => resolveTheme(getThemeMode()));
  const [sideW, setSideW] = useState(() => readSideWidth());
  const sideDragRef = useRef<{ x: number; w: number; next: number } | null>(null);
  // 自动保存与版本：配置存 localStorage，改了立刻生效，不用刷新
  const [autoSave, setAutoSave] = useState<AutoSaveConfig>(() => readAutoSaveConfig());
  const [autoSavedAt, setAutoSavedAt] = useState(0);
  const updateAutoSave = useCallback((patch: Partial<AutoSaveConfig>) => {
    setAutoSave((cur) => {
      const next = { ...cur, ...patch };
      if (Number.isFinite(next.interval)) {
        next.interval = Math.max(AUTOSAVE_MIN, Math.min(AUTOSAVE_MAX, Math.round(next.interval)));
      }
      writeAutoSaveConfig(next);
      return next;
    });
  }, []);
  const saveNow = useCallback(() => {
    const s = useEditor.getState();
    const d = s.doc;
    const ok = saveDoc(d, docToThumb(d, 200));
    if (ok) {
      s.markClean();
      setAutoSavedAt(Date.now());
      notify('已保存到本地');
    } else {
      notify('本地空间不足，先删掉几份旧图纸', 'warn');
    }
  }, [notify]);

  useEffect(() => setTitleDraft(doc.name), [doc.name, doc.id]);

  // 拖动右侧面板左边缘调宽度：只改 CSS 变量，不触发画布重排逻辑
  const onSideResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      sideDragRef.current = { x: e.clientX, w: sideW, next: sideW };
    },
    [sideW],
  );
  const onSideResizeMove = useCallback((e: React.PointerEvent) => {
    const d = sideDragRef.current;
    if (!d) return;
    const next = Math.max(SIDE_W_MIN, Math.min(SIDE_W_MAX, d.w - (e.clientX - d.x)));
    // 记在 ref 里：pointerup 时读的 sideW 可能是这一帧之前的旧值
    d.next = next;
    setSideW(next);
  }, []);
  const onSideResizeUp = useCallback((e: React.PointerEvent) => {
    const d = sideDragRef.current;
    if (!d) return;
    sideDragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    try {
      localStorage.setItem(SIDE_W_KEY, String(Math.round(d.next)));
    } catch {
      /* 忽略写入失败 */
    }
  }, []);

  // 主题：写 localStorage + 挂 <html data-theme>，并跟随系统切换
  const setThemeMode = useCallback((m: ThemeMode) => {
    setThemeModeState(m);
    setThemeModePersist(m);
  }, []);

  useEffect(() => {
    applyTheme(themeMode);
    setResolved(resolveTheme(themeMode));
    return watchSystemTheme();
  }, [themeMode]);

  const cycleTheme = useCallback(() => {
    setThemeMode(themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto');
  }, [setThemeMode, themeMode]);

  const themeTitle = themeMode === 'auto' ? '跟随系统' : themeMode === 'light' ? '亮色' : '暗色';

  const beadCount = useMemo(() => totalBeads(doc), [doc]);
  // 按当前单板格数切出来的实体板数量（0 = 不分板）
  const boardTotal = useMemo(
    () => (doc.pegboard > 0 ? boardCount(doc.width, doc.height, doc.pegboard) : 0),
    [doc.width, doc.height, doc.pegboard],
  );

  // 首次访问：读取本地最近文档
  useEffect(() => {
    const idx = readIndex();
    if (idx.length) {
      // 不自动加载，避免覆盖用户预期；仅在标题处提示
    }
  }, []);

  // 分享链接（#p=…）：打开就能看到对方拼到哪儿了。
  // 首次挂载要处理，另外粘到已经打开的页面里只会触发 hashchange、不会重载，
  // 所以两种时机都要接。
  useEffect(() => {
    let cancelled = false;
    const open = async (hash: string) => {
      const shared = await decodeShare(hash);
      if (cancelled) return;
      if (shared) {
        const pal = shared.palette.length ? shared.palette : palettePreset(DEFAULT_PALETTE_KEY);
        const now = Date.now();
        loadDocument({
          id: `share-${now.toString(36)}`,
          name: shared.name,
          width: shared.width,
          height: shared.height,
          pegboard: shared.pegboard,
          palette: pal,
          cells: shared.cells,
          progress: shared.progress,
          createdAt: now,
          updatedAt: shared.updatedAt || now,
          notes: '',
        });
        const stat = progressStat(shared.cells, shared.progress);
        notify(`已打开分享的图纸「${shared.name}」· 拼了 ${stat.placed} / ${stat.total} 颗`, 'ok');
      } else {
        notify('这个分享链接读不出来（链接可能被截断了）', 'warn');
      }
      // 读完就把 hash 清掉，之后的编辑与自动保存才不会被链接反复覆盖
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    const check = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#p=')) void open(hash);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', check);
    };
  }, [loadDocument, notify]);

  // 自动保存：默认每 2 分钟静默存一次（不弹提示，只在顶部状态区亮个小点）。
  // 以前是每次改动 2.6 秒就写 localStorage，大图纸上画画会卡；现在攒够间隔再落盘。
  // 同时按配置留版本快照，画崩了能退回任意一版。
  useEffect(() => {
    if (!autoSave.enabled) return;
    const tick = () => {
      const s = useEditor.getState();
      if (!s.dirty) return;
      const d = s.doc;
      try {
        const ok = saveDoc(d, docToThumb(d, 200));
        if (ok) s.markClean();
        setAutoSavedAt(Date.now());
      } catch {
        /* 配额满了就算了，不打断画画 */
      }
      if (autoSave.backup) pushBackup(d, 'auto');
    };
    // 页面隐藏时补存一次，避免关机前那段没写到
    const onHide = () => {
      if (document.visibilityState === 'hidden') tick();
    };
    const id = window.setInterval(tick, Math.max(AUTOSAVE_MIN, autoSave.interval));
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [autoSave.enabled, autoSave.interval, autoSave.backup]);

  // 全局拖拽落图：图片 → 以图生图；.perler.json → 直接打开工程
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth++;
      setDragOver(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (/\.json$/i.test(f.name)) {
        const reader = new FileReader();
        reader.onload = () => {
          const d = parseProject(String(reader.result));
          if (!d) {
            notify('不是有效的工程文件', 'warn');
            return;
          }
          loadDocument(d);
          notify(`已打开「${d.name}」`);
        };
        reader.readAsText(f);
        return;
      }
      if (f.type.startsWith('image/')) {
        setDropped(f);
        setSeedForOpen(null);
        setDialog('import');
        return;
      }
      notify('只支持图片或 .perler.json 工程文件', 'warn');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [loadDocument, notify]);

  // ===== 快捷键：全部走可自定义键位表 =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest('input,textarea,select,[contenteditable="true"]')) return;
      const binding = eventToBinding(e);
      if (!binding) return;
      const action = resolveAction(binding, keymap);
      if (!action) {
        // 数字键选色是动态的（色号数量不固定），不占键位表
        if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
          const idx = Number(e.key) - 1;
          if (idx < doc.palette.length) {
            e.preventDefault();
            setColorIndex(idx);
            notify(`${doc.palette[idx].code} ${doc.palette[idx].name}`);
          }
        }
        return;
      }
      const s = useEditor.getState();
      switch (action) {
        case 'escape':
          setDialog(null);
          setSheet(null);
          setDropped(null);
          return;
        case 'help':
          e.preventDefault();
          setDialog((d) => (d === 'keys' ? null : 'keys'));
          return;
        case 'edit.undo':
          e.preventDefault();
          undo();
          return;
        case 'edit.redo':
          e.preventDefault();
          redo();
          return;
        case 'file.save': {
          e.preventDefault();
          saveNow();
          return;
        }
        case 'file.export':
          e.preventDefault();
          setDialog('export');
          return;
        case 'file.import':
          e.preventDefault();
          setDropped(null);
          setSeedForOpen(null);
          setDialog('import');
          return;
        case 'file.new':
          e.preventDefault();
          setDialog('new');
          return;
        case 'tool.pencil':
        case 'tool.eraser':
        case 'tool.bucket':
        case 'tool.line':
        case 'tool.rect':
        case 'tool.ellipse':
        case 'tool.picker':
        case 'tool.pan':
          e.preventDefault();
          setTool(action.slice(5) as Tool);
          return;
        case 'cursor.up':
          e.preventDefault();
          s.moveCursor(0, -1, e.shiftKey ? 5 : 1);
          return;
        case 'cursor.down':
          e.preventDefault();
          s.moveCursor(0, 1, e.shiftKey ? 5 : 1);
          return;
        case 'cursor.left':
          e.preventDefault();
          s.moveCursor(-1, 0, e.shiftKey ? 5 : 1);
          return;
        case 'cursor.right':
          e.preventDefault();
          s.moveCursor(1, 0, e.shiftKey ? 5 : 1);
          return;
        case 'cursor.paint':
          e.preventDefault();
          s.paintAtCursor(false);
          return;
        case 'cursor.erase':
          e.preventDefault();
          s.paintAtCursor(true);
          return;
        case 'color.prev':
        case 'color.next': {
          e.preventDefault();
          const n = s.doc.palette.length;
          if (!n) return;
          s.setColorIndex((s.colorIndex + (action === 'color.prev' ? -1 : 1) + n) % n);
          return;
        }
        case 'brush.thinner':
          e.preventDefault();
          s.setBrushSize(s.brushSize - 1);
          return;
        case 'brush.thicker':
          e.preventDefault();
          s.setBrushSize(s.brushSize + 1);
          return;
        case 'view.zoomIn':
          e.preventDefault();
          s.setZoom(s.zoom * 1.25);
          return;
        case 'view.zoomOut':
          e.preventDefault();
          s.setZoom(s.zoom / 1.25);
          return;
        case 'view.fit':
          e.preventDefault();
          requestFit();
          return;
        case 'view.progress':
          toggleFlag('progressMode');
          return;
        case 'view.online':
          setOnlineMode(!useEditor.getState().flags.onlineMode);
          return;
        case 'view.grid':
          toggleFlag('grid');
          return;
        case 'view.symmetryX':
          toggleFlag('symmetryX');
          return;
        case 'view.symmetryY':
          toggleFlag('symmetryY');
          return;
        case 'view.codes':
          toggleFlag('showCodes');
          return;
        case 'view.pegboard':
          toggleFlag('pegboard');
          return;
        case 'view.boardIds':
          toggleFlag('boardIds');
          return;
        case 'board.focus': {
          e.preventDefault();
          const at = s.hover ?? { x: Math.floor(s.doc.width / 2), y: Math.floor(s.doc.height / 2) };
          if (s.doc.pegboard <= 0) {
            notify('先把拼豆板格数设成 14 / 29 / 48 才能聚焦单块板', 'warn');
            return;
          }
          s.focusOnCell(at.x, at.y);
          return;
        }
        case 'board.next':
        case 'board.prev': {
          e.preventDefault();
          if (s.doc.pegboard <= 0) {
            notify('先把拼豆板格数设成 14 / 29 / 48 才能切换板', 'warn');
            return;
          }
          s.stepFocus(action === 'board.next' ? 1 : -1);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setTool, notify, toggleFlag, doc.palette, setColorIndex, requestFit, keymap, saveNow]);

  const colorIndex = useEditor((s) => s.colorIndex);
  const cur = doc.palette[colorIndex];
  const soloColor = useEditor((s) => s.soloColor);

  const openWand = useCallback(() => openImport(lastSeed, 'wandCut'), [openImport, lastSeed]);

  /** 左侧功能列表：顺序由用户自己定（设置 → 功能列表顺序），新条目自动补到末尾 */
  const railItems = useMemo<RailItem[]>(() => {
    const toolById = new Map(TOOLS.map((t) => [t.key as string, t]));
    const out: RailItem[] = [];
    for (const id of railOrder) {
      const def = RAIL_DEFAULTS.find((d) => d.id === id);
      if (!def) continue;
      const t = toolById.get(id);
      if (t) {
        out.push({
          id,
          label: def.label,
          group: def.group,
          icon: t.icon,
          active: tool === t.key,
          title: `${t.label}${toolHint(keymap, t.key)}`,
          run: () => setTool(t.key),
        });
        continue;
      }
      const base = { id, label: def.label, group: def.group };
      switch (id) {
        case 'wand':
          out.push({
            ...base,
            icon: (p) => <IconWand {...p} />,
            active: false,
            title: '抠图 / 魔法棒：打开图片转图纸，用魔棒点一片、框选一块，把背景抠掉再生成图纸',
            run: openWand,
          });
          break;
        case 'progress':
          out.push({
            ...base,
            icon: (p) => <IconCheck {...p} />,
            active: flags.progressMode,
            title: '进度模式：点击勾选已拼好的豆子 (P)',
            run: () => toggleFlag('progressMode'),
          });
          break;
        case 'online':
          out.push({
            ...base,
            icon: (p) => <IconSparkle {...p} />,
            active: flags.onlineMode,
            title: '线上拼豆模式：对色判对错 + 单色高亮 + 进度环 + 分享链接',
            run: () => setOnlineMode(!flags.onlineMode),
          });
          break;
        case 'grid':
          out.push({
            ...base,
            icon: (p) => <IconGrid {...p} />,
            active: flags.grid,
            title: '网格线 (G)',
            run: () => toggleFlag('grid'),
          });
          break;
        case 'symmetry':
          out.push({
            ...base,
            icon: (p) => <IconLayers {...p} />,
            active: flags.symmetryX,
            title: '左右对称 (X)',
            run: () => toggleFlag('symmetryX'),
          });
          break;
        case 'colors':
          out.push({
            ...base,
            icon: (p) => <IconPalette {...p} />,
            active: false,
            title: '色号管理：改色、换色、导入导出色板',
            run: () => {
              setColorManagerTab('doc');
              setDialog('colors');
            },
          });
          break;
        case 'projects':
          out.push({
            ...base,
            icon: (p) => <IconBoard {...p} />,
            active: false,
            title: '我的图纸',
            run: () => setDialog('projects'),
          });
          break;
        case 'guide':
          out.push({
            ...base,
            icon: (p) => <IconBook {...p} />,
            active: false,
            title: '新手手册 / 更新公告',
            run: () => openWelcome('guide'),
          });
          break;
        default:
          break;
      }
    }
    return out;
  }, [railOrder, tool, keymap, flags, openWand, openWelcome]);

  const sideBody = (t: SideTab) => {
    if (t === 'colors')
      return (
        <ColorPanel
          onOpenManager={(tab) => {
            setColorManagerTab(tab ?? 'doc');
            setDialog('colors');
          }}
        />
      );
    if (t === 'usage') return <UsagePanel />;
    return (
      <SettingsPanel
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        autoSave={autoSave}
        onAutoSaveChange={updateAutoSave}
        onSaveNow={saveNow}
        autoSavedAt={autoSavedAt}
        railOrder={railOrder}
        onRailOrder={setRailOrder}
        onOpenGuide={() => openWelcome('guide')}
        onOpenNotice={() => openWelcome('notice')}
      />
    );
  };

  return (
    <>
      <div className="app-bg" />
      <div className="app">
        {/* ============ 顶栏 ============ */}
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="brand-text">
              <b>拼豆工作室</b>
              <span>
                Perler Studio
                <em className="brand-ver" title={`构建于 ${__APP_BUILD__}`}>
                  v{__APP_VERSION__}
                </em>
              </span>
            </div>
          </div>

          <div className="doc-title-wrap">
            <input
              className="doc-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => titleDraft.trim() && renameDoc(titleDraft.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              spellCheck={false}
            />
            <span className="doc-size">
              {doc.width}×{doc.height}
            </span>
            {dirty && <span className="dirty-dot" title="有未保存的修改" />}
          </div>

          <div className="header-spacer" />

          <div className="header-actions">
            <button className="btn ghost icon hide-md" title="撤销 (Ctrl+Z)" onClick={undo} disabled={!past.length}>
              <IconUndo width={16} height={16} />
            </button>
            <button className="btn ghost icon hide-md" title="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={!future.length}>
              <IconRedo width={16} height={16} />
            </button>
            <div className="vdivider hide-md" />
            <button
              className="btn ghost icon"
              onClick={cycleTheme}
              title={`主题：${themeTitle}（点击切换）`}
              aria-label="切换主题"
            >
              {resolved === 'dark' ? <IconMoon width={15} height={15} /> : <IconSun width={15} height={15} />}
            </button>
            <div className="vdivider hide-md" />
            <button
              className="btn ghost icon hide-md"
              onClick={() => setDialog('keys')}
              title="快捷键 (?)"
              aria-label="快捷键"
            >
              <IconKeyboard width={16} height={16} />
            </button>
            <button className="btn sm hide-sm" onClick={() => setDialog('new')} title="新建图纸 (N)">
              <IconPlus width={13} height={13} /> 新建
            </button>
            <button
              className="btn sm hide-sm"
              onClick={() => openImport()}
              title="图片转图纸 (Ctrl+O) — 载入后可以框选 / 魔棒 / 笔刷抠图"
            >
              <IconImage width={13} height={13} /> 图片转图纸
            </button>
            {lastSeed && (
              <button
                className="btn sm hide-sm"
                onClick={() => openImport(lastSeed)}
                title="回到上次的图片，重新选范围 / 重新抠图（生成后不满意就点这里）"
              >
                <IconWand width={13} height={13} /> 重调图片
              </button>
            )}
            <button className="btn sm hide-sm" onClick={() => setDialog('projects')} title="我的图纸">
              <IconFolder width={13} height={13} /> 图纸
            </button>
            <button className="btn sm primary" onClick={() => setDialog('export')} title="导出 (Ctrl+E)">
              <IconUpload width={13} height={13} /> 导出
            </button>
          </div>
        </header>

        {/* ============ 主区 ============ */}
        <div className="main">
          <nav className="rail">
            {railItems.map((it, i) => (
              <Fragment key={it.id}>
                {i > 0 && railItems[i - 1].group !== it.group && <div className="rail-sep" />}
                <button
                  className={'rail-btn' + (it.active ? ' active' : '')}
                  onClick={it.run}
                  title={it.title}
                >
                  <it.icon width={17} height={17} />
                  <span className="rail-label">{it.label}</span>
                </button>
              </Fragment>
            ))}
          </nav>

          <div className="workspace">
            <CanvasStage doc={doc} theme={resolved} />

            {beadCount === 0 && (
              <div className="empty-state">
                <div className="empty-card">
                  <div className="empty-mark">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <h3>从一张图片开始，或者直接落笔</h3>
                  <p>
                    导入照片自动生成拼豆图纸，也可以选个颜色在网格上慢慢画。
                    所有数据只保存在你的浏览器里，不上传任何服务器。
                  </p>
                  <div className="empty-actions">
                    <button className="btn primary" onClick={() => openImport()}>
                      <IconImage width={14} height={14} /> 图片转图纸
                    </button>
                    <button className="btn" onClick={() => setDialog('projects')}>
                      <IconFolder width={14} height={14} /> 打开我的图纸
                    </button>
                  </div>
                  <div className="empty-tips">
                    <span><span className="kbd">B</span> 画笔</span>
                    <span><span className="kbd">G</span> 填充</span>
                    <span><span className="kbd">P</span> 进度模式</span>
                    <span><span className="kbd">Ctrl</span>+滚轮缩放</span>
                  </div>
                </div>
              </div>
            )}

            <div className="stage-topbar">
              {cur && (
                <span
                  className={'tbar-chip current-color' + (soloColor !== null ? ' on' : '')}
                  title={
                    soloColor !== null
                      ? `正在拼：${cur.brand} ${cur.code} ${cur.name}（单色模式）`
                      : `正在拼：${cur.brand} ${cur.code} ${cur.name}`
                  }
                >
                  <i className="cc-dot" style={{ background: cur.hex }} />
                  <b className="cc-code">{cur.code}</b>
                  <span className="cc-name">{cur.name}</span>
                  {soloColor !== null && <em className="cc-solo">单色</em>}
                </span>
              )}
              <button
                className={'tbar-chip' + (flags.progressMode ? ' on' : '')}
                onClick={() => toggleFlag('progressMode')}
                title="进度模式：点格子打个勾，只记「拼了没」"
              >
                <IconCheck width={12} height={12} /> 进度
              </button>
              <button
                className={'tbar-chip' + (flags.onlineMode ? ' on' : '')}
                onClick={() => setOnlineMode(!flags.onlineMode)}
                title="线上拼豆模式：照着图纸一颗颗拼，带对色判对错、单色高亮、进度环和分享链接"
              >
                <IconSparkle width={12} height={12} /> 线上
              </button>
              <button className={'tbar-chip' + (flags.grid ? ' on' : '')} onClick={() => toggleFlag('grid')}>
                <IconGrid width={12} height={12} /> 网格
              </button>
              <button className={'tbar-chip' + (flags.symmetryX ? ' on' : '')} onClick={() => toggleFlag('symmetryX')}>
                对称X
              </button>
              <button className={'tbar-chip' + (flags.symmetryY ? ' on' : '')} onClick={() => toggleFlag('symmetryY')}>
                对称Y
              </button>
              <button
                className={'tbar-chip' + (flags.showCodes ? ' on' : '')}
                onClick={() => toggleFlag('showCodes')}
                title="在每颗豆子上显示色号，放大到 120% 以上才看得清"
              >
                色号
              </button>
              {(tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse') && (
                <span className="brush-chip" title="画笔粗细（[ 变细 / ] 变粗）">
                  <button
                    type="button"
                    className="brush-step"
                    onClick={() => setBrushSize(brushSize - 1)}
                    disabled={brushSize <= 1}
                    aria-label="变细"
                  >
                    −
                  </button>
                  <span className="brush-dot" aria-hidden>
                    <i style={{ width: Math.min(16, 3 + brushSize * 2), height: Math.min(16, 3 + brushSize * 2) }} />
                  </span>
                  <b className="brush-num">{brushSize}</b>
                  <button
                    type="button"
                    className="brush-step"
                    onClick={() => setBrushSize(brushSize + 1)}
                    disabled={brushSize >= 16}
                    aria-label="变粗"
                  >
                    +
                  </button>
                </span>
              )}
              {doc.pegboard > 0 && (
                <>
                  <button
                    className={'tbar-chip' + (flags.pegboard ? ' on' : '')}
                    onClick={() => toggleFlag('pegboard')}
                    title={`单板 ${doc.pegboard}×${doc.pegboard}，共 ${boardTotal} 块`}
                  >
                    分板
                  </button>
                  <button
                    className={'tbar-chip' + (flags.boardIds ? ' on' : '')}
                    onClick={() => toggleFlag('boardIds')}
                    title="在每块板的左上角标出 A1 / B2 这样的板号"
                  >
                    板号
                  </button>
                </>
              )}
              <div className="vdivider" style={{ margin: '0 2px' }} />
              <span className="tbar-chip" style={{ cursor: 'default' }}>
                <IconFile width={12} height={12} /> {beadCount} 颗
              </span>
              {doc.pegboard > 0 && (
                <span className="tbar-chip" style={{ cursor: 'default' }} title="按当前单板格数切出来的实体板数量">
                  {boardTotal} 块板
                </span>
              )}
            </div>
          </div>

          <aside className="side" style={{ width: sideW }}>
            <div
              className="side-resizer"
              title="拖动调整面板宽度"
              onPointerDown={onSideResizeDown}
              onPointerMove={onSideResizeMove}
              onPointerUp={onSideResizeUp}
              onPointerCancel={onSideResizeUp}
              onDoubleClick={() => setSideW(300)}
            />
            <div className="side-tabs">
              <button className={'side-tab' + (tab === 'colors' ? ' active' : '')} onClick={() => setTab('colors')}>
                <IconPalette /> 颜色
              </button>
              <button className={'side-tab' + (tab === 'usage' ? ' active' : '')} onClick={() => setTab('usage')}>
                <IconChart /> 用量
              </button>
              <button className={'side-tab' + (tab === 'settings' ? ' active' : '')} onClick={() => setTab('settings')}>
                <IconSettings /> 设置
              </button>
            </div>
            <div className="side-body">{sideBody(tab)}</div>
          </aside>
        </div>

        {/* ============ 移动端底部工具条 ============ */}
        <div className="mobile-tools">
          <div className="mtools-scroll">
            {TOOLS.slice(0, 5).map((t) => (
              <button
                key={t.key}
                className={'mtool' + (tool === t.key ? ' active' : '')}
                onClick={() => setTool(t.key)}
              >
                <t.icon width={19} height={19} />
                {t.label}
              </button>
            ))}
            <button
              className={'mtool' + (tool === 'picker' ? ' active' : '')}
              onClick={() => setTool('picker')}
            >
              <IconPicker width={19} height={19} />
              吸管
            </button>
            <button className={'mtool' + (tool === 'pan' ? ' active' : '')} onClick={() => setTool('pan')}>
              <IconHand width={19} height={19} />
              拖动
            </button>
            <button
              className={'mtool' + (flags.progressMode ? ' active' : '')}
              onClick={() => toggleFlag('progressMode')}
            >
              <IconCheck width={19} height={19} />
              进度
            </button>
            <button
              className={'mtool' + (flags.onlineMode ? ' active' : '')}
              onClick={() => setOnlineMode(!flags.onlineMode)}
            >
              <IconSparkle width={19} height={19} />
              线上
            </button>
            <button
              className={'mtool' + (sheet === 'colors' ? ' active' : '')}
              onClick={() => setSheet('colors')}
            >
              <span
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: 5,
                  background: cur?.hex ?? '#fff',
                  boxShadow: 'inset 0 0 0 1.5px var(--ring)',
                }}
              />
              颜色
            </button>
          </div>
          <button className="mtool mtool-more" onClick={() => setSheet('settings')}>
            <IconMenu width={19} height={19} />
            更多
          </button>
        </div>
      </div>

      {/* ============ 移动端抽屉 ============ */}
      {sheet && (
        <>
          <div className="sheet-scrim" onClick={() => setSheet(null)} />
          <div className="sheet">
            <div className="sheet-grip" />
            <div className="side-tabs">
              <button
                className={'side-tab' + (sheet === 'colors' ? ' active' : '')}
                onClick={() => setSheet('colors')}
              >
                <IconPalette /> 颜色
              </button>
              <button className={'side-tab' + (sheet === 'usage' ? ' active' : '')} onClick={() => setSheet('usage')}>
                <IconChart /> 用量
              </button>
              <button
                className={'side-tab' + (sheet === 'settings' ? ' active' : '')}
                onClick={() => setSheet('settings')}
              >
                <IconSettings /> 设置
              </button>
            </div>
            <div className="side-body">
              {sheet === 'settings' && (
                <div className="sheet-actions">
                  <button className="btn block" onClick={() => { setSheet(null); setDialog('new'); }}>
                    <IconPlus width={14} height={14} /> 新建图纸
                  </button>
                  <button className="btn block" onClick={() => { setSheet(null); openImport(); }}>
                    <IconImage width={14} height={14} /> 图片转图纸
                  </button>
                  <button className="btn block" onClick={() => { setSheet(null); openImport(lastSeed, 'wandCut'); }}>
                    <IconWand width={14} height={14} /> 抠图 / 魔法棒
                  </button>
                  <button className="btn block" onClick={() => { setSheet(null); setDialog('projects'); }}>
                    <IconFolder width={14} height={14} /> 我的图纸
                  </button>
                  <button className="btn block" onClick={() => { setSheet(null); openWelcome('guide'); }}>
                    <IconBook width={14} height={14} /> 新手手册 / 公告
                  </button>
                  <button className="btn block primary" onClick={() => { setSheet(null); setDialog('export'); }}>
                    <IconUpload width={14} height={14} /> 导出图纸
                  </button>
                </div>
              )}
              {sideBody(sheet)}
            </div>
          </div>
        </>
      )}

      {/* ============ 全局拖拽提示 ============ */}
      {dragOver && (
        <div className="drop-veil">
          <div className="drop-veil-card">
            <IconImage width={30} height={30} />
            <b>松手即导入</b>
            <span>图片会转成拼豆图纸，.perler.json 会直接打开工程</span>
          </div>
        </div>
      )}

      {/* ============ 对话框 ============ */}
      {dialog === 'new' && <NewCanvasDialog onClose={() => setDialog(null)} />}
      {dialog === 'import' && (
        <ImportDialog
          initialFile={dropped}
          initialSeed={seedForOpen}
          initialTool={importTool}
          onSeed={setLastSeed}
          onClose={() => {
            setDialog(null);
            setDropped(null);
            setSeedForOpen(null);
          }}
        />
      )}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'projects' && <ProjectsDialog onClose={() => setDialog(null)} />}
      {dialog === 'colors' && (
        <ColorManager onClose={() => setDialog(null)} initialTab={colorManagerTab} />
      )}
      {dialog === 'welcome' && (
        <WelcomeDialog tab={welcomeTab} onClose={() => setDialog(null)} />
      )}
      {dialog === 'keys' && (
        <ShortcutsDialog
          onClose={() => setDialog(null)}
          keymap={keymap}
          onChange={setKeymap}
        />
      )}

      {/* ============ 右下角作者角标 ============ */}
      <CornerBadge />

      {/* ============ Toast ============ */}
      <div className="toast-wrap">
        {toast && (
          <div key={toast.id} className={'toast ' + (toast.kind ?? 'ok')}>
            {toast.text}
          </div>
        )}
      </div>
    </>
  );
}
