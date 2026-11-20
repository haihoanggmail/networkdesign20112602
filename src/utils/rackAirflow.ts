import {
  DeviceAsset,
  DiagramNode,
  RackSensorReading,
  RackSide,
  ServerRack
} from '../types/infrastructure';
import { getAssetUHeight, getRackSlotsForSide } from './rackGeometry';

export type RackDoorAirflowType = 'perforated' | 'open' | 'glass';
export type ThermalRiskLevel = 'cool' | 'nominal' | 'warm' | 'hot';
export type VentilationStatus = 'optimal' | 'warning' | 'critical';

export interface RackAirflowConfig {
  fanCount?: number; // 0, 2, 4, 6 top canopy exhaust fans
  doorType?: RackDoorAirflowType;
  ambientTempC?: number; // default 22°C
}

export interface RackDeviceThermalProfile {
  assetId: string;
  name: string;
  model: string;
  category: DeviceAsset['category'];
  side: RackSide;
  startU: number;
  endU: number;
  uHeight: number;
  powerWatts: number;
  heatBtuPerHour: number;
  wattsPerU: number;
  requiredCfm: number;
  airflowPattern: 'front-to-back' | 'passive';
  risk: ThermalRiskLevel;
}

export interface RackUnitThermalCell {
  u: number;
  frontAssetId?: string;
  rearAssetId?: string;
  directWatts: number;
  convectionScore: number; // 0..1 combining local density + rising heat from lower Us
  zone: ThermalRiskLevel;
  isBypassGap: boolean;
}

export interface RackThermalHotspot {
  startU: number;
  endU: number;
  totalWatts: number;
  peakWattsPerU: number;
  deviceNames: string[];
  severity: 'warning' | 'critical';
}

export interface RackBypassGap {
  startU: number;
  endU: number;
  size: number;
  side: RackSide;
}

export interface RackVentilationRecommendation {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  targetStartU?: number;
  targetEndU?: number;
}

export interface RackAirflowAnalysis {
  totalUnits: number;
  ambientTempC: number;
  estimatedExhaustTempC: number;
  doorType: RackDoorAirflowType;
  fanCount: number;
  totalWatts: number;
  totalBtuPerHour: number;
  requiredCfm: number;
  rawFanCapacityCfm: number;
  effectiveCoolingCfm: number;
  airflowCoveragePct: number;
  status: VentilationStatus;
  devices: RackDeviceThermalProfile[];
  unitCells: RackUnitThermalCell[]; // indexed 1..totalUnits via u, sorted ascending U1..UN
  hotspots: RackThermalHotspot[];
  bypassGaps: RackBypassGap[];
  recommendations: RackVentilationRecommendation[];
}

const PASSIVE_CATEGORIES = new Set<DeviceAsset['category']>(['odf', 'patch_panel']);

export function getDefaultRackFanCount(rack: ServerRack): number {
  if ((rack.depthMm || 800) >= 1000 || (rack.widthMm || 600) >= 800) return 4;
  return 2;
}

