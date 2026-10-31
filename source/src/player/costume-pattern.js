import * as THREE from 'three';
import { torsoSection } from './costume-surface.js';
import { sewnHoodGeometry } from './hood-tailoring.js';
import { chibiSleevePoint } from './chibi-sleeve-drape.js';

export const COSTUME_PATTERN_VERSION = 'wholelook-tailoring-04';
const mix = (a, b, t) => a + (b - a) * t;
function section(table, t) {
  for (let i = 1; i < table.length; i++) if (t <= table[i][0]) {
    const a = table[i - 1], b = table[i], u = (t - a[0]) / (b[0] - a[0]);
    const s = u * u * (3 - 2 * u);
    return Array.from({ length: Math.max(a.length, b.length) - 1 }, (_, j) => mix(a[j + 1] ?? 0, b[j + 1] ?? 0, s));
  }
  return table[table.length - 1].slice(1);
}

// Periodic loft with hard end caps and welded seam normals. Each part remains
// one ordinary mesh; no texture, material variant, callback or light is added.
function sweep(sample, { rows = 40, columns = 24, reverse = true, caps = [true, true] } = {}) {
  const pos = [], uv = [], indices = [], stride = columns + 1;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    pos.push(...sample(r / rows, c === columns ? 0 : c / columns * Math.PI * 2)); uv.push(c / columns, 1 - r / rows);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * stride + c, b = a + stride;
    if (reverse) indices.push(a, b, a + 1, b, b + 1, a + 1);
    else indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  for (let end = 0; end < 2; end++) if (caps[end]) {
    const ring = [], center = [0, 0, 0];
    for (let c = 0; c < columns; c++) {
      const p = sample(end, c / columns * Math.PI * 2); ring.push(p);
      p.forEach((v, j) => { center[j] += v / columns; });
    }
    const start = pos.length / 3; pos.push(...center); uv.push(.5, .5);
    for (const p of ring) { pos.push(...p); uv.push(.5, .5); }
    for (let c = 0; c < columns; c++) {
      const a = start + 1 + c, b = start + 1 + (c + 1) % columns;
      if (end ? !reverse : reverse) indices.push(start, a, b); else indices.push(start, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  const n = g.attributes.normal, v = new THREE.Vector3();
  for (let r = 0; r <= rows; r++) {
    const a = r * stride, b = a + columns;
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.k3CostumePattern = COSTUME_PATTERN_VERSION;
  g.userData.loft = { rows, columns };
  return g;
}
const validKind = kind => { if (!['chibi', 'awakened'].includes(kind)) throw new TypeError('Unknown costume form: ' + kind); };
function limbPoint(table, length, y, shape, fold, t, a) {
  const [width, front, back, z = 0] = section(table, t), c = Math.cos(a), s = Math.sin(a);
  const crease = 1 + fold * Math.cos(a * 4 + .5) * Math.exp(-(((t - .53) / .1) ** 2));
  return [Math.sign(s) * Math.abs(s) ** shape * width * crease, y - t * length, z + Math.sign(c) * Math.abs(c) ** shape * (c >= 0 ? front : back) * crease];
}
function limb(table, length, y = 0, shape = 1, fold = 0) {
  return sweep((t, a) => limbPoint(table, length, y, shape, fold, t, a));
}

export function foldedCollarPoint(kind, angle, v) {
  validKind(kind);
  const small = kind === 'chibi', y = small ? .414 : .627, base = torsoSection(kind, y);
  const front = (Math.cos(angle) + 1) * .5, top = small ? .474 - .035 * front : .684 - .039 * front;
  const width = mix(base.width + .005, small ? .082 : .049, v);
  const depth = mix((Math.cos(angle) >= 0 ? base.front : base.back) + .004, small ? .064 : .041, v);
  const fold = Math.sin(angle * 5 + .4) * Math.sin(v * Math.PI) * .002;
  return new THREE.Vector3(Math.sin(angle) * (width + fold), mix(y, top, v), Math.cos(angle) * (depth + fold));
}

export function sleeveGeometry(kind, shoulderSide = 0) {
  validKind(kind);
  if (kind === 'chibi') {
    const table = [[0,.053,.052,.048],[.18,.071,.064,.057],[.52,.068,.059,.057],[.82,.084,.071,.066],[.94,.089,.075,.07],[1,.083,.071,.065]];
    if (shoulderSide === 0) return limb(table, .3, 0, 1, .035);
    if (shoulderSide !== -1 && shoulderSide !== 1) throw new TypeError('Shoulder side must be -1, 0 or 1');
    // Loft the sleeve head along the same curve used by the pose binding.
    // Each cross section retains its size as the arm changes direction.
    const geometry = sweep((t,a) => chibiSleevePoint(t,a,
      limbPoint(table,.3,0,1,.035,t,a),shoulderSide));
    geometry.userData.k3ShoulderPrototype = 'chibi-curved-sleeve-v04';
    return geometry;
  }
  // Preserve all shoulder-binding sections; a turned cuff occupies only
  // the lower sleeve instead of adding a disconnected ring mesh.
  const table = [[0,.048,.047,.044],[.16,.071,.063,.056],[.46,.066,.059,.054],[.78,.053,.049,.047],[.85,.054,.050,.048],[.9,.066,.058,.056],[.96,.066,.058,.056],[1,.058,.051,.049]];
  if (shoulderSide === 0) return limb(table, .30, 0, 1, .025);
  if (shoulderSide !== -1 && shoulderSide !== 1) throw new TypeError('Shoulder side must be -1, 0 or 1');
  // Dynamic sleeve rest shape: the narrowed torso at y=.577 requires .096
  // inward offset. The archived .080 cap protruded even before animation.
  // createSleeveBinding owns runtime motion; no extra draw call is added.
  const geometry = sweep((t, a) => {
    const p = limbPoint(table, .30, 0, 1, .025, t, a);
    const u = Math.min(1, t / .22), fade = 1 - u * u * (3 - 2 * u);
    const v = Math.min(1, t / .18), radius = .17 + .83 * v * v * (3 - 2 * v);
    p[0] = p[0] * radius - shoulderSide * .096 * fade;
    p[1] += .037 * fade;
    p[2] *= radius;
    return p;
  });
  geometry.userData.k3ShoulderPrototype = 'dynamic-sleeve-head-v02';
  return geometry;
}
export function forearmGeometry() {
  return limb([[0,.044,.043,.041],[.17,.052,.046,.044],[.45,.048,.044,.043],[.76,.036,.035,.033],[1,.030,.031,.028]], .3);
}
function trouserProfile(kind) {
  validKind(kind);
  return kind === 'chibi'
    ? { table: [[0,.077,.077,.07],[.2,.08,.075,.068],[.48,.063,.07,.062,.008],[.58,.065,.066,.061,.008],[.76,.062,.058,.055],[1,.048,.047,.043]], length: .42, fold: .024 }
    : { table: [[0,.090,.085,.078],[.08,.095,.087,.080],[.25,.084,.080,.078],[.43,.068,.072,.065,.010],[.52,.071,.076,.066,.012],[.59,.065,.069,.064,.006],[.72,.069,.067,.064,-.004],[.86,.055,.053,.051,-.003],[1,.047,.043,.043]], length: .74, fold: .027 };
}
export function trouserLegGeometry(kind) {
  const p = trouserProfile(kind);
  if (kind === 'chibi') return limb(p.table, p.length, 0, 1, p.fold);
  return sweep((t,a)=>{
    const point=limbPoint(p.table,p.length,0,1,p.fold,t,a);
    const envelope=Math.sin(Math.PI*t)**2*Math.exp(-(((t-.52)/.14)**2));
    const fold=envelope*Math.sin((t-.46)*34+Math.sin(a)*1.4);
    point[0]*=1+.045*fold;
    point[2]+=.0055*fold*Math.cos(a);
    return point;
  });
}
export function bootGeometry(kind) {
  validKind(kind);
  const small = kind === 'chibi', trousers = trouserProfile(kind);
  const mountY = small ? -.46 : -.82, mountZ = small ? .03 : .05, outline = small ? 1 : 1.015;
  const table = [[0,.065,.052,.059,-.048],[.075,.063,.05,.057,-.048],[.14,.056,.043,.055,-.048],[.45,.050,.045,.061,-.035],[.68,.061,.10,.095,-.012],[.83,.068,.135,.114],[.88,.071,.143,.12],[.96,.071,.143,.12],[1,.066,.137,.114]];
  return sweep((t, a) => {
    const p = limbPoint(table, .26, .21, .86, 0, t, a);
    if (small) { p[0] *= 1.12; p[1] = p[1] * .77 - .0215; p[2] *= .85; }
    const legY = p[1] + mountY, hemY = -trousers.length * outline;
    // Fit the shaft around the actual tucked trouser and its existing outline.
    // Below the hem, ease back into the instep without changing the sole.
    const blend = Math.max(0, Math.min(1, (legY - hemY + .025) / .025));
    if (blend > 0) {
      const u = Math.max(0, Math.min(1, -legY / (trousers.length * outline)));
      const hem = limbPoint(trousers.table, trousers.length, 0, 1, trousers.fold, u, a);
      const sx = Math.sin(a), cz = Math.cos(a), clearance = .008;
      const x = Math.sign(sx) * Math.max(Math.abs(p[0]), Math.abs(hem[0] * outline) + clearance * Math.abs(sx));
      const z = hem[2] * outline - mountZ + clearance * cz;
      p[0] = mix(p[0], x, blend);
      p[2] = mix(p[2], cz >= 0 ? Math.max(p[2], z) : Math.min(p[2], z), blend);
    }
    return p;
  });
}
export function trouserPelvisGeometry() {
  return sweep((t, a) => {
    // Shape the trouser rise into the two leg roots. The old shallow
    // horizontal band read as a separate thick white tube at the waist.
    const [w,f,b] = section([[0,.169,.128,.12],[.22,.181,.114,.118],[.56,.198,.076,.100],[1,.202,.012,.048]], t);
    const c = Math.cos(a);
    const bottom=-.096-.052*c*c;
    const fly=-.0025*Math.exp(-((Math.sin(a)/.12)**2))*Math.sin(Math.PI*t);
    return [Math.sin(a)*w, .024+(bottom-.024)*t, c*(c>=0?f+fly:b)];
  }, { rows: 18 });
}
export function travelerHoodGeometry() {
  const geometry = sewnHoodGeometry();
  geometry.userData.k3CostumePattern = COSTUME_PATTERN_VERSION;
  return geometry;
}

export function foldedCollarGeometry(kind) {
  // Weld the curved collar's normal field without blending it into the flat
  // lapels. The original non-indexed triangle soup created a faceted fan.
  const geometry = sweep((v, a) => foldedCollarPoint(kind, a, v).toArray(), {
    rows: 8, columns: 48, reverse: false, caps: [false, false],
  });
  geometry.deleteAttribute('uv');
  geometry.userData.k3CollarTailoring = 'continuous-collar-v01';
  return geometry;
}
