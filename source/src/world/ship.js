// 夜航书斋号：60 m × 14 m 三桅木船，全部 three.js 几何体程序生成。
// 船体 = 沿 z 的横剖面缝成的参数曲面；甲板 / 舷墙 / 船尾楼 / 楼梯 / 桅杆 / 帆 / 索具 / 灯笼 / 舵轮 / 船首像 / 望远镜台。
// 所有「可走的面」与 collision.js 的解析式共用同一组函数（hullHalfWidth / deckHalfWidth / stairHeight）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP, DOOR, COLORS } from '../config.js';
import { woodPlanks, bookSpines, sailClothSet } from './textures.js';
import { clamp, lerp, smoothstep } from '../util/easing.js';
import { buildSternCrest } from './ship-stern.js';
import { buildShipFinish } from './ship-finish.js';
import { buildShipHelm } from './ship-helm.js';
import { buildShipTelescope } from './ship-telescope.js';
import { buildBowBook } from './ship-bow-book.js';
import { createSailGeometry, deformSail, finishSailCloth } from './ship-sail-craft.js';
import { assetsReady, hasAsset, loadTexture } from '../util/assets.js'; // X-002：甲板木纹法线 assets/wood-deck-normal.webp

const P = SHIP.poop;
const ST = SHIP.stairs;
export const CABIN_HALF = 5.3;              // 船尾楼舱室半宽（楼梯在 |x| ∈ [5.3, 6.6]）
export const STAIR_RUN = ST.steps * ST.depth + ST.landing; // 4.44
export const STAIR_END_Z = ST.z0 + STAIR_RUN;              // 18.64
export const DOOR_XS = [-4.2, 0, 4.2];

/** 船体外皮在甲板高度的半宽（x） */
export function hullHalfWidth(z) {
  const W = SHIP.beam / 2;
  if (z < -18) { const t = clamp((z + 30) / 12, 0, 1); return W * (0.06 + 0.94 * Math.pow(Math.sin(t * Math.PI / 2), 0.7)); }
  if (z <= 16) return W;
  const t = clamp((z - 16) / 14, 0, 1);
  return W * (1 - 0.32 * Math.pow(t, 1.6));
}
/** 可行走甲板半宽（舷墙厚 0.4） */
export function deckHalfWidth(z) { return Math.min(hullHalfWidth(z) - 0.4, SHIP.railX); }
/** 舷墙顶高度（相对 y=0） */
export function bulwarkTop(z) {
  if (z >= P.wallZ) return P.height + SHIP.railHeight + 0.3 * clamp((z - P.wallZ) / 16, 0, 1);
  if (z < -18) { const t = clamp((-18 - z) / 12, 0, 1); return SHIP.railHeight + 0.8 * t * t; }
  return SHIP.railHeight;
}
/** 龙骨深度 */
export function hullDepth(z) {
  const D = 5.5;
  if (z < -18) { const t = clamp((z + 30) / 12, 0, 1); return D * (0.3 + 0.7 * Math.sin(t * Math.PI / 2)); }
  if (z <= 16) return D;
  const t = clamp((z - 16) / 14, 0, 1);
  return D * (1 - 0.45 * t * t);
}
/** 楼梯斜坡高度（两段各 6 级 + 中间平台），z 在 [z0, z0+RUN] 之外返回端点值 */
export function stairHeight(z) {
  const flight = ST.steps / 2 * ST.depth; // 1.92
  const half = ST.steps / 2 * ST.rise;    // 1.5
  const u = z - ST.z0;
  if (u <= 0) return 0;
  if (u < flight) return half * (u / flight);
  if (u < flight + ST.landing) return half;
  if (u < STAIR_RUN) return half + half * ((u - flight - ST.landing) / flight);
  return P.height;
}

// 船体参数曲面上的一点：z 站位，s ∈ [0,1] 从舷墙顶到龙骨，side = ±1
function hullPoint(z, s, side, out) {
  const w = hullHalfWidth(z), top = bulwarkTop(z), d = hullDepth(z);
  const x = w * Math.sqrt(Math.max(0, 1 - Math.pow(s, 3.2)));
  const y = top - (top + d) * Math.pow(s, 1.15);
  return out.set(side * x, y, z);
}

