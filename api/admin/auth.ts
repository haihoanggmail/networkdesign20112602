import {
  handleAdminAuthStatus,
  handleAdminLogin,
  handleAdminLogout
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
  const action = getQueryParam(req, 'action');
  const headers = req.headers || {};
  const remoteIp = req.socket?.remoteAddress;

  try {
    let result;
    if (method === 'GET') {
      result = await handleAdminAuthStatus({ method, headers, remoteIp });
    } else if (method === 'DELETE' || (method === 'POST' && action === 'logout')) {
      result = await handleAdminLogout({ method, headers, remoteIp });
    } else if (method === 'POST') {
      result = await handleAdminLogin({ method, headers, body: req.body, remoteIp });
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
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi máy chủ khi xử lý xác thực Admin.'
    });
  }
}
