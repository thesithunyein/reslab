import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // GitHub Pages serves from docs/; Vercel serves web/dist (VERCEL=1 during its build).
    outDir: process.env.VERCEL ? 'dist' : '../docs',
    emptyOutDir: true,
  },
});
