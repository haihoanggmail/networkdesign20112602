import * as THREE from 'three';

export interface ResourceRegistryStats {
  activeGeometries: number;
  activeMaterials: number;
  activeTextures: number;
  activeRenderTargets: number;
  activeInstancedMeshes: number;
  pinnedTextures: number;
  totalDisposedCount: number;
  scopes: string[];
}

export interface DisposeSummary {
  geometries: number;
  materials: number;
  textures: number;
  renderTargets: number;
  instancedMeshes: number;
}

interface ScopeBucket {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  renderTargets: Set<THREE.WebGLRenderTarget>;
  instancedMeshes: Set<THREE.InstancedMesh>;
}

const KNOWN_TEXTURE_FIELDS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'gradientMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap'
] as const;

function extractTexturesFromMaterial(mat: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  const seen = new Set<THREE.Texture>();
  const matRecord = mat as unknown as Record<string, unknown>;

  for (const field of KNOWN_TEXTURE_FIELDS) {
    const val = matRecord[field];
    if (val instanceof THREE.Texture && !seen.has(val)) {
      seen.add(val);
      found.push(val);
    }
  }

  for (const val of Object.values(matRecord)) {
    if (val instanceof THREE.Texture && !seen.has(val)) {
      seen.add(val);
      found.push(val);
    }
  }

  return found;
}

/**
 * Deduplicating Three.js WebGL Resource Manager & Disposal Registry.
 * Tracks BufferGeometry, Material, Texture, WebGLRenderTarget, and InstancedMesh
 * allocations across named lifecycle scopes (e.g. 'persistent' vs 'world' rebuilds)
 * so 2D<->3D transitions and rapid project edits never leak VRAM.
 */
export class ThreeResourceRegistry {
  private readonly scopes = new Map<string, ScopeBucket>();
  private readonly pinnedTextures = new Set<THREE.Texture>();
  private totalDisposedCount = 0;

  private ensureScope(scope: string): ScopeBucket {
    let bucket = this.scopes.get(scope);
    if (!bucket) {
      bucket = {
        geometries: new Set(),
        materials: new Set(),
        textures: new Set(),
        renderTargets: new Set(),
        instancedMeshes: new Set()
      };
      this.scopes.set(scope, bucket);
    }
    return bucket;
  }

  pinTexture<T extends THREE.Texture>(tex: T | null | undefined): T | null | undefined {
    if (tex) {
      this.pinnedTextures.add(tex);
    }
    return tex;
  }

  unpinTexture(tex: THREE.Texture | null | undefined): void {
    if (tex) {
      this.pinnedTextures.delete(tex);
    }
  }

  trackGeometry<T extends THREE.BufferGeometry>(geo: T, scope = 'world'): T {
    this.ensureScope(scope).geometries.add(geo);
    return geo;
  }

  trackMaterial<T extends THREE.Material>(mat: T, scope = 'world', keepTextures?: Set<THREE.Texture>): T {
    const bucket = this.ensureScope(scope);
    bucket.materials.add(mat);
    for (const tex of extractTexturesFromMaterial(mat)) {
      if (!this.pinnedTextures.has(tex) && (!keepTextures || !keepTextures.has(tex))) {
        bucket.textures.add(tex);
      }
    }
    return mat;
  }

  trackTexture<T extends THREE.Texture>(tex: T, scope = 'world'): T {
    if (!this.pinnedTextures.has(tex)) {
      this.ensureScope(scope).textures.add(tex);
    }
    return tex;
  }

  trackRenderTarget<T extends THREE.WebGLRenderTarget>(rt: T, scope = 'persistent'): T {
    this.ensureScope(scope).renderTargets.add(rt);
    return rt;
  }

