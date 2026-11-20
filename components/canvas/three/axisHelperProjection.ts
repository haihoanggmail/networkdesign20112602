import * as THREE from 'three';

export type AxisId = 'X' | 'Y' | 'Z';

export interface ProjectedCornerAxis {
  axis: AxisId;
  color: string;
  /** Positive endpoint on 2D helper plane */
  px: number;
  py: number;
  /** Label anchor on 2D helper plane */
  tx: number;
  ty: number;
  /** Negative counter-arm endpoint on 2D helper plane */
  nx: number;
  ny: number;
  /** Camera-space Z depth (-1 away from viewer, +1 toward viewer) */
  depth: number;
  /** Opacity computed from Z depth */
  opacity: number;
}

const AXIS_BASIS: ReadonlyArray<{ axis: AxisId; color: string; vx: number; vy: number; vz: number }> = [
  { axis: 'X', color: '#ef4444', vx: 1, vy: 0, vz: 0 },
  { axis: 'Y', color: '#22c55e', vx: 0, vy: 1, vz: 0 },
  { axis: 'Z', color: '#3b82f6', vx: 0, vy: 0, vz: 1 }
];

const _axisWorkVec = new THREE.Vector3();

/**
 * Extracts the pure 3x3 rotation matrix from camera.matrixWorldInverse
 * so world-space basis axes (+X, +Y, +Z) map into camera view orientation.
 */
export function extractCameraRotationMatrix(
  camera: THREE.Camera,
  targetMatrix: THREE.Matrix4 = new THREE.Matrix4()
): THREE.Matrix4 {
  camera.updateMatrixWorld();
  return targetMatrix.extractRotation(camera.matrixWorldInverse);
}

/**
 * Projects world X/Y/Z axes through the camera rotation matrix and returns them
 * sorted back-to-front by view-space Z depth (painter's order).
 */
export function projectCornerAxesFromCameraMatrix(
  rotationMatrix: THREE.Matrix4,
  center = 38,
  armLength = 22,
  labelOffset = 9
): ProjectedCornerAxis[] {
  const projected: ProjectedCornerAxis[] = AXIS_BASIS.map(def => {
    _axisWorkVec.set(def.vx, def.vy, def.vz).applyMatrix4(rotationMatrix);
    const vx = _axisWorkVec.x;
    const vy = _axisWorkVec.y;
    const vz = _axisWorkVec.z;

    const px = center + vx * armLength;
    const py = center - vy * armLength;
    const nx = center - vx * (armLength * 0.55);
    const ny = center + vy * (armLength * 0.55);
    const tx = center + vx * (armLength + labelOffset);
    const ty = center - vy * (armLength + labelOffset);
    const opacity = vz < -0.25 ? 0.45 : vz < 0.05 ? 0.78 : 1;

    return {
      axis: def.axis,
      color: def.color,
      px,
      py,
      tx,
      ty,
      nx,
      ny,
      depth: vz,
      opacity
    };
  });

  // Back-to-front sort so foreground axes draw cleanly above background axes
  projected.sort((a, b) => a.depth - b.depth);
  return projected;
}
