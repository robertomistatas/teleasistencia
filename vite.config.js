import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/teleasistencia/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: {
        main: './index.html',
      },
      output: {
        manualChunks: {
          vendor: [
            'react',
            'react-dom',
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/analytics',
            'xlsx'
          ]
        }
      }
    }
  }
})
