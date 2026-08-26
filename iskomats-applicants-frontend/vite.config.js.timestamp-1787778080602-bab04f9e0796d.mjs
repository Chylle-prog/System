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
  // Disable identifier renaming (minifyIdentifiers) to prevent esbuild TDZ
  // ReferenceErrors caused by const arrow functions being renamed and reordered
  // in the minified output (e.g. "Cannot access 'ge' before initialization").
  // Syntax and whitespace minification are still applied for bundle size.
  esbuild: {
    minifyIdentifiers: false
  },
  build: {
    // Increase chunk size warning threshold
    chunkSizeWarningLimit: 1e3,
    rollupOptions: {
      output: {
        // Manual chunks to optimize bundle splitting and prevent single vendor chunk connection reset errors
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom") || id.includes("react-router-dom")) {
              return "vendor-framework";
            }
            if (id.includes("socket.io-client")) {
              return "vendor-socket";
            }
            return "vendor-deps";
          }
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxDaHlsZVxcXFxPbmVEcml2ZVxcXFxEZXNrdG9wXFxcXFN5c3RlbVxcXFxpc2tvbWF0cy1hcHBsaWNhbnRzLWZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxDaHlsZVxcXFxPbmVEcml2ZVxcXFxEZXNrdG9wXFxcXFN5c3RlbVxcXFxpc2tvbWF0cy1hcHBsaWNhbnRzLWZyb250ZW5kXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9DaHlsZS9PbmVEcml2ZS9EZXNrdG9wL1N5c3RlbS9pc2tvbWF0cy1hcHBsaWNhbnRzLWZyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICdAdGFpbHdpbmRjc3Mvdml0ZSdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3RhaWx3aW5kY3NzKCksIHJlYWN0KCldLFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiAzMDEwLFxuICAgIG9wZW46IHRydWVcbiAgfSxcbiAgLy8gRGlzYWJsZSBpZGVudGlmaWVyIHJlbmFtaW5nIChtaW5pZnlJZGVudGlmaWVycykgdG8gcHJldmVudCBlc2J1aWxkIFREWlxuICAvLyBSZWZlcmVuY2VFcnJvcnMgY2F1c2VkIGJ5IGNvbnN0IGFycm93IGZ1bmN0aW9ucyBiZWluZyByZW5hbWVkIGFuZCByZW9yZGVyZWRcbiAgLy8gaW4gdGhlIG1pbmlmaWVkIG91dHB1dCAoZS5nLiBcIkNhbm5vdCBhY2Nlc3MgJ2dlJyBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIikuXG4gIC8vIFN5bnRheCBhbmQgd2hpdGVzcGFjZSBtaW5pZmljYXRpb24gYXJlIHN0aWxsIGFwcGxpZWQgZm9yIGJ1bmRsZSBzaXplLlxuICBlc2J1aWxkOiB7XG4gICAgbWluaWZ5SWRlbnRpZmllcnM6IGZhbHNlLFxuICB9LFxuICBidWlsZDoge1xuICAgIC8vIEluY3JlYXNlIGNodW5rIHNpemUgd2FybmluZyB0aHJlc2hvbGRcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIC8vIE1hbnVhbCBjaHVua3MgdG8gb3B0aW1pemUgYnVuZGxlIHNwbGl0dGluZyBhbmQgcHJldmVudCBzaW5nbGUgdmVuZG9yIGNodW5rIGNvbm5lY3Rpb24gcmVzZXQgZXJyb3JzXG4gICAgICAgIG1hbnVhbENodW5rcyhpZCkge1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzJykpIHtcbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncmVhY3QnKSB8fCBpZC5pbmNsdWRlcygncmVhY3QtZG9tJykgfHwgaWQuaW5jbHVkZXMoJ3JlYWN0LXJvdXRlci1kb20nKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1mcmFtZXdvcmsnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdzb2NrZXQuaW8tY2xpZW50JykpIHtcbiAgICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3Itc29ja2V0JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiAndmVuZG9yLWRlcHMnO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufSkiXSwKICAibWFwcGluZ3MiOiAiO0FBQXlZLFNBQVMsb0JBQW9CO0FBQ3RhLE9BQU8sV0FBVztBQUNsQixPQUFPLGlCQUFpQjtBQUV4QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQztBQUFBLEVBQ2hDLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtBLFNBQVM7QUFBQSxJQUNQLG1CQUFtQjtBQUFBLEVBQ3JCO0FBQUEsRUFDQSxPQUFPO0FBQUE7QUFBQSxJQUVMLHVCQUF1QjtBQUFBLElBQ3ZCLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQTtBQUFBLFFBRU4sYUFBYSxJQUFJO0FBQ2YsY0FBSSxHQUFHLFNBQVMsY0FBYyxHQUFHO0FBQy9CLGdCQUFJLEdBQUcsU0FBUyxPQUFPLEtBQUssR0FBRyxTQUFTLFdBQVcsS0FBSyxHQUFHLFNBQVMsa0JBQWtCLEdBQUc7QUFDdkYscUJBQU87QUFBQSxZQUNUO0FBQ0EsZ0JBQUksR0FBRyxTQUFTLGtCQUFrQixHQUFHO0FBQ25DLHFCQUFPO0FBQUEsWUFDVDtBQUNBLG1CQUFPO0FBQUEsVUFDVDtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
