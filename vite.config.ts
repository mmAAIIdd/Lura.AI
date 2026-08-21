import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /* React and the router change on their own schedule, which is far
           slower than the site's own code. Keeping them in a separate chunk
           means a copy edit does not invalidate the cached vendor code for
           returning visitors.
           Matched by path rather than by package name: the entry actually
           imported is `react-dom/client`, and a name list leaves react-dom's
           bulk — the part worth caching — behind in the app chunk. */
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'react-vendor';
          }
        },
      },
    },
  },
});
