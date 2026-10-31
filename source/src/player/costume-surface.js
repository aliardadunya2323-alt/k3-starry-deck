import * as THREE from 'three';

export const COSTUME_SURFACE_VERSION = 'wholelook-tailoring-02';
// y / half-width / front-depth / back-depth, in the existing torso frame.
// Sloping shoulder-to-neck sections replace the old horizontal capsule bar.
const PROFILES = {
  chibi: [[0,.21,.17,.155],[.08,.214,.187,.162],[.18,.215,.189,.17],
    [.28,.222,.183,.16],[.335,.231,.164,.147],[.37,.209,.132,.124],
    [.40,.172,.111,.098],[.43,.091,.073,.065]],
  awakened: [[.02,.171,.130,.12],[.08,.173,.135,.12],[.20,.164,.139,.125],
    [.31,.194,.154,.135],[.44,.226,.163,.14],[.505,.249,.144,.129],
    [.555,.23,.112,.096],[.59,.163,.092,.079],[.635,.064,.05,.047]],
};
const profile = kind => {
  const rows = PROFILES[kind];
  if (!rows) throw new TypeError('Unknown tailored torso: ' + kind);
  return rows;
};
export function torsoSection(kind, y) {
  if (!Number.isFinite(y)) throw new TypeError('Torso height must be finite');
  const rows = profile(kind);
  let a = rows[0], b = rows[rows.length - 1];
  if (y <= a[0]) b = a;
  else if (y >= b[0]) a = b;
  else for (let i = 1; i < rows.length; i++) if (y <= rows[i][0]) { a = rows[i - 1]; b = rows[i]; break; }
  let t = b[0] === a[0] ? 0 : (y - a[0]) / (b[0] - a[0]);
  t = t * t * (3 - 2 * t);
  return { width: a[1] + (b[1] - a[1]) * t, front: a[2] + (b[2] - a[2]) * t, back: a[3] + (b[3] - a[3]) * t };
}
// Cloth form, not a lighting/noise overlay. Keep the collar and shoulder
// attachment band untouched and use the same surface for trim placement.
function frontDrape(kind, x, y, s) {
  if (kind !== 'awakened') return 0;
  const u = Math.min(1, Math.abs(x) / s.width);
  const ease = v => { v = Math.max(0, Math.min(1, v)); return v*v*(3-2*v); };
  const edge = (1-u*u) * ease((y-.025)/.065) * (1-ease((y-.46)/.07));
  const ridge = (center, width) => Math.exp(-(((y-center)/width)**2)) - .45*Math.exp(-(((y-center-.019)/(width*1.3))**2));
  return edge * (.009*ridge(.092+.155*u,.021) + .004*ridge(.168+.14*u,.028));
}
export function torsoFront(kind, x, y, lift = .009) {
  if (!Number.isFinite(x) || !Number.isFinite(lift)) throw new TypeError('Torso sample must be finite');
  const s = torsoSection(kind, y);
  return new THREE.Vector3(x, y, s.front * Math.sqrt(Math.max(0, 1 - (x / s.width) ** 2)) + frontDrape(kind,x,y,s) + lift);
}
export function tailoredTorsoGeometry(kind) {
  const source = profile(kind), rows = 32, columns = 24, stride = columns + 1;
  const positions = [], uv = [], index = [], bottom = source[0][0], top = source[source.length - 1][0];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows, y = bottom + (top - bottom) * v, s = torsoSection(kind, y);
    for (let col = 0; col <= columns; col++) {
      const a = col / columns * Math.PI * 2, c = Math.cos(a);
      const x = Math.sin(a)*s.width;
      const z = c*(c>=0?s.front:s.back) + (c>=0?frontDrape(kind,x,y,s):0);
      positions.push(x,y,z);
      uv.push(col / columns, v);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * stride + c, b = a + stride;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  for (const end of [0, rows]) {
    const center = positions.length / 3; positions.push(0, end === 0 ? bottom : top, 0); uv.push(.5, end / rows);
    for (let c = 0; c < columns; c++) {
      const a = end * stride + c;
      if (end === 0) index.push(center, a + 1, a); else index.push(center, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  const n = g.attributes.normal, merged = new THREE.Vector3();
  for (let r = 0; r <= rows; r++) {
    const a = r * stride, b = a + columns;
    merged.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, merged.x, merged.y, merged.z); n.setXYZ(b, merged.x, merged.y, merged.z);
  }
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.k3Costume = COSTUME_SURFACE_VERSION;
  return g;
}

// The character keeps the hanging black mask, but it behaves as folded cloth
// rather than a half-sphere projecting from the throat. No material is added.
export function hangingMaskGeometry() {
  const positions = [], uv = [], index = [], columns = 12, rows = 6;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    const v = r / rows, u = c / columns * 2 - 1, middle = 1 - u * u;
    const upper = .035 - .025 * middle, lower = -.038 + .016 * u * u;
    positions.push(u * (.075 - .012 * v), upper + (lower - upper) * v, .018 * middle * (.45 + .55 * Math.sin(v * Math.PI)));
    uv.push(c / columns, 1 - v);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * (columns + 1) + c, b = a + columns + 1;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
export function hangingMaskStrapGeometry() {
  const points = [[-.07,.53,.155],[-.09,.58,.09],[-.075,.636,.015],
    [0,.645,-.045],[.075,.636,.015],[.09,.58,.09],[.07,.53,.155]];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 32, .003, 5, false);
}
