import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from './core/store';
import { applyTheme, getThemeMode, resolveTheme, setThemeMode as setThemeModePersist, watchSystemTheme, type ThemeMode } from './core/theme';
import CanvasStage from './components/CanvasStage';
import ColorPanel from './components/ColorPanel';
import UsagePanel from './components/UsagePanel';
import SettingsPanel from './components/SettingsPanel';
import ColorManager from './components/ColorManager';
import ImportDialog from './components/ImportDialog';
import ExportDialog from './components/ExportDialog';
import NewCanvasDialog from './components/NewCanvasDialog';
import ProjectsDialog from './components/ProjectsDialog';
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
  IconSun,
  IconMoon,
  IconUndo,
  IconUpload,
} from './components/Icons';
import type { Tool } from './core/types';
import { docToThumb, parseProject, totalBeads } from './core/export';
import { readIndex, saveDoc } from './core/storage';

type Dialog = null | 'new' | 'import' | 'export' | 'projects' | 'colors';
type SideTab = 'colors' | 'usage' | 'settings';

const TOOLS: {
  key: Tool;
  label: string;
  hint?: string;
  icon: (p: { width: number; height: number }) => JSX.Element;
}[] = [
  { key: 'pencil', label: '画笔', hint: '(B)', icon: (p) => <IconPencil {...p} /> },
  { key: 'eraser', label: '橡皮', hint: '(E)', icon: (p) => <IconEraser {...p} /> },
  { key: 'bucket', label: '填充', hint: '(G)', icon: (p) => <IconBucket {...p} /> },
  { key: 'line', label: '直线', hint: '(L)', icon: (p) => <IconLine {...p} /> },
  { key: 'rect', label: '矩形', hint: '(R)', icon: (p) => <IconRect {...p} /> },
  { key: 'ellipse', label: '椭圆', hint: '(O)', icon: (p) => <IconEllipse {...p} /> },
  { key: 'picker', label: '吸管', hint: '(I)', icon: (p) => <IconPicker {...p} /> },
  { key: 'pan', label: '平移', hint: '(H)', icon: (p) => <IconHand {...p} /> },
];

