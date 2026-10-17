import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import {
  DEFAULT_PDF,
  DEFAULT_RENDER,
  exportCSV,
  exportPDF,
  exportPNG,
  exportProject,
  exportSVG,
  renderPatternCanvas,
  type PdfOptions,
  type RenderOptions,
} from '../core/export';
import { IconCheck, IconClose, IconDownload, IconFile, IconImage, IconSparkle } from './Icons';

interface Props {
  onClose: () => void;
}

type Fmt = 'png' | 'svg' | 'pdf' | 'csv' | 'project';

const FORMATS: { key: Fmt; label: string; desc: string; icon: 'img' | 'file' }[] = [
  { key: 'png', label: 'PNG 图片', desc: '高清位图，适合分享', icon: 'img' },
  { key: 'svg', label: 'SVG 矢量', desc: '无限放大，可再编辑', icon: 'file' },
  { key: 'pdf', label: 'PDF 图纸', desc: '分页打印，带坐标用量', icon: 'file' },
  { key: 'csv', label: 'CSV 用量表', desc: '色号清单，采购用', icon: 'file' },
  { key: 'project', label: '工程文件', desc: '.perler.json 可再次导入', icon: 'file' },
];

export default function ExportDialog({ onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const notify = useEditor((s) => s.notify);
  const [fmt, setFmt] = useState<Fmt>('png');
  const [cellSize, setCellSize] = useState(24);
  const [grid, setGrid] = useState(true);
  const [coords, setCoords] = useState(true);
  const [holes, setHoles] = useState(true);
  const [showCodes, setShowCodes] = useState(false);
  const [background, setBackground] = useState(true);
  const [transparent, setTransparent] = useState(false);

  const [pageSize, setPageSize] = useState<'a4' | 'letter'>('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [maxCellsPerPage, setMaxCellsPerPage] = useState(32);
  const [withLegend, setWithLegend] = useState(true);

  const previewRef = useRef<HTMLDivElement>(null);

  const renderOpts: RenderOptions = useMemo(
    () => ({
      ...DEFAULT_RENDER,
      cellSize,
      grid,
      coords,
      holes,
      showCodes,
      dimUnplaced: false,
      background: transparent ? null : background ? '#ffffff' : null,
      title: doc.name,
    }),
    [cellSize, grid, coords, holes, showCodes, transparent, background, doc.name],
  );

  const pdfOpts: PdfOptions = useMemo(
    () => ({ ...DEFAULT_PDF, ...renderOpts, pageSize, orientation, maxCellsPerPage, withLegend, withHeader: true }),
    [renderOpts, pageSize, orientation, maxCellsPerPage, withLegend],
  );

  // 实时预览
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.innerHTML = '';
    if (fmt === 'pdf' || fmt === 'csv' || fmt === 'project') return;
    const canvas = renderPatternCanvas(doc, {
      ...renderOpts,
      cellSize: Math.max(3, Math.min(renderOpts.cellSize, Math.floor(520 / Math.max(doc.width, doc.height)))),
    });
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.borderRadius = '6px';
    canvas.style.imageRendering = 'pixelated';
    host.appendChild(canvas);
  }, [doc, renderOpts, fmt]);

  const doExport = () => {
    try {
      if (fmt === 'png') exportPNG(doc, renderOpts);
      else if (fmt === 'svg') exportSVG(doc, renderOpts);
      else if (fmt === 'pdf') exportPDF(doc, pdfOpts);
      else if (fmt === 'csv') exportCSV(doc);
      else exportProject(doc);
      notify('已开始下载');
      onClose();
    } catch (err) {
      console.error(err);
      notify('导出失败，请重试', 'warn');
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>导出图纸</h2>
            <p>支持 PNG / SVG / PDF / CSV 与工程文件，全部在本地完成</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 7, marginBottom: 16 }}>
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className={'radio-card' + (fmt === f.key ? ' active' : '')}
                onClick={() => setFmt(f.key)}
                style={{ padding: '9px 11px' }}
              >
                <div className="rc-icon" style={{ width: 28, height: 28, borderRadius: 8 }}>
                  {f.icon === 'img' ? <IconImage width={15} height={15} /> : <IconFile width={15} height={15} />}
                </div>
                <div className="rc-body">
                  <b style={{ fontSize: 12 }}>{f.label}</b>
                  <span style={{ fontSize: 10 }}>{f.desc}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="import-grid" style={{ gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)' }}>
            <div className="preview-box" style={{ minHeight: 240 }}>
              <span className="preview-label">预览</span>
              {fmt === 'pdf' || fmt === 'csv' || fmt === 'project' ? (
                <div style={{ textAlign: 'center', color: 'var(--text-mute)', fontSize: 12, lineHeight: 1.8 }}>
                  {fmt === 'pdf' && (
                    <>
                      <IconFile width={26} height={26} style={{ marginBottom: 8, opacity: 0.6 }} />
                      <div>
                        将导出 {Math.ceil(doc.width / maxCellsPerPage) * Math.ceil(doc.height / maxCellsPerPage)} 页图纸
                      </div>
                      <div>分块打印，带坐标与 5 格加粗线</div>
                    </>
                  )}
                  {fmt === 'csv' && (
                    <>
                      <IconFile width={26} height={26} style={{ marginBottom: 8, opacity: 0.6 }} />
                      <div>色号 / 数量 / 已拼 / 剩余</div>
                      <div>可用 Excel 打开</div>
                    </>
                  )}
                  {fmt === 'project' && (
                    <>
                      <IconSparkle width={26} height={26} style={{ marginBottom: 8, opacity: 0.6 }} />
                      <div>.perler.json 工程文件</div>
                      <div>含画布、色板、进度，可完整还原</div>
                    </>
                  )}
                </div>
              ) : (
                <div ref={previewRef} style={{ display: 'flex', justifyContent: 'center', width: '100%' }} />
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(fmt === 'png' || fmt === 'svg') && (
                <>
                  <div className="field">
                    <label>单格像素</label>
                    <div className="slider-row">
                      <input
                        type="range"
                        min={4}
                        max={64}
                        value={cellSize}
                        onChange={(e) => setCellSize(Number(e.target.value))}
                      />
                      <span className="val">{cellSize}px</span>
                    </div>
                    <span className="hint">
                      输出约 {doc.width * cellSize} × {doc.height * cellSize} px
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
                    <div className="check-row" onClick={() => setGrid((v) => !v)}>
                      <span className={'checkbox' + (grid ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      网格线
                    </div>
                    <div className="check-row" onClick={() => setCoords((v) => !v)}>
                      <span className={'checkbox' + (coords ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      坐标标尺
                    </div>
                    <div className="check-row" onClick={() => setHoles((v) => !v)}>
                      <span className={'checkbox' + (holes ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      豆子中孔
                    </div>
                    <div className="check-row" onClick={() => setShowCodes((v) => !v)}>
                      <span className={'checkbox' + (showCodes ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      显示色号
                    </div>
                    <div className="check-row" onClick={() => setBackground((v) => !v)}>
                      <span className={'checkbox' + (background ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      白色背景
                    </div>
                    <div className="check-row" onClick={() => setTransparent((v) => !v)}>
                      <span className={'checkbox' + (transparent ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      透明背景
                    </div>
                  </div>
                </>
              )}

              {fmt === 'pdf' && (
                <>
                  <div className="field">
                    <label>纸张</label>
                    <div className="segmented">
                      <button className={pageSize === 'a4' ? 'active' : ''} onClick={() => setPageSize('a4')}>
                        A4
                      </button>
                      <button className={pageSize === 'letter' ? 'active' : ''} onClick={() => setPageSize('letter')}>
                        Letter
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>方向</label>
                    <div className="segmented">
                      <button
                        className={orientation === 'landscape' ? 'active' : ''}
                        onClick={() => setOrientation('landscape')}
                      >
                        横向
                      </button>
                      <button
                        className={orientation === 'portrait' ? 'active' : ''}
                        onClick={() => setOrientation('portrait')}
                      >
                        纵向
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>每页格数</label>
                    <div className="slider-row">
                      <input
                        type="range"
                        min={10}
                        max={60}
                        step={2}
                        value={maxCellsPerPage}
                        onChange={(e) => setMaxCellsPerPage(Number(e.target.value))}
                      />
                      <span className="val">{maxCellsPerPage}</span>
                    </div>
                  </div>
                  <div className="check-row" onClick={() => setWithLegend((v) => !v)}>
                    <span className={'checkbox' + (withLegend ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    附加用量清单页
                  </div>
                </>
              )}

              {(fmt === 'csv' || fmt === 'project') && (
                <div className="hint-box" style={{ textAlign: 'left' }}>
                  {fmt === 'csv'
                    ? '导出当前图纸所有使用到的色号清单，含品牌、色号、色名、HEX、总数、已拼数、剩余数，可直接用于采购。'
                    : '工程文件保存了画布尺寸、每格色号、拼装进度与完整色板，可在本网站「导入工程」中完整还原，也方便备份和分享给朋友。'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="dialog-foot">
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
            {doc.width} × {doc.height} · {doc.palette.length} 色板
          </span>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={doExport}>
            <IconDownload width={14} height={14} /> 导出 {fmt.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
