import * as THREE from 'three';
import { DeviceAsset, RackSide, ServerRack } from '../../types/infrastructure';
import {
  RackAirflowAnalysis,
  RackDoorAirflowType,
  ThermalRiskLevel
} from '../../utils/rackAirflow';
import { getAssetUHeight, getRackSlotsForSide } from '../../utils/rackGeometry';

export const UNIT_HEIGHT_M = 0.04445; // Exact EIA-310 1U = 44.45mm
export const PLINTH_HEIGHT_M = 0.09;
export const RAIL_BOTTOM_Y_M = PLINTH_HEIGHT_M + 0.04;
export const TOP_CANOPY_HEIGHT_M = 0.095;
export const INNER_19_WIDTH_M = 0.4826;
export const DEVICE_CHASSIS_WIDTH_M = 0.442;

export interface RackDimensions3D {
  totalUnits: number;
  width: number;
  depth: number;
  railSpanHeight: number;
  cabinetHeight: number;
  frontRailZ: number;
  rearRailZ: number;
}

export function getRackDimensions3D(rack: ServerRack): RackDimensions3D {
  const totalUnits = Math.max(4, rack.totalUnits || 42);
  const width = Math.max(0.58, Math.min(0.92, (rack.widthMm || 600) / 1000));
  const depth = Math.max(0.56, Math.min(1.26, (rack.depthMm || 800) / 1000));
  const railSpanHeight = totalUnits * UNIT_HEIGHT_M;
  const cabinetHeight = RAIL_BOTTOM_Y_M + railSpanHeight + TOP_CANOPY_HEIGHT_M;
  const frontRailZ = depth / 2 - 0.068;
  const rearRailZ = -depth / 2 + 0.068;

  return {
    totalUnits,
    width,
    depth,
    railSpanHeight,
    cabinetHeight,
    frontRailZ,
    rearRailZ
  };
}

export function uSlotToCenterY(startU: number, uHeight = 1): number {
  return RAIL_BOTTOM_Y_M + (startU - 1 + uHeight / 2) * UNIT_HEIGHT_M;
}

export function getThermalRiskHex(zone: ThermalRiskLevel): number {
  switch (zone) {
    case 'hot':
      return 0xef4444;
    case 'warm':
      return 0xf59e0b;
    case 'nominal':
      return 0x22c55e;
    default:
      return 0x38bdf8;
  }
}

export interface DisposableTrack {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

export function createDisposableTrack(): DisposableTrack {
  return { geometries: [], materials: [], textures: [] };
}

export function disposeTrack(track: DisposableTrack): void {
  for (const g of track.geometries) g.dispose();
  for (const m of track.materials) m.dispose();
  for (const t of track.textures) t.dispose();
  track.geometries.length = 0;
  track.materials.length = 0;
  track.textures.length = 0;
}

function trackGeo<T extends THREE.BufferGeometry>(track: DisposableTrack, geo: T): T {
  track.geometries.push(geo);
  return geo;
}

function trackMat<T extends THREE.Material>(track: DisposableTrack, mat: T): T {
  track.materials.push(mat);
  return mat;
}

function trackTex<T extends THREE.Texture>(track: DisposableTrack, tex: T): T {
  track.textures.push(tex);
  return tex;
}

function createURailScaleTexture(
  totalUnits: number,
  maxAniso: number,
  track: DisposableTrack
): THREE.CanvasTexture {
  const pxPerU = 36;
  const w = 96;
  const h = Math.max(256, totalUnits * pxPerU);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#2b3445';
    ctx.fillRect(0, 0, w, h);

    // Metallic subtle gradient strip
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#1f2937');
    grad.addColorStop(0.5, '#374151');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < totalUnits; i++) {
      // Canvas Y=0 is top = U(totalUnits)
      const u = totalUnits - i;
      const yTop = i * pxPerU;

      // Subtle alternating band
      if (u % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(0, yTop, w, pxPerU);
      }

      // U boundary line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yTop + pxPerU - 0.5);
      ctx.lineTo(w, yTop + pxPerU - 0.5);
      ctx.stroke();

      // 3 square cage-nut mounting holes per U
      ctx.fillStyle = '#090d16';
      const holeSize = 7;
      for (let hIdx = 0; hIdx < 3; hIdx++) {
        const hy = yTop + 5 + hIdx * 10;
        ctx.fillRect(w - 20, hy, holeSize, holeSize);
      }

      // Crisp U number text
      ctx.fillStyle = u % 5 === 0 ? '#93c5fd' : '#e2e8f0';
      ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = u < 10 ? `0${u}` : String(u);
      ctx.fillText(label, 12, yTop + pxPerU / 2 + 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return trackTex(track, tex);
}

function createPerforatedDoorTexture(maxAniso: number, track: DisposableTrack): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, size, size);

    // Cut honeycomb/grid holes via destination-out
    ctx.globalCompositeOperation = 'destination-out';
    const stepX = 16;
    const stepY = 14;
    for (let row = 0; row * stepY <= size + stepY; row++) {
      const offsetX = row % 2 === 0 ? 0 : stepX / 2;
      for (let col = -1; col * stepX <= size + stepX; col++) {
        ctx.beginPath();
        ctx.arc(col * stepX + offsetX, row * stepY, 4.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 24);
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return trackTex(track, tex);
}

function getCategoryAccentColor(cat: DeviceAsset['category']): string {
  switch (cat) {
    case 'core_switch':
      return '#0284c7';
    case 'switch':
      return '#0ea5e9';
    case 'router':
      return '#2563eb';
    case 'firewall':
      return '#dc2626';
    case 'server':
      return '#334155';
    case 'storage':
      return '#0f766e';
    case 'ups':
      return '#e11d48';
    case 'pdu':
      return '#7c3aed';
    case 'odf':
      return '#0891b2';
    case 'patch_panel':
      return '#475569';
    case 'nvr':
      return '#d97706';
    default:
      return '#3b82f6';
  }
}

function createDeviceFaceplateTexture(
  asset: DeviceAsset,
  uHeight: number,
  maxAniso: number,
  track: DisposableTrack
): THREE.CanvasTexture {
  const w = 1024;
  const h = Math.max(96, Math.min(512, uHeight * 96));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const accent = getCategoryAccentColor(asset.category);
    const isDarkChassis = asset.category === 'server' || asset.category === 'ups' || asset.category === 'storage' || asset.category === 'pdu';

    // Brushed bezel base
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, isDarkChassis ? '#1e293b' : '#283548');
    grad.addColorStop(0.5, isDarkChassis ? '#0f172a' : '#1e293b');
    grad.addColorStop(1, '#0b1120');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle metallic border + left brand stripe
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = accent;
    ctx.fillRect(6, 6, 14, h - 12);

    // Equipment badge text
    ctx.fillStyle = '#f8fafc';
    ctx.font = `700 ${uHeight >= 2 ? 26 : 20}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const title = asset.name.length > 26 ? `${asset.name.slice(0, 25)}…` : asset.name;
    ctx.fillText(title, 32, 12);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${asset.vendor} · ${asset.model} · ${asset.powerWatts || 0}W`, 32, uHeight >= 2 ? 44 : 37);