export function analyzeRackAirflow(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>,
  config: RackAirflowConfig = {}
): RackAirflowAnalysis {
  const totalUnits = Math.max(4, rack.totalUnits || 42);
  const ambientTempC = config.ambientTempC ?? 22;
  const doorType: RackDoorAirflowType = config.doorType ?? 'perforated';
  const fanCount = config.fanCount ?? getDefaultRackFanCount(rack);

  const devices: RackDeviceThermalProfile[] = [];
  const frontOccupied = new Map<number, DeviceAsset>();
  const rearOccupied = new Map<number, DeviceAsset>();

  const collectSide = (side: RackSide) => {
    const slotMap = getRackSlotsForSide(rack, side);
    for (const [uStr, assetId] of Object.entries(slotMap)) {
      const startU = parseInt(uStr, 10);
      const asset = assets[assetId];
      if (Number.isNaN(startU) || !asset) continue;
      const uHeight = getAssetUHeight(asset);
      const endU = Math.min(totalUnits, startU + uHeight - 1);
      const powerWatts = Math.max(0, asset.powerWatts || 0);
      const heatBtuPerHour =
        asset.heatBtu && asset.heatBtu > 0
          ? Math.round(asset.heatBtu)
          : Math.round(powerWatts * 3.412);
      const isPassive = PASSIVE_CATEGORIES.has(asset.category) || powerWatts <= 15;
      const wattsPerU = powerWatts / Math.max(1, uHeight);
      // ASHRAE rule of thumb for 20°F (11.1°C) ΔT: CFM = BTU/h / (1.08 * 20) ≈ Watts * 0.158
      const requiredCfm = isPassive ? 0 : Math.max(8, Math.round(heatBtuPerHour / (1.08 * 20)));

      let risk: ThermalRiskLevel = 'cool';
      if (wattsPerU >= 420) risk = 'hot';
      else if (wattsPerU >= 220) risk = 'warm';
      else if (powerWatts > 20) risk = 'nominal';

      devices.push({
        assetId: asset.id,
        name: asset.name,
        model: asset.model,
        category: asset.category,
        side,
        startU,
        endU,
        uHeight,
        powerWatts,
        heatBtuPerHour,
        wattsPerU,
        requiredCfm,
        airflowPattern: isPassive ? 'passive' : 'front-to-back',
        risk
      });

      const targetMap = side === 'rear' ? rearOccupied : frontOccupied;
      for (let u = Math.max(1, startU); u <= endU; u++) {
        targetMap.set(u, asset);
      }
    }
  };

  collectSide('front');
  collectSide('rear');
  devices.sort((a, b) => b.startU - a.startU);

  const totalWatts = devices.reduce((acc, d) => acc + d.powerWatts, 0);
  const totalBtuPerHour = devices.reduce((acc, d) => acc + d.heatBtuPerHour, 0);
  const requiredCfm = devices.reduce((acc, d) => acc + d.requiredCfm, 0);

  // Typical 120mm high-static-pressure rack roof fan delivers ~95 CFM free air
  const cfmPerFan = 95;
  const rawFanCapacityCfm = fanCount * cfmPerFan;
  // Passive convection baseline ~35 CFM for perforated/open rack, ~8 CFM for sealed glass
  const passiveConvectionCfm = doorType === 'open' ? 55 : doorType === 'perforated' ? 35 : 8;
  const doorEfficiency = doorType === 'open' ? 1.0 : doorType === 'perforated' ? 0.9 : 0.48;
  const effectiveCoolingCfm = Math.round((rawFanCapacityCfm + passiveConvectionCfm) * doorEfficiency);

  const airflowCoveragePct =
    requiredCfm <= 0 ? 100 : Math.min(200, Math.round((effectiveCoolingCfm / requiredCfm) * 100));

  // Estimate exhaust ΔT (°C): ΔT_C = (Watts * 1.76) / effectiveCFM (clamped reasonably)
  const deltaTempC =
    totalWatts <= 0
      ? 0
      : Math.min(34, (totalWatts * 1.76) / Math.max(18, effectiveCoolingCfm));
  const estimatedExhaustTempC = Number((ambientTempC + deltaTempC).toFixed(1));

  // Detect unblanked bypass gaps >= 3U on front rail when active cooling equipment is present
  const bypassGaps: RackBypassGap[] = [];
  const hasActiveFrontHeat = devices.some(d => d.side === 'front' && d.powerWatts >= 120);
  if (hasActiveFrontHeat) {
    let gapStart: number | null = null;
    for (let u = 1; u <= totalUnits; u++) {
      const occupied = frontOccupied.has(u);
      if (!occupied && gapStart === null) {
        gapStart = u;
      } else if ((occupied || u === totalUnits) && gapStart !== null) {
        const gapEnd = occupied ? u - 1 : u;
        const size = gapEnd - gapStart + 1;
        if (size >= 3) {
          bypassGaps.push({ startU: gapStart, endU: gapEnd, size, side: 'front' });
        }
        gapStart = null;
      }
    }
  }

  const bypassUSet = new Set<number>();
  for (const g of bypassGaps) {
    for (let u = g.startU; u <= g.endU; u++) bypassUSet.add(u);
  }

  // Build per-U thermal cells with vertical convection accumulation (rising warm plume)
  const unitCells: RackUnitThermalCell[] = [];
  let risingPlumeHeat = 0;
  for (let u = 1; u <= totalUnits; u++) {
    const fDev = frontOccupied.get(u);
    const rDev = rearOccupied.get(u);
    const fWattsPerU = fDev ? (fDev.powerWatts || 0) / getAssetUHeight(fDev) : 0;
    const rWattsPerU = rDev ? (rDev.powerWatts || 0) / getAssetUHeight(rDev) : 0;
    const directWatts = Math.round(fWattsPerU + rWattsPerU);

    // Heat rises slowly and dissipates along open height unless trapped behind solid door
    const retention = doorType === 'glass' ? 0.92 : 0.78;
    risingPlumeHeat = risingPlumeHeat * retention + directWatts * 0.45;
    const effectiveThermalLoad = directWatts + risingPlumeHeat * 0.4;
    const convectionScore = Math.min(1, effectiveThermalLoad / 520);

    let zone: ThermalRiskLevel = 'cool';
    if (convectionScore >= 0.72) zone = 'hot';
    else if (convectionScore >= 0.42) zone = 'warm';
    else if (directWatts > 15 || convectionScore >= 0.16) zone = 'nominal';

    unitCells.push({
      u,
      frontAssetId: fDev?.id,
      rearAssetId: rDev?.id,
      directWatts,
      convectionScore: Number(convectionScore.toFixed(3)),
      zone,
      isBypassGap: bypassUSet.has(u)
    });
  }

  // Detect high-density thermal hotspot clusters (>= 300W/U across contiguous Us or >= 950W stacked)
  const hotspots: RackThermalHotspot[] = [];
  let clusterStart: number | null = null;
  let clusterWatts = 0;
  let clusterPeak = 0;
  const clusterNames = new Set<string>();

  const flushCluster = (endU: number) => {
    if (clusterStart !== null && (clusterWatts >= 900 || clusterPeak >= 420)) {
      hotspots.push({
        startU: clusterStart,
        endU,
        totalWatts: Math.round(clusterWatts),
        peakWattsPerU: Math.round(clusterPeak),
        deviceNames: Array.from(clusterNames),
        severity: clusterWatts >= 1600 || clusterPeak >= 550 ? 'critical' : 'warning'
      });
    }
    clusterStart = null;
    clusterWatts = 0;
    clusterPeak = 0;
    clusterNames.clear();
  };

  for (let u = 1; u <= totalUnits; u++) {
    const cell = unitCells[u - 1];
    if (cell.directWatts >= 200) {
      if (clusterStart === null) clusterStart = u;
      clusterWatts += cell.directWatts;
      clusterPeak = Math.max(clusterPeak, cell.directWatts);
      if (cell.frontAssetId && assets[cell.frontAssetId]) clusterNames.add(assets[cell.frontAssetId].name);
      if (cell.rearAssetId && assets[cell.rearAssetId]) clusterNames.add(assets[cell.rearAssetId].name);
    } else {
      flushCluster(u - 1);
    }
  }
  flushCluster(totalUnits);

  // Engineering recommendations (Vietnamese)
  const recommendations: RackVentilationRecommendation[] = [];

  if (doorType === 'glass' && totalWatts >= 600) {
    recommendations.push({
      id: 'glass_door_choke',
      severity: totalWatts >= 1400 ? 'critical' : 'warning',
      title: 'Cửa kính kín cản trở lưu lượng gió nạp trước',
      detail: `Tủ đang tỏa ${totalWatts}W nhưng dùng cửa kính kín. Khuyến nghị chuyển sang cửa lưới đục lỗ (Perforated Mesh ≥70%) để tăng hiệu suất nạp khí lạnh.`
    });
  }

  if (requiredCfm > effectiveCoolingCfm && totalWatts > 0) {
    const deficit = requiredCfm - effectiveCoolingCfm;
    const extraFans = Math.max(2, Math.ceil(deficit / (cfmPerFan * doorEfficiency) / 2) * 2);
    recommendations.push({
      id: 'insufficient_fan_cfm',
      severity: airflowCoveragePct < 65 ? 'critical' : 'warning',
      title: `Thiếu lưu lượng quạt hút đỉnh (-${deficit} CFM)`,
      detail: `Thiết bị cần ${requiredCfm} CFM nhưng khay ${fanCount} quạt hiện đạt ${effectiveCoolingCfm} CFM hiệu dụng. Nên bổ sung thêm ${extraFans} quạt hút đỉnh.`
    });
  }

  for (const spot of hotspots) {
    recommendations.push({
      id: `hotspot_${spot.startU}_${spot.endU}`,
      severity: spot.severity,
      title: `Cụm tích nhiệt cao tại U${spot.startU}–U${spot.endU} (${spot.totalWatts}W)`,
      detail: `Nhóm ${spot.deviceNames.join(', ')} đặt sát nhau không có khe thở. Nên chèn khe trống 1U có nắp che hoặc tách giãn cách dọc theo thân tủ.`,
      targetStartU: spot.startU,
      targetEndU: spot.endU
    });
  }

  for (const gap of bypassGaps) {
    recommendations.push({
      id: `bypass_${gap.startU}_${gap.endU}`,
      severity: gap.size >= 8 ? 'warning' : 'info',
      title: `Khe trống tuần hoàn khí nóng U${gap.startU}–U${gap.endU} (${gap.size}U)`,
      detail: `Không khí nóng mặt sau có thể quẩn ngược ra mặt trước qua khoảng trống ${gap.size}U. Nên gắn tấm che Blanking Panel 1U–2U để tách luồng lạnh/nóng.`,
      targetStartU: gap.startU,
      targetEndU: gap.endU
    });
  }

  // Check heavy UPS placed high in rack (blocks rising hot exhaust + poor center of gravity)
  const highUps = devices.find(
    d => d.category === 'ups' && d.startU > Math.ceil(totalUnits * 0.55)
  );
  if (highUps) {
    recommendations.push({
      id: `high_ups_${highUps.assetId}`,
      severity: 'warning',
      title: `UPS "${highUps.name}" đang đặt ở tầng cao (U${highUps.startU})`,
      detail: 'Nên đặt UPS ở đáy tủ (U1–U6) để hạ trọng tâm và không cản luồng khí nóng bốc lên khay quạt đỉnh.'
    });
  }

  if (recommendations.length === 0 && totalWatts > 0) {
    recommendations.push({
      id: 'airflow_healthy',
      severity: 'info',
      title: 'Thông gió tủ đạt chuẩn vận hành',
      detail: `Lưu lượng làm mát ${effectiveCoolingCfm} CFM đáp ứng tốt tải nhiệt ${totalWatts}W (${totalBtuPerHour} BTU/h). Nhiệt độ khí xả ước tính ${estimatedExhaustTempC}°C.`
    });
  }

  const hasCritical = recommendations.some(r => r.severity === 'critical') || estimatedExhaustTempC >= 38;
  const hasWarning = recommendations.some(r => r.severity === 'warning') || estimatedExhaustTempC >= 33;
  const status: VentilationStatus = hasCritical ? 'critical' : hasWarning ? 'warning' : 'optimal';

  return {
    totalUnits,
    ambientTempC,
    estimatedExhaustTempC,
    doorType,
    fanCount,
    totalWatts,
    totalBtuPerHour,
    requiredCfm,
    rawFanCapacityCfm,
    effectiveCoolingCfm,
    airflowCoveragePct,
    status,
    devices,
    unitCells,
    hotspots,
    bypassGaps,
    recommendations
  };
}

