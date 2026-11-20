import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ProjectState } from '../../types/infrastructure';
import { runEngineeringAudit } from '../../utils/engineeringValidator';
import { getRackStatistics } from '../../utils/rackGeometry';
import {
  Bot,
  Send,
  Trash2,
  X,
  Loader2,
  Zap,
  Sparkles,
  User,
  AlertTriangle
} from 'lucide-react';

export type AssistantPersona = 'architect' | 'rack_power' | 'bom_tia';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

interface NetworkAssistantChatProps {
  project: ProjectState;
  isOpen: boolean;
  onClose: () => void;
}

const PERSONA_OPTIONS: Array<{ id: AssistantPersona; label: string; hint: string }> = [
  { id: 'architect', label: 'Kiến trúc sư Mạng', hint: 'LAN/WAN, VLAN, Core-Access, Wi-Fi & CCTV' },
  { id: 'rack_power', label: 'Kỹ sư Rack & Điện', hint: 'Bố trí U, công suất UPS, tải trọng & PoE' },
  { id: 'bom_tia', label: 'Chuẩn TIA-606 & BOM', hint: 'Nhãn cáp TIA-606, bóc tách vật tư & thi công' }
];

export const NetworkAssistantChat: React.FC<NetworkAssistantChatProps> = ({
  project,
  isOpen,
  onClose
}) => {
  const storageKey = `hachihi_ai_chat_${project.id}`;
  const [persona, setPersona] = useState<AssistantPersona>('architect');
  const [modelMode, setModelMode] = useState<'standard' | 'fast'>('standard');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load persisted conversation history whenever project changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          return;
        }
      }
    } catch {
      // ignore storage errors
    }
    setMessages([]);
  }, [storageKey]);

  // Persist conversation history
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      // ignore quota errors
    }
  }, [messages, storageKey]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending, isOpen]);

  const auditSummary = useMemo(() => {
    const report = runEngineeringAudit(project);
    return {
      errorCount: report.summary.errorCount,
      warningCount: report.summary.warningCount,
      topIssues: report.issues.slice(0, 6).map(i => `[${i.severity.toUpperCase()}] ${i.title}: ${i.description}`)
    };
  }, [project]);

  const projectContext = useMemo(() => {
    const assetValues = Object.values(project.assets);
    const totalPowerWatts = assetValues.reduce((s, a) => s + (a.powerWatts || 0), 0);
    const activeFloor = project.floors.find(f => f.id === project.activeFloorId);
    return {
      projectName: project.name,
      activeMode: project.activeMode,
      activeFloorName: activeFloor?.name || 'Mặt bằng chính',
      deviceCount: assetValues.length,
      rackCount: project.racks.length,
      cableCount: project.cables.length,
      roomCount: project.rooms.length,
      totalPowerWatts,
      auditSummary,
      sampleDevices: assetValues.slice(0, 12).map(a => ({
        name: a.name,
        category: a.category,
        ipAddress: a.ipAddress,
        vlan: a.vlan,
        powerWatts: a.powerWatts
      })),
      racksSummary: project.racks.slice(0, 6).map(r => {
        const st = getRackStatistics(r, project.assets);
        return {
          name: r.name,
          totalUnits: r.totalUnits,
          usedUnits: st.frontUsedUnits,
          powerWatts: st.totalPowerWatts
        };
      })
    };
  }, [project, auditSummary]);

  const buildLocalDiagnosticsReply = (question: string): string => {
    const q = question.toLowerCase();
    const has = (...keys: string[]) => keys.some(k => q.includes(k));
    const totalPower = projectContext.totalPowerWatts;
    const recommendedUpsWatts = Math.ceil(totalPower * 1.3);
    const recommendedUpsVa = Math.ceil(recommendedUpsWatts / 0.8);
    const assets = Object.values(project.assets);
    const textOf = (a: { name: string; category: unknown }) => `${a.name} ${String(a.category)}`.toLowerCase();
    const issueCount = auditSummary.errorCount + auditSummary.warningCount;

    const wantAudit = has('lỗi', 'cảnh báo', 'kiểm tra', 'audit', 'vấn đề', 'khắc phục', 'sửa');
    const wantPower = has('ups', 'poe', 'điện', 'công suất', 'rack', 'tủ', 'btu', 'nguồn');
    const wantNet = has('ip', 'vlan', 'subnet', 'mạng con', 'địa chỉ');
    const wantCable = has('tia', 'nhãn', 'cáp', 'tuyến', 'đi dây', 'route');
    const wantList = has('bao nhiêu', 'thống kê', 'liệt kê', 'danh sách', 'danh mục', 'bom', 'số lượng');
    const wantCamera = has('camera', 'nvr', 'cctv', 'giám sát');
    const wantWifi = has('wifi', 'wi-fi', 'không dây', 'access point');
    const wantOverview = has('tổng quan', 'đánh giá', 'kiến trúc', 'tối ưu', 'nhận xét', 'tóm tắt', 'phân tích');

    const sections: string[] = [];

    if (wantAudit || wantOverview) {
      if (issueCount === 0) {
        sections.push('• Kiểm tra kỹ thuật: chưa phát hiện lỗi hay cảnh báo nào.');
      } else {
        sections.push(`• Kiểm tra kỹ thuật: ${auditSummary.errorCount} lỗi nghiêm trọng, ${auditSummary.warningCount} cảnh báo.`);
        auditSummary.topIssues.slice(0, 4).forEach(issue => sections.push(`  - ${issue}`));
      }
    }

    if (wantPower || wantOverview || (!wantAudit && !wantNet && !wantCable && !wantList && !wantCamera && !wantWifi && persona === 'rack_power' && has('gợi ý', 'đề xuất', 'tính'))) {
      sections.push(
        `• Tải điện tổng ước tính: ${totalPower}W (~${Math.round(totalPower * 3.412)} BTU/h). UPS đề xuất tối thiểu (dự phòng 30%, PF 0.8): ${recommendedUpsWatts}W / ${recommendedUpsVa}VA.`
      );
      projectContext.racksSummary.forEach(r => {
        sections.push(`  - ${r.name}: ${r.usedUnits}/${r.totalUnits}U đã dùng, ${r.powerWatts}W.`);
      });
      if (projectContext.racksSummary.length === 0) {
        sections.push('  - Dự án chưa có tủ rack nào.');
      }
    }

    if (wantNet) {
      const vlans = Array.from(new Set(assets.map(a => a.vlan).filter(Boolean)));
      const noIp = assets.filter(a => !a.ipAddress).length;
      sections.push(
        `• VLAN đang dùng: ${vlans.length > 0 ? vlans.join(', ') : 'chưa gán VLAN'}. Thiết bị chưa có IP: ${noIp}/${assets.length}.`
      );
      sections.push('• Gợi ý tách VLAN: Quản trị/Core, Server, Wi-Fi/Người dùng, Camera (CCTV).');
    }

    if (wantCable) {
      sections.push(
        `• Dự án có ${projectContext.cableCount} tuyến cáp. Chuẩn nhãn TIA-606: [Tầng]-[Tủ]-[Thiết bị/Port]; dùng Auto-Route để tuyến cáp tự tránh vật cản.`
      );
    }

    if (wantCamera) {
      const cams = assets.filter(a => /camera|cctv|ipcam/.test(textOf(a))).length;
      const nvrs = assets.filter(a => /nvr|dvr/.test(textOf(a))).length;
      sections.push(`• Camera: ${cams} • NVR/DVR: ${nvrs}. Kiểm tra mỗi camera đã nối về NVR/switch PoE và đủ băng thông.`);
    }

    if (wantWifi) {
      const aps = assets.filter(a => /wifi|wi-fi|access point|\bap\b/.test(textOf(a))).length;
      sections.push(`• Access Point: ${aps}. Kiểm tra vùng phủ chồng lấn và đặt kênh khác nhau giữa các AP gần nhau.`);
    }

    if (wantList) {
      const byCat = new Map<string, number>();
      assets.forEach(a => byCat.set(String(a.category), (byCat.get(String(a.category)) || 0) + 1));
      const list = Array.from(byCat.entries())
        .sort((x, y) => y[1] - x[1])
        .map(([c, n]) => `${c}: ${n}`)
        .join(' · ');
      sections.push(`• Thống kê theo loại thiết bị: ${list || 'chưa có thiết bị'}.`);
    }

    const header = '[Chế độ phân tích cục bộ — đang phản hồi theo từ khóa ngoại tuyến]';
    const summary = `• Dự án "${project.name}": ${projectContext.deviceCount} thiết bị, ${projectContext.rackCount} tủ rack, ${projectContext.cableCount} tuyến cáp.`;

    if (sections.length === 0) {
      return [
        header,
        summary,
        '• Ở chế độ cục bộ, bạn có thể hỏi cụ thể về: lỗi/cảnh báo, UPS/PoE/rack, IP/VLAN, cáp/TIA-606, camera, Wi-Fi, thống kê thiết bị, hoặc "đánh giá tổng quan".'
      ].join('\n');
    }
    return [header, summary, ...sections].join('\n');
  };

  const sendMessageText = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isSending) return;

    setErrorMsg(null);
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toISOString()
    };

    const nextHistory = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsSending(true);

    try {
      const resp = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: nextHistory,
          persona,
          modelMode,
          projectContext
        })
      });

      if (resp.status === 404 || resp.status === 503) {
        const offlineReply = buildLocalDiagnosticsReply(trimmed);
        setMessages(prev => [
          ...prev,
          {
            id: `m_${Date.now()}`,
            role: 'model',
            text: offlineReply,
            timestamp: new Date().toISOString(),
            modelUsed: 'local-diagnostics'
          }
        ]);
        return;
      }

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.error || `Máy chủ phản hồi lỗi ${resp.status}`);
      }

      const modelMsg: ChatMessage = {
        id: `m_${Date.now()}`,
        role: 'model',
        text: String(data.reply || ''),
        timestamp: new Date().toISOString(),
        modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : undefined
      };
      setMessages(prev => [...prev, modelMsg]);
    } catch (err: unknown) {
      // Fall back smoothly when running as pure static hosting without Express API
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('404')) {
        const offlineReply = buildLocalDiagnosticsReply(trimmed);
        setMessages(prev => [
          ...prev,
          {
            id: `m_${Date.now()}`,
            role: 'model',
            text: offlineReply,
            timestamp: new Date().toISOString(),
            modelUsed: 'local-diagnostics'
          }
        ]);
      } else {
        setErrorMsg(msg || 'Không thể kết nối máy chủ trợ lý AI.');
      }
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  const quickPrompts = [
    auditSummary.errorCount + auditSummary.warningCount > 0
      ? `Phân tích ${auditSummary.errorCount} lỗi và ${auditSummary.warningCount} cảnh báo kỹ thuật hiện có và đề xuất cách khắc phục.`
      : 'Đánh giá kiến trúc tổng thể sơ đồ hiện tại và gợi ý điểm có thể tối ưu.',
    'Tính toán công suất PoE, dự phòng UPS (thêm 30%) và bố trí tủ Rack hợp lý.',
    'Đề xuất quy hoạch IP Subnet, VLAN và chuẩn đặt mã nhãn cáp TIA-606 cho dự án này.'
  ];

  return (
    <aside
      role="dialog"
      aria-label="Trợ lý kỹ thuật hạ tầng"
      className="fixed inset-x-0 bottom-0 h-[78dvh] rounded-t-2xl sm:inset-x-auto sm:right-3 sm:top-14 sm:bottom-16 sm:h-auto sm:w-[390px] sm:max-w-[92vw] sm:rounded-xl z-40 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-xs text-slate-800 dark:text-slate-100 no-print pb-safe"
    >
      {/* Mobile Bottom Sheet Handle */}
      <div className="sm:hidden flex justify-center py-1.5 bg-[#155EEF]">
        <div className="w-10 h-1 rounded-full bg-white/40" />
      </div>

      {/* Header */}
      <div className="px-3.5 py-2.5 bg-[#155EEF] text-white flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs truncate">Trợ Lý Kỹ Thuật Hạ Tầng</div>
            <div className="text-xs text-blue-100 tabular-nums truncate">
              {projectContext.deviceCount} TB · {projectContext.rackCount} Rack · {projectContext.cableCount} cáp
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                setErrorMsg(null);
              }}
              aria-label="Xóa lịch sử hội thoại"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md hover:bg-white/15 text-blue-100 hover:text-white transition-colors"
              title="Xóa lịch sử hội thoại"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Đóng trợ lý kỹ thuật"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md hover:bg-white/15 text-blue-100 hover:text-white transition-colors"
            title="Đóng trợ lý"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Role Persona & Speed Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <select
            value={persona}
            onChange={e => setPersona(e.target.value as AssistantPersona)}
            aria-label="Chọn vai trò chuyên gia tư vấn"
            className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 text-xs font-semibold outline-none focus:border-[#155EEF]"
            title="Chọn vai trò chuyên gia tư vấn"
          >
            {PERSONA_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>
                Vai trò: {opt.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => setModelMode(m => (m === 'standard' ? 'fast' : 'standard'))}
            aria-label="Chuyển chế độ phân tích nhanh hoặc chuyên sâu"
            aria-pressed={modelMode === 'fast'}
            className={`px-2.5 py-1.5 rounded-md border text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
              modelMode === 'fast'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-[#155EEF] dark:text-blue-300'
            }`}
            title="Chuyển đổi giữa chế độ phân tích chuẩn và phản hồi nhanh"
          >
            {modelMode === 'fast' ? <Zap className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{modelMode === 'fast' ? 'Nhanh' : 'Chuyên sâu'}</span>
          </button>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {PERSONA_OPTIONS.find(p => p.id === persona)?.hint}
        </div>
      </div>

      {/* Scrollable Conversation Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-white dark:bg-slate-950/40">
        {messages.length === 0 ? (
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
              <div className="font-semibold text-slate-800 dark:text-slate-100">
                Xin chào kỹ sư!
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Tôi đang đọc trực tiếp sơ đồ <strong>{project.name}</strong> ({projectContext.deviceCount} thiết bị,{' '}
                {projectContext.totalPowerWatts}W). Hãy đặt câu hỏi nối tiếp nhiều lượt về sơ đồ logic, tủ rack, PoE/UPS hoặc chuẩn TIA-606.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-500">Gợi ý câu hỏi nhanh</div>
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => void sendMessageText(prompt)}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] hover:bg-blue-50/70 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => {
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="w-6 h-6 rounded-md bg-[#155EEF] text-white flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}
                <div
                  className={`max-w-[82%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    isUser
                      ? 'bg-[#155EEF] text-white rounded-br-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-xs'
                  }`}
                >
                  {msg.text}
                </div>
                {isUser && (
                  <div className="w-6 h-6 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
            <div className="w-6 h-6 rounded-md bg-[#155EEF] text-white flex items-center justify-center shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </div>
            <span>Đang phân tích cấu hình kỹ thuật...</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMsg}</div>
          </div>
        )}
      </div>

      {/* Input Composer */}
      <form
        onSubmit={e => {
          e.preventDefault();
          void sendMessageText(input);
        }}
        className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-end gap-2 shrink-0"
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendMessageText(input);
            }
          }}
          rows={2}
          placeholder="Hỏi về VLAN, cáp, tải UPS, tủ rack... (Enter gửi)"
          className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs outline-none focus:border-[#155EEF]"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="p-2.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-45 disabled:cursor-not-allowed text-white transition-colors shrink-0"
          title="Gửi câu hỏi"
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </aside>
  );
};
