import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 3010,
    open: true
  },
  // Disable identifier renaming (minifyIdentifiers) to prevent esbuild TDZ
  // ReferenceErrors caused by const arrow functions being renamed and reordered
  // in the minified output (e.g. "Cannot access 'ge' before initialization").
  // Syntax and whitespace minification are still applied for bundle size.
  esbuild: {
    minifyIdentifiers: false,
  },
  build: {
    // Increase chunk size warning threshold
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunks to optimize bundle splitting
        manualChunks: {
          // Vendor chunk for large dependencies including socket.io-client to avoid adblocker triggers on filenames
          'vendor': [
            'react',
            'react-dom',
            'react-router-dom',
            'socket.io-client'
          ]
        }
      }
    }
  }
})