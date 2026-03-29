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
    minify: 'esbuild'
  }
})
