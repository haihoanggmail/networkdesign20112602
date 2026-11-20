import { handleChatRequest } from '../../src/server/chatService';
import { HeaderMap } from '../../src/server/chatTypes';

interface ServerlessReq {
  method?: string;
  body?: unknown;
  headers: HeaderMap;
  socket?: { remoteAddress?: string };
}

interface ServerlessRes {
  status: (code: number) => ServerlessRes;
  setHeader: (name: string, value: string) => void;
  json: (data: unknown) => void;
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  const headers = req.headers || {};
  const contentLengthHeader = headers['content-length'];
  const rawByteLength =
    typeof contentLengthHeader === 'string' && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : undefined;

  const result = await handleChatRequest({
    method: req.method,
    headers,
    body: req.body,
    rawByteLength,
    remoteIp: req.socket?.remoteAddress
  });

  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  res.status(result.statusCode).json(result.body);
}