    // Status LED cluster
    const leds = [
      { label: 'PWR', color: '#22c55e' },
      { label: 'SYS', color: '#38bdf8' },
      {
        label: 'ALM',
        color:
          asset.status === 'offline'
            ? '#ef4444'
            : asset.status === 'maintenance'
              ? '#f59e0b'
              : '#334155'
      }
    ];
    leds.forEach((led, idx) => {
      const lx = 36 + idx * 44;
      const ly = h - 22;
      ctx.fillStyle = led.color;
      ctx.beginPath();
      ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 10px ui-monospace, monospace';
      ctx.fillText(led.label, lx + 8, ly - 5);
    });

    // Category-specific front hardware details (right 62% of faceplate)
    const detailX = 390;
    const detailW = w - detailX - 24;

    if (asset.category === 'server' || asset.category === 'storage' || asset.category === 'nvr') {
      // Drive bays + ventilation slats
      const rows = uHeight >= 2 ? 2 : 1;
      const cols = 8;
      const bayGap = 8;
      const bayW = (detailW - bayGap * (cols - 1)) / cols;
      const bayH = Math.max(26, (h - 28 - bayGap * (rows - 1)) / rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = detailX + c * (bayW + bayGap);
          const by = 14 + r * (bayH + bayGap);
          ctx.fillStyle = '#070b14';
          ctx.fillRect(bx, by, bayW, bayH);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, by, bayW, bayH);
          // Latch accent + drive LED
          ctx.fillStyle = asset.category === 'storage' ? '#14b8a6' : '#38bdf8';
          ctx.fillRect(bx + 4, by + 4, 8, bayH - 8);
          ctx.fillStyle = (r + c) % 3 === 0 ? '#22c55e' : '#0ea5e9';
          ctx.fillRect(bx + bayW - 10, by + 6, 4, 4);
        }
      }
    } else if (asset.category === 'ups') {
      // Honeycomb intake + OLED telemetry readout
      ctx.fillStyle = '#090d16';
      ctx.fillRect(detailX, 14, 190, h - 28);
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2;
      ctx.strokeRect(detailX, 14, 190, h - 28);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 22px ui-monospace, monospace';
      ctx.fillText('230V · 100%', detailX + 16, h / 2 - 12);

      // Intake vent slots
      const ventX = detailX + 210;
      const ventW = w - ventX - 24;
      for (let vx = ventX; vx < ventX + ventW; vx += 14) {
        ctx.fillStyle = '#05080f';
        ctx.fillRect(vx, 14, 8, h - 28);
      }
    } else if (asset.category === 'pdu') {
      // C13 / C19 outlets row
      const outlets = 12;
      const step = detailW / outlets;
      for (let i = 0; i < outlets; i++) {
        const ox = detailX + i * step + 4;
        const oy = h / 2 - 16;
        ctx.fillStyle = '#04070d';
        ctx.fillRect(ox, oy, step - 10, 32);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ox, oy, step - 10, 32);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(ox + 6, oy + 9, 4, 8);
        ctx.fillRect(ox + step - 20, oy + 9, 4, 8);
        ctx.fillRect(ox + (step - 10) / 2 - 2, oy + 19, 4, 7);
      }
    } else {
      // Network Switch / Router / Firewall / Patch / ODF RJ45 & SFP port banks
      const portCount = Math.min(24, Math.max(8, asset.ports?.length || 16));
      const cols = portCount <= 12 ? portCount : 12;
      const rows = portCount > 12 ? 2 : 1;
      const pGap = 6;
      const bankW = detailW - 110;
      const portW = (bankW - pGap * (cols - 1)) / cols;
      const portH = rows === 2 ? Math.max(18, (h - 32) / 2) : Math.min(34, h - 30);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= portCount) break;
          const px = detailX + c * (portW + pGap);
          const py = rows === 2 ? 14 + r * (portH + 6) : (h - portH) / 2;
          ctx.fillStyle = '#05080f';
          ctx.fillRect(px, py, portW, portH);
          ctx.strokeStyle = asset.category === 'odf' ? '#06b6d4' : '#475569';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(px, py, portW, portH);
          // Port link LED
          const isUp = asset.ports?.[idx]?.status === 'up';
          ctx.fillStyle = isUp ? '#22c55e' : '#334155';
          ctx.fillRect(px + 3, py + 2, 5, 3);
        }
      }

      // 4x SFP+ / QSFP uplink cages on far right
      const sfpX = detailX + bankW + 14;
      for (let s = 0; s < 4; s++) {
        const sx = sfpX + (s % 2) * 44;
        const sy = s < 2 ? 16 : h / 2 + 4;
        ctx.fillStyle = '#020617';
        ctx.fillRect(sx, sy, 36, Math.max(18, h / 2 - 22));
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx, sy, 36, Math.max(18, h / 2 - 22));
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return trackTex(track, tex);
}

