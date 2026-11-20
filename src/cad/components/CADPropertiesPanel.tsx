import React, { useMemo, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Lock,
  Plus,
  Scale,
  Tag,
  Trash2
} from 'lucide-react';
import type { CADBatchEntityPatch } from '../commands/CADCommands';
import { QUICK_ACI_SWATCHES } from '../core/CADColorPalette';
import { createCadId } from '../core/CADRegistry';
import type {
  CADDimensionStyle,
  CADDocument,
  CADEntity,
  CADInsertAttribute,
  CADTextStyle,
  CADUnderlayAlignment
} from '../core/CADTypes';
import { CAD_UNIT_CATALOG, getCADUnitMeta } from '../core/CADUnits';
import { computeNetworkPxPerMeterFromCad } from '../core/CADUnderlayTransform';
import { decodeAutoCadText, stripMTextFormatting } from '../geometry/CADCurve';
import {
  computeEntityLength2D,
  extractViewportSummary,
  isEntityGeometryEditable
} from '../geometry/CADGeometry';
import { formatDimensionDisplayText } from '../rendering/CADTextRenderer';

interface CADPropertiesPanelProps {
  doc: CADDocument;
  selectedEntities: CADEntity[];
  onPatchEntity: (entityId: string, patcher: (e: CADEntity) => CADEntity, labelVi?: string) => void;
  onBatchPatchEntities: (entityIds: string[], patch: CADBatchEntityPatch, labelVi?: string) => void;
  onEditInsertAttributes: (entityId: string, attributes: CADInsertAttribute[]) => void;
  onSelectSimilar: (seeds: CADEntity[]) => void;
  onUpsertTextStyle: (style: CADTextStyle) => void;
  onUpsertDimStyle: (style: CADDimensionStyle) => void;
  onDeleteSelected: () => void;
  onExplodeInsert: (entityId: string) => void;
  onUpdateDocumentSettings: (updater: (doc: CADDocument) => CADDocument) => void;
  onAutoFitUnderlay: () => void;
}

const LINE_WEIGHT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: -3, label: 'Mặc định (-3)' },
  { value: 0, label: '0.00 mm' },
  { value: 15, label: '0.15 mm' },
  { value: 25, label: '0.25 mm' },
  { value: 35, label: '0.35 mm' },
  { value: 50, label: '0.50 mm' },
  { value: 70, label: '0.70 mm' }
];