export interface RackSensorPoint {
  id: string;
  label: string;
  zone: 'intake' | 'mid' | 'exhaust' | 'ambient';
  u: number;
  temperatureC: number;
  humidityPct?: number;
  source: 'hardware_sensor' | 'node_telemetry' | 'calculated_probe';
  status: ThermalRiskLevel;
}

export interface RackUnitThermalReading {
  u: number;
  tempC: number;
  heatNorm: number; // 0..1 normalized between 18°C and 46°C
  zone: ThermalRiskLevel;
  color: string;
  frontAssetId?: string;
  rearAssetId?: string;
}

export interface RackThermalOverlayData {
  analysis: RackAirflowAnalysis;
  sensors: RackSensorPoint[];
  unitReadings: RackUnitThermalReading[]; // sorted U1..UN
  hasHardwareSensors: boolean;
  intakeTempC: number;
  exhaustTempC: number;
  avgTempC: number;
  peakTempC: number;
  peakU: number;
}

export function classifyTempRisk(tempC: number): ThermalRiskLevel {
  if (tempC >= 37) return 'hot';
  if (tempC >= 30.5) return 'warm';
  if (tempC >= 24.5) return 'nominal';
  return 'cool';
}

export function thermalHeatToColor(heatNorm: number, zone?: ThermalRiskLevel): string {
  const t = Math.max(0, Math.min(1, heatNorm));
  if (zone === 'hot' || t >= 0.72) {
    // Amber-orange -> Red (#f97316 -> #ef4444)
    return t >= 0.85 ? '#ef4444' : '#f97316';
  }
  if (zone === 'warm' || t >= 0.48) {
    // Yellow-amber (#eab308 -> #f59e0b)
    return '#f59e0b';
  }
  if (zone === 'nominal' || t >= 0.24) {
    // Emerald / Cyan-green (#10b981)
    return '#10b981';
  }
  // Cool intake blue (#0ea5e9)
  return '#0ea5e9';
}

