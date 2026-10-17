import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import {
  BOARD_PRESETS,
  DEFAULT_PDF,
  DEFAULT_RENDER,
  exportCSV,
  exportPDF,
  exportPNG,
  exportProject,
  exportSVG,
  renderPatternCanvas,
  renderPdfPreviewCanvas,
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
  { key: 'pdf', label: 'PDF 图纸', desc: '整张一页，直接打印', icon: 'file' },
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
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [layout, setLayout] = useState<'single' | 'boards' | 'tile'>('single');
  const [maxCellsPerPage, setMaxCellsPerPage] = useState(32);
  const [withLegend, setWithLegend] = useState(false);
  const [calibration, setCalibration] = useState(true);
  const [boardSize, setBoardSize] = useState(0);

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
      boardSize,
      boardGap: 1.2,
    }),
    [cellSize, grid, coords, holes, showCodes, transparent, background, doc.name, boardSize],
  );

  const pdfOpts: PdfOptions = useMemo(
    () => ({
      ...DEFAULT_PDF,
      ...renderOpts,
      pageSize,
      orientation,
      layout,
      maxCellsPerPage,
      withLegend,
      calibration,
      withHeader: true,
      boardSize,
    }),
    [renderOpts, pageSize, orientation, layout, maxCellsPerPage, withLegend, calibration, boardSize],
  );

  const boardCols = boardSize > 0 ? Math.ceil(doc.width / boardSize) : 1;
  const boardRows = boardSize > 0 ? Math.ceil(doc.height / boardSize) : 1;
  const boardTotal = boardCols * boardRows;

  // PDF 预览的页数：一板一页 = 板数；分块 = 块数；单页 = 1
  const pdfPages =
    layout === 'boards'
      ? boardTotal
      : layout === 'tile'
        ? Math.ceil(doc.width / maxCellsPerPage) * Math.ceil(doc.height / maxCellsPerPage)
        : 1;
  const [pdfPage, setPdfPage] = useState(0);
  useEffect(() => {
    if (pdfPage > pdfPages - 1) setPdfPage(0);
  }, [pdfPages, pdfPage]);

  // 实时预览
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.innerHTML = '';
    if (fmt === 'csv' || fmt === 'project') return;

    let canvas: HTMLCanvasElement;
    if (fmt === 'pdf') {
      canvas = renderPdfPreviewCanvas(doc, { ...pdfOpts, page: pdfPage });
    } else {
      const gap = 1.2;
      const spanW = boardSize > 0 ? doc.width + Math.floor((doc.width - 1) / boardSize) * gap : doc.width;
      const spanH = boardSize > 0 ? doc.height + Math.floor((doc.height - 1) / boardSize) * gap : doc.height;
      canvas = renderPatternCanvas(doc, {
        ...renderOpts,
        cellSize: Math.max(3, Math.min(renderOpts.cellSize, Math.floor(520 / Math.max(spanW, spanH)))),
      });
      canvas.style.imageRendering = 'pixelated';
    }
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    canvas.style.borderRadius = '4px';
    if (fmt === 'pdf') {
      canvas.style.imageRendering = 'auto';
      canvas.style.boxShadow = '0 6px 24px -6px rgba(0,0,0,.35)';
      canvas.style.background = '#fff';
    }
    host.appendChild(canvas);
  }, [doc, renderOpts, pdfOpts, fmt, boardSize, pdfPage]);

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
            <div className="preview-box" style={{ minHeight: 260, padding: 12 }}>
              <span className="preview-label">{fmt === 'pdf' ? '纸张预览' : '预览'}</span>
              {fmt === 'csv' || fmt === 'project' ? (
                <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.8 }}>
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
                <>
                  <div
                    ref={previewRef}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      height: 420,
                    }}
                  />
                  {fmt === 'pdf' && pdfPages > 1 && (
                    <div className="pdf-pager">
                      <button
                        className="btn ghost sm"
                        disabled={pdfPage === 0}
                        onClick={() => setPdfPage((p) => Math.max(0, p - 1))}
                      >
                        上一页
                      </button>
                      <span>
                        第 {pdfPage + 1} / {pdfPages} 页
                      </span>
                      <button
                        className="btn ghost sm"
                        disabled={pdfPage >= pdfPages - 1}
                        onClick={() => setPdfPage((p) => Math.min(pdfPages - 1, p + 1))}
                      >
                        下一页
                      </button>
                    </div>
                  )}
                  {fmt === 'pdf' && (
                    <div className="pdf-cap">
                      {layout === 'single' && (
                        <>
                          整张图纸 1 页装下 · 自动缩放至 {pageSize === 'a4' ? 'A4' : 'Letter'}{' '}
                          {boardSize > 0 ? `· 含 ${boardCols}×${boardRows} 块板框与板号` : ''}
                        </>
                      )}
                      {layout === 'boards' && (
                        <>
                          每块板 1 页，共 {boardTotal} 页 ·{' '}
                          {boardSize > 0 ? `${boardSize} × ${boardSize}` : `${doc.pegboard} × ${doc.pegboard}`}{' '}
                          格一块板 · 可 1:1 打印后逐块拼装
                        </>
                      )}
                      {layout === 'tile' && (
                        <>
                          {pdfPages} 页 · 每页 {maxCellsPerPage} × {maxCellsPerPage} 格分块
                        </>
                      )}
                    </div>
                  )}
                </>
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
                      输出约 {(boardSize > 0 ? doc.width + Math.floor((doc.width - 1) / boardSize) * 1.2 : doc.width) * cellSize | 0} ×{' '}
                      {(boardSize > 0 ? doc.height + Math.floor((doc.height - 1) / boardSize) * 1.2 : doc.height) * cellSize | 0} px
                    </span>
                  </div>
                  <div className="field">
                    <label>拼豆板尺寸</label>
                    <select className="select" value={boardSize} onChange={(e) => setBoardSize(Number(e.target.value))}>
                      {BOARD_PRESETS.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    <span className="hint">
                      {boardSize > 0
                        ? `${doc.width} × ${doc.height} 需要 ${boardCols} × ${boardRows} = ${boardTotal} 块板，导出图上会标出板框与板号`
                        : '选一个板尺寸，导出图会按实体板切分并标出板号'}
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
                    <label>排版</label>
                    <div className="segmented">
                      <button className={layout === 'single' ? 'active' : ''} onClick={() => setLayout('single')}>
                        整张一页
                      </button>
                      <button className={layout === 'boards' ? 'active' : ''} onClick={() => setLayout('boards')}>
                        一板一页
                      </button>
                      <button className={layout === 'tile' ? 'active' : ''} onClick={() => setLayout('tile')}>
                        分块
                      </button>
                    </div>
                    <span className="hint">
                      {layout === 'single' && '整张图纸缩放进一张纸，一眼看全；大图会画出板框与板号'}
                      {layout === 'boards' && '按实体拼豆板切分，每块板一页，可 1:1 打印后逐块拼装'}
                      {layout === 'tile' && '按每页格数硬切，适合需要放大对照的场景'}
                    </span>
                  </div>
                  <div className="field">
                    <label>拼豆板尺寸</label>
                    <select className="select" value={boardSize} onChange={(e) => setBoardSize(Number(e.target.value))}>
                      {BOARD_PRESETS.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    <span className="hint">
                      {boardSize > 0
                        ? `${doc.width} × ${doc.height} 需要 ${boardCols} × ${boardRows} = ${boardTotal} 块板`
                        : '选一个板尺寸，图纸会按板切分并标出板号'}
                    </span>
                  </div>
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
                      <button className={orientation === 'auto' ? 'active' : ''} onClick={() => setOrientation('auto')}>
                        自动
                      </button>
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
                  {layout === 'tile' && (
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
                  )}
                  <div className="check-row" onClick={() => setCalibration((v) => !v)}>
                    <span className={'checkbox' + (calibration ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    页脚 50mm 校准标尺
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
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
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
