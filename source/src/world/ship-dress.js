// 船身装饰（D-075 / H-1，对着门户 hero-painting 做）：纯附加，不动 ship.js 的坐标常量与 collision。
//   · 两舷各两排暖光舱窗（面片贴在船体曲面外 3 cm，暖金自发光 + 深色窗框 + 十字窗格），船尾楼后墙一排更大的拱窗；
//   · 沿船体三道鎏金饰带（甲板线 / 舷墙半高 / 两排窗间），跟着船体曲面走；
//   · 每根横桁两端各挂一只金色灯笼笼（链 + 八面体笼线框 + 内里一颗暖光珠），三桅七桁共 14 只；
//   全部按材质合批：窗玻璃 1、窗框 1、饰带 1、笼线 1、笼珠 1、链 1 —— 6 次 draw call。没有真灯（灯数恒定纪律），亮的地方靠自发光 + Bloom。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, SHIP } from '../config.js';
import { hullHalfWidth, bulwarkTop, hullDepth } from './ship.js';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _quat = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

/** 船体参数曲面上的一点（与 ship.js hullPoint 同式）：s ∈ [0,1] 舷墙顶 → 龙骨 */
function hullPoint(z, s, side, out) {
  const w = hullHalfWidth(z), top = bulwarkTop(z), d = hullDepth(z);
  const x = w * Math.sqrt(Math.max(0, 1 - Math.pow(s, 3.2)));
  const y = top - (top + d) * Math.pow(s, 1.15);
  return out.set(side * x, y, z);
}
/** 让 y 落到目标高度的 s */
function sForY(z, y) {
  const top = bulwarkTop(z), d = hullDepth(z);
  return Math.pow(Math.max(0, (top - y) / (top + d)), 1 / 1.15);
}
/** 船体外法线（有限差分） */
function hullNormal(z, s, side, out) {
  hullPoint(z, s, side, _p); hullPoint(z + 0.2, s, side, _q); const dz = _q.clone().sub(_p);
  hullPoint(z, Math.min(1, s + 0.02), side, _q); const ds = _q.clone().sub(_p);
  out.crossVectors(ds, dz).normalize();
  if (out.x * side < 0) out.negate();
  return out;
}