function createDeviceRearTexture(
  asset: DeviceAsset,
  uHeight: number,
  maxAniso: number,
  track: DisposableTrack
): THREE.CanvasTexture {
  const w = 1024;
  const h = Math.max(96, Math.min(512, uHeight * 96));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#182234';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Exhaust fan grilles (center)
    const fanCount = asset.category === 'server' || asset.category === 'ups' ? 4 : 3;
    const fanR = Math.min(h * 0.34, 38);
    for (let i = 0; i < fanCount; i++) {
      const fx = 280 + i * 115;
      const fy = h / 2;
      ctx.fillStyle = '#090d16';
      ctx.beginPath();
      ctx.arc(fx, fy, fanR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, fy, fanR * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Dual redundant PSUs on left & right
    const psuPositions = [28, w - 168];
    psuPositions.forEach((px, idx) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(px, 14, 140, h - 28);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, 14, 140, h - 28);
      // C14 inlet cutout
      ctx.fillStyle = '#020617';
      ctx.fillRect(px + 20, h / 2 - 14, 46, 28);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(px + 108, h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.fillText(`PSU${idx + 1}`, px + 88, 28);
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return trackTex(track, tex);
}

export interface MountedDevice3DHandle {
  assetId: string;
  side: RackSide;
  startU: number;
  uHeight: number;
  group: THREE.Group;
  chassisMat: THREE.MeshStandardMaterial;
  ledMat: THREE.MeshStandardMaterial;
}

export interface InteractiveRackSceneHandle {
  root: THREE.Group;
  dims: RackDimensions3D;
  frontDoorPivot: THREE.Group;
  rearLeftDoorPivot: THREE.Group;
  rearRightDoorPivot: THREE.Group;
  sidePanels: THREE.Mesh[];
  fanRotors: THREE.Group[];
  frontHitPlanes: THREE.Mesh[]; // index 0..totalUnits-1 -> u = idx + 1
  rearHitPlanes: THREE.Mesh[];
  dropPreviewGroup: THREE.Group;
  dropPreviewFillMat: THREE.MeshBasicMaterial;
  dropPreviewLineMat: THREE.LineBasicMaterial;
  thermalOverlayGroup: THREE.Group;
  mountedDevicesGroup: THREE.Group;
  mountedHandles: MountedDevice3DHandle[];
  airflowGroup: THREE.Group;
  intakeInstanced: THREE.InstancedMesh | null;
  exhaustInstanced: THREE.InstancedMesh | null;
  recircInstanced: THREE.InstancedMesh | null;
  intakeStreams: Array<{ y: number; x: number; speed: number; phase: number }>;
  exhaustStreams: Array<{ y: number; x: number; speed: number; phase: number; colorHex: number; topFanX: number; topFanZ: number }>;
  recircStreams: Array<{ y: number; x: number; gapHeight: number; speed: number; phase: number }>;
  rebuildDevices: (
    rack: ServerRack,
    assets: Record<string, DeviceAsset>,
    analysis: RackAirflowAnalysis,
    selectedAssetId: string | null,
    showThermal: boolean
  ) => void;
  rebuildThermalAndAirflow: (
    analysis: RackAirflowAnalysis,
    showThermal: boolean,
    showAirflow: boolean,
    highlightedGap: { startU: number; endU: number } | null
  ) => void;
  setDoorMode: (doorMode: 'open' | 'closed' | 'hidden', doorType: RackDoorAirflowType) => void;
  setXRaySides: (xray: boolean) => void;
  setDropPreview: (
    preview: { startU: number; uHeight: number; side: RackSide; valid: boolean } | null
  ) => void;
  updateAnimation: (dt: number, elapsed: number, analysis: RackAirflowAnalysis, airflowActive: boolean) => void;
  dispose: () => void;
}

export function buildInteractiveRackScene(
  rack: ServerRack,
  maxAniso: number,
  castShadow: boolean
): InteractiveRackSceneHandle {
  const globalTrack = createDisposableTrack();
  const deviceTrack = createDisposableTrack();
  const thermalTrack = createDisposableTrack();

  const dims = getRackDimensions3D(rack);
  const { totalUnits, width, depth, cabinetHeight, frontRailZ, rearRailZ } = dims;

  const root = new THREE.Group();
  root.name = 'interactive_rack_3d_root';

  // Shared PBR metallic materials
  const frameSteelMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({
      color: 0x161f2f,
      metalness: 0.72,
      roughness: 0.36
    })
  );
  const darkPlinthMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({
      color: 0x0b1120,
      metalness: 0.45,
      roughness: 0.58
    })
  );
  const sidePanelMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.55,
      roughness: 0.42,
      transparent: true,
      opacity: 0.96
    })
  );
  const railScaleTex = createURailScaleTexture(totalUnits, maxAniso, globalTrack);
  const railScaleMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({
      map: railScaleTex,
      metalness: 0.65,
      roughness: 0.35
    })
  );
  const perforatedTex = createPerforatedDoorTexture(maxAniso, globalTrack);
  const perforatedDoorMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({
      map: perforatedTex,
      transparent: true,
      alphaTest: 0.15,
      side: THREE.DoubleSide,
      metalness: 0.65,
      roughness: 0.4
    })
  );
  const glassDoorMat = trackMat(
    globalTrack,
    new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.24,
      roughness: 0.12,
      metalness: 0.1,
      reflectivity: 0.7,
      side: THREE.DoubleSide
    })
  );

  // 1. Plinth & 4 Heavy-Duty Leveling Feet
  const plinthGeo = trackGeo(globalTrack, new THREE.BoxGeometry(width - 0.02, PLINTH_HEIGHT_M, depth - 0.02));
  const plinthMesh = new THREE.Mesh(plinthGeo, darkPlinthMat);
  plinthMesh.position.set(0, PLINTH_HEIGHT_M / 2 + 0.015, 0);
  plinthMesh.castShadow = castShadow;
  plinthMesh.receiveShadow = castShadow;
  root.add(plinthMesh);

  const footGeo = trackGeo(globalTrack, new THREE.CylinderGeometry(0.024, 0.028, 0.025, 16));
  const footMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 })
  );
  const footOffsets = [
    [-width / 2 + 0.05, -depth / 2 + 0.05],
    [width / 2 - 0.05, -depth / 2 + 0.05],
    [-width / 2 + 0.05, depth / 2 - 0.05],
    [width / 2 - 0.05, depth / 2 - 0.05]
  ];
  for (const [fx, fz] of footOffsets) {
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(fx, 0.0125, fz);
    root.add(foot);
  }

  // 2. 4 Corner Steel Posts + Bottom/Top Structural Frames
  const postHeight = cabinetHeight - PLINTH_HEIGHT_M;
  const postSize = 0.036;
  const postGeo = trackGeo(globalTrack, new THREE.BoxGeometry(postSize, postHeight, postSize));
  const postOffsets = [
    [-width / 2 + postSize / 2, -depth / 2 + postSize / 2],
    [width / 2 - postSize / 2, -depth / 2 + postSize / 2],
    [-width / 2 + postSize / 2, depth / 2 - postSize / 2],
    [width / 2 - postSize / 2, depth / 2 - postSize / 2]
  ];
  for (const [px, pz] of postOffsets) {
    const post = new THREE.Mesh(postGeo, frameSteelMat);
    post.position.set(px, PLINTH_HEIGHT_M + postHeight / 2, pz);
    post.castShadow = castShadow;
    root.add(post);
  }

  // Top canopy frame
  const canopyY = cabinetHeight - TOP_CANOPY_HEIGHT_M / 2;
  const canopyGeo = trackGeo(globalTrack, new THREE.BoxGeometry(width, TOP_CANOPY_HEIGHT_M, depth));
  const canopyEdges = trackGeo(globalTrack, new THREE.EdgesGeometry(canopyGeo));
  const canopyMesh = new THREE.Mesh(canopyGeo, frameSteelMat);
  canopyMesh.position.set(0, canopyY, 0);
  canopyMesh.castShadow = castShadow;
  root.add(canopyMesh);

  const canopyWireMat = trackMat(
    globalTrack,
    new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35 })
  );
  const canopyWire = new THREE.LineSegments(canopyEdges, canopyWireMat);
  canopyWire.position.copy(canopyMesh.position);
  root.add(canopyWire);

  // 3. Top Exhaust Fan Tray (up to 6 circular fans mounted on roof canopy)
  const fanRotors: THREE.Group[] = [];
  const fanTrayGroup = new THREE.Group();
  fanTrayGroup.position.set(0, cabinetHeight + 0.004, 0);
  root.add(fanTrayGroup);

  const fanRingGeo = trackGeo(globalTrack, new THREE.TorusGeometry(0.068, 0.008, 10, 28));
  const fanHousingGeo = trackGeo(globalTrack, new THREE.CylinderGeometry(0.072, 0.072, 0.018, 24));
  const fanHubGeo = trackGeo(globalTrack, new THREE.CylinderGeometry(0.018, 0.018, 0.014, 16));
  const fanBladeGeo = trackGeo(globalTrack, new THREE.BoxGeometry(0.056, 0.004, 0.016));
  const fanHousingMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({ color: 0x090d16, metalness: 0.6, roughness: 0.45 })
  );
  const fanBladeMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.4, roughness: 0.35 })
  );
  const fanRingMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.25 })
  );

  const fanGridCoords: Array<[number, number]> = [
    [-0.14, 0.14],
    [0.14, 0.14],
    [-0.14, -0.14],
    [0.14, -0.14],
    [-0.14, 0],
    [0.14, 0]
  ];
  for (const [fx, fz] of fanGridCoords) {
    const fanUnit = new THREE.Group();
    fanUnit.position.set(fx, 0, Math.max(-depth / 2 + 0.14, Math.min(depth / 2 - 0.14, fz)));

    const housing = new THREE.Mesh(fanHousingGeo, fanHousingMat);
    const ring = new THREE.Mesh(fanRingGeo, fanRingMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.008;
    fanUnit.add(housing, ring);

    const rotor = new THREE.Group();
    rotor.position.y = 0.005;
    const hub = new THREE.Mesh(fanHubGeo, fanRingMat);
    rotor.add(hub);
    for (let b = 0; b < 7; b++) {
      const bladePivot = new THREE.Group();
      bladePivot.rotation.y = (b * Math.PI * 2) / 7;
      const blade = new THREE.Mesh(fanBladeGeo, fanBladeMat);
      blade.position.x = 0.036;
      blade.rotation.x = 0.36;
      bladePivot.add(blade);
      rotor.add(bladePivot);
    }
    fanUnit.add(rotor);
    fanRotors.push(rotor);
    fanTrayGroup.add(fanUnit);
  }

  // 4. Numbered 19-inch EIA Mounting Rails (Front Left/Right & Rear Left/Right)
  const railW = 0.042;
  const railH = dims.railSpanHeight;
  const railCenterY = RAIL_BOTTOM_Y_M + railH / 2;
  const railGeo = trackGeo(globalTrack, new THREE.BoxGeometry(railW, railH, 0.012));
  const railFaceGeo = trackGeo(globalTrack, new THREE.PlaneGeometry(railW, railH));
  const railOffsetX = INNER_19_WIDTH_M / 2 + railW / 2 - 0.018;

  // Front rails (facing +Z)
  for (const sign of [-1, 1]) {
    const railPost = new THREE.Mesh(railGeo, frameSteelMat);
    railPost.position.set(sign * railOffsetX, railCenterY, frontRailZ);
    root.add(railPost);

    const railScaleFront = new THREE.Mesh(railFaceGeo, railScaleMat);
    railScaleFront.position.set(sign * railOffsetX, railCenterY, frontRailZ + 0.0065);
    root.add(railScaleFront);

    // Rear rails (facing -Z)
    const rearPost = new THREE.Mesh(railGeo, frameSteelMat);
    rearPost.position.set(sign * railOffsetX, railCenterY, rearRailZ);
    root.add(rearPost);

    const railScaleRear = new THREE.Mesh(railFaceGeo, railScaleMat);
    railScaleRear.rotation.y = Math.PI;
    railScaleRear.position.set(sign * railOffsetX, railCenterY, rearRailZ - 0.0065);
    root.add(railScaleRear);
  }

  // Horizontal mounting rail brackets connecting outer frame to 19" rails
  const bracketGeo = trackGeo(globalTrack, new THREE.BoxGeometry(Math.max(0.02, (width - INNER_19_WIDTH_M) / 2), 0.018, 0.03));
  for (const yFrac of [0.08, 0.5, 0.92]) {
    const by = RAIL_BOTTOM_Y_M + railH * yFrac;
    for (const sign of [-1, 1]) {
      for (const rz of [frontRailZ, rearRailZ]) {
        const br = new THREE.Mesh(bracketGeo, frameSteelMat);
        br.position.set(sign * (width / 2 - (width - INNER_19_WIDTH_M) / 4), by, rz);
        root.add(br);
      }
    }
  }

  // 5. Side Panels (toggleable opacity/visibility for X-Ray inspection)
  const sidePanels: THREE.Mesh[] = [];
  const sidePanelH = cabinetHeight - PLINTH_HEIGHT_M - TOP_CANOPY_HEIGHT_M - 0.01;
  const sidePanelGeo = trackGeo(globalTrack, new THREE.BoxGeometry(0.014, sidePanelH, depth - 0.07));
  for (const sign of [-1, 1]) {
    const sp = new THREE.Mesh(sidePanelGeo, sidePanelMat);
    sp.position.set(sign * (width / 2 - 0.007), PLINTH_HEIGHT_M + sidePanelH / 2 + 0.005, 0);
    sp.castShadow = false;
    root.add(sp);
    sidePanels.push(sp);
  }

  // 6. Hinged Front Door & Split Rear Doors
  const doorH = cabinetHeight - PLINTH_HEIGHT_M - TOP_CANOPY_HEIGHT_M - 0.015;
  const doorCenterY = PLINTH_HEIGHT_M + doorH / 2 + 0.008;

  const frontDoorPivot = new THREE.Group();
  frontDoorPivot.position.set(-width / 2 + 0.016, doorCenterY, depth / 2 - 0.006);
  root.add(frontDoorPivot);

  const frontDoorFrameW = width - 0.032;
  const frontDoorPanelGeo = trackGeo(globalTrack, new THREE.PlaneGeometry(frontDoorFrameW - 0.05, doorH - 0.06));
  const frontDoorPanel = new THREE.Mesh(frontDoorPanelGeo, perforatedDoorMat);
  frontDoorPanel.position.set(frontDoorFrameW / 2, 0, 0);
  frontDoorPivot.add(frontDoorPanel);

  // Door perimeter stiles
  const doorVStileGeo = trackGeo(globalTrack, new THREE.BoxGeometry(0.03, doorH, 0.016));
  const doorHStileGeo = trackGeo(globalTrack, new THREE.BoxGeometry(frontDoorFrameW, 0.032, 0.016));
  const fLeftStile = new THREE.Mesh(doorVStileGeo, frameSteelMat);
  fLeftStile.position.set(0.015, 0, 0);
  const fRightStile = new THREE.Mesh(doorVStileGeo, frameSteelMat);
  fRightStile.position.set(frontDoorFrameW - 0.015, 0, 0);
  const fTopStile = new THREE.Mesh(doorHStileGeo, frameSteelMat);
  fTopStile.position.set(frontDoorFrameW / 2, doorH / 2 - 0.016, 0);
  const fBotStile = new THREE.Mesh(doorHStileGeo, frameSteelMat);
  fBotStile.position.set(frontDoorFrameW / 2, -doorH / 2 + 0.016, 0);
  // Chrome door handle
  const handleGeo = trackGeo(globalTrack, new THREE.BoxGeometry(0.016, 0.14, 0.02));
  const handleMat = trackMat(
    globalTrack,
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.75, roughness: 0.25 })
  );
  const fHandle = new THREE.Mesh(handleGeo, handleMat);
  fHandle.position.set(frontDoorFrameW - 0.03, 0, 0.014);
  frontDoorPivot.add(fLeftStile, fRightStile, fTopStile, fBotStile, fHandle);

  // Split Rear Doors
  const halfRearW = (width - 0.036) / 2;
  const rearLeafGeo = trackGeo(globalTrack, new THREE.PlaneGeometry(halfRearW - 0.025, doorH - 0.05));
  const rearLeftDoorPivot = new THREE.Group();
  rearLeftDoorPivot.position.set(-width / 2 + 0.018, doorCenterY, -depth / 2 + 0.006);
  const rearLeftLeaf = new THREE.Mesh(rearLeafGeo, perforatedDoorMat);
  rearLeftLeaf.position.set(halfRearW / 2, 0, 0);
  rearLeftDoorPivot.add(rearLeftLeaf);
  root.add(rearLeftDoorPivot);

  const rearRightDoorPivot = new THREE.Group();
  rearRightDoorPivot.position.set(width / 2 - 0.018, doorCenterY, -depth / 2 + 0.006);
  const rearRightLeaf = new THREE.Mesh(rearLeafGeo, perforatedDoorMat);
  rearRightLeaf.position.set(-halfRearW / 2, 0, 0);
  rearRightDoorPivot.add(rearRightLeaf);
  root.add(rearRightDoorPivot);

  // 7. Raycast Proxy Planes per U (Front & Rear)
  const hitPlaneMat = trackMat(
    globalTrack,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  const hitPlaneGeo = trackGeo(globalTrack, new THREE.PlaneGeometry(INNER_19_WIDTH_M, UNIT_HEIGHT_M));
  const frontHitPlanes: THREE.Mesh[] = [];
  const rearHitPlanes: THREE.Mesh[] = [];

  for (let u = 1; u <= totalUnits; u++) {
    const cy = uSlotToCenterY(u, 1);

    const fPlane = new THREE.Mesh(hitPlaneGeo, hitPlaneMat);
    fPlane.position.set(0, cy, frontRailZ + 0.02);
    fPlane.userData = { hitSlotU: u, hitSide: 'front' as RackSide };
    root.add(fPlane);
    frontHitPlanes.push(fPlane);

    const rPlane = new THREE.Mesh(hitPlaneGeo, hitPlaneMat);
    rPlane.position.set(0, cy, rearRailZ - 0.02);
    rPlane.userData = { hitSlotU: u, hitSide: 'rear' as RackSide };
    root.add(rPlane);
    rearHitPlanes.push(rPlane);
  }

  // 8. 3D Drop Preview Highlight Box (valid = emerald, invalid = rose)
  const dropPreviewGroup = new THREE.Group();
  dropPreviewGroup.visible = false;
  const previewBoxGeo = trackGeo(globalTrack, new THREE.BoxGeometry(INNER_19_WIDTH_M + 0.014, UNIT_HEIGHT_M, 0.42));
  const dropPreviewFillMat = trackMat(
    globalTrack,
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    })
  );
  const previewBoxMesh = new THREE.Mesh(previewBoxGeo, dropPreviewFillMat);
  const previewEdgesGeo = trackGeo(globalTrack, new THREE.EdgesGeometry(previewBoxGeo));
  const dropPreviewLineMat = trackMat(
    globalTrack,
    new THREE.LineBasicMaterial({ color: 0x34d399 })
  );
  const previewEdges = new THREE.LineSegments(previewEdgesGeo, dropPreviewLineMat);
  dropPreviewGroup.add(previewBoxMesh, previewEdges);
  root.add(dropPreviewGroup);

  // 9. Groups for Mounted Devices, Thermal Heatmap Overlay, and Airflow Streams
  const mountedDevicesGroup = new THREE.Group();
  mountedDevicesGroup.name = 'mounted_devices_group';
  root.add(mountedDevicesGroup);

  const thermalOverlayGroup = new THREE.Group();
  thermalOverlayGroup.name = 'thermal_overlay_group';
  root.add(thermalOverlayGroup);

  const airflowGroup = new THREE.Group();
  airflowGroup.name = 'airflow_streams_group';
  root.add(airflowGroup);

  const mountedHandles: MountedDevice3DHandle[] = [];
  let intakeInstanced: THREE.InstancedMesh | null = null;
  let exhaustInstanced: THREE.InstancedMesh | null = null;
  let recircInstanced: THREE.InstancedMesh | null = null;
  const intakeStreams: InteractiveRackSceneHandle['intakeStreams'] = [];
  const exhaustStreams: InteractiveRackSceneHandle['exhaustStreams'] = [];
  const recircStreams: InteractiveRackSceneHandle['recircStreams'] = [];

  // Reusable animation temporaries
  const dummyObj = new THREE.Object3D();
  const targetDir = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);
  const quatTmp = new THREE.Quaternion();
  const colorTmp = new THREE.Color();

  let targetFrontDoorAngle = -Math.PI * 0.62;
  let targetRearDoorAngle = Math.PI * 0.52;
  let doorsVisible = true;

  const rebuildDevices = (
    currentRack: ServerRack,
    assets: Record<string, DeviceAsset>,
    analysis: RackAirflowAnalysis,
    selectedAssetId: string | null,
    showThermal: boolean
  ) => {
    mountedDevicesGroup.clear();
    mountedHandles.length = 0;
    disposeTrack(deviceTrack);

    const earMat = trackMat(
      deviceTrack,
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.28 })
    );
    const screwMat = trackMat(
      deviceTrack,
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 })
    );
    const earGeo = trackGeo(deviceTrack, new THREE.BoxGeometry(0.022, 1, 0.008));
    const screwGeo = trackGeo(deviceTrack, new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 8));

    const mountSide = (side: RackSide) => {
      const slotMap = getRackSlotsForSide(currentRack, side);
      for (const [uStr, assetId] of Object.entries(slotMap)) {
        const startU = parseInt(uStr, 10);
        const asset = assets[assetId];
        if (Number.isNaN(startU) || !asset) continue;

        const uHeight = getAssetUHeight(asset);
        const hM = uHeight * UNIT_HEIGHT_M - 0.003;
        const isShallow = ['odf', 'patch_panel', 'pdu'].includes(asset.category);
        const devDepth = isShallow
          ? Math.min(0.24, depth * 0.28)
          : asset.category === 'server' || asset.category === 'storage' || asset.category === 'ups'
            ? Math.min(0.76, depth - 0.16)
            : Math.min(0.46, depth - 0.18);

        const devGroup = new THREE.Group();
        const cy = uSlotToCenterY(startU, uHeight);
        const railZ = side === 'rear' ? rearRailZ : frontRailZ;
        const dirSign = side === 'rear' ? -1 : 1; // +1 faces +Z (front), -1 faces -Z (rear)
        const centerZ = railZ - dirSign * (devDepth / 2);

        devGroup.position.set(0, cy, centerZ);
        if (side === 'rear') {
          devGroup.rotation.y = Math.PI;
        }

        const isSelected = selectedAssetId === asset.id;
        const thermalDev = analysis.devices.find(d => d.assetId === asset.id);
        const thermalAccentHex =
          showThermal && thermalDev
            ? getThermalRiskHex(thermalDev.risk)
            : isSelected
              ? 0x38bdf8
              : 0x1e293b;

        const chassisMat = trackMat(
          deviceTrack,
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x1e3a5f : 0x1e293b,
            emissive: showThermal && thermalDev && thermalDev.risk !== 'cool' ? thermalAccentHex : isSelected ? 0x0ea5e9 : 0x000000,
            emissiveIntensity: showThermal && thermalDev ? (thermalDev.risk === 'hot' ? 0.35 : thermalDev.risk === 'warm' ? 0.2 : 0.06) : isSelected ? 0.25 : 0,
            metalness: 0.62,
            roughness: 0.38
          })
        );

        const chassisGeo = trackGeo(deviceTrack, new THREE.BoxGeometry(DEVICE_CHASSIS_WIDTH_M, hM, devDepth));
        const chassisMesh = new THREE.Mesh(chassisGeo, chassisMat);
        chassisMesh.castShadow = castShadow;
        chassisMesh.receiveShadow = castShadow;
        devGroup.add(chassisMesh);

        // Front & Rear Textured Faceplates
        const frontTex = createDeviceFaceplateTexture(asset, uHeight, maxAniso, deviceTrack);
        const frontMat = trackMat(
          deviceTrack,
          new THREE.MeshStandardMaterial({
            map: frontTex,
            metalness: 0.35,
            roughness: 0.45
          })
        );
        const faceGeo = trackGeo(deviceTrack, new THREE.PlaneGeometry(DEVICE_CHASSIS_WIDTH_M - 0.008, hM - 0.004));
        const frontFace = new THREE.Mesh(faceGeo, frontMat);
        frontFace.position.set(0, 0, devDepth / 2 + 0.0015);
        devGroup.add(frontFace);

        const rearTex = createDeviceRearTexture(asset, uHeight, maxAniso, deviceTrack);
        const rearMat = trackMat(
          deviceTrack,
          new THREE.MeshStandardMaterial({
            map: rearTex,
            metalness: 0.4,
            roughness: 0.45
          })
        );
        const rearFace = new THREE.Mesh(faceGeo, rearMat);
        rearFace.rotation.y = Math.PI;
        rearFace.position.set(0, 0, -devDepth / 2 - 0.0015);
        devGroup.add(rearFace);

        // 19" Mounting Ears + 4 Rack Screws
        for (const earSign of [-1, 1]) {
          const ear = new THREE.Mesh(earGeo, earMat);
          ear.scale.y = hM;
          ear.position.set(earSign * (DEVICE_CHASSIS_WIDTH_M / 2 + 0.011), 0, devDepth / 2 - 0.004);
          devGroup.add(ear);

          for (const sySign of [-1, 1]) {
            const screw = new THREE.Mesh(screwGeo, screwMat);
            screw.rotation.x = Math.PI / 2;
            screw.position.set(
              earSign * (DEVICE_CHASSIS_WIDTH_M / 2 + 0.012),
              sySign * Math.max(0.008, hM * 0.32),
              devDepth / 2 + 0.002
            );
            devGroup.add(screw);
          }
        }

        // Protruding Pull Handles on 2U+ servers/storage/UPS
        if (uHeight >= 2 || asset.category === 'server' || asset.category === 'storage') {
          const pullGeo = trackGeo(deviceTrack, new THREE.BoxGeometry(0.008, hM * 0.65, 0.016));
          for (const pSign of [-1, 1]) {
            const pull = new THREE.Mesh(pullGeo, earMat);
            pull.position.set(pSign * (DEVICE_CHASSIS_WIDTH_M / 2 - 0.012), 0, devDepth / 2 + 0.008);
            devGroup.add(pull);
          }
        }

        // Emissive LED Accent / Selection Halo
        const ledMat = trackMat(
          deviceTrack,
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x38bdf8 : 0x22c55e,
            emissive: isSelected ? 0x38bdf8 : 0x22c55e,
            emissiveIntensity: isSelected ? 1.4 : 0.75,
            roughness: 0.2
          })
        );
        const ledGeo = trackGeo(deviceTrack, new THREE.BoxGeometry(0.036, 0.005, 0.006));
        const ledMesh = new THREE.Mesh(ledGeo, ledMat);
        ledMesh.position.set(-DEVICE_CHASSIS_WIDTH_M / 2 + 0.028, -hM / 2 + 0.007, devDepth / 2 + 0.004);
        devGroup.add(ledMesh);

        if (isSelected) {
          const selEdgesGeo = trackGeo(
            deviceTrack,
            new THREE.EdgesGeometry(
              trackGeo(deviceTrack, new THREE.BoxGeometry(DEVICE_CHASSIS_WIDTH_M + 0.014, hM + 0.006, devDepth + 0.014))
            )
          );
          const selEdgesMat = trackMat(
            deviceTrack,
            new THREE.LineBasicMaterial({ color: 0x38bdf8 })
          );
          const selWire = new THREE.LineSegments(selEdgesGeo, selEdgesMat);
          devGroup.add(selWire);
        }

        // Tag every mesh for deterministic raycasting
        const tag = {
          assetId: asset.id,
          rackSide: side,
          startU,
          uHeight
        };
        devGroup.userData = tag;
        devGroup.traverse(child => {
          child.userData = tag;
        });

        mountedDevicesGroup.add(devGroup);
        mountedHandles.push({
          assetId: asset.id,
          side,
          startU,
          uHeight,
          group: devGroup,
          chassisMat,
          ledMat
        });
      }
    };

    mountSide('front');
    mountSide('rear');
  };

  const rebuildThermalAndAirflow = (
    analysis: RackAirflowAnalysis,
    showThermal: boolean,
    showAirflow: boolean,
    highlightedGap: { startU: number; endU: number } | null
  ) => {
    thermalOverlayGroup.clear();
    airflowGroup.clear();
    intakeInstanced?.dispose();
    exhaustInstanced?.dispose();
    recircInstanced?.dispose();
    disposeTrack(thermalTrack);
    intakeStreams.length = 0;
    exhaustStreams.length = 0;
    recircStreams.length = 0;
    intakeInstanced = null;
    exhaustInstanced = null;
    recircInstanced = null;

    // Toggle visible fan rotor count (2 / 4 / 6)
    fanRotors.forEach((rotor, idx) => {
      if (rotor.parent) {
        rotor.parent.visible = idx < analysis.fanCount;
      }
    });

    // Thermal Heatmap Bars along Front & Rear U-Rail Edges + Highlighted Gap/Hotspot
    if (showThermal || highlightedGap) {
      const stripGeo = trackGeo(thermalTrack, new THREE.BoxGeometry(0.016, UNIT_HEIGHT_M * 0.88, 0.018));
      const bypassGapGeo = trackGeo(thermalTrack, new THREE.BoxGeometry(INNER_19_WIDTH_M - 0.02, UNIT_HEIGHT_M * 0.9, 0.03));

      for (const cell of analysis.unitCells) {
        const cy = uSlotToCenterY(cell.u, 1);
        const inHighlighted =
          highlightedGap !== null && cell.u >= highlightedGap.startU && cell.u <= highlightedGap.endU;

        if (showThermal) {
          const hex = getThermalRiskHex(cell.zone);
          const barMat = trackMat(
            thermalTrack,
            new THREE.MeshBasicMaterial({
              color: hex,
              transparent: true,
              opacity: cell.zone === 'cool' ? 0.32 : 0.85
            })
          );
          for (const sign of [-1, 1]) {
            const frontStrip = new THREE.Mesh(stripGeo, barMat);
            frontStrip.position.set(sign * (INNER_19_WIDTH_M / 2 + 0.016), cy, frontRailZ + 0.014);
            thermalOverlayGroup.add(frontStrip);

            const rearStrip = new THREE.Mesh(stripGeo, barMat);
            rearStrip.position.set(sign * (INNER_19_WIDTH_M / 2 + 0.016), cy, rearRailZ - 0.014);
            thermalOverlayGroup.add(rearStrip);
          }
        }

        if ((showThermal && cell.isBypassGap) || inHighlighted) {
          const gapMat = trackMat(
            thermalTrack,
            new THREE.MeshBasicMaterial({
              color: inHighlighted ? 0xf59e0b : 0xfb923c,
              transparent: true,
              opacity: inHighlighted ? 0.34 : 0.14,
              depthWrite: false
            })
          );
          const gapMesh = new THREE.Mesh(bypassGapGeo, gapMat);
          gapMesh.position.set(0, cy, frontRailZ + 0.005);
          thermalOverlayGroup.add(gapMesh);
        }
      }
    }

    if (!showAirflow) return;

    // Build aerodynamic airflow chevron geometry (cone pointing +Y, rotated via lookAt/quaternion)
    const arrowGeo = trackGeo(thermalTrack, new THREE.ConeGeometry(0.013, 0.044, 8));
    const speedBoost = Math.max(0.7, Math.min(1.65, 0.8 + analysis.fanCount * 0.12));
    const doorDamp = analysis.doorType === 'glass' ? 0.52 : 1.0;

    // 1. Cold Intake Streams entering Front Face of Active Equipment + Plinth Intake
    const activeFrontDevices = analysis.devices.filter(d => d.side === 'front' && d.powerWatts > 15);
    const intakeAnchors: number[] = [];
    if (activeFrontDevices.length === 0) {
      for (let k = 0; k < 4; k++) intakeAnchors.push(uSlotToCenterY(4 + k * Math.max(2, Math.floor(totalUnits / 5)), 1));
    } else {
      for (const dev of activeFrontDevices) {
        intakeAnchors.push(uSlotToCenterY(dev.startU, dev.uHeight));
        if (dev.uHeight >= 2) {
          intakeAnchors.push(uSlotToCenterY(dev.startU, 1));
        }
      }
    }

    for (let i = 0; i < intakeAnchors.length; i++) {
      const y = intakeAnchors[i];
      for (let lane = -1; lane <= 1; lane++) {
        for (let p = 0; p < 2; p++) {
          intakeStreams.push({
            y: y + (Math.random() - 0.5) * 0.015,
            x: lane * 0.14 + (Math.random() - 0.5) * 0.02,
            speed: (0.42 + Math.random() * 0.18) * speedBoost * doorDamp,
            phase: (p * 0.5 + i * 0.19 + Math.abs(lane) * 0.13) % 1
          });
        }
      }
    }

    if (intakeStreams.length > 0) {
      const intakeMat = trackMat(
        thermalTrack,
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 })
      );
      intakeInstanced = new THREE.InstancedMesh(arrowGeo, intakeMat, intakeStreams.length);
      intakeInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      airflowGroup.add(intakeInstanced);
    }

    // 2. Hot Exhaust & Rising Convection Streams (Rear Plenum -> Top Canopy Fans)
    const activeAll = analysis.devices.filter(d => d.powerWatts > 15);
    const exhaustSources =
      activeAll.length > 0
        ? activeAll
        : [
            {
              startU: Math.max(2, Math.floor(totalUnits * 0.3)),
              uHeight: 1,
              risk: 'cool' as ThermalRiskLevel,
              powerWatts: 100
            }
          ];

    const activeFans = fanGridCoords.slice(0, Math.max(2, analysis.fanCount));
    exhaustSources.forEach((dev, idx) => {
      const baseY = uSlotToCenterY(dev.startU, dev.uHeight);
      const colorHex = getThermalRiskHex(dev.risk);
      for (let lane = 0; lane < 4; lane++) {
        const fanCoord = activeFans[(idx + lane) % activeFans.length];
        exhaustStreams.push({
          y: baseY,
          x: -0.15 + lane * 0.1,
          speed: (0.34 + (dev.powerWatts / 1200) * 0.25) * speedBoost,
          phase: ((lane * 0.25) + idx * 0.17) % 1,
          colorHex,
          topFanX: fanCoord[0],
          topFanZ: Math.max(-depth / 2 + 0.14, Math.min(depth / 2 - 0.14, fanCoord[1]))
        });
      }
    });

    if (exhaustStreams.length > 0) {
      const exhaustMat = trackMat(
        thermalTrack,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 })
      );
      exhaustInstanced = new THREE.InstancedMesh(arrowGeo, exhaustMat, exhaustStreams.length);
      exhaustInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < exhaustStreams.length; i++) {
        colorTmp.setHex(exhaustStreams[i].colorHex);
        exhaustInstanced.setColorAt(i, colorTmp);
      }
      if (exhaustInstanced.instanceColor) exhaustInstanced.instanceColor.needsUpdate = true;
      airflowGroup.add(exhaustInstanced);
    }

    // 3. Hot-Air Bypass Recirculation Loops in Unblanked Gaps >= 3U
    for (const gap of analysis.bypassGaps) {
      const midY = uSlotToCenterY(gap.startU, gap.size);
      for (let lane = -1; lane <= 1; lane += 2) {
        for (let p = 0; p < 2; p++) {
          recircStreams.push({
            y: midY,
            x: lane * 0.12,
            gapHeight: gap.size * UNIT_HEIGHT_M,
            speed: 0.38,
            phase: (p * 0.5 + (lane > 0 ? 0.25 : 0)) % 1
          });
        }
      }
    }

    if (recircStreams.length > 0) {
      const recircMat = trackMat(
        thermalTrack,
        new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.92 })
      );
      recircInstanced = new THREE.InstancedMesh(arrowGeo, recircMat, recircStreams.length);
      recircInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      airflowGroup.add(recircInstanced);
    }
  };

  const setDoorMode = (doorMode: 'open' | 'closed' | 'hidden', doorType: RackDoorAirflowType) => {
    doorsVisible = doorMode !== 'hidden';
    frontDoorPivot.visible = doorsVisible;
    rearLeftDoorPivot.visible = doorsVisible;
    rearRightDoorPivot.visible = doorsVisible;

    const targetMat = doorType === 'glass' ? glassDoorMat : perforatedDoorMat;
    if (frontDoorPanel.material !== targetMat) {
      frontDoorPanel.material = targetMat;
    }

    if (doorMode === 'closed') {
      targetFrontDoorAngle = 0;
      targetRearDoorAngle = 0;
    } else {
      targetFrontDoorAngle = -Math.PI * 0.62;
      targetRearDoorAngle = Math.PI * 0.52;
    }
  };

  const setXRaySides = (xray: boolean) => {
    sidePanelMat.opacity = xray ? 0.14 : 0.96;
    sidePanelMat.depthWrite = !xray;
    sidePanelMat.needsUpdate = true;
  };

  const setDropPreview = (
    preview: { startU: number; uHeight: number; side: RackSide; valid: boolean } | null
  ) => {
    if (!preview) {
      dropPreviewGroup.visible = false;
      return;
    }
    dropPreviewGroup.visible = true;
    const clampedU = Math.max(1, Math.min(totalUnits - preview.uHeight + 1, preview.startU));
    const cy = uSlotToCenterY(clampedU, preview.uHeight);
    const zCenter = preview.side === 'rear' ? rearRailZ + 0.18 : frontRailZ - 0.18;

    dropPreviewGroup.position.set(0, cy, zCenter);
    dropPreviewGroup.scale.set(1, preview.uHeight, 1);

    if (preview.valid) {
      dropPreviewFillMat.color.setHex(0x10b981);
      dropPreviewLineMat.color.setHex(0x34d399);
    } else {
      dropPreviewFillMat.color.setHex(0xef4444);
      dropPreviewLineMat.color.setHex(0xf87171);
    }
  };

  const updateAnimation = (
    dt: number,
    elapsed: number,
    analysis: RackAirflowAnalysis,
    airflowActive: boolean
  ) => {
    // Smoothly damp hinged doors
    const dampFactor = 1 - Math.exp(-8 * dt);
    frontDoorPivot.rotation.y += (targetFrontDoorAngle - frontDoorPivot.rotation.y) * dampFactor;
    rearLeftDoorPivot.rotation.y += (targetRearDoorAngle - rearLeftDoorPivot.rotation.y) * dampFactor;
    rearRightDoorPivot.rotation.y += (-targetRearDoorAngle - rearRightDoorPivot.rotation.y) * dampFactor;

    // Spin top canopy exhaust fans when active
    if (analysis.fanCount > 0) {
      const rpmScale = airflowActive ? 7.5 + Math.min(8, analysis.totalWatts / 350) : 2.2;
      for (let i = 0; i < fanRotors.length; i++) {
        if (i < analysis.fanCount) {
          fanRotors[i].rotation.y += dt * rpmScale;
        }
      }
    }

    if (!airflowActive) return;

    // Animate cold intake arrows (+Z outside -> into front rack rail)
    if (intakeInstanced && intakeStreams.length > 0) {
      const zStart = depth / 2 + 0.42;
      const zEnd = frontRailZ - 0.14;
      for (let i = 0; i < intakeStreams.length; i++) {
        const s = intakeStreams[i];
        const t = (s.phase + elapsed * s.speed) % 1;
        const z = THREE.MathUtils.lerp(zStart, zEnd, t);
        const wobble = Math.sin(elapsed * 4 + i) * 0.008;
        dummyObj.position.set(s.x + wobble, s.y, z);
        targetDir.set(0, 0, -1).normalize();
        quatTmp.setFromUnitVectors(upVec, targetDir);
        dummyObj.quaternion.copy(quatTmp);
        const fadeScale = Math.sin(t * Math.PI) * 0.9 + 0.35;
        dummyObj.scale.setScalar(fadeScale);
        dummyObj.updateMatrix();
        intakeInstanced.setMatrixAt(i, dummyObj.matrix);
      }
      intakeInstanced.instanceMatrix.needsUpdate = true;
    }

    // Animate hot exhaust + vertical plenum convection -> out top fans
    if (exhaustInstanced && exhaustStreams.length > 0) {
      const plenumZ = -depth / 2 + 0.04;
      const topExitY = cabinetHeight + 0.28;
      for (let i = 0; i < exhaustStreams.length; i++) {
        const s = exhaustStreams[i];
        const t = (s.phase + elapsed * s.speed) % 1;

        let px: number;
        let py: number;
        let pz: number;
        let dx = 0;
        let dy = 1;
        let dz = 0;

        if (t < 0.25) {
          // Exiting rear of device into rear hot plenum
          const u = t / 0.25;
          px = s.x;
          py = s.y;
          pz = THREE.MathUtils.lerp(rearRailZ + 0.12, plenumZ, u);
          dx = 0;
          dy = 0.2;
          dz = -1;
        } else if (t < 0.78) {
          // Rising up hot rear plenum toward top canopy fan tray
          const u = (t - 0.25) / 0.53;
          px = THREE.MathUtils.lerp(s.x, s.topFanX, u);
          py = THREE.MathUtils.lerp(s.y, cabinetHeight - 0.04, u);
          pz = THREE.MathUtils.lerp(plenumZ, s.topFanZ, u * 0.75);
          dx = s.topFanX - s.x;
          dy = Math.max(0.4, cabinetHeight - s.y);
          dz = s.topFanZ - plenumZ;
        } else {
          // Exhausting upward out of spinning roof fans
          const u = (t - 0.78) / 0.22;
          px = s.topFanX + Math.sin(elapsed * 6 + i) * 0.015;
          py = THREE.MathUtils.lerp(cabinetHeight - 0.02, topExitY, u);
          pz = s.topFanZ;
          dx = 0;
          dy = 1;
          dz = 0;
        }

        dummyObj.position.set(px, py, pz);
        targetDir.set(dx, dy, dz).normalize();
        quatTmp.setFromUnitVectors(upVec, targetDir);
        dummyObj.quaternion.copy(quatTmp);
        const fadeScale = Math.sin(t * Math.PI) * 0.95 + 0.35;
        dummyObj.scale.setScalar(fadeScale);
        dummyObj.updateMatrix();
        exhaustInstanced.setMatrixAt(i, dummyObj.matrix);
      }
      exhaustInstanced.instanceMatrix.needsUpdate = true;
    }

    // Animate recirculation bypass loops curling from inside rack out open unblanked front gaps
    if (recircInstanced && recircStreams.length > 0) {
      for (let i = 0; i < recircStreams.length; i++) {
        const s = recircStreams[i];
        const t = (s.phase + elapsed * s.speed) % 1;
        const angle = t * Math.PI * 1.4;
        const pz = frontRailZ - 0.14 + Math.sin(angle) * 0.26;
        const py = s.y + (0.5 - Math.cos(angle) * 0.5) * Math.min(0.18, s.gapHeight * 0.45);
        dummyObj.position.set(s.x, py, pz);
        targetDir.set(0, Math.sin(angle) * 0.3, Math.cos(angle)).normalize();
        quatTmp.setFromUnitVectors(upVec, targetDir);
        dummyObj.quaternion.copy(quatTmp);
        dummyObj.scale.setScalar(Math.sin(t * Math.PI) * 0.85 + 0.3);
        dummyObj.updateMatrix();
        recircInstanced.setMatrixAt(i, dummyObj.matrix);
      }
      recircInstanced.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    root,
    dims,
    frontDoorPivot,
    rearLeftDoorPivot,
    rearRightDoorPivot,
    sidePanels,
    fanRotors,
    frontHitPlanes,
    rearHitPlanes,
    dropPreviewGroup,
    dropPreviewFillMat,
    dropPreviewLineMat,
    thermalOverlayGroup,
    mountedDevicesGroup,
    mountedHandles,
    airflowGroup,
    intakeInstanced,
    exhaustInstanced,
    recircInstanced,
    intakeStreams,
    exhaustStreams,
    recircStreams,
    rebuildDevices,
    rebuildThermalAndAirflow,
    setDoorMode,
    setXRaySides,
    setDropPreview,
    updateAnimation,
    dispose: () => {
      intakeInstanced?.dispose();
      exhaustInstanced?.dispose();
      recircInstanced?.dispose();
      intakeInstanced = null;
      exhaustInstanced = null;
      recircInstanced = null;
      thermalOverlayGroup.clear();
      airflowGroup.clear();
      mountedDevicesGroup.clear();
      root.clear();
      disposeTrack(globalTrack);
      disposeTrack(deviceTrack);
      disposeTrack(thermalTrack);
    }
  };
}
