import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { DEFAULT_QUANTIZE, quantizeImage, sampleImage } from '../core/quantize';
import { BUILTIN_PALETTES, BRAND_LABEL, PALETTE_KEYS, palettePreset } from '../core/palette';
import type { BeadColor } from '../core/types';
import { IconCheck, IconClose, IconImage, IconUpload, IconWand } from './Icons';
import { renderPatternCanvas } from '../core/export';
import { PEGBOARD_MAX, PEGBOARD_PRESETS, clampPegboard } from '../core/board';

interface Props {
  onClose: () => void;
  /** 外部拖入的图片：打开对话框时直接载入 */
  initialFile?: File | null;
}

type Sample = 'point' | 'average';

/** 单板格数常用档：直接取拼豆板规格表，和画布设置里的分板保持一致 */
const BOARD_SIZES = PEGBOARD_PRESETS.filter((p) => p.value > 0);

export default function ImportDialog({ onClose, initialFile }: Props) {
  const doc = useEditor((s) => s.doc);
  const applyImported = useEditor((s) => s.applyImported);
  const notify = useEditor((s) => s.notify);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  // 尺寸按「真实的拼豆板」来定：单板格数 × 横纵板数。
  // 之前只有一个「画布宽度（格）」滑杆，用户拿到 64×64 的图根本不知道自己要用几块板，
  // 预览里也没有分板线，所以才会说「完全不是按照板子数量分的」。
  const [boardSize, setBoardSize] = useState(29);
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(2);
  const [dither, setDither] = useState(0.5);
  const [ditherMode, setDitherMode] = useState<'none' | 'fs' | 'ordered'>('fs');
  const [sample, setSample] = useState<Sample>('average');
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [transparentWhite, setTransparentWhite] = useState(true);
  const [whiteThreshold, setWhiteThreshold] = useState(242);
  // 默认用品牌全色板（色阶充足，渐变过渡自然）；当前图纸色板通常只有几种颜色，留给用户主动选
  const [useDocPalette, setUseDocPalette] = useState(false);
  // 直接用完整 key，避免再靠 ALIASES 把 'mard' 映射成 'mard291'
  const [brandKey, setBrandKey] = useState('mard291');

  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const width = boardSize * cols;
  const height = boardSize * rows;

  const palette: BeadColor[] = useMemo(() => {
    return useDocPalette ? doc.palette : palettePreset(brandKey);
  }, [useDocPalette, doc.palette, brandKey]);

  const result = useMemo(() => {
    if (!img) return null;
    try {
      // cover 采样：画布比例由板数锁死，宁可裁掉图片多出来的部分也不要拉扁人脸
      const data = sampleImage(img, width, height, sample, 'cover');
      return quantizeImage(data, {
        ...DEFAULT_QUANTIZE,
        width,
        height,
        maxColors: palette.length,
        dither,
        ditherMode,
        sample,
        brightness,
        contrast,
        saturation,
        transparentWhite,
        whiteThreshold,
        palette,
      });
    } catch {
      return null;
    }
  }, [
    img,
    width,
    height,
    sample,
    dither,
    ditherMode,
    brightness,
    contrast,
    saturation,
    transparentWhite,
    whiteThreshold,
    palette,
  ]);

  // 预览绘制：带分板线，让用户一眼看到「这是几块板拼起来」
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !result) return;
    const tmp = renderPatternCanvas(
      {
        ...doc,
        width,
        height,
        cells: result.cells,
        progress: new Uint8Array(width * height),
        palette: result.palette,
      },
      {
        cellSize: 8,
        grid: false,
        coords: false,
        background: null,
        holes: false,
        showCodes: false,
        dimUnplaced: false,
        boardSize: boardSize > 0 ? boardSize : 0,
      },
    );
    const maxW = 520;
    const scale = Math.min(1, maxW / tmp.width);
    canvas.width = Math.round(tmp.width * scale);
    canvas.height = Math.round(tmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }, [result, doc, width, height, boardSize]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    // 用 dataURL 而不是 blobURL：后者在 onload 里被回收后，<img> 会变成裂图
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        setImg(image);
        setFileName(file.name);
        // 画布尺寸由「板数 × 单板格数」决定，不再按图片比例改格子数；
        // 但可以按图片比例推荐一个板数排布，省得用户自己算，改完还能手动调。
        const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
        if (Number.isFinite(ratio) && ratio > 0) {
          if (ratio >= 1.12) {
            setRows(2);
            setCols(Math.max(1, Math.min(8, Math.round(2 * ratio))));
          } else if (ratio <= 0.89) {
            setCols(2);
            setRows(Math.max(1, Math.min(8, Math.round(2 / ratio))));
          } else {
            setCols(2);
            setRows(2);
          }
        }
      };
      image.onerror = () => alert('图片读取失败');
      image.src = String(reader.result);
    };
    reader.onerror = () => alert('图片读取失败');
    reader.readAsDataURL(file);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  // 从画布区直接拖入的图片：打开对话框即载入
  useEffect(() => {
    if (initialFile) loadFile(initialFile);
  }, [initialFile, loadFile]);

  const doImport = () => {
    if (!result) return;
    setBusy(true);
    const name = fileName.replace(/\.[^.]+$/, '') || '图片转图纸';
    applyImported(result.cells, result.palette, width, height, name, boardSize);
    notify(`已生成 ${width}×${height} 图纸 · ${cols * rows} 块 ${boardSize}×${boardSize} 板 · ${result.usedCount} 色`);
    setBusy(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>以图生图 · 图片转图纸</h2>
            <p>上传图片，自动量化为拼豆色号，可实时预览与微调</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="dialog-body">
          {!img ? (
            <div
              className={'dropzone' + (over ? ' over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              <IconImage />
              <b>点击选择或拖入图片</b>
              <span>支持 PNG / JPG / WebP / GIF · 图片不会上传到任何服务器</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f);
                }}
              />
            </div>
          ) : (
            <div className="import-grid">
              <div>
                <div className="preview-box" style={{ minHeight: 260 }}>
                  <span className="preview-label">原图</span>
                  <img src={img.src} alt="source" style={{ maxHeight: 300 }} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn sm" onClick={() => fileRef.current?.click()}>
                    <IconUpload width={12} height={12} /> 换一张
                  </button>
                  <span className="chip" style={{ flex: 1, justifyContent: 'center', minWidth: 0 }}>
                    {fileName}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadFile(f);
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="preview-box" style={{ minHeight: 260 }}>
                  <span className="preview-label">
                    图纸预览 {result ? `· ${result.usedCount} 色` : ''}
                  </span>
                  <canvas ref={previewRef} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span className="chip accent">
                    {width} × {height}
                  </span>
                  <span className="chip">
                    {cols} × {rows} 块板
                  </span>
                  <span className="chip">
                    豆子 {result ? result.cells.reduce((a, b) => a + (b ? 1 : 0), 0) : 0} 颗
                  </span>
                </div>
              </div>
            </div>
          )}

          {img && (
            <>
              <div className="divider" />
              <div className="form-grid">
                <div className="field">
                  <label>单板格数</label>
                  <div className="slider-row">
                    <input
                      type="number"
                      className="input"
                      min={2}
                      max={PEGBOARD_MAX}
                      value={boardSize}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setBoardSize(clampPegboard(Number.isFinite(v) ? v : 29) || 29);
                      }}
                      style={{ width: 88 }}
                    />
                    <span className="val">× {boardSize} 格 / 块</span>
                  </div>
                  <div className="seg-wrap" style={{ marginTop: 2 }}>
                    {BOARD_SIZES.slice(0, 8).map((p) => (
                      <button
                        key={p.value}
                        className={boardSize === p.value ? 'active' : ''}
                        onClick={() => setBoardSize(p.value)}
                        title={`每块板 ${p.value} × ${p.value} 格${p.note ? ' · ' + p.note : ''}`}
                      >
                        {p.value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>用几块板（横 × 纵）</label>
                  <div className="slider-row">
                    <span className="val" style={{ width: 'auto' }}>横</span>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={cols}
                      onChange={(e) => setCols(Number(e.target.value))}
                    />
                    <span className="val">{cols}</span>
                    <span className="val" style={{ width: 'auto', marginLeft: 6 }}>纵</span>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={rows}
                      onChange={(e) => setRows(Number(e.target.value))}
                    />
                    <span className="val">{rows}</span>
                  </div>
                  <span className="hint">
                    {cols} × {rows} = {cols * rows} 块 {boardSize}×{boardSize} 板，合计 {width} × {height} 格
                  </span>
                </div>

                <div className="field">
                  <label>抖动算法</label>
                  <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                    <button className={ditherMode === 'none' ? 'active' : ''} onClick={() => setDitherMode('none')}>
                      无
                    </button>
                    <button className={ditherMode === 'fs' ? 'active' : ''} onClick={() => setDitherMode('fs')}>
                      误差扩散
                    </button>
                    <button className={ditherMode === 'ordered' ? 'active' : ''} onClick={() => setDitherMode('ordered')}>
                      有序抖动
                    </button>
                  </div>
                  <span className="hint">无 = 最干净；误差扩散 = 过渡自然；有序 = 规则网纹，印刷感强</span>
                </div>

                {ditherMode !== 'none' && (
                  <div className="field">
                    <label>抖动强度</label>
                    <div className="slider-row">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={dither}
                        onChange={(e) => setDither(Number(e.target.value))}
                      />
                      <span className="val">{dither.toFixed(2)}</span>
                    </div>
                    <span className="hint">高抖动可还原渐变，低抖动更干净</span>
                  </div>
                )}

                <div className="field">
                  <label>采样方式</label>
                  <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                    <button className={sample === 'average' ? 'active' : ''} onClick={() => setSample('average')}>
                      平均采样
                    </button>
                    <button className={sample === 'point' ? 'active' : ''} onClick={() => setSample('point')}>
                      单点采样
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label>亮度</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0.5}
                      max={1.6}
                      step={0.02}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                    />
                    <span className="val">{brightness.toFixed(2)}</span>
                  </div>
                </div>

                <div className="field">
                  <label>对比度</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.02}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                    />
                    <span className="val">{contrast.toFixed(2)}</span>
                  </div>
                </div>

                <div className="field">
                  <label>饱和度</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.02}
                      value={saturation}
                      onChange={(e) => setSaturation(Number(e.target.value))}
                    />
                    <span className="val">{saturation.toFixed(2)}</span>
                  </div>
                </div>

                <div className="field">
                  <label>白底处理</label>
                  <div className="check-row" onClick={() => setTransparentWhite((v) => !v)}>
                    <span className={'checkbox' + (transparentWhite ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    接近纯白的背景转为空豆
                  </div>
                  {transparentWhite && (
                    <div className="slider-row">
                      <input
                        type="range"
                        min={200}
                        max={255}
                        value={whiteThreshold}
                        onChange={(e) => setWhiteThreshold(Number(e.target.value))}
                      />
                      <span className="val">{whiteThreshold}</span>
                    </div>
                  )}
                </div>

                <div className="field full">
                  <label>匹配色板</label>
                  <div className="seg-row">
                    <button
                      className={'btn sm ' + (useDocPalette ? 'primary' : '')}
                      onClick={() => setUseDocPalette(true)}
                    >
                      当前图纸色板 · {doc.palette.length} 色
                    </button>
                    <button
                      className={'btn sm ' + (!useDocPalette ? 'primary' : '')}
                      onClick={() => setUseDocPalette(false)}
                    >
                      品牌色板
                    </button>
                  </div>
                  {/* 品牌色板一律列全 10 套，不随「当前图纸色板」隐藏——
                      之前选到图纸色板后整排品牌按钮就消失了，看着像点不开。 */}
                  <select
                    className="input"
                    style={{ marginTop: 8 }}
                    value={brandKey}
                    onChange={(e) => {
                      setBrandKey(e.target.value);
                      setUseDocPalette(false);
                    }}
                    title="选一套品牌色卡来匹配这张图，导入后还能在「色号管理」里继续改"
                  >
                    {PALETTE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {BRAND_LABEL[k] ?? k} · {BUILTIN_PALETTES[k]?.length ?? 0} 色
                      </option>
                    ))}
                  </select>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {useDocPalette
                      ? `用当前图纸里的 ${doc.palette.length} 种颜色匹配，导入后色号与现场一致`
                      : `用 ${BRAND_LABEL[brandKey] ?? brandKey} 的全套 ${palette.length} 色匹配，渐变过渡更自然`}
                    ；导入后仍可在「色号管理」里换色卡或逐个改色号。
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="dialog-foot">
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {img ? '导入后将替换当前画布内容，可用 Ctrl+Z 撤销' : '选择图片后可调整参数'}
          </span>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!img || !result || busy} onClick={doImport}>
            <IconWand width={14} height={14} /> 生成图纸
          </button>
        </div>
      </div>
    </div>
  );
}
