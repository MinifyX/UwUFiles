import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri drives the dev server, so the port is fixed and failures are loud.
// 1424, so UwUFiles runs next to UwUNotes (1421) and UwUSSH (1420).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1424,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/target/**'] },
  },
  build: { target: 'chrome110', sourcemap: false },
});
