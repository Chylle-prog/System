import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    transformer: 'postcss',
    lightningcss: false
  },
  build: {
    cssMinify: 'esbuild',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-core': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['chart.js'],
          'vendor-utils': ['xlsx', 'jspdf', 'jspdf-autotable'],
          'vendor-icons': ['react-icons'],
          'vendor-socket': ['socket.io-client']
        }
      }
    }
  }
})
