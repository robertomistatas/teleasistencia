import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    manifest: true,
    // Aumentar el límite de advertencia de tamaño de chunks
    chunkSizeWarningLimit: 1000, // 1000kb (1MB)
    rollupOptions: {
      input: {
        main: './index.html',
      },
      output: {
        manualChunks: {
          // Vendors principales
          'vendor-react': [
            'react',
            'react-dom',
          ],
          // Firebase
          'vendor-firebase': [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/analytics',
          ],
          // Utilidades y herramientas
          'vendor-utils': [
            'xlsx'
          ],
          // Componentes de terceros (si se requieren)
          'vendor-ui': [
            '@heroicons/react'
          ]
        }
      }
    },
    // Optimizaciones adicionales
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Cambiar a true en producción final
        drop_debugger: true
      }
    }
  }
})
