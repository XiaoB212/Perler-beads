import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { DEFAULT_QUANTIZE, quantizeImage, sampleImage } from '../core/quantize';
import { palettePreset } from '../core/palette';
import type { BeadColor } from '../core/types';
import { IconCheck, IconClose, IconImage, IconUpload, IconWand } from './Icons';
import { renderPatternCanvas } from '../core/export';

interface Props {
  onClose: () => void;
  /** 外部拖入的图片：打开对话框时直接载入 */
  initialFile?: File | null;
}

type Sample = 'point' | 'average';

const PRESET_SIZES: { w: number; h: number; label: string }[] = [
  { w: 29, h: 29, label: '小板' },
  { w: 48, h: 48, label: '中板' },
  { w: 58, h: 58, label: '双板' },
  { w: 96, h: 96, label: '大图' },
];

export default function ImportDialog({ onClose, initialFile }: Props) {
  const doc = useEditor((s) => s.doc);
  const applyImported = useEditor((s) => s.applyImported);
  const notify = useEditor((s) => s.notify);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const [width, setWidth] = useState(48);
  const [maxColors, setMaxColors] = useState(20);
  const [dither, setDither] = useState(0.5);
  const [sample, setSample] = useState<Sample>('average');
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [transparentWhite, setTransparentWhite] = useState(true);
  const [whiteThreshold, setWhiteThreshold] = useState(242);
  // 默认用品牌全色板（色阶充足，渐变过渡自然）；当前图纸色板通常只有几种颜色，留给用户主动选
  const [useDocPalette, setUseDocPalette] = useState(false);
  const [brandKey, setBrandKey] = useState('mard');

  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const height = useMemo(() => {
    if (!img) return width;
    const ratio = img.naturalHeight / img.naturalWidth;
    return Math.max(4, Math.round(width * ratio));
  }, [img, width]);

  const palette: BeadColor[] = useMemo(() => {
    return useDocPalette ? doc.palette : palettePreset(brandKey);
  }, [useDocPalette, doc.palette, brandKey]);

  const result = useMemo(() => {
    if (!img) return null;
    try {
      const data = sampleImage(img, width, height, sample);
      return quantizeImage(data, {
        ...DEFAULT_QUANTIZE,
        width,
        height,
        maxColors: Math.min(maxColors, palette.length),
        dither,
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
    maxColors,
    dither,
    brightness,
    contrast,
    saturation,
    transparentWhite,
    whiteThreshold,
    palette,
  ]);

  // 预览绘制
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
      { cellSize: 8, grid: false, coords: false, background: null, holes: false, showCodes: false, dimUnplaced: false },
    );
    const maxW = 520;
    const scale = Math.min(1, maxW / tmp.width);
    canvas.width = Math.round(tmp.width * scale);
    canvas.height = Math.round(tmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }, [result, doc, width, height]);

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
        // 依据图片比例推荐画布宽度
        const ratio = image.naturalWidth / image.naturalHeight;
        const w = Math.max(16, Math.min(120, Math.round(ratio >= 1 ? 64 : 48)));
        setWidth(w);
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
    applyImported(result.cells, result.palette, width, height, name);
    notify(`已生成 ${width}×${height} 图纸 · ${result.usedCount} 色`);
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
                  <label>画布宽度（格）</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={8}
                      max={160}
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                    />
                    <span className="val">{width}</span>
                  </div>
                  <div className="seg-row" style={{ marginTop: 2 }}>
                    {PRESET_SIZES.map((p) => (
                      <button
                        key={p.w}
                        className={'btn sm ' + (width === p.w ? 'primary' : '')}
                        onClick={() => setWidth(p.w)}
                      >
                        {p.label} {p.w}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>颜色数量上限</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={2}
                      max={64}
                      value={maxColors}
                      onChange={(e) => setMaxColors(Number(e.target.value))}
                    />
                    <span className="val">{maxColors}</span>
                  </div>
                  <span className="hint">颜色越少越好拼，一般 12~24 色足够</span>
                </div>

                <div className="field">
                  <label>抖动（仿色）强度</label>
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
                    {!useDocPalette &&
                      ['mard', 'artkal', 'perler', 'hama', 'basic'].map((k) => (
                        <button
                          key={k}
                          className={'btn sm ' + (brandKey === k ? 'primary' : '')}
                          onClick={() => setBrandKey(k)}
                        >
                          {k.toUpperCase()}
                        </button>
                      ))}
                    <button className="btn sm" onClick={() => setUseDocPalette(false)}>
                      品牌色板
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="dialog-foot">
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
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
