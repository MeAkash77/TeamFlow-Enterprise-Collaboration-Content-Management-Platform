import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2019' }, // broad browser support
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
