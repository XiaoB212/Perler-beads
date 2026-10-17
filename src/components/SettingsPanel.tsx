import { useEditor } from '../core/store';
import type { ViewFlags } from '../core/types';
import type { ThemeMode } from '../core/theme';
import { PEGBOARD_MAX, PEGBOARD_PRESETS, boardCols, boardLabel, boardRows } from '../core/board';
import { IconBoard, IconCode, IconGrid, IconHole, IconMirrorX, IconMirrorY, IconMoon, IconRuler, IconSun } from './Icons';

interface Props {
  themeMode?: ThemeMode;
  onThemeChange?: (m: ThemeMode) => void;
}

const THEMES: { key: ThemeMode; label: string; icon: (p: { width: number; height: number }) => JSX.Element }[] = [
  { key: 'auto', label: '跟随系统', icon: (p) => <IconHole {...p} /> },
  { key: 'light', label: '亮色', icon: (p) => <IconSun {...p} /> },
  { key: 'dark', label: '暗色', icon: (p) => <IconMoon {...p} /> },
];

const FLAG_ITEMS: { key: keyof ViewFlags; label: string; icon: (p: { width: number; height: number }) => JSX.Element }[] = [
  { key: 'grid', label: '网格线', icon: (p) => <IconGrid {...p} /> },
  { key: 'rulers', label: '坐标标尺', icon: (p) => <IconRuler {...p} /> },
  { key: 'beadHoles', label: '豆子中孔', icon: (p) => <IconHole {...p} /> },
  { key: 'pegboard', label: '拼豆板分界', icon: (p) => <IconBoard {...p} /> },
  { key: 'boardIds', label: '板号标签', icon: (p) => <IconBoard {...p} /> },
  { key: 'symmetryX', label: '左右对称', icon: (p) => <IconMirrorX {...p} /> },
  { key: 'symmetryY', label: '上下对称', icon: (p) => <IconMirrorY {...p} /> },
  { key: 'progressMode', label: '进度模式', icon: (p) => <IconHole {...p} /> },
  { key: 'dimUnplaced', label: '淡化未拼', icon: (p) => <IconHole {...p} /> },
  { key: 'showCodes', label: '显示色号', icon: (p) => <IconCode {...p} /> },
];

export default function SettingsPanel({ themeMode, onThemeChange }: Props) {
  const doc = useEditor((s) => s.doc);
  const flags = useEditor((s) => s.flags);
  const toggleFlag = useEditor((s) => s.toggleFlag);
  const brushSize = useEditor((s) => s.brushSize);
  const setBrushSize = useEditor((s) => s.setBrushSize);
  const shapeFill = useEditor((s) => s.shapeFill);
  const setShapeFill = useEditor((s) => s.setShapeFill);
  const setPegboard = useEditor((s) => s.setPegboard);
  const setNotes = useEditor((s) => s.setNotes);
  const focus = useEditor((s) => s.focus);
  const setFocus = useEditor((s) => s.setFocus);
  const focusOnCell = useEditor((s) => s.focusOnCell);
  const hover = useEditor((s) => s.hover);

  return (
    <div>
      <div className="panel-head">
        <span className="panel-title">画布设置</span>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>界面主题</label>
        <div className="segmented" style={{ alignSelf: 'stretch' }}>
          {THEMES.map((t) => (
            <button
              key={t.key}
              className={themeMode === t.key ? 'active' : ''}
              onClick={() => onThemeChange?.(t.key)}
              title={t.label}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>画笔粗细</label>
        <div className="slider-row">
          <input
            type="range"
            min={1}
            max={16}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
          <span className="val">{brushSize}px</span>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>形状填充</label>
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button className={shapeFill ? 'active' : ''} onClick={() => setShapeFill(true)}>
            实心
          </button>
          <button className={!shapeFill ? 'active' : ''} onClick={() => setShapeFill(false)}>
            描边
          </button>
        </div>
      </div>

      <div className="divider" />
      <div className="panel-head">
        <span className="panel-title">显示与辅助</span>
      </div>
      <div className="flag-list">
        {FLAG_ITEMS.map((f) => (
          <div key={f.key} className="row-toggle" onClick={() => toggleFlag(f.key)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <f.icon width={14} height={14} />
              {f.label}
            </span>
            <span className={'switch' + (flags[f.key] ? ' on' : '')} />
          </div>
        ))}
      </div>

      <div className="divider" />
      <div className="panel-head">
        <span className="panel-title">拼豆板</span>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>单板格数（用于分板参考线）</label>
        <div className="seg-wrap">
          {PEGBOARD_PRESETS.map((p) => (
            <button
              key={p.value}
              className={doc.pegboard === p.value ? 'active' : ''}
              onClick={() => setPegboard(p.value)}
              title={p.value === 0 ? '不画分板参考线' : `每 ${p.value} 格一块拼豆板${p.note ? ' · ' + p.note : ''}`}
            >
              {p.value === 0 ? '不分板' : `${p.value}×${p.value}`}
            </button>
          ))}
        </div>
        <div className="slider-row" style={{ marginTop: 8 }}>
          <input
            type="number"
            className="input"
            min={2}
            max={PEGBOARD_MAX}
            value={doc.pegboard || ''}
            placeholder="不分板"
            onChange={(e) => {
              const v = Number(e.target.value);
              setPegboard(Number.isFinite(v) && v > 0 ? v : 0);
            }}
            style={{ width: 92 }}
            title="也可以直接填任意格数，不限于上面的预设"
          />
          <span className="val">× {doc.pegboard || 0} 格</span>
        </div>
      </div>

      {doc.pegboard > 0 && (
        <div className="board-focus-row">
          <div className="board-focus-info">
            <b>
              {boardCols(doc.width, doc.pegboard)} × {boardRows(doc.height, doc.pegboard)} ={' '}
              {boardCols(doc.width, doc.pegboard) * boardRows(doc.height, doc.pegboard)} 块板
            </b>
            <span>
              {focus
                ? `正在拼 ${boardLabel(focus.col, focus.row)} 板，绘画被限制在这块板内`
                : '双击画布上的任意一块板，可进入「只看这块板」'}
            </span>
          </div>
          {focus ? (
            <button className="btn sm" onClick={() => setFocus(null)}>
              看全图
            </button>
          ) : (
            <button
              className="btn sm"
              onClick={() => {
                const at = hover ?? { x: Math.floor(doc.width / 2), y: Math.floor(doc.height / 2) };
                focusOnCell(at.x, at.y);
              }}
            >
              聚焦光标处
            </button>
          )}
        </div>
      )}

      <div className="divider" />
      <div className="panel-head">
        <span className="panel-title">备注</span>
      </div>
      <textarea
        className="input"
        rows={4}
        placeholder="记录配色思路、购买清单、送给谁…"
        value={doc.notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ fontSize: 12 }}
      />
    </div>
  );
}