function defaultUForZone(
  zone: RackSensorReading['zone'],
  totalUnits: number
): number {
  if (zone === 'intake' || zone === 'ambient') return Math.min(totalUnits, 2);
  if (zone === 'mid') return Math.max(1, Math.round(totalUnits * 0.5));
  return Math.max(1, totalUnits - 1);
}

export function computeRackThermalOverlayData(
  rack: ServerRack | undefined,
  assets: Record<string, DeviceAsset>,
  rackNode?: Pick<DiagramNode, 'customData'>,
  config: RackAirflowConfig = {}
): RackThermalOverlayData {
  const effectiveRack: ServerRack = rack || {
    id: 'virtual_rack',
    name: 'Rack',
    totalUnits: rackNode?.customData?.totalUnits || 42,
    widthMm: 600,
    depthMm: 1000,
    maxLoadKg: 800,
    x: 0,
    y: 0,
    slots: {}
  };

  const totalUnits = Math.max(4, effectiveRack.totalUnits || 42);
  const analysis = analyzeRackAirflow(effectiveRack, assets, config);

  const collectedSensors: RackSensorPoint[] = [];

  // 1) Retrieve explicit rack.sensors array if populated
  if (Array.isArray(effectiveRack.sensors)) {
    for (const s of effectiveRack.sensors) {
      if (typeof s.temperatureC !== 'number' || !Number.isFinite(s.temperatureC)) continue;
      const u = Math.max(1, Math.min(totalUnits, Math.round(s.u ?? defaultUForZone(s.zone, totalUnits))));
      collectedSensors.push({
        id: s.id,
        label: s.label,
        zone: s.zone,
        u,
        temperatureC: Number(s.temperatureC.toFixed(1)),
        humidityPct: s.humidityPct,
        source: 'hardware_sensor',
        status: classifyTempRisk(s.temperatureC)
      });
    }
  }

  // 2) Retrieve sensor / IoT DeviceAssets attached to or mounted inside this rack
  const mountedAssetIds = new Set<string>([
    ...Object.values(effectiveRack.slots || {}),
    ...Object.values(effectiveRack.rearSlots || {})
  ]);
  for (const asset of Object.values(assets)) {
    if (!asset) continue;
    const belongsToRack =
      asset.rackId === effectiveRack.id || mountedAssetIds.has(asset.id);
    if (!belongsToRack) continue;
    const isSensorAsset =
      asset.category === 'sensor' || asset.sensorSpecs?.temperatureC !== undefined;
    if (!isSensorAsset) continue;

    const probeZone = asset.sensorSpecs?.probeLocation ?? 'mid';
    const rawU = asset.rackUnitStart ?? defaultUForZone(probeZone, totalUnits);
    const u = Math.max(1, Math.min(totalUnits, Math.round(rawU)));
    const cell = analysis.unitCells[u - 1];
    const tempC =
      typeof asset.sensorSpecs?.temperatureC === 'number' &&
      Number.isFinite(asset.sensorSpecs.temperatureC)
        ? asset.sensorSpecs.temperatureC
        : Number(
            (
              analysis.ambientTempC +
              (cell ? cell.convectionScore * (analysis.estimatedExhaustTempC - analysis.ambientTempC + 4) : 2)
            ).toFixed(1)
          );

    if (!collectedSensors.some(existing => existing.id === asset.id)) {
      collectedSensors.push({
        id: asset.id,
        label: asset.name,
        zone: probeZone,
        u,
        temperatureC: Number(tempC.toFixed(1)),
        humidityPct: asset.sensorSpecs?.humidityPct,
        source: 'hardware_sensor',
        status: classifyTempRisk(tempC)
      });
    }
  }

  // 3) Retrieve optional telemetry numbers stored in rackNode.customData
  const customIntake = Number(rackNode?.customData?.intakeTempC);
  const customExhaust = Number(rackNode?.customData?.exhaustTempC);
  const customSensor = Number(rackNode?.customData?.sensorTempC);
  if (Number.isFinite(customIntake) && !collectedSensors.some(s => s.zone === 'intake')) {
    collectedSensors.push({
      id: `${effectiveRack.id}_intake_telemetry`,
      label: 'Cảm biến Nạp',
      zone: 'intake',
      u: Math.min(totalUnits, 2),
      temperatureC: Number(customIntake.toFixed(1)),
      source: 'node_telemetry',
      status: classifyTempRisk(customIntake)
    });
  }
  if (Number.isFinite(customSensor) && !collectedSensors.some(s => s.zone === 'mid')) {
    collectedSensors.push({
      id: `${effectiveRack.id}_mid_telemetry`,
      label: 'Cảm biến Thân tủ',
      zone: 'mid',
      u: Math.max(1, Math.round(totalUnits * 0.5)),
      temperatureC: Number(customSensor.toFixed(1)),
      source: 'node_telemetry',
      status: classifyTempRisk(customSensor)
    });
  }
  if (Number.isFinite(customExhaust) && !collectedSensors.some(s => s.zone === 'exhaust')) {
    collectedSensors.push({
      id: `${effectiveRack.id}_exhaust_telemetry`,
      label: 'Cảm biến Xả',
      zone: 'exhaust',
      u: Math.max(1, totalUnits - 1),
      temperatureC: Number(customExhaust.toFixed(1)),
      source: 'node_telemetry',
      status: classifyTempRisk(customExhaust)
    });
  }

  const hasHardwareSensors = collectedSensors.some(
    s => s.source === 'hardware_sensor' || s.source === 'node_telemetry'
  );

  // Calibrate baseline intake & exhaust from any attached sensors
  const intakeSensors = collectedSensors.filter(s => s.zone === 'intake' || s.zone === 'ambient');
  const exhaustSensors = collectedSensors.filter(s => s.zone === 'exhaust');
  const intakeTempC =
    intakeSensors.length > 0
      ? Number((intakeSensors.reduce((sum, s) => sum + s.temperatureC, 0) / intakeSensors.length).toFixed(1))
      : analysis.ambientTempC;
  const exhaustTempC =
    exhaustSensors.length > 0
      ? Number((exhaustSensors.reduce((sum, s) => sum + s.temperatureC, 0) / exhaustSensors.length).toFixed(1))
      : analysis.estimatedExhaustTempC;

  const spanDeltaC = Math.max(1.5, exhaustTempC - intakeTempC);

  // Compute per-U thermal readings (U1..UN) incorporating direct load, convection plume & sensor anchors
  const unitReadings: RackUnitThermalReading[] = analysis.unitCells.map(cell => {
    const heightRatio = (cell.u - 1) / Math.max(1, totalUnits - 1);
    const localLoadBoostC = Math.min(11, (cell.directWatts / 320) * 6.5);
    let baseTempC =
      intakeTempC +
      spanDeltaC * (0.28 * heightRatio + 0.72 * cell.convectionScore) +
      localLoadBoostC;

    // Pull toward nearest explicit sensor readings using inverse-distance Gaussian weighting
    if (collectedSensors.length > 0) {
      let weightSum = 0;
      let weightedDiffSum = 0;
      for (const s of collectedSensors) {
        const distU = Math.abs(cell.u - s.u);
        const w = Math.exp(-(distU * distU) / (2 * 36));
        weightSum += w;
        weightedDiffSum += w * (s.temperatureC - baseTempC);
      }
      if (weightSum > 0.05) {
        baseTempC += (weightedDiffSum / weightSum) * Math.min(0.9, weightSum);
      }
    }

    const tempC = Number(Math.max(15, Math.min(68, baseTempC)).toFixed(1));
    const heatNorm = Math.max(0, Math.min(1, (tempC - 20) / 24));
    const zone = classifyTempRisk(tempC);
    const color = thermalHeatToColor(heatNorm, zone);

    return {
      u: cell.u,
      tempC,
      heatNorm: Number(heatNorm.toFixed(3)),
      zone,
      color,
      frontAssetId: cell.frontAssetId,
      rearAssetId: cell.rearAssetId
    };
  });

  let peakTempC = unitReadings[0]?.tempC ?? intakeTempC;
  let peakU = 1;
  let sumTemp = 0;
  for (const r of unitReadings) {
    sumTemp += r.tempC;
    if (r.tempC > peakTempC) {
      peakTempC = r.tempC;
      peakU = r.u;
    }
  }
  const avgTempC = Number((sumTemp / Math.max(1, unitReadings.length)).toFixed(1));

  // If no explicit sensors exist, append calibrated virtual probes so telemetry badges always reflect intake/peak/exhaust
  if (collectedSensors.length === 0) {
    const midU = Math.max(1, Math.round(totalUnits * 0.5));
    const topU = Math.max(1, totalUnits - 1);
    const intakeReading = unitReadings[Math.min(unitReadings.length - 1, 1)];
    const midReading = unitReadings[Math.min(unitReadings.length - 1, midU - 1)];
    const topReading = unitReadings[Math.min(unitReadings.length - 1, topU - 1)];

    collectedSensors.push(
      {
        id: `${effectiveRack.id}_probe_intake`,
        label: 'Đầu dò Nạp (U2)',
        zone: 'intake',
        u: Math.min(totalUnits, 2),
        temperatureC: intakeReading?.tempC ?? intakeTempC,
        source: 'calculated_probe',
        status: classifyTempRisk(intakeReading?.tempC ?? intakeTempC)
      },
      {
        id: `${effectiveRack.id}_probe_peak`,
        label: peakU !== topU && peakU !== 2 ? `Điểm nóng (U${peakU})` : `Đầu dò Giữa (U${midU})`,
        zone: 'mid',
        u: peakU !== topU && peakU !== 2 ? peakU : midU,
        temperatureC:
          peakU !== topU && peakU !== 2
            ? peakTempC
            : midReading?.tempC ?? avgTempC,
        source: 'calculated_probe',
        status: classifyTempRisk(
          peakU !== topU && peakU !== 2
            ? peakTempC
            : midReading?.tempC ?? avgTempC
        )
      },
      {
        id: `${effectiveRack.id}_probe_exhaust`,
        label: `Đầu dò Xả (U${topU})`,
        zone: 'exhaust',
        u: topU,
        temperatureC: topReading?.tempC ?? exhaustTempC,
        source: 'calculated_probe',
        status: classifyTempRisk(topReading?.tempC ?? exhaustTempC)
      }
    );
  }

  collectedSensors.sort((a, b) => a.u - b.u);

  return {
    analysis,
    sensors: collectedSensors,
    unitReadings,
    hasHardwareSensors,
    intakeTempC,
    exhaustTempC,
    avgTempC,
    peakTempC,
    peakU
  };
}

export function getSubDeviceThermalReading(
  overlay: RackThermalOverlayData,
  startU: number,
  uHeight: number
): { tempC: number; zone: ThermalRiskLevel; color: string; heatNorm: number } {
  const lo = Math.max(1, startU);
  const hi = Math.min(overlay.unitReadings.length, startU + Math.max(1, uHeight) - 1);
  let maxTemp = overlay.avgTempC;
  let found = false;
  for (let u = lo; u <= hi; u++) {
    const r = overlay.unitReadings[u - 1];
    if (r && (!found || r.tempC > maxTemp)) {
      maxTemp = r.tempC;
      found = true;
    }
  }
  const heatNorm = Math.max(0, Math.min(1, (maxTemp - 20) / 24));
  const zone = classifyTempRisk(maxTemp);
  return {
    tempC: Number(maxTemp.toFixed(1)),
    zone,
    color: thermalHeatToColor(heatNorm, zone),
    heatNorm: Number(heatNorm.toFixed(3))
  };
}
