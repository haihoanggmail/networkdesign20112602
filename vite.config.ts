import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { buildTemplateCatalogFromDir } from './scripts/build-template-catalog';

const LIBREDWG_WASM_SOURCE = path.resolve(
  __dirname,
  'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm'
);

function libredwgWasmPlugin(): Plugin {
  return {
    name: 'hachihi-libredwg-wasm',
    configureServer(server) {
      server.middlewares.use('/wasm/libredwg-web.wasm', (_req, res, next) => {
        if (!fs.existsSync(LIBREDWG_WASM_SOURCE)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(LIBREDWG_WASM_SOURCE).pipe(res);
      });
    },
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir) || !fs.existsSync(LIBREDWG_WASM_SOURCE)) return;
      const targetDir = path.join(distDir, 'wasm');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(LIBREDWG_WASM_SOURCE, path.join(targetDir, 'libredwg-web.wasm'));
    }
  };
}

function templateCatalogSyncPlugin(): Plugin {
  const templatesDir = path.resolve(__dirname, 'public', 'templates');
  return {
    name: 'hachihi-template-catalog-sync',
    buildStart() {
      if (fs.existsSync(templatesDir)) {
        buildTemplateCatalogFromDir(templatesDir);
      }
    }
  };
}

function resolveBuildMetadata() {
  let version = '3.1.1';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      version = pkg.version.trim();
    }
  } catch {
    // fallback version
  }
  let buildHash = 'local';
  try {
    buildHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim() || 'local';
  } catch {
    buildHash = 'local';
  }
  const buildDate = new Date().toISOString().slice(0, 10);
  return { version, buildHash, buildDate };
}

export default defineConfig(() => {
  const buildMeta = resolveBuildMetadata();

  return {
    define: {
      __APP_VERSION__: JSON.stringify(buildMeta.version),
      __BUILD_HASH__: JSON.stringify(buildMeta.buildHash),
      __BUILD_DATE__: JSON.stringify(buildMeta.buildDate)
    },
    plugins: [
      react(),
      tailwindcss(),
      libredwgWasmPlugin(),
      templateCatalogSyncPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          id: '/',
          name: 'HACHIHI Network & Electrical Designer',
          short_name: 'HACHIHI',
          description: 'Phần mềm thiết kế hạ tầng mạng, điện kỹ thuật, tủ Server Rack và hồ sơ thi công chuyên nghiệp.',
          theme_color: '#1d4ed8',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ],
          file_handlers: [
            {
              action: '/',
              accept: {
                'application/vnd.hachihi.project+json': ['.hachihi.json'],
                'application/json': ['.hachihi.json', '.json']
              }
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: [
            '**/iso_*',
            '**/templates/**',
            '**/wasm/**',
            '**/three-vendor*',
            '**/viewer3dRuntimeBundle*',
            '**/viewer-3d-runtime.js',
            '**/exceljs-vendor*',
            '**/pdf-vendor*',
            '**/recharts-vendor*',
            '**/jspdf*',
            '**/html2canvas*',
            '**/*.map'
          ],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.*\.js$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'hachihi-lazy-chunks',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 30 * 24 * 60 * 60
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /\/assets\/.*\.(?:jpg|jpeg|png|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'hachihi-media-assets',
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 30 * 24 * 60 * 60
                }
              }
            }
          ]
        },
        devOptions: {
          enabled: true,
          type: 'module'
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('three')) return 'three-vendor';
            if (id.includes('exceljs')) return 'exceljs-vendor';
            if (id.includes('recharts') || id.includes('d3-')) return 'recharts-vendor';
            if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('canvg') || id.includes('dompurify')) {
              return 'pdf-vendor';
            }
            if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor';
            if (id.includes('lucide-react')) return 'icons-vendor';
            return undefined;
          }
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
