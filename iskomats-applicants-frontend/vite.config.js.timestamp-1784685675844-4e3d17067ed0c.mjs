// vite.config.js
import { defineConfig } from "file:///C:/Users/Chyle/OneDrive/Desktop/System/iskomats-applicants-frontend/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Chyle/OneDrive/Desktop/System/iskomats-applicants-frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///C:/Users/Chyle/OneDrive/Desktop/System/iskomats-applicants-frontend/node_modules/@tailwindcss/vite/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 3010,
    open: true
  },
  build: {
    // Increase chunk size warning threshold
    chunkSizeWarningLimit: 1e3,
    rollupOptions: {
      output: {
        // Manual chunks to optimize bundle splitting
        manualChunks: {
          // Vendor chunk for large dependencies
          "vendor": [
            "react",
            "react-dom",
            "react-router-dom"
          ],
          // Separate chunk for socket.io since it's used across the app
          "socket": ["socket.io-client"]
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxDaHlsZVxcXFxPbmVEcml2ZVxcXFxEZXNrdG9wXFxcXFN5c3RlbVxcXFxpc2tvbWF0cy1hcHBsaWNhbnRzLWZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxDaHlsZVxcXFxPbmVEcml2ZVxcXFxEZXNrdG9wXFxcXFN5c3RlbVxcXFxpc2tvbWF0cy1hcHBsaWNhbnRzLWZyb250ZW5kXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9DaHlsZS9PbmVEcml2ZS9EZXNrdG9wL1N5c3RlbS9pc2tvbWF0cy1hcHBsaWNhbnRzLWZyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICdAdGFpbHdpbmRjc3Mvdml0ZSdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3RhaWx3aW5kY3NzKCksIHJlYWN0KCldLFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiAzMDEwLFxuICAgIG9wZW46IHRydWVcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICAvLyBJbmNyZWFzZSBjaHVuayBzaXplIHdhcm5pbmcgdGhyZXNob2xkXG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICAvLyBNYW51YWwgY2h1bmtzIHRvIG9wdGltaXplIGJ1bmRsZSBzcGxpdHRpbmdcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgLy8gVmVuZG9yIGNodW5rIGZvciBsYXJnZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgICAndmVuZG9yJzogW1xuICAgICAgICAgICAgJ3JlYWN0JyxcbiAgICAgICAgICAgICdyZWFjdC1kb20nLFxuICAgICAgICAgICAgJ3JlYWN0LXJvdXRlci1kb20nXG4gICAgICAgICAgXSxcbiAgICAgICAgICAvLyBTZXBhcmF0ZSBjaHVuayBmb3Igc29ja2V0LmlvIHNpbmNlIGl0J3MgdXNlZCBhY3Jvc3MgdGhlIGFwcFxuICAgICAgICAgICdzb2NrZXQnOiBbJ3NvY2tldC5pby1jbGllbnQnXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59KSJdLAogICJtYXBwaW5ncyI6ICI7QUFBeVksU0FBUyxvQkFBb0I7QUFDdGEsT0FBTyxXQUFXO0FBQ2xCLE9BQU8saUJBQWlCO0FBRXhCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxZQUFZLEdBQUcsTUFBTSxDQUFDO0FBQUEsRUFDaEMsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1I7QUFBQSxFQUNBLE9BQU87QUFBQTtBQUFBLElBRUwsdUJBQXVCO0FBQUEsSUFDdkIsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBO0FBQUEsUUFFTixjQUFjO0FBQUE7QUFBQSxVQUVaLFVBQVU7QUFBQSxZQUNSO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxVQUNGO0FBQUE7QUFBQSxVQUVBLFVBQVUsQ0FBQyxrQkFBa0I7QUFBQSxRQUMvQjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
