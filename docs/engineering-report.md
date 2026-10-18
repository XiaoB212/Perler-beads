# 拼豆工作室 · Perler Studio — 工程总结与多端 App 路线

> 线上地址：https://xiaob212.github.io/Perler-beads/
> 仓库：`XiaoB212/Perler-beads`（`main` 分支 = 源码，`gh-pages` = 构建产物）
> 最后提交：`9a02706`

---

## 一、项目是什么

一个**纯前端、本地优先、无需登录**的拼豆（Perler Beads）图纸工作台。从一张图或一块空白画布开始，生成按真实拼豆板切分的图纸，边拼边勾进度，最后导出能直接打印的纸样。

核心能力（全部离线可用，运行时零网络请求）：

- 画布：铅笔 / 橡皮 / 填充 / 直线 / 矩形 / 椭圆 / 吸管 / 平移，16 档笔刷，对称绘制，撤销重做
- 以图生图：图片 → 色号图纸，10 套真实品牌色卡，CIEDE2000 色差匹配，三种抖动算法
- 色号体系：2449 个真实色号，可增删改、可导入导出、可按品牌切换、可自定义色号表
- 进度：进度模式（只记「拼了没」）与线上拼豆模式（对色判对错）互相独立
- 用量与成本：每色颗数、补货量、按单价算花费
- 导出：PNG / SVG / PDF / CSV / 工程文件，可整张一页、一板一页、一板一张打 zip，图上印色号 + 用量表 + 二维码
- 分享：整张图纸压进 URL（二进制编码 + 三种压缩候选取最短），也可扫二维码
- 工程化：自动保存 + 版本快照回溯、38 条可自定义快捷键、亮/暗主题、桌面/平板/手机三档布局

---

## 二、技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | React 18 + TypeScript 5（strict） | 无 UI 库、无 CSS 框架，全部手写 |
| 构建 | Vite 5 | `base: './'`，可部署到任意子路径 |
| 状态 | zustand 4 | 单 store，TypedArray 存格子 |
| 渲染 | Canvas 2D（双 canvas：底图 + 覆盖层） | 按色 `Path2D` 批处理 + 视口裁剪 |
| PDF | jsPDF 2.5（独立 chunk） | 中文用 canvas 转 PNG 贴图 |
| 二维码 | qrcode-generator 2.0（零依赖） | 自写矩阵 → path / canvas |
| 压缩包 | 自写 `zip.ts` | 零依赖 ZIP（store 模式 + CRC32） |
| 测试 | puppeteer-core 23 + 本地 Chrome | 44 个端到端脚本 |

运行时依赖只有 5 个：`react`、`react-dom`、`zustand`、`jspdf`、`qrcode-generator`。

---

## 三、代码结构

```
src/
├── App.tsx                 961 行  应用外壳：顶栏 / 左工具栏 / 画布 / 右侧面板 / 对话框 / 快捷键分发
├── main.tsx                       入口
├── components/
│   ├── CanvasStage.tsx    1006 行  画布：绘制、命中测试、手势、光标、分板、聚焦、形状预览
│   ├── ExportDialog.tsx    759 行  导出面板：五种格式、预览、逐块翻页、清晰度建议
│   ├── ImportDialog.tsx    701 行  以图生图：板数 / 比例 / 抖动 / 色卡 / 实时预览
│   ├── SettingsPanel.tsx   516 行  设置：主题、画笔、格子形状、分板、自动保存、版本
│   ├── ColorManager.tsx    486 行  色号管理：本图纸色板 / 品牌色板 / 导入 / 导出
│   ├── UsagePanel.tsx      322 行  用量与成本
│   ├── ProgressPanel.tsx   298 行  对色面板：进度环、错号、色号格、分享、二维码
│   ├── ColorPanel.tsx      250 行  色块网格（常显色号）
│   ├── NewCanvasDialog.tsx 227 行  新建：单板格数 × 板数
│   ├── Icons.tsx           289 行  29 个手写 SVG 图标
│   ├── ProjectsDialog.tsx          本地图纸列表
│   └── ShortcutsDialog.tsx         快捷键录制
├── core/                   （20 个模块，平台无关）
│   ├── types.ts                    PatternDoc / ViewFlags / Tool / BeadColor
│   ├── store.ts            836 行  全部编辑动作、撤销栈、进度判定、导入导出
│   ├── export.ts          1752 行  PNG / SVG / PDF / CSV / 工程 / 一板一张 / 预览
│   ├── share.ts            556 行  分享链接编解码（v3 二进制）
│   ├── quantize.ts         341 行  采样、白底连通判定、k-means、抖动
│   ├── palette*.ts         2533(+367) 行  2449 色数据 + 解析 + 导入导出
│   ├── backup.ts           288 行  自动保存配置 + 版本快照
│   ├── qr.ts / zip.ts              二维码 / ZIP
│   ├── board.ts / color.ts / cost.ts / keymap.ts / rle.ts / storage.ts / theme.ts / util.ts / demo.ts
└── styles/                 6 个 CSS 文件，约 3000 行，全部用 CSS 变量做主题
```

