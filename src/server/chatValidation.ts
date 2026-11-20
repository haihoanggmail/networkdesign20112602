import {
  AssistantPersona,
  ChatModelMode,
  ChatRequestBody,
  ChatTurnInput,
  MAX_CHAT_BODY_BYTES,
  MAX_HISTORY_TURNS,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_HISTORY_CHARS,
  ProjectContextSummary
} from './chatTypes';

export type ChatValidationResult =
  | { ok: true; value: ChatRequestBody }
  | { ok: false; statusCode: number; error: string };

function sanitizeShortString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function sanitizeCount(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

export function sanitizeProjectContext(raw: unknown): ProjectContextSummary | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const rawAudit =
    obj.auditSummary && typeof obj.auditSummary === 'object' && !Array.isArray(obj.auditSummary)
      ? (obj.auditSummary as Record<string, unknown>)
      : null;

  const auditSummary = rawAudit
    ? {
        errorCount: sanitizeCount(rawAudit.errorCount) ?? 0,
        warningCount: sanitizeCount(rawAudit.warningCount) ?? 0,
        topIssues: Array.isArray(rawAudit.topIssues)
          ? rawAudit.topIssues
              .map(item => sanitizeShortString(item, 220))
              .filter((v): v is string => Boolean(v))
              .slice(0, 6)
          : []
      }
    : undefined;

  const sampleDevices = Array.isArray(obj.sampleDevices)
    ? obj.sampleDevices
        .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object' && !Array.isArray(d))
        .slice(0, 12)
        .map(d => ({
          name: sanitizeShortString(d.name, 80) || 'Device',
          category: sanitizeShortString(d.category, 40) || 'switch',
          ipAddress: sanitizeShortString(d.ipAddress, 45),
          vlan: sanitizeShortString(d.vlan, 40),
          powerWatts: sanitizeCount(d.powerWatts)
        }))
    : undefined;

  const racksSummary = Array.isArray(obj.racksSummary)
    ? obj.racksSummary
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && !Array.isArray(r))
        .slice(0, 6)
        .map(r => ({
          name: sanitizeShortString(r.name, 80) || 'Rack',
          totalUnits: sanitizeCount(r.totalUnits) ?? 42,
          usedUnits: sanitizeCount(r.usedUnits) ?? 0,
          powerWatts: sanitizeCount(r.powerWatts) ?? 0
        }))
    : undefined;

  return {
    projectName: sanitizeShortString(obj.projectName, 140),
    activeMode: sanitizeShortString(obj.activeMode, 40),
    activeFloorName: sanitizeShortString(obj.activeFloorName, 100),
    deviceCount: sanitizeCount(obj.deviceCount),
    rackCount: sanitizeCount(obj.rackCount),
    cableCount: sanitizeCount(obj.cableCount),
    roomCount: sanitizeCount(obj.roomCount),
    totalPowerWatts: sanitizeCount(obj.totalPowerWatts),
    auditSummary,
    sampleDevices,
    racksSummary
  };
}

export function validateChatRequest(
  rawBody: unknown,
  rawByteLength?: number
): ChatValidationResult {
  if (typeof rawByteLength === 'number' && rawByteLength > MAX_CHAT_BODY_BYTES) {
    return {
      ok: false,
      statusCode: 413,
      error: `Dung lượng yêu cầu vượt quá giới hạn ${Math.round(MAX_CHAT_BODY_BYTES / 1024)}KB.`
    };
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Dữ liệu yêu cầu không hợp lệ.'
    };
  }

  // Fallback serialized byte check for serverless handlers where raw byte count was not pre-read
  if (rawByteLength === undefined) {
    try {
      const approxBytes = Buffer.byteLength(JSON.stringify(rawBody), 'utf8');
      if (approxBytes > MAX_CHAT_BODY_BYTES) {
        return {
          ok: false,
          statusCode: 413,
          error: `Dung lượng yêu cầu vượt quá giới hạn ${Math.round(MAX_CHAT_BODY_BYTES / 1024)}KB.`
        };
      }
    } catch {
      return {
        ok: false,
        statusCode: 400,
        error: 'Không thể phân tích nội dung JSON gửi lên.'
      };
    }
  }

  const body = rawBody as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Nội dung câu hỏi không được để trống.'
    };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      statusCode: 400,
      error: `Câu hỏi vượt quá giới hạn ${MAX_MESSAGE_CHARS} ký tự.`
    };
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const filteredTurns: ChatTurnInput[] = rawHistory
    .filter(
      (item): item is { role: 'user' | 'model'; text: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        ((item as { role?: unknown }).role === 'user' || (item as { role?: unknown }).role === 'model') &&
        typeof (item as { text?: unknown }).text === 'string' &&
        (item as { text: string }).text.trim().length > 0
    )
    .slice(-MAX_HISTORY_TURNS)
    .map(turn => ({
      role: turn.role,
      text: turn.text.trim().slice(0, MAX_MESSAGE_CHARS)
    }));

  // Enforce aggregate character budget across history turns (keep most recent turns)
  const boundedHistory: ChatTurnInput[] = [];
  let charAcc = 0;
  for (let i = filteredTurns.length - 1; i >= 0; i--) {
    const turn = filteredTurns[i];
    if (charAcc + turn.text.length > MAX_TOTAL_HISTORY_CHARS) break;
    charAcc += turn.text.length;
    boundedHistory.unshift(turn);
  }

  const persona: AssistantPersona =
    body.persona === 'rack_power' || body.persona === 'bom_tia' ? body.persona : 'architect';
  const modelMode: ChatModelMode = body.modelMode === 'fast' ? 'fast' : 'deep';
  const projectContext = sanitizeProjectContext(body.projectContext);

  return {
    ok: true,
    value: {
      message,
      history: boundedHistory,
      persona,
      modelMode,
      projectContext
    }
  };
}

