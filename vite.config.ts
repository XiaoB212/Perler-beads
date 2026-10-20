import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 使用相对 base，保证可部署在 GitHub Pages 的任意子路径（用户名.github.io/仓库名/）
export default defineConfig({
  base: './',
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
