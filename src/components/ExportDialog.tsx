import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import {
  BOARD_PRESETS,
  DEFAULT_PDF,
  DEFAULT_RENDER,
  DEFAULT_WATERMARK_TEXT,
  DEFAULT_WATERMARK_URL,
  cellAdvice,
  exportBoardZip,
  exportCSV,
  exportPDF,
  exportPNG,
  exportProject,
  exportSVG,
  renderBoardCanvas,
  renderPatternCanvas,
  renderPdfPreviewCanvas,
  type PdfOptions,
  type RenderOptions,
} from '../core/export';
import { PEGBOARD_MAX, boardLabel, clampPegboard } from '../core/board';
import { buildShareUrl } from '../core/share';
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
  const [fitWindow, setFitWindow] = useState(true);
  /** 导出件右下角印一枚二维码：链接太长没法抄，扫码最实际 */
  const [qr, setQr] = useState(true);
  const [qrText, setQrText] = useState(DEFAULT_WATERMARK_URL);
  const [qrBusy, setQrBusy] = useState(false);
  /** PNG / SVG：一板一张，每块板单独一张图，导出时打成一个 zip */
  const [perBoard, setPerBoard] = useState(false);
  /** 预览是不是只看某一块板（大图整张缩在一格里根本看不清色号） */
  const [previewBoard, setPreviewBoard] = useState(false);
  const [boardPage, setBoardPage] = useState(0);

  const previewRef = useRef<HTMLDivElement>(null);
  /** 导出中：PNG 生成大图要几百毫秒，期间把按钮锁住，避免连点导出两份 */
  const [busy, setBusy] = useState(false);

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
      // 水印区不再单独填地址：二维码内容就是这份图纸要指向的地址
      watermarkUrl: qrText,
      fitWindow,
      shape,
      qr,
      qrText,
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
      fitWindow,
      shape,
      qr,
      qrText,
    ],
  );

  const pdfOpts: PdfOptions = useMemo(
    () => ({
      ...DEFAULT_PDF,
      ...renderOpts,
      pageSize,
      orientation,
      layout,
      withHeader: true,
      boardSize,
    }),
    [renderOpts, pageSize, orientation, layout, boardSize],
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

  // 分板预览的翻页越界保护
  useEffect(() => {
    if (boardPage > boardTotal - 1) setBoardPage(0);
  }, [boardTotal, boardPage]);

  // 切到「只看某一块板」时，直接从当前 PDF 页 / 第一块开始
  useEffect(() => {
    if (previewBoard && boardSize <= 0) setPreviewBoard(false);
  }, [previewBoard, boardSize]);

  // 实时预览
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.innerHTML = '';
    if (fmt === 'csv' || fmt === 'project') return;

    let canvas: HTMLCanvasElement;
    if (fmt === 'pdf') {
      canvas = renderPdfPreviewCanvas(doc, { ...pdfOpts, page: pdfPage });
    } else if (previewBoard && boardSize > 0 && boardTotal > 1) {
      // 只看一块板：格子能放到最大，色号肉眼可辨
      const bc = boardPage % boardCols;
      const br = Math.floor(boardPage / boardCols);
      const one = renderBoardCanvas(doc, renderOpts, bc, br, 460);
      if (!one) return;
      canvas = one;
      canvas.style.imageRendering = 'pixelated';
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
  }, [doc, renderOpts, pdfOpts, fmt, boardSize, pdfPage, previewBoard, boardPage, boardCols]);

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (fmt === 'png') {
        if (perBoard && boardSize > 0 && boardTotal > 1) {
          // 一板一张：打成一个 zip，避免 9 个文件同时涌进下载目录被浏览器拦
          const res = await exportBoardZip(doc, renderOpts, 'png');
          notify(`已打包下载 ${res.files} 块板 + 用量清单（zip ${Math.round(res.bytes / 1024)} KB）`);
        } else {
          const res = await exportPNG(doc, renderOpts);
          const shrunk =
            res.cellSize < cellSize - 0.05
              ? `（单格从 ${cellSize}px 自动降到 ${res.cellSize.toFixed(1)}px，再大浏览器就画不出来了）`
              : '';
          notify(`已下载 ${res.width}×${res.height} PNG · ${Math.round(res.bytes / 1024)} KB${shrunk}`);
        }
      } else if (fmt === 'svg') {
        if (perBoard && boardSize > 0 && boardTotal > 1) {
          const res = await exportBoardZip(doc, renderOpts, 'svg');
          notify(`已打包下载 ${res.files} 块板 + 用量清单（zip ${Math.round(res.bytes / 1024)} KB）`);
        } else {
          const res = exportSVG(doc, renderOpts);
          notify(`已下载 SVG · ${Math.round(res.bytes / 1024)} KB`);
        }
      } else if (fmt === 'pdf') {
        const res = exportPDF(doc, pdfOpts);
        notify(`已下载 PDF · ${res.pages} 页`);
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
      // 把真实原因说出来：以前不管什么错都只弹「导出失败，请重试」，
      // 大图导出失败时用户完全不知道是画布太大还是内存不够
      notify(err instanceof Error ? err.message : '导出失败，请重试', 'warn');
    } finally {
      setBusy(false);
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
              <span className="preview-label">
                {fmt === 'pdf'
                  ? '纸张预览'
                  : fmt !== 'csv' && fmt !== 'project' && previewBoard && boardSize > 0 && boardTotal > 1
                    ? `预览 · 板 ${boardLabel(boardPage % boardCols, Math.floor(boardPage / boardCols))}`
                    : '预览'}
              </span>
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
                  {fmt !== 'pdf' && boardSize > 0 && boardTotal > 1 && (
                    <>
                      <label className="checkbox-line" style={{ marginTop: 8 }}>
                        <span
                          className={'checkbox' + (previewBoard ? ' on' : '')}
                          onClick={() => setPreviewBoard(!previewBoard)}
                          role="checkbox"
                          aria-checked={previewBoard}
                          tabIndex={0}
                        >
                          {previewBoard && <IconCheck width={11} height={11} />}
                        </span>
                        <span onClick={() => setPreviewBoard(!previewBoard)}>
                          逐块预览：一次只看一块板，格子放到最大
                        </span>
                      </label>
                      {previewBoard && (
                        <div className="pdf-pager">
                          <button
                            className="btn ghost sm"
                            disabled={boardPage === 0}
                            onClick={() => setBoardPage((p) => Math.max(0, p - 1))}
                          >
                            上一块
                          </button>
                          <span>
                            第 {boardPage + 1} / {boardTotal} 块
                            {boardSize > 0 ? ` · ${boardLabel(boardPage % boardCols, Math.floor(boardPage / boardCols))}` : ''}
                          </span>
                          <button
                            className="btn ghost sm"
                            disabled={boardPage >= boardTotal - 1}
                            onClick={() => setBoardPage((p) => Math.min(boardTotal - 1, p + 1))}
                          >
                            下一块
                          </button>
                        </div>
                      )}
                    </>
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
                    {fmt !== 'pdf' && (
                      <>
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
                      </>
                    )}
                  </div>
                  {fmt === 'pdf' && (
                    <span className="hint" style={{ display: 'block', marginTop: -4 }}>
                      PDF 是打印用的纸，底色始终是白的，所以这里没有「背景 / 透明」两项。
                    </span>
                  )}
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
                  {(fmt === 'png' || fmt === 'svg') && boardSize > 0 && boardTotal > 1 && (
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
                        一板一张打包：每块板单独一张图，打成一个 zip 一次下载（{boardTotal} 张图 + 1 份用量清单）
                      </span>
                    </label>
                  )}
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
                      <span className="hint">
                        只在左下角印这一行字。地址不再另印一行 —— 右下角的二维码扫出来就是同一个地址。
                      </span>
                    </div>
                  )}
                  <div className="check-row" onClick={() => setQr((v) => !v)}>
                    <span className={'checkbox' + (qr ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    右下角印二维码（扫码打开）
                  </div>
                  {qr && (
                    <div className="field">
                      <label>二维码内容</label>
                      <input
                        className="input"
                        value={qrText}
                        placeholder="https://"
                        onChange={(e) => setQrText(e.target.value)}
                      />
                      <div className="qr-pick">
                        <button
                          className="btn sm"
                          onClick={() => setQrText(DEFAULT_WATERMARK_URL)}
                          title="二维码指向项目首页"
                        >
                          项目地址
                        </button>
                        <button
                          className="btn sm"
                          disabled={qrBusy}
                          onClick={async () => {
                            setQrBusy(true);
                            try {
                              const res = await buildShareUrl(doc);
                              setQrText(res.url);
                              setQr(true);
                              notify(
                                res.tooLong
                                  ? `进度链接 ${res.length} 字符，二维码里塞不下，换个更小的图试试`
                                  : `二维码已换成这张图纸的进度链接（${res.length} 字符）`,
                                res.tooLong ? 'warn' : 'ok',
                              );
                            } finally {
                              setQrBusy(false);
                            }
                          }}
                          title="把这张图纸和当前进度做成链接，二维码扫出来就能看到"
                        >
                          {qrBusy ? '生成中…' : '这张图纸的进度'}
                        </button>
                      </div>
                      <span className="hint">
                        链接太长时复制粘贴很容易断，二维码扫一下就进去了。打印机票大小的纸也能扫。
                      </span>
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
                          {boardSize > 0 && boardTotal > 1 && !perBoard && (
                            <button className="btn sm primary" onClick={() => setPerBoard(true)}>
                              一板一张打包（{boardTotal} 块板，一个 zip）
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {(fmt === 'png' || fmt === 'svg') && boardSize > 0 && boardTotal > 1 && (
                    <span className="hint" style={{ display: 'block' }}>
                      预览框下面可以勾「逐块预览」，一次只看一块板。
                    </span>
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
                  <span className="hint" style={{ display: 'block' }}>
                    一板一页时每页下方自动列出「本板色号用量」，和 PNG / SVG 的用量表是同一套排版。
                  </span>
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
          <button className="btn primary" onClick={doExport} disabled={busy}>
            <IconDownload width={14} height={14} /> {busy ? '导出中…' : `导出 ${fmt.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
