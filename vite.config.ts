/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages: set base to '/<repo>/' via VITE_BASE when deploying to a project page.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
