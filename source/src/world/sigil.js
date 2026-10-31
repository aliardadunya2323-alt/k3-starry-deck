// 印记：SVGLoader 读 assets/sigil.svg（B 原创，与纯净流同一张）→ 描边 → 网格 → 发光材质。
// sigil.svg 里全是 stroke 线（circle / path），只有 7 个小圆点是 fill，所以走 pointsToStroke，fill 走 createShapes。
// 同一份 SVG 数据被大印记（直径 14 m，悬浮）与三扇门上的小印记（直径 0.9 m，线加粗）复用。
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, SHIP, LINKS } from '../config.js';
import { lerp, damp, rng } from '../util/easing.js';
import { softDot } from './textures.js';

const SVG_SIZE = 300;      // sigil.svg viewBox
const SVG_OUTER_R = 141;   // 最外圈半径 → 直径 282 单位

function stripAttrs(g) { const c = g.clone(); c.deleteAttribute('normal'); c.deleteAttribute('uv'); return c; }

export class SigilFactory {
  /**
   * @param paths SVGLoader 解析出的 paths
   * @param opts  { size, outerR, splitRadius, strokeMax }（H-3 · 2026-09-07 加，默认值 = 原 sigil.svg 行为）
   *   size / outerR：viewBox 边长与「外圈半径」（make 的 diameter 对应 2·outerR 个 SVG 单位）
   *   splitRadius：> 0 时把离中心 ≥ 该半径的子路径归入「外环」（随 spinSpeed 转），其余归「中央」（保持正立）——门徽用
   *   strokeMax：描边宽度上限（SVG 单位，乘倍率之后），细密图形用来防止粗线糊成一团
   */
  constructor(paths, { size = SVG_SIZE, outerR = SVG_OUTER_R, splitRadius = 0, strokeMax = Infinity, diameterScale = 1, strokeMulScale = 1, mirror = false, splitByGroup = false } = {}) {
    this.paths = paths;
    this.splitByGroup = splitByGroup;
    this.size = size; this.outerR = outerR; this.splitRadius = splitRadius; this.strokeMax = strokeMax;
    // 走 door.js deps.emblems 正式接口时，Door 用的是给六角星调的参数（直径 0.92 / 描边 4.2）；门徽工厂用这三个把它换算成自己的档，
    // 并把几何绕 y 转 π（印记朝 +z、门外在 −z，不翻书卷 / 罗盘就是镜像）
    this.diameterScale = diameterScale; this.strokeMulScale = strokeMulScale; this.mirror = mirror;
    this.cache = new Map();
  }

  /** 按描边倍率生成（并缓存）几何：{ stroke, fill, strokeStill, fillStill }（后两项只在 splitRadius > 0 时非空） */
  geometry(strokeMul = 1.35) {
    const key = strokeMul.toFixed(2);
    if (this.cache.has(key)) return this.cache.get(key);
    const strokes = [], fills = [], strokesStill = [], fillsStill = [];
    const c = this.size / 2, split = this.splitRadius;
    const isRing = (pts) => { if (!split) return true; let m = Infinity; for (const p of pts) m = Math.min(m, Math.hypot(p.x - c, p.y - c)); return m >= split; };
    for (const path of this.paths) {
      const style = path.userData.style;
      const role = this.splitByGroup ? path.userData.node?.closest('g[id="ring"], g[id="core"]')?.id : null;
      const belongsToRing = pts => role === 'ring' ? true : role === 'core' ? false : isRing(pts);
      if (style.stroke && style.stroke !== 'none') {
        // 圆用 18 段、直线不细分；miter/butt 比 round 少一半以上三角面（round 在每个点上生成扇形）
        const st = { ...style, strokeWidth: Math.min(Math.max(style.strokeWidth || 1, 0.9) * strokeMul, this.strokeMax), strokeLineJoin: 'miter', strokeLineCap: 'butt' };
        for (const sub of path.subPaths) {
          const pts = sub.getPoints(18);
          const g = SVGLoader.pointsToStroke(pts, st, 2, 0.5);
          if (g) (belongsToRing(pts) ? strokes : strokesStill).push(stripAttrs(g));
        }
      }
      if (style.fill && style.fill !== 'none') {
        for (const shape of path.toShapes(true)) (belongsToRing(shape.getPoints(6)) ? fills : fillsStill).push(stripAttrs(new THREE.ShapeGeometry(shape, 12)));
      }
    }
    const center = (list) => { if (!list.length) return null; const g = mergeGeometries(list, false); g.translate(-c, -c, 0); return g; };
    const out = { stroke: center(strokes), fill: center(fills), strokeStill: center(strokesStill), fillStill: center(fillsStill) };
    this.cache.set(key, out);
    return out;
  }

