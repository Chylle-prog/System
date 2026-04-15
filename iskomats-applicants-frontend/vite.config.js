import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    open: true
  },
  build: {
    // Increase chunk size warning threshold
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunks to optimize bundle splitting
        manualChunks: {
          // Vendor chunk for large dependencies
          'vendor': [
            'react',
            'react-dom',
            'react-router-dom'
          ],
          // Separate chunk for socket.io since it's used across the app
          'socket': ['socket.io-client']
        }
      }
    }
  }
})