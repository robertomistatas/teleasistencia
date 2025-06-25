import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/teleasistencia/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    manifest: true,
    minify: 'terser',
    chunkSizeWarningLimit: 1000,
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true
      }
    },
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          firebase: [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/analytics'
          ],
          charts: ['recharts', 'chart.js', 'react-chartjs-2'],
          xlsx: ['xlsx'],
          utils: [
            './src/utils/dateUtils.js',
            './src/utils/statsUtils.js',
            './src/utils/textUtils.js'
          ]
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    open: true
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: true
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'recharts', 'firebase/app']
  }
})