规模：**40 个源文件、17 829 行**（TS/TSX/CSS），`docs/img/` 21 张教程截图，`scripts/` 138 个脚本（其中 44 个断言式回归测试）。

---

## 四、关键工程决策

### 1. 用 TypedArray 而不是对象数组存图纸
`cells: Uint16Array`（0 = 空，n = 第 n 个色号）、`progress: Uint8Array`。1024×1024 的图也只占 3 MB，撤销栈按字节预算裁剪（240 MB 上限），大图自动降低撤销深度。

### 2. 画布按色批处理 + 视口裁剪
不是逐格 `fillRect`，而是按十六进制颜色聚合成若干 `Path2D`，一次 `fill()`。100 万格也只有十几次绘制调用；只处理视口内格子（`vx0…vy1`），平移缩放不掉帧。

### 3. 双 canvas 分层
底图（图案、网格、板线）与覆盖层（光标、形状预览、悬停）分开，指针移动只重绘覆盖层。

### 4. 导出件的几何必须和分板对齐
这是最容易被忽略、也最容易出 bug 的地方：网格线、格子、板缝用了两套坐标就会「越往右越偏」。修法是抽出 `gridLinePositions()` / `gridStrongPositions()`，让 PNG / SVG / PDF 三条渲染管线共用同一套板偏移计算。

### 5. 色差用 CIEDE2000，并用 Lab 距离粗筛
直接对 291 色全量算 CIEDE2000，一张 160×160 图要几秒。改成「Lab 欧氏距离先取 12 个候选，再在候选里算 CIEDE2000」，快约 24 倍且观感无差。

### 6. 白底判定必须「从边缘连通扩散」
早期只要像素够白就判成空格，结果人物高光、白衣服、眼睛反光被挖成洞 —— 用户看到的「中间一块块没色号」。改成从四条边 BFS 扩散，只有连到画布边缘的白才算背景。

### 7. 分享链接：能压就压，压不动就说清楚
URL 里塞整张图，物理上有上限（25 600 颗的信息熵远超 50 字符）。做法是：
- 二进制编码（varint + 位图/RLE），色号命中内置色卡只存「第几套第几个」
- 格子三候选编码（游程 / 左邻差分 / 二维差分），各自 deflate 后取最短
- 实测：64×64 七色图 201 字符；160×160 块状图 743 字符；照片级噪声才上万（此时提示改用二维码）

### 8. 中文字体在 PDF 里的处理
jsPDF 内置 Helvetica 没有中文字形。`pdfTextSafe()` 把文本画到 canvas 再 `addImage`，代价是文字不可选中，但保证不出现豆腐块。

### 9. 计算与渲染解耦
`src/core` 里的计算（量化、色差、编码、布局）都是纯函数，只有 `export.ts` / `qr.ts` 依赖 canvas。这为后续多端复用留了口子（见第七节）。

---

## 五、踩过的坑（值得写进 next 项目的 checklist）

