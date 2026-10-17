import { useEditor } from '../core/store';
import type { ViewFlags } from '../core/types';
import type { ThemeMode } from '../core/theme';
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
        <div className="seg-row">
          {[14, 29, 48, 0].map((n) => (
            <button
              key={n}
              className={'btn sm ' + (doc.pegboard === n ? 'primary' : '')}
              onClick={() => setPegboard(n)}
            >
              {n === 0 ? '不显示' : `${n}×${n}`}
            </button>
          ))}
        </div>
      </div>

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
