import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildHealthPayload, handleChatRequest } from './src/server/chatService';
import { handleTrackRequest } from './src/server/trackService';
import {
  handleAdminAuthStatus,
  handleAdminDeleteTemplate,
  handleAdminGetTemplate,
  handleAdminListTemplates,
  handleAdminLogin,
  handleAdminLogout,
  handleAdminRebuildCatalog,
  handleAdminUpsertTemplate
} from './src/server/admin/templateAdminService';

function loadLocalEnvFiles() {
  for (const filename of ['.env', '.env.local']) {
    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore unreadable local env files
    }
  }
}

loadLocalEnvFiles();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function applySecurityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const extraFrameAncestors = (process.env.ALLOWED_FRAME_ANCESTORS || '').trim();
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'";
  const connectSrc = isProduction ? "connect-src 'self'" : "connect-src 'self' ws: wss:";
  const frameAncestors = isProduction
    ? `frame-ancestors 'self' https://hachihi.vn https://*.hachihi.vn${extraFrameAncestors ? ` ${extraFrameAncestors}` : ''}`
    : "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com";

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      connectSrc,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      frameAncestors
    ].join('; ')
  );
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(applySecurityHeaders);
  app.use('/api/admin', express.json({ limit: '4mb' }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/admin')) return next();
    return express.json({ limit: '512kb' })(req, res, next);
  });

  const pkgVersion = (() => {
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: string };
      return parsed.version || '3.1.1';
    } catch {
      return '3.1.1';
    }
  })();

  app.get('/api/health', (_req, res) => {
    res.json(buildHealthPayload(pkgVersion));
  });

  app.post('/api/gemini/chat', async (req, res) => {
    const contentLengthHeader = req.headers['content-length'];
    const rawByteLength =
      typeof contentLengthHeader === 'string' && /^\d+$/.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : undefined;

    const result = await handleChatRequest({
      method: req.method,
      headers: req.headers,
      body: req.body,
      rawByteLength,
      remoteIp: req.ip || req.socket.remoteAddress
    });

    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
    }
    res.status(result.statusCode).json(result.body);
  });

  app.all('/api/track', async (req, res) => {
    const contentLengthHeader = req.headers['content-length'];
    const rawByteLength =
      typeof contentLengthHeader === 'string' && /^\d+$/.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : undefined;

    const result = await handleTrackRequest({
      method: req.method,
      headers: req.headers,
      body: req.body,
      rawByteLength,
      remoteIp: req.ip || req.socket.remoteAddress
    });

    res.status(result.statusCode).json(result.body);
  });

  const sendAdminResult = (
    res: express.Response,
    result: { statusCode: number; headers?: Record<string, string | string[]>; body: unknown }
  ) => {
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
    }
    res.status(result.statusCode).json(result.body);
  };

  app.all('/api/admin/auth', async (req, res) => {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const action = typeof req.query.action === 'string' ? req.query.action : undefined;
      const remoteIp = req.ip || req.socket.remoteAddress;
      if (method === 'GET') {
        sendAdminResult(res, await handleAdminAuthStatus({ method, headers: req.headers, remoteIp }));
        return;
      }
      if (method === 'DELETE' || (method === 'POST' && action === 'logout')) {
        sendAdminResult(res, await handleAdminLogout({ method, headers: req.headers, remoteIp }));
        return;
      }
      if (method === 'POST') {
        sendAdminResult(
          res,
          await handleAdminLogin({ method, headers: req.headers, body: req.body, remoteIp })
        );
        return;
      }
      res.status(405).json({ error: 'Phương thức HTTP không được hỗ trợ.' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Lỗi xác thực Admin.' });
    }
  });

  app.all('/api/admin/templates', async (req, res) => {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const slug = typeof req.query.slug === 'string' ? req.query.slug : undefined;
      const action = typeof req.query.action === 'string' ? req.query.action : undefined;
      const remoteIp = req.ip || req.socket.remoteAddress;

      if (method === 'GET') {
        if (slug) {
          sendAdminResult(res, await handleAdminGetTemplate({ method, headers: req.headers, remoteIp }, slug));
          return;
        }
        sendAdminResult(res, await handleAdminListTemplates({ method, headers: req.headers, remoteIp }));
        return;
      }
      if (method === 'POST' && action === 'rebuild') {
        sendAdminResult(
          res,
          await handleAdminRebuildCatalog({ method, headers: req.headers, body: req.body, remoteIp })
        );
        return;
      }
      if (method === 'POST' || method === 'PUT') {
        sendAdminResult(
          res,
          await handleAdminUpsertTemplate({ method, headers: req.headers, body: req.body, remoteIp })
        );
        return;
      }
      if (method === 'DELETE') {
        const targetSlug =
          slug ||
          (req.body && typeof req.body === 'object' && typeof (req.body as { slug?: unknown }).slug === 'string'
            ? (req.body as { slug: string }).slug
            : '');
        sendAdminResult(
          res,
          await handleAdminDeleteTemplate({ method, headers: req.headers, body: req.body, remoteIp }, targetSlug)
        );
        return;
      }
      res.status(405).json({ error: 'Phương thức HTTP không được hỗ trợ.' });
    } catch (err) {
      const statusCode =
        err && typeof err === 'object' && typeof (err as { statusCode?: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
      res.status(statusCode).json({ error: err instanceof Error ? err.message : 'Lỗi xử lý mẫu template.' });
    }
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api/') && err && typeof err === 'object') {
        const status = (err as { status?: number }).status;
        if (status === 413) {
          res.status(413).json({
            error: req.path.startsWith('/api/admin')
              ? 'Dung lượng gói template vượt quá giới hạn 4MB.'
              : 'Dung lượng yêu cầu vượt quá giới hạn 512KB.'
          });
          return;
        }
        if (status === 400) {
          res.status(400).json({ error: 'Dữ liệu JSON gửi lên không hợp lệ.' });
          return;
        }
      }
      next(err);
    }
  );

  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer } = await import('vite');
    const disableHmr =
      process.env.DISABLE_HMR === 'true' ||
      Boolean(process.env.K_SERVICE) ||
      Boolean(process.env.APP_URL?.includes('.run.app'));
    const vite = await createServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : { server: httpServer },
        watch: disableHmr ? null : undefined
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HACHIHI Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