const TOOL_KEYS: Record<string, Tool> = {
  b: 'pencil',
  e: 'eraser',
  g: 'bucket',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  i: 'picker',
  h: 'pan',
};

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
  const loadDocument = useEditor((s) => s.loadDocument);
  const notify = useEditor((s) => s.notify);
  const brushSize = useEditor((s) => s.brushSize);
  const setBrushSize = useEditor((s) => s.setBrushSize);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<SideTab>('colors');
  const [sheet, setSheet] = useState<null | SideTab>(null);
  const [titleDraft, setTitleDraft] = useState(doc.name);
  const [dropped, setDropped] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  const [resolved, setResolved] = useState(() => resolveTheme(getThemeMode()));

  useEffect(() => setTitleDraft(doc.name), [doc.name, doc.id]);

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

  // 首次访问：读取本地最近文档
  useEffect(() => {
    const idx = readIndex();
    if (idx.length) {
      // 不自动加载，避免覆盖用户预期；仅在标题处提示
    }
  }, []);

  // 自动保存（3 秒防抖）
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      try {
        saveDoc(useEditor.getState().doc, docToThumb(useEditor.getState().doc, 200));
        useEditor.getState().markClean();
      } catch {
        /* 忽略配额错误 */
      }
    }, 2600);
    return () => window.clearTimeout(t);
  }, [dirty, doc]);

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

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        setDialog(null);
        setSheet(null);
        setDropped(null);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const d = useEditor.getState().doc;
        const ok = saveDoc(d, docToThumb(d, 200));
        if (ok) {
          useEditor.getState().markClean();
          notify('已保存到本地');
        } else notify('本地空间不足', 'warn');
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setDialog('export');
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setDialog('import');
        return;
      }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (TOOL_KEYS[k]) {
        e.preventDefault();
        setTool(TOOL_KEYS[k]);
        return;
      }
      if (k === '[') setBrushSize(brushSize - 1);
      if (k === ']') setBrushSize(brushSize + 1);
      if (k === 'p') toggleFlag('progressMode');
      if (k === 'n') setDialog('new');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setTool, notify, brushSize, setBrushSize, toggleFlag]);

  const colorIndex = useEditor((s) => s.colorIndex);
  const cur = doc.palette[colorIndex];

  const sideBody = (t: SideTab) => {
    if (t === 'colors') return <ColorPanel onOpenManager={() => setDialog('colors')} />;
    if (t === 'usage') return <UsagePanel />;
    return <SettingsPanel themeMode={themeMode} onThemeChange={setThemeMode} />;
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
              <span>Perler Studio</span>
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
            <button className="btn sm hide-sm" onClick={() => setDialog('new')} title="新建图纸 (N)">
              <IconPlus width={13} height={13} /> 新建
            </button>
            <button className="btn sm hide-sm" onClick={() => setDialog('import')} title="图片转图纸 (Ctrl+O)">
              <IconImage width={13} height={13} /> 图片转图纸
            </button>
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
            {TOOLS.slice(0, 7).map((t) => (
              <button
                key={t.key}
                className={'rail-btn' + (tool === t.key ? ' active' : '')}
                onClick={() => setTool(t.key)}
                title={`${t.label}${t.hint ? ' ' + t.hint : ''}`}
              >
                <t.icon width={17} height={17} />
                <span className="rail-label">{t.label}</span>
              </button>
            ))}
            <div className="rail-sep" />
            <button
              className={'rail-btn' + (tool === 'pan' ? ' active' : '')}
              onClick={() => setTool('pan')}
              title="平移画布（空格）"
            >
              <IconHand width={17} height={17} />
              <span className="rail-label">平移</span>
            </button>
            <div className="rail-sep" />
            <button
              className={'rail-btn' + (flags.progressMode ? ' active' : '')}
              onClick={() => toggleFlag('progressMode')}
              title="进度模式：点击勾选已拼好的豆子 (P)"
            >
              <IconCheck width={17} height={17} />
              <span className="rail-label">进度</span>
            </button>
            <button
              className={'rail-btn' + (flags.grid ? ' active' : '')}
              onClick={() => toggleFlag('grid')}
              title="网格线"
            >
              <IconGrid width={17} height={17} />
              <span className="rail-label">网格</span>
            </button>
            <button
              className={'rail-btn' + (flags.symmetryX ? ' active' : '')}
              onClick={() => toggleFlag('symmetryX')}
              title="左右对称"
            >
              <IconLayers width={17} height={17} />
              <span className="rail-label">对称</span>
            </button>
            <div className="rail-sep" />
            <button className="rail-btn" onClick={() => setDialog('colors')} title="色号管理">
              <IconPalette width={17} height={17} />
              <span className="rail-label">色号</span>
            </button>
            <button className="rail-btn" onClick={() => setDialog('projects')} title="我的图纸">
              <IconBoard width={17} height={17} />
            </button>
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
                    <button className="btn primary" onClick={() => setDialog('import')}>
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
              <button
                className={'tbar-chip' + (flags.progressMode ? ' on' : '')}
                onClick={() => toggleFlag('progressMode')}
              >
                <IconCheck width={12} height={12} /> 进度
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
              <div className="vdivider" style={{ margin: '0 2px' }} />
              <span className="tbar-chip" style={{ cursor: 'default' }}>
                <IconFile width={12} height={12} /> {beadCount} 颗
              </span>
            </div>
          </div>

          <aside className="side">
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
              className={'mtool' + (flags.progressMode ? ' active' : '')}
              onClick={() => toggleFlag('progressMode')}
            >
              <IconCheck width={19} height={19} />
              进度
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
                  <button className="btn block" onClick={() => { setSheet(null); setDialog('import'); }}>
                    <IconImage width={14} height={14} /> 图片转图纸
                  </button>
                  <button className="btn block" onClick={() => { setSheet(null); setDialog('projects'); }}>
                    <IconFolder width={14} height={14} /> 我的图纸
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
          onClose={() => {
            setDialog(null);
            setDropped(null);
          }}
        />
      )}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'projects' && <ProjectsDialog onClose={() => setDialog(null)} />}
      {dialog === 'colors' && <ColorManager onClose={() => setDialog(null)} />}

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