| 现象 | 根因 | 修法 |
|---|---|---|
| 色板 RGB 距离算错 | `((pr >> 16) & 255 - r1) ** 2` 运算符优先级 | 补括号 |
| 拼好的计数不刷新 | `paintProgressCell` 原地改 TypedArray，`useMemo` 依赖数组按引用比较 | 依赖改成整个 `doc` |
| 主题选完不持久 | 局部 state setter 与导入的 `setThemeMode` 同名遮蔽 | 重命名导入 |
| 移动端首屏图被裁 | `ResizeObserver` 之前用默认 800×600 初始 `size` | 初始 `{w:0,h:0}` |
| 平移抖 ±1px | `Math.round` 把逻辑坐标吸到整数 CSS 像素 | 吸到设备像素（`round(v*dpr)/dpr`） |
| 滚轮丢步 / 回跳 | 事件里用闭包里的旧 `pan` | store 里加 `panBy()` 基于最新状态累加 |
| 只改 hash 不跳转 | 同文档导航不重挂载 effect | 监听 `hashchange` |
| 导出的 SVG 少一块板 | 只画每格左边界，板尾没有收边线 | 每格左右边界都画 + 去重 |
| 形状工具全是方块 | 预览层不分工具有一律画包围盒矩形 | 按 tool 逐格算真实落点 |
| 测试说功能坏了其实是测试错 | 测试里 `import('/src/core/store.ts')` 拿到另一个模块实例 | 只读 DOM 与画布像素 |
| 中文 `.mjs` 变乱码 | PowerShell `-replace` + `Set-Content` 按 ANSI 重编码 | 用 `[System.IO.File]::WriteAllText` + 无 BOM UTF-8 |

---

## 六、质量保障

- **类型**：`tsc -b` strict，每次改动后必须 0 错误
- **回归**：44 个 puppeteer 脚本，覆盖画布交互、导出五格式字节检查、PDF 页数与 `/URI`、SVG 图例与二维码、色板导入导出、快捷键组合、分板聚焦、进度判定、自动保存、移动端工具条、子路径部署
- **视觉**：21 张教程截图由脚本生成（`doc-shots*.mjs`），功能改了截图跟着重出，README 不脱节
- **线上冒烟**：`pages-new-test.mjs` 直接打线上域名，确认部署产物与本地一致

---

## 七、多端 App 路线（iOS / iPadOS / Android / Linux / Windows）

### 结论先说

**首选 Tauri 2**：一套 React 代码 + 一个 Rust 壳，同时产出 Windows / Linux / macOS 安装包和 iOS / Android 应用。包体约 3–10 MB（Electron 是 100 MB+），用系统 WebView，内存占用低，且现有代码量能复用 90% 以上。

**备选 Capacitor**：如果 iOS/iPad 体验要求极高（需要大量原生插件、Apple Pencil 压感、后台任务），Capacitor 的插件生态更成熟，但 Windows/Linux 端会退化成「网页套壳」，一般不推荐跨全部平台用它。

**不推荐**：Electron（体积/内存代价大，且我们已经有更轻的等价方案）、Flutter/React Native 重写（几何渲染、PDF、导出管线要全部重做，等于重写项目）。

### 为什么现有代码适合直接包壳

| 现状 | 对多端的意义 |
|---|---|
| 运行时零网络、无后端 | 天然离线 App，不需要服务器与账号体系 |
| 数据存 localStorage + 文件导入导出 | 桌面端换成文件系统即可，移动端继续用沙盒存储 |
| 自写 `zip.ts` / `qr.ts` | 不依赖 Node API，WebView 里就能跑 |
| jsPDF 在浏览器里生成 PDF | 桌面/移动都能本地出 PDF，不依赖云打印 |
| 计算层是纯 TS 纯函数 | 未来若做原生渲染，逻辑可原样复用 |
| 触控手势已支持（双指缩放、单指绘制） | 平板/iPad 上手成本低 |

### 需要改造的地方

1. **平台抽象层**（新增 `src/platform/`）
   - `storage`：Web = localStorage；Tauri = `@tauri-apps/plugin-store` + 文件；Capacitor = Preferences
   - `files`：导出/导入走 `dialog.save` / `dialog.open`，桌面端支持「另存为到任意目录」，移动端走系统分享面板
   - `share`：桌面端可注册自定义协议 `perler://`，移动端走系统 Share Sheet
   - `print`：桌面端直接调系统打印（PDF 已就绪），移动端走 AirPrint / 打印服务

2. **canvas 依赖收敛**
   `export.ts` / `qr.ts` / `quantize.ts` 里的 `document.createElement('canvas')` 抽成 `createCanvas()` 适配器：浏览器用 DOM canvas，桌面端可换 `OffscreenCanvas` 或 node-canvas（用于「批量导出/命令行批处理」这种进阶场景）。