export function buildShipDress(ship) {
  const g = new THREE.Group(); g.name = 'ship-dress';
  const glass = [], frames = [], stripes = [], sternMouldings = [], cageLines = [], pearls = [], chains = [];
  // ---------- 舱窗 ----------
  const win = (z, y, side, w, h, arch = false) => {
    const s = sForY(z, y);
    hullPoint(z, s, side, _p); hullNormal(z, s, side, _n);
    _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n);
    _m.compose(_p.clone().addScaledVector(_n, 0.03), _quat, new THREE.Vector3(1, 1, 1));
    const pane = arch ? archGeometry(w, h) : new THREE.PlaneGeometry(w, h);
    pane.applyMatrix4(_m); glass.push(pane);
    // 框：四条窄条 + 十字格
    const t = 0.05;
    const bars = [
      new THREE.BoxGeometry(w + 2 * t, t, 0.06).translate(0, h / 2 + t / 2, 0.02),
      new THREE.BoxGeometry(w + 2 * t, t, 0.06).translate(0, -h / 2 - t / 2, 0.02),
      new THREE.BoxGeometry(t, h, 0.06).translate(-w / 2 - t / 2, 0, 0.02),
      new THREE.BoxGeometry(t, h, 0.06).translate(w / 2 + t / 2, 0, 0.02),
      new THREE.BoxGeometry(w, t * 0.6, 0.04).translate(0, 0, 0.03),
      new THREE.BoxGeometry(t * 0.6, h, 0.04).translate(0, 0, 0.03),
    ];
    for (const b of bars) { b.applyMatrix4(_m); frames.push(b); }
  };
  // 主甲板段两排：z −16 → 12 每 3.1 m；下排略小
  for (let z = -15.5; z <= 12.5; z += 3.1) for (const side of [-1, 1]) { win(z, -0.65, side, 0.62, 0.78); win(z, -1.75, side, 0.5, 0.6); }
  // （船尾楼段两舷那排 y=1.9 的拱窗去掉了：那个高度已在舷墙顶之上，窗片浮在栏杆上方，从甲板看是一大块过曝白光——D-α 22:55）
  // 船尾后墙两扇大拱窗（船尾横板外侧；原来写在 sternZ − 0.15 被 z = sternZ 的横板整块挡住、从船外根本看不见，
  // D-α 09-08 挪到横板外 3 cm；中间那扇让位给船尾家徽 ship-stern.js，直径 2.3 正好落在两窗之间）
  {
    const z = SHIP.sternZ, wHalf = hullHalfWidth(z) * 0.62;
    for (const x of [-wHalf * 0.6, wHalf * 0.6]) {
      const pane = archGeometry(1.1, 1.5); pane.translate(x, 2.2, z + 0.03); glass.push(pane);
      // 木框沿原窗洞连续包边；后沿在横板外，玻璃仍退在框内。
      frames.push(archFrameGeometry(1.1, 1.5, 0.07, 0.10).translate(x, 2.2, z + 0.055));
      frames.push(new THREE.BoxGeometry(0.042, 1.5, 0.075).translate(x, 2.2, z + 0.055));
      frames.push(new THREE.BoxGeometry(1.1, 0.036, 0.075).translate(x, 2.4, z + 0.055));
      frames.push(new THREE.BoxGeometry(1.36, 0.08, 0.20).translate(x, 1.385, z + 0.06));
      // 窄金属压边使用既有饰带材质，不增加灯光、贴图或合批。
      sternMouldings.push(archFrameGeometry(1.20, 1.60, 0.020, 0.024).translate(x, 2.2, z + 0.118));
    }
  }
  // ---------- 鎏金饰带：三道，沿船体曲面 ----------
  const stripe = (yAt, thick, z0, z1) => {
    for (const side of [-1, 1]) {
      const N = 64, pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const z = z0 + (z1 - z0) * (i / N);
        const y = yAt(z), s0 = sForY(z, y + thick / 2), s1 = sForY(z, y - thick / 2);
        hullPoint(z, s0, side, _p); hullNormal(z, s0, side, _n); _p.addScaledVector(_n, 0.025); pos.push(_p.x, _p.y, _p.z);
        hullPoint(z, s1, side, _p); _p.addScaledVector(_n, 0.025); pos.push(_p.x, _p.y, _p.z);
        if (i < N) {
          const k = i * 2;
          // 两舷是镜像曲面，右舷必须反转绕序，FrontSide 才朝船外。
          if (side < 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      stripes.push(geo);
    }
  };
  stripe((z) => 0.02, 0.16, -27, SHIP.sternZ - 0.5);                 // 甲板线
  stripe((z) => bulwarkTop(z) - 0.45, 0.09, -26, SHIP.sternZ - 0.5);  // 舷墙半高细线
  stripe((z) => -1.2, 0.08, -17, 14);                                // 两排窗之间一条细线
  // 甲板步行带导向镶线：和既有金色饰带同一合批，薄到不改变可走面。
  // 两侧避开中央罗盘/望远镜和门洞，走路时提供连续的空间节拍。
  for (const z of [-12.5, -8.5, -4.5, 0.5, 5.5, 10.5]) {
    for (const x of [-2.65, 2.65]) {
      const mark = new THREE.BoxGeometry(1.12, 0.018, 0.045);
      mark.translate(x, 0.026, z);
      stripes.push(mark);
    }
  }
  stripes.push(...sternMouldings);
  // ---------- 灯笼笼：每根横桁两端 ----------
  for (const m of SHIP.masts) {
    const b = m.base || 0;
    for (const s of m.sails) {
      const yardY = b + s.y + s.h, half = (s.w + 1.2) / 2 - 0.35;
      for (const side of [-1, 1]) {
        const x = side * half, z = m.z - 0.3, top = yardY - 0.06, len = 0.7;
        const chain = new THREE.CylinderGeometry(0.012, 0.012, len, 5); chain.translate(x, top - len / 2, z); chains.push(chain);
        const cy = top - len - 0.22;
        const cage = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.24, 0)); cage.translate(x, cy, z); cageLines.push(cage);
        const ringG = new THREE.EdgesGeometry(new THREE.CircleGeometry(0.16, 10)); ringG.rotateX(Math.PI / 2); ringG.translate(x, cy, z); cageLines.push(ringG);
        const pearl = new THREE.SphereGeometry(0.085, 10, 8); pearl.translate(x, cy, z); pearls.push(pearl);
      }
    }
  }
  // ---------- 材质与合批 ----------
  // 与其他 Standard 同一套光照。暖窗靠低强度自发光，线性亮度远低于 Bloom 阈值 0.85，不另加灯。
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x4e3828, emissive: 0xffb866, emissiveIntensity: 0.35, roughness: 0.62, metalness: 0, fog: true });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x735136, roughness: 0.72, metalness: 0.05 });
  const goldMat = new THREE.MeshStandardMaterial({ color: COLORS.bright, emissive: new THREE.Color(COLORS.gold), emissiveIntensity: 0.22, roughness: 0.38, metalness: 0.45 });
  const cageMat = new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.bright).multiplyScalar(1.2), transparent: true, opacity: 0.9 });
  const pearlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd28a).multiplyScalar(1.15), fog: false });
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 0.6, metalness: 0.6 });
  const strip = (arr) => arr.map((geo) => { geo.deleteAttribute('uv'); if (!geo.attributes.normal) geo.computeVertexNormals(); return geo; });
  const add = (geos, mat, opts = {}) => { if (!geos.length) return; const geo = mergeGeometries(strip(geos), false); const mesh = opts.lines ? new THREE.LineSegments(geo, mat) : new THREE.Mesh(geo, mat); mesh.castShadow = !!opts.shadow; mesh.frustumCulled = false; g.add(mesh); return mesh; };
  add(glass, glassMat);
  add(frames, frameMat, { shadow: false });
  add(stripes, goldMat);
  add(pearls, pearlMat);
  add(chains, chainMat);
  // 线框类（EdgesGeometry 没有 normal）：单独合
  if (cageLines.length) { const geo = mergeGeometries(cageLines.map((c) => { c.deleteAttribute('uv'); return c; }), false); const lines = new THREE.LineSegments(geo, cageMat); lines.frustumCulled = false; g.add(lines); }
  g.userData.exteriorCraft = { version: 'ship-exterior-78', sternArchFrames: 2, sternPaneSize: [1.1, 1.5], hullStripeRunsPerSide: 3, batches: 6, addedLights: 0, addedTextures: 0 };
  ship.group.add(g);
  return { group: g, glassMat, pearlMat, update(t) { const k = 0.9 + 0.06 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 4.1); glassMat.emissiveIntensity = 0.35 * k; } };
}