// 参数网格：u 沿第一个参数（通常是 z），v 沿第二个。默认绕向使 (∂u × ∂v) 为正面；flip 翻转。
function gridGeometry(nu, nv, fn, { uvScale = [1, 1], flip = false } = {}) {
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    fn(i / nu, j / nv, p);
    pos.push(p.x, p.y, p.z);
    uv.push(i / nu * uvScale[0], j / nv * uvScale[1]);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
    else idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x, y, z, mat, { castShadow = true, receiveShadow = true, ry = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = castShadow; m.receiveShadow = receiveShadow;
  return m;
}

export class Ship {
  constructor({ quality = 'high', reducedMotion = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'ship';
    this.reducedMotion = reducedMotion;
    this.time = 0;
    this.sails = [];
    this.lanternMeshes = [];
    this.occluders = [];
    this.wallSegments = [];
    this._buildMaterials();
    this._buildHull();
    this._buildDecks();
    this._buildBulwarks();
    this._buildCabin();
    this._buildStairs();
    this._buildMasts();
    this._buildRigging();
    this._buildLanterns();
    this._buildWheel();
    this._buildBow();
    this._buildTelescope();
    this.finish = buildShipFinish(this);
    this._buildOccluders();
    this.setQuality(quality); // 记下每个网格的初始 castShadow，并按启动画质套用投影体集合
    // 船尾家徽（H-1 收尾 · D-α 09-08）：异步读 assets/ship-crest.svg，居中在两扇船尾拱窗之间；缺资产就没有，不报错
    this.sternCrest = null;
    buildSternCrest(this.group, { z: SHIP.sternZ, yCenter: 2.0, diameter: 2.3 }).then((r) => { this.sternCrest = r; }).catch((e) => console.warn('船尾家徽未挂上', e));
  }

  _buildMaterials() {
    const deck = woodPlanks({ palette: 'deck', seed: 7 });
    const hull = woodPlanks({ palette: 'hull', seed: 13, planks: 10 });
    const dark = woodPlanks({ palette: 'dark', seed: 21, planks: 6 });
    hull.map.rotation = Math.PI / 2; hull.map.center.set(0.5, 0.5);
    hull.normal.rotation = Math.PI / 2; hull.normal.center.set(0.5, 0.5);
    this.mat = {
      deck: new THREE.MeshStandardMaterial({ map: deck.map, normalMap: deck.normal, normalScale: new THREE.Vector2(0.34, 0.34), roughness: 0.9, metalness: 0.0, color: 0xf6f1e8 }),
      // 贴图已经是暖木色。材质色只留低于白的一点暖中性，不再用大块米黄去乘，也不把船提到纯白。
      hull: new THREE.MeshStandardMaterial({ map: hull.map, normalMap: hull.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.84, metalness: 0.0, color: 0xf4eee4, emissive: new THREE.Color(0x3a2414), emissiveIntensity: 0.15 }),
      // 梁柱和船尾端面走 dark 调色板，高光更闷；自发光只留暗部一点暖，不把缝涂平。
      dark: new THREE.MeshStandardMaterial({ map: dark.map, normalMap: dark.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.93, metalness: 0.0, color: 0xefe6dc, emissive: 0x332619, emissiveIntensity: 0.06 }),
      trim: new THREE.MeshStandardMaterial({ color: 0xc5a16b, roughness: 0.38, metalness: 0.45, emissive: 0x332515, emissiveIntensity: 0.12 }),
      goldGlow: new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: COLORS.bright, emissiveIntensity: 0.16, roughness: 0.4, metalness: 0.5 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x655847, roughness: 0.48, metalness: 0.45 }),
      rope: new THREE.LineBasicMaterial({ color: 0x8a7455, transparent: true, opacity: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x211d16, emissive: new THREE.Color(COLORS.lantern), emissiveIntensity: 0.52, roughness: 0.68, metalness: 0.0 }),
      spines: new THREE.MeshStandardMaterial({ map: bookSpines().map, roughness: 0.8, metalness: 0.05 }),
    };
    this.mat.deck.map.repeat.set(1, 1);
    // X-002（08-F.2 木纹法线，09-09 X）：assets/wood-deck-normal.webp 到位就换掉从颜色亮度 Sobel 推出来的程序法线——
    // 板缝 V 槽 / 圆肩倒角 / 板面微鼓 / 钉孔碟形沉头的真高度场，与 woodPlanksGen 同源常量逐像素对齐（tools/wood-normal-X.mjs 生成）。
    // 等 assetsReady 再等 3 s 才取：file:// 下它是 299 KB 分片（插 <script>），不挤「启航」；换图不换变体 → 0 新程序；缺资产 / 失败保留程序法线。
    assetsReady.then(() => new Promise((r) => setTimeout(r, 3000)))
      .then(() => (hasAsset('wood-deck-normal.webp') ? loadTexture('wood-deck-normal.webp', { srgb: false, repeat: [1, 1] }) : null))
      .then((t) => {
        if (!t || !this.mat || !this.mat.deck) return;
        const old = this.mat.deck.normalMap;
        t.name = 'wood-deck-normal.webp';
        if (old) t.anisotropy = old.anisotropy;
        this.mat.deck.normalMap = t;
        this.mat.deck.needsUpdate = true;
        if (old && old !== t) old.dispose();
      })
      .catch((e) => console.warn('甲板木纹法线未换上，保留程序法线', e));
    const cloths = sailClothSet();
    const sails = [];
    for (const cloth of cloths) sails.push(finishSailCloth(new THREE.MeshStandardMaterial({ map: cloth.map, emissiveMap: cloth.emissive, emissive: new THREE.Color(COLORS.bright), emissiveIntensity: 0.4, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide, color: 0xd8cbb0 }), { bumpMap: sails[0]?.bumpMap }));
    this.mat.sail = sails[0];
    this.mat.sailMedium = sails[1] || sails[0];
    this.mat.sailSmall = sails[2] || sails[0];
  }

  _buildHull() {
    const nz = 56, ns = 12;
    const zMin = SHIP.bowZ, zMax = SHIP.sternZ;
    for (const side of [-1, 1]) {
      // side=+1 时 (∂z × ∂s) 已朝外；side=−1 需翻转
      const geo = gridGeometry(nz, ns, (u, v, p) => hullPoint(lerp(zMin, zMax, u), v, side, p), { uvScale: [60 / 2.4, 4.2], flip: side === -1 });
      const m = new THREE.Mesh(geo, this.mat.hull);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    // 船尾横板（transom）
    {
      const pts = [];
      const p = new THREE.Vector3();
      for (let j = 0; j <= ns; j++) { hullPoint(zMax, j / ns, 1, p); pts.push(new THREE.Vector2(p.x, p.y)); }
      for (let j = ns; j >= 0; j--) { hullPoint(zMax, j / ns, -1, p); pts.push(new THREE.Vector2(p.x, p.y)); }
      const shape = new THREE.Shape(pts);
      const geo = new THREE.ShapeGeometry(shape);
      geo.translate(0, 0, zMax);
      const m = new THREE.Mesh(geo, this.mat.dark);
      m.receiveShadow = true;
      this.group.add(m);
      // 船尾大灯（一盏）
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), this.mat.glass);
      lamp.position.set(0, bulwarkTop(zMax) + 0.6, zMax + 0.2);
      this.group.add(lamp);
      this.sternLamp = lamp;
    }
    // 书脊带：舷侧一圈「知识」（略微外凸 0.04）
    for (const side of [-1, 1]) {
      const geo = gridGeometry(nz, 1, (u, v, p) => {
        const z = lerp(zMin + 2, zMax - 0.5, u);
        hullPoint(z, lerp(0.22, 0.34, v), side, p);
        p.x += side * 0.04;
      }, { uvScale: [6, 1], flip: side === -1 });
      const m = new THREE.Mesh(geo, this.mat.spines);
      m.receiveShadow = true;
      this.group.add(m);
      // 上下两条金线
      for (const s of [0.205, 0.355]) {
        const g = gridGeometry(nz, 1, (u, v, p) => { hullPoint(lerp(zMin + 2, zMax - 0.5, u), s + (v - 0.5) * 0.012, side, p); p.x += side * 0.05; }, { flip: side === -1 });
        this.group.add(new THREE.Mesh(g, this.mat.trim));
      }
    }
  }

  _buildDecks() {
    // 主甲板 + 船头甲板：y=0，z ∈ [bow, wallZ]
    const mainGeo = gridGeometry(48, 2, (u, v, p) => {
      const z = lerp(SHIP.bowZ + 0.3, P.wallZ + P.wallThickness, u);
      const w = hullHalfWidth(z) - 0.3;
      p.set(lerp(-w, w, v), 0, z);
    });
    // uv 用世界坐标：u = x / 2.4, v = z / 2.4
    this._worldUV(mainGeo, 2.4);
    const main = new THREE.Mesh(mainGeo, this.mat.deck);
    main.receiveShadow = true;
    this.group.add(main);

    // 船尾楼甲板：中段（楼梯井之间）+ 后段（全宽）
    const H = P.height;
    const midGeo = gridGeometry(6, 1, (u, v, p) => p.set(lerp(-CABIN_HALF, CABIN_HALF, v), H, lerp(P.wallZ, STAIR_END_Z, u)));
    const aftGeo = gridGeometry(24, 2, (u, v, p) => { const z = lerp(STAIR_END_Z, SHIP.sternZ - 0.2, u); const w = hullHalfWidth(z) - 0.3; p.set(lerp(-w, w, v), H, z); });
    for (const g of [midGeo, aftGeo]) { this._worldUV(g, 2.4); const m = new THREE.Mesh(g, this.mat.deck); m.receiveShadow = true; m.castShadow = true; this.group.add(m); }

    // 船尾楼甲板前沿的挡板（从主甲板看是一条暗木横带）
    const fascia = box(CABIN_HALF * 2 + 0.2, 0.28, 0.12, 0, H - 0.12, P.wallZ - 0.06, this.mat.dark);
    this.group.add(fascia);
    // 舱室天花（门厅内看到的顶）
    const ceil = box(CABIN_HALF * 2, 0.1, STAIR_END_Z - P.wallZ, 0, DOOR.hallHeight + 0.05, (P.wallZ + STAIR_END_Z) / 2, this.mat.dark, { castShadow: false });
    this.group.add(ceil);
  }

  _worldUV(geo, scale) {
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / scale, pos.getZ(i) / scale);
    uv.needsUpdate = true;
  }

  _buildBulwarks() {
    // 舷墙内侧面 + 顶盖 + 立柱：沿轮廓两侧
    const nz = 56;
    const zMin = SHIP.bowZ + 0.6, zMax = SHIP.sternZ - 0.2;
    for (const side of [-1, 1]) {
      // 内侧立面：从甲板（或船尾楼甲板）到舷墙顶
      // 内立面法线朝船中心：side=+1 时 (∂z × ∂y) = −x 正确；side=−1 翻转
      const inner = gridGeometry(nz, 1, (u, v, p) => {
        const z = lerp(zMin, zMax, u);
        const base = z >= P.wallZ ? P.height : 0;
        const w = hullHalfWidth(z) - 0.4;
        p.set(side * w, lerp(base, bulwarkTop(z), v), z);
      }, { uvScale: [60 / 2.4, 0.5], flip: side === -1 });
      const im = new THREE.Mesh(inner, this.mat.dark);
      im.receiveShadow = true; im.castShadow = true;
      this.group.add(im);
      // 顶盖（栏杆帽）
      const cap = gridGeometry(nz, 1, (u, v, p) => {
        const z = lerp(zMin, zMax, u);
        const w0 = hullHalfWidth(z) - 0.45, w1 = hullHalfWidth(z) + 0.05;
        p.set(side * lerp(w0, w1, v), bulwarkTop(z) + 0.04, z);
      }, { uvScale: [60 / 2.4, 0.2], flip: side === -1 });
      const cm = new THREE.Mesh(cap, this.mat.trim);
      this.group.add(cm);
      // 立柱（每 2 m 一根，小方柱）+ 楼梯井处的段落跳过
      const posts = [];
      for (let z = zMin + 1; z < zMax; z += 2) {
        const base = z >= P.wallZ ? P.height : 0;
        const h = bulwarkTop(z) - base + 0.1;
        const g = new THREE.BoxGeometry(0.14, h, 0.14);
        g.translate(side * (hullHalfWidth(z) - 0.32), base + h / 2, z);
        posts.push(g);
      }
      const pm = new THREE.Mesh(mergeGeometries(posts), this.mat.dark);
      pm.castShadow = true;
      this.group.add(pm);
    }
    // 船尾楼前沿栏杆（防止从船尾楼掉到主甲板）与楼梯井内侧栏杆
    const H = P.height;
    const rail = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ang = Math.atan2(x1 - x0, z1 - z0);
      const g = new THREE.Group();
      g.position.set((x0 + x1) / 2, H, (z0 + z1) / 2);
      g.rotation.y = ang;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, len), this.mat.trim); top.position.y = 1.05; g.add(top);
      const mid = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, len), this.mat.dark); mid.position.y = 0.55; g.add(mid);
      const n = Math.max(2, Math.round(len / 0.9));
      const posts = [];
      for (let i = 0; i <= n; i++) { const pg = new THREE.BoxGeometry(0.1, 1.05, 0.1); pg.translate(0, 0.525, -len / 2 + (len * i) / n); posts.push(pg); }
      const pm = new THREE.Mesh(mergeGeometries(posts), this.mat.dark); pm.castShadow = true; g.add(pm);
      this.group.add(g);
    };
    rail(-CABIN_HALF, P.wallZ + 0.05, CABIN_HALF, P.wallZ + 0.05);
    rail(-CABIN_HALF, P.wallZ + 0.05, -CABIN_HALF, STAIR_END_Z);
    rail(CABIN_HALF, P.wallZ + 0.05, CABIN_HALF, STAIR_END_Z);
  }

  _buildCabin() {
    // 船尾楼正面墙（z = wallZ..wallZ+厚），三扇门洞；侧墙（楼梯井内侧）；门厅之间的隔墙由 hall.js 处理
    const H = P.height, T = P.wallThickness, zc = P.wallZ + T / 2;
    const hw = DOOR.width / 2 + 0.12; // 门洞含门框余量
    const edges = [-CABIN_HALF, ...DOOR_XS.flatMap((x) => [x - hw, x + hw]), CABIN_HALF];
    for (let i = 0; i < edges.length; i += 2) {
      const x0 = edges[i], x1 = edges[i + 1];
      if (x1 - x0 < 0.01) continue;
      const seg = box(x1 - x0, H, T, (x0 + x1) / 2, H / 2, zc, this.mat.hull);
      this.group.add(seg);
      this.wallSegments.push(seg);
    }
    // 门厅地板（主甲板几何只到墙后沿）
    const floor = box(CABIN_HALF * 2, 0.1, DOOR.hallDepth + 0.4, 0, -0.05, P.wallZ + T + DOOR.hallDepth / 2, this.mat.deck, { castShadow: false });
    floor.material = this.mat.deck;
    this.group.add(floor);
    // 门上过梁
    for (const x of DOOR_XS) {
      const lintelH = H - (DOOR.height + 0.12);
      this.group.add(box(hw * 2, lintelH, T, x, DOOR.height + 0.12 + lintelH / 2, zc, this.mat.dark));
    }
    // 侧墙（楼梯井内侧）
    for (const s of [-1, 1]) {
      const len = STAIR_END_Z - P.wallZ;
      this.group.add(box(0.2, H, len, s * (CABIN_HALF - 0.1), H / 2, P.wallZ + len / 2, this.mat.dark));
    }
    // 舱室后墙 + 门厅之间隔墙（简单闭合，门厅细节在 hall.js）
    this.group.add(box(CABIN_HALF * 2, H, 0.2, 0, H / 2, P.wallZ + T + DOOR.hallDepth + 0.1, this.mat.dark, { castShadow: false }));
    for (const x of [-2.1, 2.1]) this.group.add(box(0.2, H, DOOR.hallDepth, x, H / 2, P.wallZ + T + DOOR.hallDepth / 2, this.mat.dark, { castShadow: false }));
    // 墙面装饰：暗金压线
    this.group.add(box(CABIN_HALF * 2, 0.06, 0.04, 0, H - 0.08, P.wallZ - 0.02, this.mat.trim, { castShadow: false }));
    this.group.add(box(CABIN_HALF * 2, 0.06, 0.04, 0, 0.12, P.wallZ - 0.02, this.mat.trim, { castShadow: false }));
  }

  _buildStairs() {
    const w = SHIP.railX - CABIN_HALF; // 1.3
    for (const s of [-1, 1]) {
      const xc = s * (CABIN_HALF + w / 2);
      const geos = [];
      for (let i = 0; i < ST.steps; i++) {
        const flightOff = i >= ST.steps / 2 ? ST.landing : 0;
        const z0 = ST.z0 + i * ST.depth + flightOff;
        const yTop = (i + 1) * ST.rise;
        const g = new THREE.BoxGeometry(w, yTop, ST.depth);
        g.translate(xc, yTop / 2, z0 + ST.depth / 2);
        geos.push(g);
        if (i === ST.steps / 2 - 1) { // 平台
          const lg = new THREE.BoxGeometry(w, yTop, ST.landing);
          lg.translate(xc, yTop / 2, z0 + ST.depth + ST.landing / 2);
          geos.push(lg);
        }
      }
      const m = new THREE.Mesh(mergeGeometries(geos), this.mat.deck);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      // 楼梯扶手（靠舱室侧墙的一根金扶手）
      const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, STAIR_RUN + 0.2, 8), this.mat.trim);
      hand.position.set(s * (CABIN_HALF + 0.08), P.height / 2 + 0.95, ST.z0 + STAIR_RUN / 2);
      hand.rotation.x = -Math.atan2(P.height, STAIR_RUN);
      this.group.add(hand);
    }
  }

  _buildMasts() {
    const cleats = [];
    for (const m of SHIP.masts) {
      const b = m.base || 0;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(m.radius * 0.45, m.radius, m.height, 14), this.mat.dark);
      mast.position.set(0, b + m.height / 2, m.z);
      mast.castShadow = true;
      this.group.add(mast);
      // 桅顶小球
      const knob = new THREE.Mesh(new THREE.SphereGeometry(m.radius * 0.7, 10, 8), this.mat.goldGlow);
      knob.position.set(0, b + m.height + 0.2, m.z);
      this.group.add(knob);
      // 桅座（绳索桩）
      const base = new THREE.Mesh(new THREE.CylinderGeometry(m.radius + 0.35, m.radius + 0.45, 0.5, 12), this.mat.dark);
      base.position.set(0, b + 0.25, m.z);
      base.castShadow = true; base.receiveShadow = true;
      this.group.add(base);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        const g = new THREE.CylinderGeometry(0.07, 0.09, 0.6, 8);
        g.translate(Math.cos(a) * (m.radius + 0.55), b + 0.3, m.z + Math.sin(a) * (m.radius + 0.55));
        cleats.push(g);
      }
      // 帆与横桁（s.y 相对桅座）
      for (const s of m.sails) {
        const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, s.w + 1.2, 8), this.mat.dark);
        yard.rotation.z = Math.PI / 2;
        yard.position.set(0, b + s.y + s.h, m.z - 0.3);
        yard.castShadow = true;
        this.group.add(yard);
        const geo = createSailGeometry(s.w, s.h);
        const sail = new THREE.Mesh(geo, s.w >= 10 ? this.mat.sail : s.w >= 8 ? this.mat.sailMedium : this.mat.sailSmall);
        sail.position.set(0, b + s.y + s.h / 2, m.z - 0.5);
        sail.castShadow = true; sail.receiveShadow = true;
        sail.userData = { base: geo.attributes.position.array.slice(), w: s.w, h: s.h, phase: this.sails.length * .73, craft: true };
        this.group.add(sail);
        this.sails.push(sail);
      }
    }
    const cleatMesh = new THREE.Mesh(mergeGeometries(cleats), this.mat.dark); cleatMesh.castShadow = true;
    this.group.add(cleatMesh);
    this._deformSails(0);
  }

  _deformSails(t) {
    for (const sail of this.sails) deformSail(sail, t);
  }

  _buildRigging() {
    const pts = [];
    // D-075 / H-1：缆绳不再是直线——按悬链线下垂（垂度 ≈ 1.6% 绳长，越平的绳垂得越明显），每根 8 段折线
    const add = (a, b) => {
      const L = a.distanceTo(b);
      const horiz = Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1e-3, L);
      const sag = L * 0.016 * (0.4 + 0.6 * horiz);
      const N = 8;
      let px = a.x, py = a.y, pz = a.z;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
        pts.push(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const m of SHIP.masts) {
      const b = m.base || 0;
      const top = V(0, b + m.height - 0.5, m.z);
      const mid = V(0, b + m.height * 0.55, m.z);
      for (const s of [-1, 1]) {
        for (const dz of [-2.4, 0, 2.4]) {
          const z = m.z + dz;
          add(top, V(s * (hullHalfWidth(z) - 0.2), bulwarkTop(z), z));
        }
        add(mid, V(s * (hullHalfWidth(m.z + 1.2) - 0.2), bulwarkTop(m.z + 1.2), m.z + 1.2));
      }
      for (const sl of m.sails) {
        // 帆角吊索
        for (const s of [-1, 1]) add(V(s * (sl.w / 2 + 0.6), b + sl.y + sl.h, m.z - 0.3), V(0, b + sl.y + sl.h + 1.4, m.z));
        add(V(-sl.w / 2, b + sl.y, m.z - 0.5), V(-(hullHalfWidth(m.z) - 0.3), bulwarkTop(m.z) + 0.1, m.z + 2.5));
        add(V(sl.w / 2, b + sl.y, m.z - 0.5), V(hullHalfWidth(m.z) - 0.3, bulwarkTop(m.z) + 0.1, m.z + 2.5));
      }
    }
    // 桅间支索
    const ms = SHIP.masts;
    for (let i = 0; i < ms.length - 1; i++) add(V(0, (ms[i].base || 0) + ms[i].height - 0.6, ms[i].z), V(0, (ms[i + 1].base || 0) + ms[i + 1].height - 0.6, ms[i + 1].z));
    // 船首斜桁支索
    add(V(0, ms[0].height - 0.6, ms[0].z), V(0, 3.2, SHIP.bowZ - 3.5));
    add(V(0, ms[0].height * 0.6, ms[0].z), V(0, 2.6, SHIP.bowZ - 1.5));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(geo, this.mat.rope));
  }

  _buildLanterns() {
    // 8 盏灯笼的铁件合成一个网格、玻璃合成一个网格（省 40 多个 draw call）
    const irons = [], glasses = [];
    const T = (geo, x, y, z, ry = 0) => { if (ry) geo.rotateY(ry); geo.translate(x, y, z); return geo; };
    for (const L of SHIP.lanterns) {
      const s = Math.sign(L.x);
      // 灯框做成四根细柱 + 顶底薄板，玻璃在里面能被看见
      for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) irons.push(T(new THREE.BoxGeometry(0.03, 0.42, 0.03), L.x + dx, L.y, L.z + dz));
      irons.push(T(new THREE.BoxGeometry(0.3, 0.03, 0.3), L.x, L.y - 0.2, L.z));
      irons.push(T(new THREE.ConeGeometry(0.24, 0.16, 6), L.x, L.y + 0.28, L.z));
      irons.push(T(new THREE.TorusGeometry(0.06, 0.015, 6, 12), L.x, L.y + 0.42, L.z));
      irons.push(T(new THREE.BoxGeometry(0.5, 0.06, 0.06), L.x + s * 0.25, L.y + 0.5, L.z));
      irons.push(T(new THREE.BoxGeometry(0.08, 0.9, 0.08), L.x + s * 0.45, L.y + 0.1, L.z));
      glasses.push(T(new THREE.BoxGeometry(0.2, 0.3, 0.2), L.x, L.y, L.z));
    }
    const ironMesh = new THREE.Mesh(mergeGeometries(irons), this.mat.iron); ironMesh.castShadow = true;
    const glassMesh = new THREE.Mesh(mergeGeometries(glasses), this.mat.glass);
    this.group.add(ironMesh, glassMesh);
    this.lanternMeshes.push({ iron: ironMesh, glass: glassMesh });
  }

  _buildWheel() {
    const helm = buildShipHelm(this.mat);
    this.group.add(helm.group);
    this.wheel = helm.wheel;
    this.helmStation = helm;
  }

  _buildBow() {
    // 船首像：一本展开的大书 + 六角星（由 sigil.js 在 (0, 2.2, -30.6) 附一个小印记）
    const z = SHIP.bowZ - 0.2;
    const book = buildBowBook(this.mat);
    book.position.set(0, bulwarkTop(SHIP.bowZ) + 0.3, z);
    book.rotation.x = -0.5;
    this.group.add(book);
    this.bowBook = book;
    // 船首斜桁
    const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 7, 10), this.mat.dark);
    sprit.position.set(0, 2.4, SHIP.bowZ - 2.6);
    sprit.rotation.x = -Math.PI / 2 + 0.28;
    sprit.castShadow = true;
    this.group.add(sprit);
  }

  _buildTelescope() {
    this.telescope = buildShipTelescope(this.mat);
    this.group.add(this.telescope);
  }

  _buildOccluders() {
    // 相机遮挡用的不可见碰撞体（Raycaster 对它们打射线）
    const inv = new THREE.MeshBasicMaterial({ visible: false });
    const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, inv); m.position.set(x, y, z); m.name = 'occluder'; this.group.add(m); this.occluders.push(m); };
    for (const m of SHIP.masts) add(new THREE.CylinderGeometry(m.radius + 0.1, m.radius + 0.1, m.height, 10), 0, (m.base || 0) + m.height / 2, m.z);
    add(new THREE.BoxGeometry(CABIN_HALF * 2, P.height, STAIR_END_Z - P.wallZ), 0, P.height / 2, (P.wallZ + STAIR_END_Z) / 2);
    add(new THREE.BoxGeometry(14, 0.2, SHIP.sternZ - STAIR_END_Z), 0, P.height - 0.1, (STAIR_END_Z + SHIP.sternZ) / 2);
  }

  /**
   * 画质 → 投影体集合。阴影贴图本身在所有画质下都开着（开关它会换 shader 变体、全场景重编 1 s+），
   * 低画质只让「大件」投影（包围球半径 ≥ 1.5 m：船体 / 甲板 / 舷墙 / 舱墙 / 桅 / 帆 / 楼梯），小件（灯笼铁件、桅顶球、舵轮、书、望远镜）不投。
   * 初值记在 userData.castShadow0：旧写法 `o.castShadow !== false` 在切过一次低画质后永远为 false，船体阴影就再也回不来了（P-001 修）。
   */
  setQuality(q) {
    const largeOnly = q === 'low';
    this.group.traverse((o) => {
      if (!o.isMesh || o.name === 'occluder') return;
      if (o.userData.castShadow0 === undefined) o.userData.castShadow0 = o.castShadow && o.userData.noShadow !== true;
      if (!o.userData.castShadow0) { o.castShadow = false; return; }
      if (!largeOnly) { o.castShadow = true; return; }
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius >= 1.5;
    });
  }

  update(dt) {
    this.time += dt;
    if (!this.reducedMotion) {
      // 船体缓摇：横摇 ±0.4° / 12 s，纵摇 ±0.25° / 9 s
      this.group.rotation.z = (0.4 * Math.PI / 180) * Math.sin(this.time * Math.PI * 2 / 12);
      this.group.rotation.x = (0.25 * Math.PI / 180) * Math.sin(this.time * Math.PI * 2 / 9 + 1.3);
      this._deformSails(this.time); // 每帧更新（之前隔帧更新，帆看着一颤一颤）
      if (this.wheel) this.wheel.rotation.z = Math.sin(this.time * 0.35) * 0.25;
    }
  }
}