3. **触控 UI 调优（平板/iPad）**
   - 命中区 ≥ 44pt：现有工具栏按钮 40px 左右，需要一档「平板密度」
   - 底部工具条常驻（现在手机已有 `.mtools`），iPad 上把右侧面板改成可拖拽浮层
   - Apple Pencil：`pointerType === 'pen'` + `pressure` 映射笔刷粗细（现在固定 1–16 档）
   - 长按 = 右键菜单（取色、清空该格、整色完成）

4. **移动端包体与首屏**
   - `pdf` 独立 chunk 358 kB，改成「点了导出 PDF 再动态 import」（现在已经是动态 chunk，确认预加载策略即可）
   - 21 张教程图不进 App 包（改为应用内说明页）

5. **自动更新与签名**
   - Windows：MSIX 或 NSIS + 代码签名证书（否则 SmartScreen 拦）
   - macOS：需要 Apple Developer 账号 + 公证（notarization）
   - Linux：AppImage（免安装）+ `.deb` + Flatpak
   - iOS：TestFlight 内测 → App Store；需要 $99/年开发者账号
   - Android：APK 直发 + AAB 上架；平板要单独适配横屏

### 分阶段计划

| 阶段 | 目标 | 工作量估计 | 交付物 |
|---|---|---|---|
| P0 | 平台抽象层 + Tauri 壳跑通 | 1–2 周 | `src-tauri/`、Windows `.msi`/`.exe`、Linux `.AppImage` |
| P1 | 桌面端文件系统对接（打开/另存/自动备份到本地目录） | 1 周 | 桌面版可脱离浏览器使用 |
| P2 | 平板/iPad 触控与布局打磨 | 1–2 周 | iPad 横屏/竖屏、Apple Pencil 压感 |
| P3 | iOS / Android 打包与上架 | 2–3 周（含审核） | TestFlight / APK / AAB |
| P4 | CI 自动构建四平台产物 | 3–5 天 | GitHub Actions matrix（Windows / Ubuntu / macOS + 移动端） |
| P5（可选） | 实时协作（同 LAN 一起拼） | 需后端或 WebRTC 信令 | 单独立项 |

### 风险清单

- **iOS WebView 的 canvas 性能**：超大画布（>50 万格）在 WKWebView 上可能掉帧，需要「大图自动降采样预览 + 导出仍全精度」
- **Tauri 2 移动端仍较新**：插件与 iOS 构建链路踩坑概率高于桌面端，建议先交付 P0/P1 桌面版，再评估移动端是否切 Capacitor
- **应用商店合规**：隐私政策、无账号体系的数据说明、iPad 分屏支持声明
- **代码签名成本**：Windows 证书 + Apple 开发者账号是持续支出

---

## 八、已知技术债 / 后续可做

- `CanvasStage.tsx`（1006 行）与 `export.ts`（1752 行）偏大，可按「渲染 / 交互 / 布局 / 图例」拆分
- `App.tsx` 里 38 条快捷键是一个大 switch，可改为 action 注册表
- 分享链接对照片级图像仍然很长（物理上限），可考虑「短链服务」作为可选增强（需后端）
- PDF 中文靠贴图，文字不可选中；若要可选文字需内嵌中文字体（包体 +2 MB）
- 缺少单元测试层：核心纯函数（`color.ts`、`board.ts`、`share.ts` 编解码）值得加 vitest，比端到端快得多
- 无 i18n：目前只有中文，多端上架若面向海外需要英文文案

---

## 九、数据与格式附录

**工程文件 `.perler.json`**：`{ version, name, width, height, pegboard, palette[], cells(RLE), progress(RLE), notes, updatedAt }`

**色板文件 `.palette.json` / CSV**：`[{ brand, code, name, hex, price?, stock? }]`

**分享链接 v3 payload**（`#p=` 后 base64url，可再 deflate）：
```
magic(0x50) version(3) flags(1B) width(varint) height(varint)
[name] [pegboard] colors(varint 个：命中色卡=0+p+i / 否则 1+RGB+code+name+brand)
cells(mode + len + body)  progress(mode + len + body)
```

**色号数据来源**：`HansBug/pindou-color-data`（MIT），构建时由 `scripts/gen-palettes.mjs` 烘进 `palette-data.ts`，共 2449 色 / 10 套色卡，运行时零网络。