/** 拱形窗（上圆下方）几何，朝 +z */
function archGeometry(w, h) {
  const shape = new THREE.Shape();
  const r = w / 2;
  shape.moveTo(-r, -h / 2); shape.lineTo(r, -h / 2); shape.lineTo(r, h / 2 - r);
  shape.absarc(0, h / 2 - r, r, 0, Math.PI, false);
  shape.lineTo(-r, -h / 2);
  return new THREE.ShapeGeometry(shape, 10);
}

/** 有厚度的闭合拱框，窗洞内沿与 archGeometry 同形，所有面朝实体外侧。 */
function archFrameGeometry(w, h, thickness, depth) {
  const r = w / 2, cy = h / 2 - r, inner = [], outer = [];
  const edge = (x, y, ox, oy) => { inner.push([x, y]); outer.push([ox, oy]); };
  edge(-r, -h / 2, -r - thickness, -h / 2 - thickness);
  edge(r, -h / 2, r + thickness, -h / 2 - thickness);
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * i / 20, c = Math.cos(a), s = Math.sin(a);
    edge(r * c, cy + r * s, (r + thickness) * c, cy + (r + thickness) * s);
  }
  const positions = [], indices = [], front = depth / 2, back = -front;
  const point = (p, z) => [p[0], p[1], z];
  const quad = (a, b, c, d) => {
    const k = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length, oi = outer[i], oj = outer[j], ii = inner[i], ij = inner[j];
    quad(point(oi, front), point(oj, front), point(ij, front), point(ii, front));
    quad(point(ii, back), point(ij, back), point(oj, back), point(oi, back));
    quad(point(oi, back), point(oj, back), point(oj, front), point(oi, front));
    quad(point(ii, front), point(ij, front), point(ij, back), point(ii, back));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
