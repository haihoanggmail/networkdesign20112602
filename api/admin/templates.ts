import {
  handleAdminDeleteTemplate,
  handleAdminGetTemplate,
  handleAdminListTemplates,
  handleAdminRebuildCatalog,
  handleAdminUpsertTemplate
} from '../../src/server/admin/templateAdminService';
import type { HeaderMap } from '../../src/server/chatTypes';

interface ServerlessReq {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers: HeaderMap;
  socket?: { remoteAddress?: string };
}

interface ServerlessRes {
  status: (code: number) => ServerlessRes;
  setHeader: (name: string, value: string | string[]) => void;
  json: (data: unknown) => void;
}

function getQueryParam(req: ServerlessReq, key: string): string | undefined {
  const val = req.query?.[key];
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  const method = (req.method || 'GET').toUpperCase();
  const headers = req.headers || {};
  const remoteIp = req.socket?.remoteAddress;
  const slug = getQueryParam(req, 'slug');
  const action = getQueryParam(req, 'action');

  try {
    let result;
    if (method === 'GET') {
      if (slug) {
        result = await handleAdminGetTemplate({ method, headers, remoteIp }, slug);
      } else {
        result = await handleAdminListTemplates({ method, headers, remoteIp });
      }
    } else if (method === 'POST' && action === 'rebuild') {
      result = await handleAdminRebuildCatalog({ method, headers, body: req.body, remoteIp });
    } else if (method === 'POST' || method === 'PUT') {
      result = await handleAdminUpsertTemplate({ method, headers, body: req.body, remoteIp });
    } else if (method === 'DELETE') {
      const targetSlug =
        slug ||
        (req.body && typeof req.body === 'object' && typeof (req.body as { slug?: unknown }).slug === 'string'
          ? (req.body as { slug: string }).slug
          : '');
      result = await handleAdminDeleteTemplate({ method, headers, body: req.body, remoteIp }, targetSlug);
    } else {
      res.status(405).json({ error: 'Phương thức HTTP không được hỗ trợ.' });
      return;
    }

    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
    }
    res.status(result.statusCode).json(result.body);
  } catch (err) {
    const statusCode =
      err && typeof err === 'object' && typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    res.status(statusCode).json({
      error: err instanceof Error ? err.message : 'Lỗi máy chủ khi cập nhật template.'
    });
  }
}
