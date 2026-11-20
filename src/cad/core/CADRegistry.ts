import type { CADBlock, CADDocument, CADEntity } from './CADTypes';

/**
 * Allocates deterministic, collision-free hex DXF handles (`100`, `101`, ...).
 */
export class CADHandleAllocator {
  private usedHandles: Set<string>;
  private seed: number;

  constructor(
    doc?: Pick<
      CADDocument,
      | 'nextHandleSeed'
      | 'header'
      | 'entities'
      | 'layers'
      | 'lineTypes'
      | 'textStyles'
      | 'dimStyles'
      | 'layouts'
      | 'blocks'
      | 'rawSections'
    >
  ) {
    this.usedHandles = new Set<string>();
    this.seed = Math.max(0x100, doc?.nextHandleSeed ?? 0x100);

    if (doc) {
      if (doc.header?.$HANDSEED) {
        const parsedSeed = parseInt(doc.header.$HANDSEED.trim(), 16);
        if (Number.isFinite(parsedSeed) && parsedSeed > this.seed) {
          this.seed = parsedSeed;
        }
      }
      const registerPairs = (pairs?: Array<{ code: number; value: string | number }>) => {
        if (!pairs) return;
        for (const p of pairs) {
          if (p.code === 5 || p.code === 105) {
            this.register(String(p.value));
          }
        }
      };

      for (const e of doc.entities || []) {
        if (e.handle) this.register(e.handle);
        if (e.type === 'INSERT' && e.attributes) {
          for (const att of e.attributes) {
            if (att.handle) this.register(att.handle);
          }
        }
        registerPairs(e.rawDxf);
      }
      for (const l of Object.values(doc.layers || {})) {
        if (l.handle) this.register(l.handle);
      }
      for (const lt of Object.values(doc.lineTypes || {})) {
        if (lt.handle) this.register(lt.handle);
      }
      for (const st of Object.values(doc.textStyles || {})) {
        if (st.handle) this.register(st.handle);
      }
      for (const ds of Object.values(doc.dimStyles || {})) {
        if (ds.handle) this.register(ds.handle);
      }
      for (const lo of doc.layouts || []) {
        if (lo.handle) this.register(lo.handle);
      }
      for (const b of Object.values(doc.blocks || {})) {
        if (b.handle) this.register(b.handle);
        registerPairs(b.rawHeaderPairs);
        registerPairs(b.rawEndblkPairs);
        for (const e of b.entities || []) {
          if (e.handle) this.register(e.handle);
          if (e.type === 'INSERT' && e.attributes) {
            for (const att of e.attributes) {
              if (att.handle) this.register(att.handle);
            }
          }
          registerPairs(e.rawDxf);
        }
      }
      registerPairs(doc.rawSections?.objects);
      for (const tbl of doc.rawSections?.extraTables || []) {
        if (tbl.handle) this.register(tbl.handle);
        registerPairs(tbl.rawHeaderPairs);
        registerPairs(tbl.rawPairs);
      }
    }
  }

  register(handle: string): void {
    const norm = handle.trim().toUpperCase();
    if (!norm) return;
    this.usedHandles.add(norm);
    const parsed = parseInt(norm, 16);
    if (Number.isFinite(parsed) && parsed >= this.seed) {
      this.seed = parsed + 1;
    }
  }

  allocate(): string {
    while (true) {
      const candidate = this.seed.toString(16).toUpperCase();
      this.seed += 1;
      if (!this.usedHandles.has(candidate)) {
        this.usedHandles.add(candidate);
        return candidate;
      }
    }
  }

  getNextSeed(): number {
    return this.seed;
  }
}

export function createCadId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Collects all nested Block names referenced transitively from a starting set of entities
 * with strict cycle detection.
 */
export function collectDependentBlockNames(
  entities: CADEntity[],
  blocks: Record<string, CADBlock>,
  maxDepth = 32
): Set<string> {
  const collected = new Set<string>();
  const visited = new Set<string>();

  const visitBlock = (blockName: string, depth: number) => {
    if (!blockName || depth > maxDepth || visited.has(blockName)) return;
    visited.add(blockName);
    collected.add(blockName);
    const blk = blocks[blockName];
    if (!blk) return;
    for (const sub of blk.entities) {
      if (sub.type === 'INSERT') {
        visitBlock(sub.blockName, depth + 1);
      }
    }
  };

  for (const ent of entities) {
    if (ent.type === 'INSERT') {
      visitBlock(ent.blockName, 0);
    }
  }
  return collected;
}