export function buildSystemInstruction(persona: AssistantPersona, ctx?: ProjectContextSummary): string {
  const personaRole =
    persona === 'rack_power'
      ? 'Bạn là Kỹ sư Hạ tầng Tủ Rack 19 inch & Hệ thống Điện kỹ thuật (UPS, PDU, tải nhiệt BTU, PoE+ 802.3at/bt).'
      : persona === 'bom_tia'
      ? 'Bạn là Chuyên gia Chuẩn hóa Hồ sơ Thi công (ANSI/TIA-606-C, TIA-568, bóc tách khối lượng BOM vật tư, nhãn cáp & bản vẽ CAD).'
      : 'Bạn là Kiến trúc sư Hạ tầng Mạng Doanh nghiệp (LAN/WAN, VLAN, Core-Distribution-Access, Fiber Uplink, Wi-Fi 6 & CCTV).';

  const contextLines: string[] = [];
  if (ctx) {
    contextLines.push(`Dự án hiện tại: "${ctx.projectName || 'HACHIHI Project'}"`);
    contextLines.push(
      `Chế độ: ${ctx.activeMode || 'topology'} | Tầng đang mở: ${ctx.activeFloorName || 'Mặc định'}`
    );
    contextLines.push(
      `Quy mô: ${ctx.deviceCount ?? 0} thiết bị, ${ctx.rackCount ?? 0} tủ Rack, ${ctx.cableCount ?? 0} tuyến cáp, ${ctx.roomCount ?? 0} phòng kỹ thuật, tổng công suất ước tính ${ctx.totalPowerWatts ?? 0}W.`
    );
    if (ctx.racksSummary && ctx.racksSummary.length > 0) {
      contextLines.push(
        `Tủ Rack: ${ctx.racksSummary
          .slice(0, 6)
          .map(r => `${r.name} (${r.usedUnits}/${r.totalUnits}U, ${r.powerWatts}W)`)
          .join('; ')}.`
      );
    }
    if (ctx.sampleDevices && ctx.sampleDevices.length > 0) {
      contextLines.push(
        `Thiết bị tiêu biểu: ${ctx.sampleDevices
          .slice(0, 12)
          .map(d => `${d.name}[${d.category}${d.ipAddress ? ` ${d.ipAddress}` : ''}${d.vlan ? ` VLAN ${d.vlan}` : ''}]`)
          .join(', ')}.`
      );
    }
    if (ctx.auditSummary) {
      contextLines.push(
        `Kết quả kiểm tra kỹ thuật: ${ctx.auditSummary.errorCount} lỗi, ${ctx.auditSummary.warningCount} cảnh báo.` +
          (ctx.auditSummary.topIssues.length > 0
            ? ` Chi tiết: ${ctx.auditSummary.topIssues.slice(0, 6).join(' | ')}`
            : '')
      );
    }
  }

  return [
    personaRole,
    'Nhiệm vụ: Tư vấn trực tiếp, ngắn gọn, có cấu trúc rõ ràng bằng tiếng Việt chuyên ngành mạng & M&E cho kỹ sư đang thiết kế trên phần mềm HACHIHI Network & Electrical Designer.',
    'Quy tắc trả lời:',
    '- Dựa vào ngữ cảnh dự án thực tế được cung cấp ở dưới (nếu có) để chỉ đích danh thiết bị, tủ rack, IP/VLAN hoặc lỗi cụ thể.',
    '- Nếu thiếu thông số chi tiết, nêu rõ giả định kỹ thuật tiêu chuẩn (TIA-568, TIA-606, PoE budget, dự phòng UPS 20-30%).',
    '- Trình bày bằng gạch đầu dòng ngắn gọn, dễ đọc, tránh lan man.',
    contextLines.length > 0 ? `\n--- NGỮ CẢNH DỰ ÁN HIỆN TẠI ---\n${contextLines.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}
