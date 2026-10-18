import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import {
  BOARD_PRESETS,
  DEFAULT_PDF,
  DEFAULT_RENDER,
  DEFAULT_WATERMARK_TEXT,
  DEFAULT_WATERMARK_URL,
  cellAdvice,
  exportBoardImagesPNG,
  exportBoardImagesSVG,
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
import { PEGBOARD_MAX, clampPegboard } from '../core/board';
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
  const [holes, setHoles] = useState(false);
  // 豆子形状：默认纯方格，圆格可选
  const [shape, setShape] = useState<'square' | 'circle'>('square');
  // 导出默认就带色号：用户之前拿到一张没有色号的图，根本没法照着拼
  const [showCodes, setShowCodes] = useState(true);
  const [background, setBackground] = useState(true);
  const [transparent, setTransparent] = useState(false);

  const [pageSize, setPageSize] = useState<'a4' | 'letter'>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [layout, setLayout] = useState<'single' | 'boards'>('single');
  const [withLegend, setWithLegend] = useState(false);
  const [calibration, setCalibration] = useState(true);
  // 拼豆板尺寸：默认跟图纸自身设置一致（不再写死 64 —— 29×29 的图写 64 根本没意义）
  const [boardSize, setBoardSize] = useState(() => doc.pegboard || 0);
  const [boardText, setBoardText] = useState(() => String(doc.pegboard || 0));
  const commitBoardSize = (raw: string) => {
    setBoardText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setBoardSize(clampPegboard(n));
  };
  // 导出件上的色号用量表与水印
  const [legend, setLegend] = useState(true);
  const [watermark, setWatermark] = useState(true);
  const [watermarkText, setWatermarkText] = useState(DEFAULT_WATERMARK_TEXT);
  const [watermarkUrl, setWatermarkUrl] = useState(DEFAULT_WATERMARK_URL);
  const [fitWindow, setFitWindow] = useState(true);
  /** PNG / SVG：一板一张，每块板单独一个文件（6.9 万格那种大图色号才看得清） */
  const [perBoard, setPerBoard] = useState(false);

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
      legend,
      watermark,
      watermarkText,
      watermarkUrl,
      fitWindow,
      shape,
    }),
    [
      cellSize,
      grid,
      coords,
      holes,
      showCodes,
      transparent,
      background,
      doc.name,
      boardSize,
      legend,
      watermark,
      watermarkText,
      watermarkUrl,
      fitWindow,
      shape,
    ],
  );

  const pdfOpts: PdfOptions = useMemo(
    () => ({
      ...DEFAULT_PDF,
      ...renderOpts,
      pageSize,
      orientation,
      layout,
      withLegend,
      calibration,
      withHeader: true,
      boardSize,
    }),
    [renderOpts, pageSize, orientation, layout, withLegend, calibration, boardSize],
  );

  const boardCols = boardSize > 0 ? Math.ceil(doc.width / boardSize) : 1;
  const boardRows = boardSize > 0 ? Math.ceil(doc.height / boardSize) : 1;
  const boardTotal = boardCols * boardRows;

  // 提前算好「这个设置下色号到底印不印得清」。大图（比如 264×264 ≈ 7 万格）
  // 塞进一张 A4，每格不到 1mm，色号根本没法看 —— 与其导完才发现，不如现在就提示。
  const advice = useMemo(
    () =>
      cellAdvice(doc, fmt === 'pdf' ? 'pdf' : fmt === 'svg' ? 'svg' : 'png', {
        cellSize,
        layout,
        boardSize,
        pageSize,
        orientation,
        coords,
      }),
    [doc, fmt, cellSize, layout, boardSize, pageSize, orientation, coords],
  );

  // 输出像素尺寸（分板时接缝占 1.2 格）
  const outSpanW = boardSize > 0 ? doc.width + Math.floor((doc.width - 1) / boardSize) * 1.2 : doc.width;
  const outSpanH = boardSize > 0 ? doc.height + Math.floor((doc.height - 1) / boardSize) * 1.2 : doc.height;
  const outW = Math.round(outSpanW * cellSize);
  const outH = Math.round(outSpanH * cellSize);

  // PDF 预览的页数：一板一页 = 板数；单页 = 1
  const pdfPages = layout === 'boards' ? boardTotal : 1;
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
      if (fmt === 'png') {
        if (perBoard && boardSize > 0 && boardTotal > 1) {
          void exportBoardImagesPNG(doc, renderOpts);
          notify(`已开始下载 ${boardTotal} 个 PNG（每块板一张，文件名带板号）`);
        } else {
          exportPNG(doc, renderOpts);
          notify('已开始下载');
        }
      } else if (fmt === 'svg') {
        if (perBoard && boardSize > 0 && boardTotal > 1) {
          exportBoardImagesSVG(doc, renderOpts);
          notify(`已开始下载 ${boardTotal} 个 SVG（每块板一张，文件名带板号）`);
        } else {
          exportSVG(doc, renderOpts);
          notify('已开始下载');
        }
      } else if (fmt === 'pdf') {
        exportPDF(doc, pdfOpts);
        notify('已开始下载');
      } else if (fmt === 'csv') {
        exportCSV(doc);
        notify('已开始下载');
      } else {
        exportProject(doc);
        notify('已开始下载');
      }
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
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(fmt === 'png' || fmt === 'svg' || fmt === 'pdf') && (
                <>
                  {fmt !== 'pdf' && (
                    <div className="field">
                      <label>单格像素</label>
                      <div className="slider-row">
                        <input
                          type="range"
                          min={4}
                          max={128}
                          step={2}
                          value={cellSize}
                          onChange={(e) => setCellSize(Number(e.target.value))}
                        />
                        <span className="val">{cellSize}px</span>
                      </div>
                      <div className="seg-row" style={{ marginTop: 6 }}>
                        {[12, 24, 48, 80, 128].map((v) => (
                          <button
                            key={v}
                            className={cellSize === v ? 'active' : ''}
                            onClick={() => setCellSize(v)}
                            title={v >= 48 ? '色号很清晰，但文件较大' : '色号清晰'}
                          >
                            {v}px
                          </button>
                        ))}
                      </div>
                      <span className="hint">
                        输出约 {outW} × {outH} px
                        {cellSize < 14 ? ' · 这个尺寸印不下色号，想要色号至少 14px' : ''}
                        {outW > 12000 || outH > 12000
                          ? ' · 图很大，看图软件通常会自动缩到最小，建议改用 SVG（矢量，放大不糊）'
                          : ''}
                      </span>
                    </div>
                  )}
                  <div className="field">
                    <label>拼豆板尺寸</label>
                    <div className="slider-row">
                      <select
                        className="select"
                        value={BOARD_PRESETS.some((b) => b.value === boardSize) ? boardSize : -1}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (v < 0) return;
                          setBoardSize(v);
                          setBoardText(String(v));
                        }}
                      >
                        {!BOARD_PRESETS.some((b) => b.value === boardSize) && (
                          <option value={-1}>自定义 {boardSize} 格</option>
                        )}
                        {BOARD_PRESETS.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="input"
                        style={{ width: 76 }}
                        min={0}
                        max={PEGBOARD_MAX}
                        value={boardText}
                        onChange={(e) => commitBoardSize(e.target.value)}
                        onBlur={() => setBoardText(String(boardSize))}
                        title={`可以直接填任意 1 – ${PEGBOARD_MAX} 的整数`}
                      />
                      <span className="val">格</span>
                      {doc.pegboard > 0 && boardSize !== doc.pegboard && (
                        <button
                          className="chip"
                          onClick={() => {
                            setBoardSize(clampPegboard(doc.pegboard));
                            setBoardText(String(clampPegboard(doc.pegboard)));
                          }}
                          title="用图纸设置里的拼豆板分界"
                        >
                          跟图纸一致
                        </button>
                      )}
                    </div>
                    <span className="hint">
                      {boardSize > 0
                        ? `${doc.width} × ${doc.height} 需要 ${boardCols} × ${boardRows} = ${boardTotal} 块板，导出图上会标出板框与板号`
                        : '选一个板尺寸，导出图会按实体板切分并标出板号；填 0 表示不画分板'}
                      {doc.pegboard > 0
                        ? `。默认跟新建图纸时设的 ${doc.pegboard}×${doc.pegboard} 一致，这里改只影响本次导出。`
                        : '。想按实体板切分，可以直接在上面填任意格数。'}
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
                  <div className="field" style={{ marginTop: 2 }}>
                    <label>豆子形状</label>
                    <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                      <button className={shape === 'square' ? 'active' : ''} onClick={() => setShape('square')}>
                        方格
                      </button>
                      <button className={shape === 'circle' ? 'active' : ''} onClick={() => setShape('circle')}>
                        圆格
                      </button>
                    </div>
                  </div>
                </>
              )}

              {(fmt === 'png' || fmt === 'svg' || fmt === 'pdf') && (
                <>
                  <div className="check-row" onClick={() => setLegend((v) => !v)}>
                    <span className={'checkbox' + (legend ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    附色号用量表（每个色号用多少颗）
                  </div>
                  {fmt === 'svg' && (
                    <div className="check-row" onClick={() => setFitWindow((v) => !v)}>
                      <span className={'checkbox' + (fitWindow ? ' on' : '')}>
                        <IconCheck width={11} height={11} />
                      </span>
                      打开时自适应窗口大小
                    </div>
                  )}
                  <div className="check-row" onClick={() => setWatermark((v) => !v)}>
                    <span className={'checkbox' + (watermark ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    加导出水印
                  </div>
                  {watermark && (
                    <div className="field">
                      <label>水印文字</label>
                      <input
                        className="input"
                        value={watermarkText}
                        placeholder="例如：本图纸由 XXX 制作"
                        onChange={(e) => setWatermarkText(e.target.value)}
                      />
                      <label style={{ marginTop: 6 }}>
                        水印地址（{fmt === 'pdf' ? 'PDF 里可以直接点开' : '会写在文字旁边'}）
                      </label>
                      <input
                        className="input"
                        value={watermarkUrl}
                        placeholder="https://"
                        onChange={(e) => setWatermarkUrl(e.target.value)}
                      />
                      <span className="hint">留空则不写地址；想署名自己就改上面的文字</span>
                    </div>
                  )}
                </>
              )}

              {(fmt === 'png' || fmt === 'svg' || fmt === 'pdf') && (
                <div className={'advice-box' + (advice.legible ? ' ok' : ' warn')}>
                  <div className="advice-main">
                    <b>{advice.legible ? '色号看得清' : '这样导出看不清色号'}</b>
                    <span>{advice.hint}</span>
                  </div>
                  {!advice.legible && (
                    <div className="advice-actions">
                      {fmt === 'pdf' && layout !== 'boards' && (
                        <button className="btn sm primary" onClick={() => setLayout('boards')}>
                          改成一板一页
                        </button>
                      )}
                      {(fmt === 'png' || fmt === 'svg') && (
                        <>
                          {cellSize < 13 && (
                            <button className="btn sm" onClick={() => setCellSize(16)}>
                              单格调到 16px
                            </button>
                          )}
                          {boardSize > 0 && boardTotal > 1 && (
                            <button className="btn sm primary" onClick={() => setPerBoard(true)}>
                              一板一张（{boardTotal} 个文件）
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {(fmt === 'png' || fmt === 'svg') && (
                    <label className="checkbox-line">
                      <span
                        className={'checkbox' + (perBoard ? ' on' : '')}
                        onClick={() => setPerBoard(!perBoard)}
                        role="checkbox"
                        aria-checked={perBoard}
                        tabIndex={0}
                      >
                        {perBoard && <IconCheck width={11} height={11} />}
                      </span>
                      <span onClick={() => setPerBoard(!perBoard)}>
                        一板一张：每块板单独一个文件，文件名和图上都标好板号（当前 {boardTotal} 块板）
                      </span>
                    </label>
                  )}
                </div>
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
                    </div>
                    <span className="hint">
                      {layout === 'single' &&
                        '一张纸看全整幅图，自动缩放；大图会画出板框与板号，但格子会变小'}
                      {layout === 'boards' &&
                        `按「拼豆板尺寸」切成一板一页，每块板单独一页、格子放到最大，可 1:1 打印后逐块拼装（当前 ${boardTotal} 页）`}
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
                    再附一页完整用量清单
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
