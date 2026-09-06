import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({ plugins: [react()], resolve: { alias: { '@': resolve(__dirname, 'src'), '@backend': resolve(__dirname, 'backend') } }, server: { host: '127.0.0.1', port: 5173, strictPort: true }, build: { outDir: 'dist', emptyOutDir: true }, clearScreen: false });
