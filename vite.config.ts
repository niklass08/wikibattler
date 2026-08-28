/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages: set base to '/<repo>/' via VITE_BASE when deploying to a project page.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte()],
  // pools.json is a ~1MB data file; parse it via JSON.parse (faster) and don't
  // warn about its chunk size — it's deliberately code-split and loaded up front.
  json: { stringify: true },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
