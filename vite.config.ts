import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 版本号只写 package.json 一处，构建时塞进产物，界面上直接显示，
// 这样「线上到底跑的是不是最新一版」一眼就能看出来（之前没有任何地方显示版本）。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};
const buildStamp = new Date().toISOString().slice(0, 10);

// 使用相对 base，保证可部署在 GitHub Pages 的任意子路径（用户名.github.io/仓库名/）
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __APP_BUILD__: JSON.stringify(buildStamp),
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          pdf: ['jspdf'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Windows 下编辑器写入的临时目录会触发 EBUSY，直接忽略。
    // .shots 是验证脚本的截图 / 下载目录：Chrome 往这里写大 PNG 时文件被锁住，
    // vite 去 watch 它会抛 EBUSY 并直接把 dev server 干掉（已经踩过一次），
    // 所以整个目录都不监听。
    watch: {
      ignored: ['**/.*tmpdir/**', '**/node_modules/**', '**/dist/**', '**/.shots/**'],
    },
  },
});