  trackObjectTree(root: THREE.Object3D, scope = 'world', keepTextures?: Set<THREE.Texture>): void {
    const bucket = this.ensureScope(scope);
    root.traverse(obj => {
      if (obj instanceof THREE.InstancedMesh) {
        bucket.instancedMeshes.add(obj);
      }
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.Line ||
        obj instanceof THREE.LineSegments ||
        obj instanceof THREE.Points ||
        obj instanceof THREE.Sprite
      ) {
        if ('geometry' in obj && obj.geometry instanceof THREE.BufferGeometry) {
          bucket.geometries.add(obj.geometry);
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          bucket.materials.add(m);
          for (const tex of extractTexturesFromMaterial(m)) {
            if (!this.pinnedTextures.has(tex) && (!keepTextures || !keepTextures.has(tex))) {
              bucket.textures.add(tex);
            }
          }
        }
      }
    });
  }

  private isUsedInOtherScopes<K extends keyof ScopeBucket>(
    resource: ScopeBucket[K] extends Set<infer T> ? T : never,
    key: K,
    excludedScope: string
  ): boolean {
    for (const [scopeName, bucket] of this.scopes.entries()) {
      if (scopeName === excludedScope) continue;
      if ((bucket[key] as Set<unknown>).has(resource)) {
        return true;
      }
    }
    return false;
  }

  disposeScope(scope: string, renderer?: THREE.WebGLRenderer | null): DisposeSummary {
    const bucket = this.scopes.get(scope);
    const summary: DisposeSummary = {
      geometries: 0,
      materials: 0,
      textures: 0,
      renderTargets: 0,
      instancedMeshes: 0
    };
    if (!bucket) return summary;

    this.scopes.delete(scope);

    for (const inst of bucket.instancedMeshes) {
      if (!this.isUsedInOtherScopes(inst, 'instancedMeshes', scope)) {
        inst.dispose();
        summary.instancedMeshes += 1;
      }
    }
    for (const geo of bucket.geometries) {
      if (!this.isUsedInOtherScopes(geo, 'geometries', scope)) {
        geo.dispose();
        summary.geometries += 1;
      }
    }
    for (const tex of bucket.textures) {
      if (!this.pinnedTextures.has(tex) && !this.isUsedInOtherScopes(tex, 'textures', scope)) {
        tex.dispose();
        summary.textures += 1;
      }
    }
    for (const mat of bucket.materials) {
      if (!this.isUsedInOtherScopes(mat, 'materials', scope)) {
        mat.dispose();
        summary.materials += 1;
      }
    }
    for (const rt of bucket.renderTargets) {
      if (!this.isUsedInOtherScopes(rt, 'renderTargets', scope)) {
        rt.dispose();
        summary.renderTargets += 1;
      }
    }

    this.totalDisposedCount +=
      summary.geometries +
      summary.materials +
      summary.textures +
      summary.renderTargets +
      summary.instancedMeshes;

    if (renderer?.renderLists && typeof renderer.renderLists.dispose === 'function') {
      renderer.renderLists.dispose();
    }

    return summary;
  }

  disposeAll(renderer?: THREE.WebGLRenderer | null): DisposeSummary {
    const total: DisposeSummary = {
      geometries: 0,
      materials: 0,
      textures: 0,
      renderTargets: 0,
      instancedMeshes: 0
    };

    const pinnedList = Array.from(this.pinnedTextures);
    this.pinnedTextures.clear();

    for (const scopeName of Array.from(this.scopes.keys())) {
      const part = this.disposeScope(scopeName, null);
      total.geometries += part.geometries;
      total.materials += part.materials;
      total.textures += part.textures;
      total.renderTargets += part.renderTargets;
      total.instancedMeshes += part.instancedMeshes;
    }

    for (const tex of pinnedList) {
      tex.dispose();
      total.textures += 1;
      this.totalDisposedCount += 1;
    }

    if (renderer?.renderLists && typeof renderer.renderLists.dispose === 'function') {
      renderer.renderLists.dispose();
    }

    return total;
  }

  getStats(): ResourceRegistryStats {
    const uniqueGeos = new Set<THREE.BufferGeometry>();
    const uniqueMats = new Set<THREE.Material>();
    const uniqueTexs = new Set<THREE.Texture>();
    const uniqueRts = new Set<THREE.WebGLRenderTarget>();
    const uniqueInstanced = new Set<THREE.InstancedMesh>();

    for (const bucket of this.scopes.values()) {
      for (const g of bucket.geometries) uniqueGeos.add(g);
      for (const m of bucket.materials) uniqueMats.add(m);
      for (const t of bucket.textures) uniqueTexs.add(t);
      for (const rt of bucket.renderTargets) uniqueRts.add(rt);
      for (const im of bucket.instancedMeshes) uniqueInstanced.add(im);
    }

    return {
      activeGeometries: uniqueGeos.size,
      activeMaterials: uniqueMats.size,
      activeTextures: uniqueTexs.size,
      activeRenderTargets: uniqueRts.size,
      activeInstancedMeshes: uniqueInstanced.size,
      pinnedTextures: this.pinnedTextures.size,
      totalDisposedCount: this.totalDisposedCount,
      scopes: Array.from(this.scopes.keys())
    };
  }
}

/**
 * Safely disposes all geometries, materials, untagged textures, and InstancedMeshes
 * in an Object3D hierarchy with full deduplication so shared resources are never disposed twice.
 */
export function disposeThreeObjectTree(
  root: THREE.Object3D,
  keepTextures?: Set<THREE.Texture>
): DisposeSummary {
  const temp = new ThreeResourceRegistry();
  if (keepTextures) {
    for (const t of keepTextures) {
      temp.pinTexture(t);
    }
  }
  temp.trackObjectTree(root, 'dispose_tree', keepTextures);
  return temp.disposeScope('dispose_tree', null);
}
