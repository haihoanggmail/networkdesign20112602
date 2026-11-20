import type {
  CameraPresetId,
  Capture3DBackground,
  Capture3DRequestOptions,
  Capture3DResult
} from '../../contexts/ViewportContext';
import type { A4Orientation, PdfMarginsMm } from '../../utils/pdfExporter';
import type { CADDocument } from '../../cad/core/CADTypes';

export type { PdfMarginsMm };

export interface ExportProgressEvent {
  percent: number;
  stage: string;
  currentPage?: number;
  totalPages?: number;
}

export type ExportProgressCallback = (progress: ExportProgressEvent) => void;

export type ExportContentScope = '2d' | '3d' | 'both';
export type ExportFloorScope = 'all' | 'active' | string;
export type ExportScopeMode = 'drawing_only' | 'drawing_and_cad';
export type ExportFormat = 'png' | 'svg' | 'dxf' | 'pdf' | 'bundle' | 'html';
export type PdfPaperSize = 'A4' | 'A3' | 'A2' | 'A1';

export interface ExportFloorSummary {
  id: string;
  name: string;
  level: number;
  buildingId?: string;
  elevationMeters: number;
  widthMeters: number;
  heightMeters: number;
  roomCount: number;
  nodeCount: number;
  rackCount: number;
  cableCount: number;
}

export interface ExportFloorMetadata {
  hasMultipleFloors: boolean;
  totalFloors: number;
  activeFloorId: string;
  requestedFloorScope: ExportFloorScope;
  resolvedFloorId: '__ALL__' | string;
  isFloorBasedMode: boolean;
  floors: ExportFloorSummary[];
}

export interface ExportFloorLayerMap {
  [floorId: string]: {
    roomIds: string[];
    nodeIds: string[];
    rackIds: string[];
    cableIds: string[];
  };
}

export interface SerializedHachihiProjectData {
  id: string;
  name: string;
  author: string;
  version: string;
  activeMode: string;
  activeBuildingId?: string;
  activeFloorId: string;
  activeFloorScope: '__ALL__' | string;
  floorMetadata: ExportFloorMetadata;
  floors: ExportFloorSummary[];
  floorLayerIds: ExportFloorLayerMap;
}

export interface ExportHtmlViewerConfig {
  contentScope?: ExportContentScope;
  background3D?: 'light' | 'dark';
  floorScope?: ExportFloorScope;
  viewer3DRuntimeJs?: string;
}

export interface Export2DViewportRect {
  pan: { x: number; y: number };
  zoom: number;
  viewportSize: { w: number; h: number };
}

export interface Captured3DSnapshotInput {
  preset: CameraPresetId;
  label: string;
  dataUrl: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  background: Capture3DBackground;
}

export interface ExportPngConfig {
  contentScope: ExportContentScope;
  floorScope?: ExportFloorScope;
  background3D?: Capture3DBackground;
  viewport2D?: Export2DViewportRect;
  quickView?: boolean;
  whiteBackground2D?: boolean;
  capture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
}

export interface ExportDxfOptions {
  includeCad?: boolean;
  cadDocument?: CADDocument | null;
}

export interface ExportPdfConfig {
  contentScope: ExportContentScope;
  floorScope?: ExportFloorScope;
  paperSize?: PdfPaperSize;
  orientation: A4Orientation;
  autoFit?: boolean;
  margins?: Partial<PdfMarginsMm>;
  drawingCode: string;
  drawingScale: string;
  includeDiagram: boolean;
  includeLegendPanel: boolean;
  includeRackElevation: boolean;
  includeTables: boolean;
  includeCad?: boolean;
  cadDocument?: CADDocument | null;
  background3D?: Capture3DBackground;
  cameraAngles3D?: CameraPresetId[];
  capture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
  onProgress?: ExportProgressCallback;
}

export interface PdfViewportTransformConfig {
  paperSize?: PdfPaperSize;
  orientation?: A4Orientation;
  autoFit?: boolean;
  margins?: Partial<PdfMarginsMm>;
  includeLegendPanel?: boolean;
  floorScope?: ExportFloorScope;
  drawingScale?: string;
  cadDocument?: CADDocument | null;
}

export interface PdfViewportTransformResult {
  boundingBox: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  viewportMm: {
    width: number;
    height: number;
  };
  transform: {
    scale: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    clipped: boolean;
  };
  marginsMm: PdfMarginsMm;
  scaleRatioLabel: string;
  autoFit: boolean;
}

export interface ExportBundleConfig {
  contentScope: ExportContentScope;
  floorScope?: ExportFloorScope;
  orientation: A4Orientation;
  autoFit?: boolean;
  margins?: Partial<PdfMarginsMm>;
  drawingCode: string;
  drawingScale: string;
  includeLegendPanel: boolean;
  includeRackElevation: boolean;
  includeTables: boolean;
  includeCad?: boolean;
  cadDocument?: CADDocument | null;
  background3D?: Capture3DBackground;
  cameraAngles3D?: CameraPresetId[];
  capture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
  onProgress?: ExportProgressCallback;
}

export const CAMERA_PRESET_LABELS: Record<CameraPresetId, string> = {
  iso: 'Góc nhìn Isometric 3D',
  top: 'Mặt bằng trên xuống (Top 3D)',
  front: 'Mặt đứng trực diện (Front 3D)',
  side: 'Mặt cắt bên hông (Side 3D)'
};

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const urlApi = window.URL || window.webkitURL;
  const url = urlApi.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(url), 1500);
}

export function sanitizeExportBaseName(name: string): string {
  const cleaned = (name || 'HACHIHI_Project')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'HACHIHI_Project';
}
