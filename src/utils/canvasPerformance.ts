import type { CanvasPerformanceMode } from '../types/infrastructure';
import type { RenderQualityLevel } from '../contexts/ViewportContext';

export interface CanvasSceneComplexityMetrics {
  nodeCount: number;
  cableCount: number;
  rackCount: number;
  roomCount: number;
  trayCount: number;
  cadEntityCount: number;
  zoom: number;
  isPanning?: boolean;
}

export interface CanvasPerformancePolicy {
  mode: CanvasPerformanceMode;
  effectiveTier: 'quality' | 'balanced' | 'performance';
  spatialCullingActive: boolean;
  cullingThresholds: {
    devices: number;
    cables: number;
    racks: number;
    rooms: number;
    trays: number;
    cadEntities: number;
  };
  cullBufferPx: number;
  rasterCableDenseThreshold: number;
  rasterCablePanThreshold: number;
  lowDetailMode: boolean;
  enableShadowsAndFilters: boolean;
  showFineSubDetails: boolean;
  redrawThrottleMs: number;
  maxDpr: number;
  threeRenderQuality: RenderQualityLevel;
  threeShadowsEnabled: boolean;
}

export interface CanvasPerformancePresetMeta {
  id: CanvasPerformanceMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const CANVAS_PERFORMANCE_MODES: CanvasPerformancePresetMeta[] = [
  {
    id: 'auto',
    label: 'Tự động (Smart Adaptive)',
    shortLabel: 'Tự động',
    description: 'Tự động bật/tắt Spatial Indexing & mức chi tiết theo số lượng node/cáp thực tế.'
  },
  {
    id: 'high_quality',
    label: 'Chất lượng cao (High Quality)',
    shortLabel: 'Chất lượng cao',
    description: 'Tắt culling thô, render đầy đủ 3D Rack, bóng đổ & đường cáp vector sắc nét cho máy trạm / xuất bản vẽ.'
  },
  {
    id: 'high_performance',
    label: 'Tốc độ cao (Field Mode)',
    shortLabel: 'Tốc độ cao',
    description: 'Kích hoạt triệt để Viewport Culling, giới hạn tần số vẽ lại và ẩn bớt chi tiết nhỏ khi thu phóng xa.'
  }
];

export function normalizeCanvasPerformanceMode(mode?: unknown): CanvasPerformanceMode {
  if (mode === 'high_quality' || mode === 'high_performance' || mode === 'auto') {
    return mode;
  }
  return 'auto';
}

/**
 * Resolves unified 2D Network Canvas, CAD Canvas, and 3D render policy from user/project setting
 * and real-time scene complexity.
 */
export function resolveCanvasPerformancePolicy(
  rawMode: CanvasPerformanceMode | undefined,
  metrics: CanvasSceneComplexityMetrics
): CanvasPerformancePolicy {
  const mode = normalizeCanvasPerformanceMode(rawMode);
  const totalNetworkObjects =
    metrics.nodeCount + metrics.cableCount + metrics.rackCount + metrics.roomCount + metrics.trayCount;
  const isHeavyScene =
    metrics.nodeCount > 60 ||
    metrics.cableCount > 60 ||
    totalNetworkObjects > 140 ||
    metrics.cadEntityCount > 1200;

  if (mode === 'high_quality') {
    return {
      mode,
      effectiveTier: 'quality',
      spatialCullingActive: false,
      cullingThresholds: {
        devices: Number.POSITIVE_INFINITY,
        cables: Number.POSITIVE_INFINITY,
        racks: Number.POSITIVE_INFINITY,
        rooms: Number.POSITIVE_INFINITY,
        trays: Number.POSITIVE_INFINITY,
        cadEntities: Number.POSITIVE_INFINITY
      },
      cullBufferPx: 600,
      rasterCableDenseThreshold: Number.POSITIVE_INFINITY,
      rasterCablePanThreshold: Number.POSITIVE_INFINITY,
      lowDetailMode: false,
      enableShadowsAndFilters: true,
      showFineSubDetails: true,
      redrawThrottleMs: 0,
      maxDpr: 2,
      threeRenderQuality: 'high',
      threeShadowsEnabled: true
    };
  }

  if (mode === 'high_performance') {
    const thresholds = {
      devices: 12,
      cables: 12,
      racks: 6,
      rooms: 10,
      trays: 8,
      cadEntities: 150
    };
    const spatialCullingActive =
      metrics.nodeCount > thresholds.devices ||
      metrics.cableCount > thresholds.cables ||
      metrics.rackCount > thresholds.racks ||
      metrics.roomCount > thresholds.rooms ||
      metrics.trayCount > thresholds.trays ||
      metrics.cadEntityCount > thresholds.cadEntities;

    return {
      mode,
      effectiveTier: 'performance',
      spatialCullingActive,
      cullingThresholds: thresholds,
      cullBufferPx: 160,
      rasterCableDenseThreshold: 20,
      rasterCablePanThreshold: 8,
      lowDetailMode: metrics.zoom < 0.72 || (Boolean(metrics.isPanning) && metrics.zoom < 0.95),
      enableShadowsAndFilters: false,
      showFineSubDetails: metrics.zoom >= 0.72 && !metrics.isPanning,
      redrawThrottleMs: 34,
      maxDpr: 1,
      threeRenderQuality: 'low',
      threeShadowsEnabled: false
    };
  }

  // Smart Adaptive ('auto')
  const thresholds = {
    devices: 40,
    cables: 40,
    racks: 16,
    rooms: 24,
    trays: 16,
    cadEntities: 400
  };
  const spatialCullingActive =
    metrics.nodeCount > thresholds.devices ||
    metrics.cableCount > thresholds.cables ||
    metrics.rackCount > thresholds.racks ||
    metrics.roomCount > thresholds.rooms ||
    metrics.trayCount > thresholds.trays ||
    metrics.cadEntityCount > thresholds.cadEntities;

  return {
    mode,
    effectiveTier: isHeavyScene ? 'performance' : 'balanced',
    spatialCullingActive,
    cullingThresholds: thresholds,
    cullBufferPx: isHeavyScene ? 260 : 350,
    rasterCableDenseThreshold: 100,
    rasterCablePanThreshold: 25,
    lowDetailMode: metrics.zoom < 0.45 || (isHeavyScene && metrics.zoom < 0.65),
    enableShadowsAndFilters: !isHeavyScene,
    showFineSubDetails: metrics.zoom >= 0.45,
    redrawThrottleMs: isHeavyScene ? 16 : 0,
    maxDpr: isHeavyScene ? 1.5 : 2,
    threeRenderQuality: totalNetworkObjects > 220 ? 'medium' : 'high',
    threeShadowsEnabled: !isHeavyScene
  };
}