  make({ diameter = 1, color = COLORS.bright, dotColor = COLORS.magic, opacity = 1, glow = 1, strokeMul = 1.35 } = {}) {
    const inst = new SigilInstance(this.geometry(strokeMul * this.strokeMulScale), { diameter: diameter * this.diameterScale, color, dotColor, opacity, glow, outerR: this.outerR });
    if (this.mirror) inst.group.rotation.y = Math.PI;
    return inst;
  }
}

export class SigilInstance {
  constructor(geo, { diameter, color, dotColor, opacity, glow, outerR = SVG_OUTER_R }) {
    this.group = new THREE.Group();
    this.baseColor = new THREE.Color(color);
    this.baseDot = new THREE.Color(dotColor);
    this.strokeMat = new THREE.MeshBasicMaterial({ color: this.baseColor.clone(), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.dotMat = new THREE.MeshBasicMaterial({ color: this.baseDot.clone(), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false });
    // 印记在 XY 平面、朝 +Z、中心在原点、单位直径 = diameter（SVG y 向下 → 翻转）
    const s = diameter / (outerR * 2);
    this.inner = new THREE.Group();            // 随 spinSpeed 自转的部分（无分离时 = 全部）
    this.inner.scale.set(s, -s, s);
    if (geo.stroke) { this.stroke = new THREE.Mesh(geo.stroke, this.strokeMat); this.inner.add(this.stroke); }
    if (geo.fill) { this.dots = new THREE.Mesh(geo.fill, this.dotMat); this.inner.add(this.dots); }
    this.group.add(this.inner);
    if (geo.strokeStill || geo.fillStill) {   // 中央正立部分（门徽的图形）
      this.still = new THREE.Group();
      this.still.scale.set(s, -s, s);
      if (geo.strokeStill) this.still.add(new THREE.Mesh(geo.strokeStill, this.strokeMat));
      if (geo.fillStill) this.still.add(new THREE.Mesh(geo.fillStill, this.dotMat));
      this.group.add(this.still);
    }
    this.glow = glow;
    this.targetGlow = glow;
    this.spinSpeed = 0; // rad/s
    this.setGlow(glow);
  }

  setGlow(g) {
    this.glow = g;
    this.strokeMat.color.copy(this.baseColor).multiplyScalar(g);
    this.dotMat.color.copy(this.baseDot).multiplyScalar(Math.max(0.6, g));
  }
  setOpacity(o) { this.strokeMat.opacity = o; this.dotMat.opacity = o; }

  /** 每帧：glow 向 targetGlow 以 rate 逼近；自转 */
  update(dt, rate = 6) {
    if (Math.abs(this.targetGlow - this.glow) > 1e-3) this.setGlow(lerp(this.glow, this.targetGlow, damp(rate, dt)));
    if (this.spinSpeed) this.inner.rotation.z += this.spinSpeed * dt;
  }
}

/** 读印记：有内嵌文本（离线单文件包）就直接 parse，否则 fetch（http 模式） */
export function loadSigil(url = 'assets/sigil.svg', inlineText = null) {
  if (inlineText) return Promise.resolve(new SigilFactory(new SVGLoader().parse(inlineText).paths));
  return new Promise((resolve, reject) => {
    new SVGLoader().load(url, (data) => resolve(new SigilFactory(data.paths)), undefined, (err) => reject(err));
  });
}

/** 悬浮大印记：(0,26,−8) 直径 14，缓慢自转，面向相机（魔法印记「留在屏幕上」），宇宙视角下变亮变实；点击 → 门户。 */
export class BigSigil {
  constructor(factory, { reducedMotion = false } = {}) {
    const B = SHIP.bigSigil;
    this.inst = factory.make({ diameter: B.diameter, color: COLORS.bright, dotColor: COLORS.magic, opacity: 0.35, glow: 1.15, strokeMul: 1.6 });
    this.group = this.inst.group;
    this.group.position.set(B.x, B.y, B.z);
    this.inst.spinSpeed = reducedMotion ? 0 : Math.PI * 2 / B.turnSeconds;
    const ringGeo = new THREE.RingGeometry(B.diameter / 2 * 1.04, B.diameter / 2 * 1.06, 96);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.group.add(this.ring);
    // D-075：印记背后一张巨大的金色星网（门户 hero-painting 里桅杆后那张蛛网状法阵）：8 圈同心环 + 18 根辐线 + 环间锯齿丝 + 交点亮珠
    this.web = this._buildWeb(B.diameter * 1.9);
    this.web.position.z = -0.6;
    this.group.add(this.web);
    this.hit = new THREE.Mesh(new THREE.CircleGeometry(B.diameter / 2 * 1.05, 24), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.name = 'bigSigilHit';
    this.group.add(this.hit);
    this.universeBlend = 0;
    this.hover = 0;
    this.target = LINKS.portal;
  }

  _buildWeb(diameter) {
    const R = diameter / 2, rings = 8, spokes = 18;
    const seg = [], nodes = [];
    const rr = (k) => R * (0.18 + 0.82 * Math.pow(k / rings, 1.15));
    const rand = rng(31);
    // 每根辐线在每圈的交点略微偏离正圆（蛛网的手工感）
    const pt = (k, s) => { const a = (s / spokes) * Math.PI * 2 + (k % 2) * 0.03; const r = rr(k) * (1 + (rand() - 0.5) * 0.05); return [Math.cos(a) * r, Math.sin(a) * r]; };
    const grid = [];
    for (let k = 1; k <= rings; k++) { grid[k] = []; for (let s = 0; s < spokes; s++) grid[k][s] = pt(k, s); }
    for (let k = 1; k <= rings; k++) for (let s = 0; s < spokes; s++) {
      const a = grid[k][s], b = grid[k][(s + 1) % spokes];
      // 环：两交点之间不是直线，往内微凹（蛛网的丝是垂的）
      const mx = (a[0] + b[0]) / 2 * 0.985, my = (a[1] + b[1]) / 2 * 0.985;
      seg.push(a[0], a[1], 0, mx, my, 0, mx, my, 0, b[0], b[1], 0);
      if (k < rings) { const c = grid[k + 1][s]; seg.push(a[0], a[1], 0, c[0], c[1], 0); } // 辐线
      else { const a2 = a[0] * 1.06, b2 = a[1] * 1.06; seg.push(a[0], a[1], 0, a2, b2, 0); }
      if (k > 1 && (s + k) % 3 === 0) { const c = grid[k - 1][(s + 1) % spokes]; seg.push(a[0], a[1], 0, c[0], c[1], 0); } // 少量斜丝
      nodes.push(a[0], a[1], 0.01);
    }
    // 中心到第一圈的辐线
    for (let s = 0; s < spokes; s += 2) { const a = grid[1][s]; seg.push(0, 0, 0, a[0], a[1], 0); }
    const g = new THREE.Group();
    const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.webLineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.gold).multiplyScalar(1.3), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const lines = new THREE.LineSegments(lineGeo, this.webLineMat); lines.frustumCulled = false; g.add(lines);
    const nodeGeo = new THREE.BufferGeometry(); nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodes, 3));
    this.webDotMat = new THREE.PointsMaterial({ map: softDot(32), color: new THREE.Color(COLORS.flare).multiplyScalar(1.4), size: R * 0.028, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const dots = new THREE.Points(nodeGeo, this.webDotMat); dots.frustumCulled = false; g.add(dots);
    return g;
  }

  /** t: 0 甲板 → 1 宇宙 */
  setUniverseBlend(t) { this.universeBlend = t; }
  setStarryPresentation(enabled) { this.starryPresentation = !!enabled; }
  setHover(h) { this.hover = h ? 1 : 0; }

  update(dt, camera) {
    this.group.quaternion.copy(camera.quaternion);
    // Parent vessel now has a heading; billboard quaternion must remain world-facing.
    if (this.group.parent) this.group.quaternion.premultiply(this.group.parent.getWorldQuaternion(this._parentQ || (this._parentQ = new THREE.Quaternion())).invert());
    const t = this.universeBlend;
    // Keep the original portal disc and hover response, with the outer web as
    // a quieter backdrop to the ship. Compute from base values every frame.
    const night = this.starryPresentation;
    this.inst.setOpacity(lerp(0.35, 0.95, t) * (night ? .80 : 1));
    this.inst.targetGlow = lerp(1.15, 2.1, t) + this.hover * 0.6;
    this.inst.update(dt, 4);
    this.ring.material.opacity = lerp(0.18, 0.5, t) * (night ? .64 : 1) + this.hover * 0.3;
    this.webLineMat.opacity = lerp(0.2, 0.42, t) * (night ? .34 : 1) + this.hover * 0.15;
    this.webDotMat.opacity = lerp(0.35, 0.7, t) * (night ? .45 : 1);
    this.web.rotation.z -= dt * 0.012;
  }
}
