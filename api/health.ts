import { buildHealthPayload } from '../src/server/chatService';

interface ServerlessRes {
  status: (code: number) => ServerlessRes;
  json: (data: unknown) => void;
}

export default function handler(_req: unknown, res: ServerlessRes) {
  res.status(200).json(buildHealthPayload());
}
