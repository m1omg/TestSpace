// Static geometry builder. Collects primitive geometries per (zone, material),
// assigns world-space UVs, bakes lighting and merges each batch into a single
// mesh so the whole clinic renders in a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class Builder {
  constructor(lighting) {
    this.lighting = lighting;
    this.batches = new Map();
    this.colliders = [];
    this.meshes = [];
  }

  // Add a geometry (already positioned in world space).
  add(geo, mat, zone, opts = {}) {
    const keepUV = !!opts.keepUV;
    const uvScale = opts.uvScale ?? 1;
    const key = `${zone}|${mat.uuid}|${keepUV ? 'k' : uvScale}|${opts.castShadow === false ? 'n' : 's'}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { zone, mat, uvScale, keepUV, castShadow: opts.castShadow !== false, geos: [] };
      this.batches.set(key, b);
    }
    if (geo.index === null) {
      // all batch members must be indexed for merging
      const idx = [];
      for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i);
      geo.setIndex(idx);
    }
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    b.geos.push(geo);
    return geo;
  }

  // Place a local geometry with position / rotation (Y-X-Z euler) / scale.
  place(geo, mat, zone, x, y, z, ry = 0, opts = {}) {
    tmpE.set(opts.rx || 0, ry, opts.rz || 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpS.set(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1);
    tmpP.set(x, y, z);
    tmpM.compose(tmpP, tmpQ, tmpS);
    geo.applyMatrix4(tmpM);
    return this.add(geo, mat, zone, opts);
  }

  // Axis-aligned box from min to max corners.
  box(x0, y0, z0, x1, y1, z1, mat, zone, opts = {}) {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    const seg = opts.seg ?? 99;
    const g = new THREE.BoxGeometry(
      w,
      h,
      d,
      Math.max(1, Math.round(w / seg)),
      Math.max(1, Math.round(h / seg)),
      Math.max(1, Math.round(d / seg))
    );
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, mat, zone, opts);
    if (opts.collide) this.collider(x0, z0, x1, z1, opts.collideTag);
    return g;
  }

  // Box centred at (x, y, z) with size and Y rotation.
  rbox(x, y, z, w, h, d, ry, mat, zone, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    return this.place(g, mat, zone, x, y, z, ry, opts);
  }

  cyl(x, y, z, rTop, rBot, h, mat, zone, opts = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, opts.radial ?? 12, 1, !!opts.open);
    return this.place(g, mat, zone, x, y, z, opts.ry || 0, opts);
  }

  sphere(x, y, z, r, mat, zone, opts = {}) {
    const g = new THREE.SphereGeometry(r, opts.ws ?? 12, opts.hs ?? 8);
    return this.place(g, mat, zone, x, y, z, opts.ry || 0, opts);
  }

  // Horizontal plane (floor if up, ceiling if down).
  plane(x0, z0, x1, z1, y, mat, zone, up = true, opts = {}) {
    const w = Math.abs(x1 - x0);
    const d = Math.abs(z1 - z0);
    const seg = opts.seg ?? 0.5;
    const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / seg)), Math.max(1, Math.round(d / seg)));
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    return this.add(g, mat, zone, opts);
  }

  // Vertical quad facing +Z rotated by ry, with explicit UV rectangle.
  quad(x, y, z, w, h, ry, mat, zone, uv, opts = {}) {
    const g = new THREE.PlaneGeometry(w, h);
    if (uv) {
      const a = g.attributes.uv;
      // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
      a.setXY(0, uv.u0, uv.v1);
      a.setXY(1, uv.u1, uv.v1);
      a.setXY(2, uv.u0, uv.v0);
      a.setXY(3, uv.u1, uv.v0);
    }
    return this.place(g, mat, zone, x, y, z, ry, { ...opts, keepUV: true });
  }

  collider(x0, z0, x1, z1, tag) {
    const c = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), enabled: true, tag };
    this.colliders.push(c);
    return c;
  }

  // Merge, UV-project, bake and add everything to `parent`.
  finalize(parent, shadows) {
    for (const b of this.batches.values()) {
      if (!b.geos.length) continue;
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (!merged) {
        console.warn('merge failed', b.zone, b.mat.name);
        continue;
      }
      for (const g of b.geos) if (g !== merged) g.dispose();
      if (!b.keepUV) worldUV(merged, b.uvScale);
      this.lighting.bake(merged, b.zone);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = !!shadows;
      mesh.castShadow = !!shadows && b.castShadow;
      mesh.userData.zone = b.zone;
      mesh.name = `static:${b.zone}:${b.mat.name}`;
      parent.add(mesh);
      this.meshes.push(mesh);
    }
    this.batches.clear();
  }
}

// Box-projected UVs in world space (scale = repeats per metre).
function worldUV(geo, scale) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    } else if (ax >= az) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true;
}