export const CADPropertiesPanel: React.FC<CADPropertiesPanelProps> = ({
  doc,
  selectedEntities,
  onPatchEntity,
  onBatchPatchEntities,
  onEditInsertAttributes,
  onSelectSimilar,
  onUpsertTextStyle,
  onUpsertDimStyle,
  onDeleteSelected,
  onExplodeInsert,
  onUpdateDocumentSettings,
  onAutoFitUnderlay
}) => {
  const layerNames = useMemo(() => Object.keys(doc.layers).sort(), [doc.layers]);
  const lineTypeNames = useMemo(() => {
    const names = new Set<string>(['BYLAYER', 'BYBLOCK', 'CONTINUOUS', 'DASHED', 'CENTER', 'HIDDEN']);
    for (const k of Object.keys(doc.lineTypes)) names.add(k);
    return Array.from(names);
  }, [doc.lineTypes]);
  const textStyleList = useMemo(() => Object.values(doc.textStyles), [doc.textStyles]);
  const dimStyleList = useMemo(() => Object.values(doc.dimStyles), [doc.dimStyles]);
  const unitMeta = getCADUnitMeta(doc.header.$INSUNITS);

  const [openStyleSection, setOpenStyleSection] = useState<'none' | 'text' | 'dim'>('none');
  const [selectedTextStyleKey, setSelectedTextStyleKey] = useState<string>('STANDARD');
  const [selectedDimStyleKey, setSelectedDimStyleKey] = useState<string>('STANDARD');
  const [newTextStyleName, setNewTextStyleName] = useState('');
  const [newDimStyleName, setNewDimStyleName] = useState('');

  const updateUnderlay = (patch: Partial<CADUnderlayAlignment>) => {
    onUpdateDocumentSettings(prev => ({
      ...prev,
      underlay: { ...prev.underlay, ...patch },
      updatedAt: new Date().toISOString()
    }));
  };

  if (selectedEntities.length === 0) {
    const activeTextStyle =
      doc.textStyles[selectedTextStyleKey] ||
      doc.textStyles['STANDARD'] ||
      textStyleList[0];
    const activeDimStyle =
      doc.dimStyles[selectedDimStyleKey] ||
      doc.dimStyles['STANDARD'] ||
      dimStyleList[0];

    return (
      <div className="flex h-full flex-col overflow-y-auto p-3 text-xs space-y-3.5">
        <div>
          <h3 className="text-xs font-semibold text-white">Thuộc tính Bản vẽ CAD</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">{doc.metadata.sourceFileName}</p>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[11px] font-semibold text-cyan-300">Đơn vị & Tiêu chuẩn</div>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">Đơn vị bản vẽ ($INSUNITS)</span>
            <select
              value={doc.header.$INSUNITS}
              onChange={e =>
                onUpdateDocumentSettings(prev => ({
                  ...prev,
                  header: { ...prev.header, $INSUNITS: Number(e.target.value) as CADDocument['header']['$INSUNITS'] },
                  updatedAt: new Date().toISOString()
                }))
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              {Object.values(CAD_UNIT_CATALOG).map(u => (
                <option key={u.code} value={u.code}>
                  {u.labelVi}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Phiên bản DXF:</span>
            <span className="text-slate-200">{doc.metadata.acadVersion}</span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Tỉ lệ chiều dài:</span>
            <span className="text-slate-200">1 {unitMeta.shortLabel} = {unitMeta.metersPerUnit} m</span>
          </div>
        </div>

        {/* TextStyle Manager */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={() => setOpenStyleSection(s => (s === 'text' ? 'none' : 'text'))}
            className="flex w-full items-center justify-between px-2.5 py-2 text-left text-[11px] font-semibold text-cyan-300"
          >
            <span>Kiểu Chữ (Text Style • {textStyleList.length})</span>
            {openStyleSection === 'text' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {openStyleSection === 'text' && activeTextStyle && (
            <div className="space-y-2 border-t border-slate-800/80 p-2.5 text-[11px]">
              <select
                value={activeTextStyle.name.toUpperCase()}
                onChange={e => setSelectedTextStyleKey(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              >
                {textStyleList.map(st => (
                  <option key={st.name} value={st.name.toUpperCase()}>
                    {st.name} ({st.fontFile})
                  </option>
                ))}
              </select>
              <label className="block space-y-0.5">
                <span className="text-[10px] text-slate-400">Font gốc DXF (vd: arial, simplex, txt)</span>
                <input
                  type="text"
                  value={activeTextStyle.fontFile}
                  onChange={e =>
                    onUpsertTextStyle({ ...activeTextStyle, fontFile: e.target.value })
                  }
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                />
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <label className="block">
                  <span className="text-[10px] text-slate-400">Cao cố định</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={activeTextStyle.fixedHeight}
                    onChange={e =>
                      onUpsertTextStyle({ ...activeTextStyle, fixedHeight: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">Hệ số rộng</span>
                  <input
                    type="number"
                    min={0.2}
                    max={4}
                    step={0.05}
                    value={activeTextStyle.widthFactor}
                    onChange={e =>
                      onUpsertTextStyle({ ...activeTextStyle, widthFactor: Math.max(0.2, Number(e.target.value) || 1) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">Nghiêng (°)</span>
                  <input
                    type="number"
                    min={-45}
                    max={45}
                    step={1}
                    value={activeTextStyle.obliqueAngle}
                    onChange={e =>
                      onUpsertTextStyle({ ...activeTextStyle, obliqueAngle: Number(e.target.value) || 0 })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const name = newTextStyleName.trim().toUpperCase().replace(/\s+/g, '_');
                  if (!name || doc.textStyles[name]) return;
                  onUpsertTextStyle({
                    name,
                    fontFile: 'arial.ttf',
                    fixedHeight: 0,
                    widthFactor: 1,
                    obliqueAngle: 0
                  });
                  setSelectedTextStyleKey(name);
                  setNewTextStyleName('');
                }}
                className="flex gap-1 pt-1"
              >
                <input
                  type="text"
                  value={newTextStyleName}
                  onChange={e => setNewTextStyleName(e.target.value)}
                  placeholder="Tên TextStyle mới..."
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px]"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-0.5 rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-500"
                >
                  <Plus className="h-3 w-3" />
                  Tạo
                </button>
              </form>
            </div>
          )}
        </div>

        {/* DimStyle Manager */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={() => setOpenStyleSection(s => (s === 'dim' ? 'none' : 'dim'))}
            className="flex w-full items-center justify-between px-2.5 py-2 text-left text-[11px] font-semibold text-cyan-300"
          >
            <span>Kiểu Kích thước (Dim Style • {dimStyleList.length})</span>
            {openStyleSection === 'dim' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {openStyleSection === 'dim' && activeDimStyle && (
            <div className="space-y-2 border-t border-slate-800/80 p-2.5 text-[11px]">
              <select
                value={activeDimStyle.name.toUpperCase()}
                onChange={e => setSelectedDimStyleKey(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              >
                {dimStyleList.map(ds => (
                  <option key={ds.name} value={ds.name.toUpperCase()}>
                    {ds.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">
                  <span className="text-[10px] text-slate-400">DIMSCALE (Tỉ lệ chung)</span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={activeDimStyle.dimscale}
                    onChange={e =>
                      onUpsertDimStyle({ ...activeDimStyle, dimscale: Math.max(0.01, Number(e.target.value) || 1) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">DIMTXT (Cỡ chữ)</span>
                  <input
                    type="number"
                    min={1}
                    step={10}
                    value={activeDimStyle.dimtxt}
                    onChange={e =>
                      onUpsertDimStyle({ ...activeDimStyle, dimtxt: Math.max(1, Number(e.target.value) || 180) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">DIMASZ (Mũi tên/gạch)</span>
                  <input
                    type="number"
                    min={1}
                    step={10}
                    value={activeDimStyle.dimasz}
                    onChange={e =>
                      onUpsertDimStyle({ ...activeDimStyle, dimasz: Math.max(1, Number(e.target.value) || 180) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">DIMLFAC (Hệ số đo)</span>
                  <input
                    type="number"
                    min={0.001}
                    step={0.1}
                    value={activeDimStyle.dimlfac}
                    onChange={e =>
                      onUpsertDimStyle({ ...activeDimStyle, dimlfac: Math.max(0.001, Number(e.target.value) || 1) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
                <label className="block col-span-2">
                  <span className="text-[10px] text-slate-400">DIMDEC (Số chữ số thập phân)</span>
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={activeDimStyle.dimdec}
                    onChange={e =>
                      onUpsertDimStyle({ ...activeDimStyle, dimdec: Math.max(0, Math.min(4, Math.round(Number(e.target.value) || 0))) })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px]"
                  />
                </label>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const name = newDimStyleName.trim().toUpperCase().replace(/\s+/g, '_');
                  if (!name || doc.dimStyles[name]) return;
                  onUpsertDimStyle({
                    name,
                    dimscale: 1,
                    dimtxt: 180,
                    dimasz: 180,
                    dimexo: 62.5,
                    dimexe: 125,
                    dimlfac: 1,
                    dimdec: 2
                  });
                  setSelectedDimStyleKey(name);
                  setNewDimStyleName('');
                }}
                className="flex gap-1 pt-1"
              >
                <input
                  type="text"
                  value={newDimStyleName}
                  onChange={e => setNewDimStyleName(e.target.value)}
                  placeholder="Tên DimStyle mới..."
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px]"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-0.5 rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-500"
                >
                  <Plus className="h-3 w-3" />
                  Tạo
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Underlay alignment for Network Design 2D & 3D */}
        <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-300">
              Căn chỉnh Nền Mạng (2D & 3D)
            </span>
            <button
              type="button"
              onClick={onAutoFitUnderlay}
              className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-cyan-300 hover:bg-slate-700"
            >
              Tự động khớp
            </button>
          </div>

          <label className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">Hiển thị làm nền Thiết kế Mạng</span>
            <input
              type="checkbox"
              checked={doc.underlay.enabled}
              onChange={e => updateUnderlay({ enabled: e.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">Hiển thị nền CAD trong 3D</span>
            <input
              type="checkbox"
              checked={doc.underlay.showIn3D}
              onChange={e => updateUnderlay({ showIn3D: e.target.checked })}
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Độ mờ nền (Opacity)</span>
              <span>{Math.round(doc.underlay.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={doc.underlay.opacity}
              onChange={e => updateUnderlay({ opacity: Number(e.target.value) })}
              className="w-full"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-0.5">
              <span className="text-[10px] text-slate-400">Tỉ lệ (px/unit)</span>
              <input
                type="number"
                step={0.005}
                value={doc.underlay.scaleToCanvasPx}
                onChange={e => updateUnderlay({ scaleToCanvasPx: Math.max(0.0005, Number(e.target.value) || 0.05) })}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[10px] text-slate-400">Góc xoay (°)</span>
              <input
                type="number"
                step={1}
                value={doc.underlay.rotationDeg}
                onChange={e => updateUnderlay({ rotationDeg: Number(e.target.value) || 0 })}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[10px] text-slate-400">Dịch X (px)</span>
              <input
                type="number"
                step={10}
                value={doc.underlay.offsetX}
                onChange={e => updateUnderlay({ offsetX: Number(e.target.value) || 0 })}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[10px] text-slate-400">Dịch Y (px)</span>
              <input
                type="number"
                step={10}
                value={doc.underlay.offsetY}
                onChange={e => updateUnderlay({ offsetY: Number(e.target.value) || 0 })}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              />
            </label>
          </div>

          {(() => {
            const cadPxPerMeter = computeNetworkPxPerMeterFromCad(doc);
            const layers = Object.values(doc.layers);
            const lockedCount = layers.filter(l => l.locked).length;
            const allLocked = layers.length > 0 && lockedCount === layers.length;
            return (
              <div className="space-y-1.5 rounded border border-slate-800 bg-slate-900/70 p-2 text-[10px] text-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span>Tỉ lệ quy đổi sang Mạng:</span>
                  <strong className={cadPxPerMeter ? 'font-mono text-emerald-300' : 'text-amber-300'}>
                    {cadPxPerMeter ? `${cadPxPerMeter} px/m` : 'Chưa đặt đơn vị'}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>
                    Khóa mặt bằng:{' '}
                    <strong className="font-mono text-slate-100">
                      {lockedCount}/{layers.length} lớp
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDocumentSettings(prev => {
                        const nextLayers = { ...prev.layers };
                        const nextLock = !allLocked;
                        for (const k of Object.keys(nextLayers)) {
                          nextLayers[k] = { ...nextLayers[k], locked: nextLock };
                        }
                        return { ...prev, layers: nextLayers };
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                      allLocked
                        ? 'bg-amber-900/60 text-amber-200 hover:bg-amber-800/70'
                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <Lock className="h-2.5 w-2.5" />
                    {allLocked ? 'Mở khóa nền' : 'Khóa toàn bộ nền'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  if (selectedEntities.length > 1) {
    const selectedIds = selectedEntities.map(e => e.id);
    const editableCount = selectedEntities.filter(e => isEntityGeometryEditable(e)).length;
    const protectedCount = selectedEntities.length - editableCount;
    const totalLength = selectedEntities.reduce((sum, e) => sum + computeEntityLength2D(e), 0);

    return (
      <div className="flex h-full flex-col overflow-y-auto space-y-3 p-3 text-xs">
        <div>
          <div className="font-semibold text-white">
            Đang chọn {selectedEntities.length} đối tượng CAD
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1.5 rounded border border-slate-800 bg-slate-950/60 p-2 text-[10px] text-slate-300">
            <div>Cho phép sửa: <strong className="text-emerald-300">{editableCount}</strong></div>
            <div>Được bảo toàn: <strong className="text-amber-300">{protectedCount}</strong></div>
            <div className="col-span-2">
              Tổng chiều dài tuyến: <strong className="text-cyan-300">{totalLength.toFixed(2)} {unitMeta.shortLabel}</strong>
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">Chuyển tất cả sang Layer</span>
            <select
              defaultValue=""
              onChange={e => {
                const targetLayer = e.target.value;
                if (!targetLayer) return;
                onBatchPatchEntities(selectedIds, { layer: targetLayer }, 'Đổi Layer hàng loạt');
              }}
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              <option value="">-- Giữ nguyên Layer --</option>
              {layerNames.map(n => (
                <option key={n} value={n}>
                  {decodeAutoCadText(n)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">Đổi màu hàng loạt (ACI)</span>
            <select
              defaultValue=""
              onChange={e => {
                if (e.target.value === '') return;
                onBatchPatchEntities(selectedIds, { colorIndex: Number(e.target.value) }, 'Đổi màu hàng loạt');
              }}
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              <option value="">-- Giữ nguyên màu --</option>
              <option value={256}>ByLayer</option>
              <option value={0}>ByBlock</option>
              {QUICK_ACI_SWATCHES.map(sw => (
                <option key={sw.aci} value={sw.aci}>
                  {sw.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-1.5">
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Kiểu nét</span>
              <select
                defaultValue=""
                onChange={e => {
                  if (!e.target.value) return;
                  onBatchPatchEntities(selectedIds, { lineType: e.target.value }, 'Đổi kiểu nét hàng loạt');
                }}
                className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-100"
              >
                <option value="">-- Giữ nguyên --</option>
                {lineTypeNames.map(lt => (
                  <option key={lt} value={lt}>{lt}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Độ dày nét</span>
              <select
                defaultValue=""
                onChange={e => {
                  if (e.target.value === '') return;
                  onBatchPatchEntities(selectedIds, { lineWeight: Number(e.target.value) }, 'Đổi độ dày nét hàng loạt');
                }}
                className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-100"
              >
                <option value="">-- Giữ nguyên --</option>
                {LINE_WEIGHT_OPTIONS.map(lw => (
                  <option key={lw.value} value={lw.value}>{lw.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelectSimilar(selectedEntities)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-900/50"
        >
          <CheckSquare className="h-3.5 w-3.5" />
          Chọn tương tự (Select Similar)
        </button>

        <button
          type="button"
          onClick={onDeleteSelected}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900/50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Xóa {selectedEntities.length} đối tượng
        </button>
      </div>
    );
  }

  const ent = selectedEntities[0];
  const isReadonlyOrUnknown = !isEntityGeometryEditable(ent);
  const vpSummary = extractViewportSummary(ent);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 text-xs space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <span>{ent.type === 'UNKNOWN' ? ent.dxfType : ent.type}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-normal text-slate-300">
              {ent.space === 'paper' ? 'Paper' : 'Model'}
            </span>
          </div>
          <div className="text-[10px] text-slate-400">Handle DXF: #{ent.handle}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelectSimilar([ent])}
            className="rounded p-1.5 text-slate-400 hover:bg-cyan-950/60 hover:text-cyan-300"
            title="Chọn toàn bộ đối tượng cùng loại & Layer (Select Similar)"
          >
            <CheckSquare className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDeleteSelected}
            className="rounded p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
            title="Xóa đối tượng"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isReadonlyOrUnknown && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-[11px] text-amber-200">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <div>
            {ent.preservationTier === 'unknown'
              ? 'Đối tượng đặc thù được khóa hình học và bảo toàn mã DXF/XData gốc để xuất Round-trip nguyên vẹn.'
              : 'Đối tượng Hatch/Solid/Leader ở chế độ chỉ đọc hình học nhằm bảo toàn biên gốc.'}
          </div>
        </div>
      )}

      {vpSummary && (
        <div className="space-y-1 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-2 text-[11px] text-cyan-200">
          <div className="font-semibold">Paper Space VIEWPORT {vpSummary.viewportId !== undefined ? `#${vpSummary.viewportId}` : ''}</div>
          <div className="text-[10px] text-cyan-300/80">
            Kích thước khung nhìn: {vpSummary.width.toFixed(1)} × {vpSummary.height.toFixed(1)} {unitMeta.shortLabel}
          </div>
        </div>
      )}

      {/* Common Properties */}
      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Layer</span>
          <select
            value={ent.layer}
            onChange={e =>
              onPatchEntity(ent.id, prev => ({ ...prev, layer: e.target.value }), 'Đổi Layer')
            }
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
          >
            {layerNames.map(n => (
              <option key={n} value={n}>
                {decodeAutoCadText(n)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Màu sắc (ACI)</span>
          <select
            disabled={isReadonlyOrUnknown}
            value={ent.colorIndex ?? 256}
            onChange={e =>
              onPatchEntity(
                ent.id,
                prev => ({ ...prev, colorIndex: Number(e.target.value), trueColor: undefined }),
                'Đổi màu đối tượng'
              )
            }
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 disabled:opacity-50"
          >
            <option value={256}>ByLayer (Theo lớp)</option>
            <option value={0}>ByBlock (Theo khối)</option>
            {QUICK_ACI_SWATCHES.map(sw => (
              <option key={sw.aci} value={sw.aci}>
                {sw.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400">Kiểu nét</span>
            <select
              disabled={isReadonlyOrUnknown}
              value={ent.lineType || 'BYLAYER'}
              onChange={e =>
                onPatchEntity(ent.id, prev => ({ ...prev, lineType: e.target.value }), 'Đổi kiểu nét')
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-100 disabled:opacity-50"
            >
              {lineTypeNames.map(lt => (
                <option key={lt} value={lt}>
                  {lt}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400">Độ dày nét</span>
            <select
              disabled={isReadonlyOrUnknown}
              value={ent.lineWeight ?? -3}
              onChange={e =>
                onPatchEntity(ent.id, prev => ({ ...prev, lineWeight: Number(e.target.value) }), 'Đổi độ dày nét')
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-100 disabled:opacity-50"
            >
              {LINE_WEIGHT_OPTIONS.map(lw => (
                <option key={lw.value} value={lw.value}>
                  {lw.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Type-specific geometry fields */}
      {ent.type === 'LINE' && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[11px] font-semibold text-cyan-300">Tọa độ Đoạn thẳng</div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="text-[10px] text-slate-400">Đầu X</span>
              <input
                type="number"
                value={Number(ent.start.x.toFixed(3))}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'LINE'
                      ? { ...p, start: { ...p.start, x: Number(e.target.value) || 0 } }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-slate-400">Đầu Y</span>
              <input
                type="number"
                value={Number(ent.start.y.toFixed(3))}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'LINE'
                      ? { ...p, start: { ...p.start, y: Number(e.target.value) || 0 } }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-slate-400">Cuối X</span>
              <input
                type="number"
                value={Number(ent.end.x.toFixed(3))}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'LINE'
                      ? { ...p, end: { ...p.end, x: Number(e.target.value) || 0 } }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-slate-400">Cuối Y</span>
              <input
                type="number"
                value={Number(ent.end.y.toFixed(3))}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'LINE'
                      ? { ...p, end: { ...p.end, y: Number(e.target.value) || 0 } }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
          </div>
          <div className="text-[11px] text-slate-400">
            Chiều dài:{' '}
            <span className="font-medium text-white">
              {Math.hypot(ent.end.x - ent.start.x, ent.end.y - ent.start.y).toFixed(2)}{' '}
              {unitMeta.shortLabel}
            </span>
          </div>
        </div>
      )}

      {(ent.type === 'CIRCLE' || ent.type === 'ARC') && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[11px] font-semibold text-cyan-300">
            {ent.type === 'CIRCLE' ? 'Đường tròn' : 'Cung tròn'}
          </div>
          <label className="block">
            <span className="text-[10px] text-slate-400">Bán kính (Radius)</span>
            <input
              type="number"
              min={0.1}
              value={Number(ent.radius.toFixed(3))}
              onChange={e =>
                onPatchEntity(ent.id, p =>
                  p.type === 'CIRCLE' || p.type === 'ARC'
                    ? { ...p, radius: Math.max(0.1, Number(e.target.value) || 1) }
                    : p
                )
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
            />
          </label>
          {ent.type === 'ARC' && (
            <div className="grid grid-cols-2 gap-1.5">
              <label className="block">
                <span className="text-[10px] text-slate-400">Góc đầu (°)</span>
                <input
                  type="number"
                  value={Number(ent.startAngle.toFixed(1))}
                  onChange={e =>
                    onPatchEntity(ent.id, p =>
                      p.type === 'ARC' ? { ...p, startAngle: Number(e.target.value) || 0 } : p
                    )
                  }
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Góc cuối (°)</span>
                <input
                  type="number"
                  value={Number(ent.endAngle.toFixed(1))}
                  onChange={e =>
                    onPatchEntity(ent.id, p =>
                      p.type === 'ARC' ? { ...p, endAngle: Number(e.target.value) || 0 } : p
                    )
                  }
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {(ent.type === 'TEXT' || ent.type === 'MTEXT') && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[11px] font-semibold text-cyan-300">Nội dung & Kiểu Chữ</div>
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400">Text Style</span>
            <select
              value={ent.style || 'STANDARD'}
              onChange={e =>
                onPatchEntity(
                  ent.id,
                  p => (p.type === 'TEXT' || p.type === 'MTEXT' ? { ...p, style: e.target.value } : p),
                  'Đổi Text Style'
                )
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              {textStyleList.map(st => (
                <option key={st.name} value={st.name}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            rows={3}
            value={
              ent.type === 'TEXT'
                ? decodeAutoCadText(ent.text)
                : stripMTextFormatting(ent.plainText || ent.rawText)
            }
            onChange={e => {
              const nextVal = e.target.value;
              onPatchEntity(
                ent.id,
                p => {
                  if (p.type === 'TEXT') return { ...p, text: nextVal };
                  if (p.type === 'MTEXT') return { ...p, plainText: nextVal, rawText: nextVal };
                  return p;
                },
                'Sửa nội dung văn bản CAD'
              );
            }}
            className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-[11px] text-slate-100"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="text-[10px] text-slate-400">Chiều cao chữ</span>
              <input
                type="number"
                min={0.5}
                value={Number(ent.height.toFixed(2))}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'TEXT' || p.type === 'MTEXT'
                      ? { ...p, height: Math.max(0.5, Number(e.target.value) || 2.5) }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-slate-400">Góc xoay (°)</span>
              <input
                type="number"
                value={Number(ent.rotation.toFixed(1))}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'TEXT' || p.type === 'MTEXT'
                      ? { ...p, rotation: Number(e.target.value) || 0 }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
            {ent.type === 'TEXT' && (
              <>
                <label className="block">
                  <span className="text-[10px] text-slate-400">Co giãn rộng</span>
                  <input
                    type="number"
                    min={0.2}
                    max={4}
                    step={0.05}
                    value={Number((ent.widthFactor || 1).toFixed(2))}
                    onChange={e =>
                      onPatchEntity(ent.id, p =>
                        p.type === 'TEXT' ? { ...p, widthFactor: Math.max(0.2, Number(e.target.value) || 1) } : p
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">Nghiêng (°)</span>
                  <input
                    type="number"
                    min={-45}
                    max={45}
                    value={Number((ent.obliqueAngle || 0).toFixed(1))}
                    onChange={e =>
                      onPatchEntity(ent.id, p =>
                        p.type === 'TEXT' ? { ...p, obliqueAngle: Number(e.target.value) || 0 } : p
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}

      {ent.type === 'DIMENSION' && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[11px] font-semibold text-cyan-300">Kiểu & Nhãn Kích thước</div>
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400">Dim Style</span>
            <select
              value={ent.style || 'STANDARD'}
              onChange={e =>
                onPatchEntity(
                  ent.id,
                  p => (p.type === 'DIMENSION' ? { ...p, style: e.target.value } : p),
                  'Đổi Dim Style'
                )
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              {dimStyleList.map(ds => (
                <option key={ds.name} value={ds.name}>
                  {ds.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400">Mẫu chữ ghi (&lt;&gt; = giá trị đo)</span>
            <input
              type="text"
              value={ent.text || '<>'}
              onChange={e =>
                onPatchEntity(
                  ent.id,
                  p => (p.type === 'DIMENSION' ? { ...p, text: e.target.value } : p),
                  'Sửa nhãn Dimension'
                )
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            />
          </label>
          <div className="text-[11px] text-slate-400">
            Hiển thị: <strong className="text-white">{formatDimensionDisplayText(ent, doc)} {unitMeta.shortLabel}</strong>
          </div>
        </div>
      )}

      {ent.type === 'INSERT' && (
        <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[11px] font-semibold text-cyan-300">
            Block: {decodeAutoCadText(ent.blockName)}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="text-[10px] text-slate-400">Tỉ lệ X</span>
              <input
                type="number"
                step={0.1}
                value={ent.scale.x}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'INSERT'
                      ? { ...p, scale: { ...p.scale, x: Number(e.target.value) || 1 } }
                      : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-slate-400">Góc xoay (°)</span>
              <input
                type="number"
                value={ent.rotation}
                onChange={e =>
                  onPatchEntity(ent.id, p =>
                    p.type === 'INSERT' ? { ...p, rotation: Number(e.target.value) || 0 } : p
                  )
                }
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              />
            </label>
          </div>

          {/* ATTRIB editor */}
          <div className="space-y-1.5 border-t border-slate-800 pt-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300">
                <Tag className="h-3 w-3" />
                Thuộc tính (ATTRIB • {ent.attributes?.length || 0})
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextAttr: CADInsertAttribute = {
                    id: createCadId('att'),
                    tag: `ATTR_${(ent.attributes?.length || 0) + 1}`,
                    text: 'VALUE',
                    position: { ...ent.position },
                    height: doc.header.$TEXTSIZE || 180,
                    rotation: 0,
                    layer: ent.layer
                  };
                  onEditInsertAttributes(ent.id, [...(ent.attributes || []), nextAttr]);
                }}
                className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-slate-700"
              >
                <Plus className="h-2.5 w-2.5" />
                Thêm Tag
              </button>
            </div>

            {ent.attributes && ent.attributes.length > 0 ? (
              <div className="space-y-1.5">
                {ent.attributes.map((att, idx) => (
                  <div key={att.id || idx} className="space-y-1 rounded border border-slate-800 bg-slate-900/70 p-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={att.tag}
                        onChange={e => {
                          const next = (ent.attributes || []).map((a, i) =>
                            i === idx ? { ...a, tag: e.target.value } : a
                          );
                          onEditInsertAttributes(ent.id, next);
                        }}
                        placeholder="TAG"
                        className="w-24 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300"
                      />
                      <input
                        type="number"
                        min={1}
                        value={att.height}
                        onChange={e => {
                          const next = (ent.attributes || []).map((a, i) =>
                            i === idx ? { ...a, height: Math.max(1, Number(e.target.value) || 2.5) } : a
                          );
                          onEditInsertAttributes(ent.id, next);
                        }}
                        title="Cỡ chữ Attribute"
                        className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = (ent.attributes || []).filter((_, i) => i !== idx);
                          onEditInsertAttributes(ent.id, next);
                        }}
                        className="ml-auto text-slate-500 hover:text-rose-400"
                        title="Xóa Attribute"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={decodeAutoCadText(att.text)}
                      onChange={e => {
                        const next = (ent.attributes || []).map((a, i) =>
                          i === idx ? { ...a, text: e.target.value } : a
                        );
                        onEditInsertAttributes(ent.id, next);
                      }}
                      placeholder="Giá trị Attribute..."
                      className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-100"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-slate-500">Block này chưa gắn Attribute nào.</div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onExplodeInsert(ent.id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/40 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-900/50"
          >
            <Scale className="h-3.5 w-3.5" />
            Phá khối Block (Explode)
          </button>
        </div>
      )}
    </div>
  );
};
