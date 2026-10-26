/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Makes the build a single self-contained index.html. Browsers refuse to load
 * module scripts and stylesheets from file:// pages, so a normal multi-file
 * build is blank when opened from disk; one file with everything inlined is
 * not. Runs after Vite has written its output, so all of Vite's own rewriting
 * is already done. Fonts and workers are inlined by the settings below.
 *
 * It also writes sw.js, a tiny service worker that caches the page, so a copy
 * served from a static host keeps working offline (service workers are not
 * used on file://, where nothing needs caching).
 */
function singleFile(): Plugin {
  return {
    name: 'single-file',
    apply: 'build',
    enforce: 'post',
    writeBundle(options) {
      const dir = options.dir ?? 'dist';
      const htmlPath = join(dir, 'index.html');
      let html = readFileSync(htmlPath, 'utf8');
      const inlined: string[] = [];
      html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_m, file: string) => {
        inlined.push(file);
        const code = readFileSync(join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script');
        return `<script type="module">${code}</script>`;
      });
      html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_m, file: string) => {
        inlined.push(file);
        return `<style>${readFileSync(join(dir, file), 'utf8')}</style>`;
      });
      html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
      writeFileSync(htmlPath, html);
      for (const f of inlined) rmSync(join(dir, f));
      const assets = join(dir, 'assets');
      if (existsSync(assets) && readdirSync(assets).length === 0) rmSync(assets, { recursive: true });
      const version = Date.now().toString(36);
      writeFileSync(
        join(dir, 'sw.js'),
        `const CACHE='qt-${version}';
const ASSETS=['./','./index.html'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)));});`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), singleFile()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    // Everything in one file: no code splitting, fonts as data URIs.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
