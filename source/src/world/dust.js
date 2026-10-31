// 甲板浮尘（08 规划 §六 A.4「粒子与空气」第一件 · X-003 · 2026-09-09 · 窗口 X）
// 200 粒极慢漂的尘埃，**只在灯笼的光里亮起来**：每粒的顶点色按它到 8 盏舷墙灯笼 + 3 盏门灯的距离算亮度——
// 灯下一小团金色微尘慢慢翻，暗处几乎看不见（A0：「灯多」的感觉靠假光，不加灯）。
// 材质 = PointsMaterial({ map: softDot, vertexColors, additive, depthWrite: false })，与 rose.js 花瓣雨同一个 shader 变体（花瓣雨启动时就在场景里）
//   → 0 新程序、0 灯、1 个 draw call、0 三角（点精灵）。挂 ship.group 随船摇；宇宙视角随 universeBlend 淡出；低画质隐藏。
// update 零分配：位置 / 颜色都写回同一个 Float32Array（200 × 11 次距离 ≈ 0.03 ms）。
import * as THREE from 'three';
import { SHIP } from '../config.js';
import { softDot } from './textures.js';
import { hullHalfWidth, DOOR_XS } from './ship.js';

// 光源位置（船局部）：8 盏舷墙灯笼（lights.js 候选灯同源）+ 3 盏门灯（DOOR_XS，wallZ − 0.35，高 2.75）
const LAMPS = [
  ...SHIP.lanterns.map((l) => [l.x, l.y, l.z]),
  ...DOOR_XS.map((x) => [x, 2.75, SHIP.poop.wallZ - 0.35]),
];
const LAMP_R = 2.6;          // 亮度半衰距离（m）：灯下 1 m 内接近满亮，4 m 外只剩底色
const BASE_GLOW = 0.10;      // 暗处底色（几乎看不见，但不至于凭空消失）
const WARM = [1.25, 1.03, 0.66]; // 香槟金（A0 #C6A56B）× 1.6：加法点精灵本来就只有几个像素，色值 > 1 让灯下那几粒真能亮起来

export class DeckDust {
  /**
   * @param {THREE.Object3D} parent 一般是 ship.group（随船摇）
   * @param {{ count?: number, quality?: string, reducedMotion?: boolean, seed?: number }} o
   */
  constructor(parent, { count = 200, quality = 'high', reducedMotion = false, seed = 1 } = {}) {
    this.count = count;
    this.reducedMotion = reducedMotion;
    this.t = 0;
    this.blend = 0;
    this.quality = quality;
    // 可复现的随机（mulberry32，与 util/easing.js rng 同式，避免再 import 一层）
    let a = seed >>> 0;
    const R = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = count;
    this.base = new Float32Array(n * 3);   // 每粒的家（漂动中心）
    this.seed = new Float32Array(n * 4);   // φ1 φ2 频率 大小权重
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const P = SHIP.poop;
    for (let i = 0; i < n; i++) {
      let x, y, z;
      if (i < n * 0.6) {
        // 六成撒在灯周围（半径 2.2 m 球，略偏灯下方）：灯光里的尘才看得见，均匀撒满甲板大半浪费在黑处
        const lp = LAMPS[Math.floor(R() * LAMPS.length)];
        const u = R() * 6.283, v = Math.acos(2 * R() - 1), rr = 2.2 * Math.cbrt(R());
        x = lp[0] + rr * Math.sin(v) * Math.cos(u); z = lp[2] + rr * Math.sin(v) * Math.sin(u); y = lp[1] + rr * Math.cos(v) * 0.8 - 0.3;
        const w = Math.max(0.8, hullHalfWidth(z) - 0.5); x = Math.max(-w, Math.min(w, x));
        const floor = z > SHIP.poop.wallZ ? P.height : 0; y = Math.max(floor + 0.15, Math.min(floor + 3.4, y));
      } else {
        // 四成均匀：3/4 主甲板（z bowZ+3 … wallZ−1，y 0.15–3.4），1/4 船尾楼甲板（z wallZ+0.5 … sternZ−1，y 高出 P.height）
        const poop = R() < 0.25;
        z = poop ? SHIP.poop.wallZ + 0.5 + R() * (SHIP.sternZ - 1 - SHIP.poop.wallZ - 0.5) : SHIP.bowZ + 3 + R() * (SHIP.poop.wallZ - 1 - SHIP.bowZ - 3);
        const w = Math.max(0.8, hullHalfWidth(z) - 0.8);
        x = (R() * 2 - 1) * w;
        y = (poop ? P.height : 0) + 0.15 + R() * 3.25;
      }
      this.base[i * 3] = x; this.base[i * 3 + 1] = y; this.base[i * 3 + 2] = z;
      this.seed[i * 4] = R() * 6.283; this.seed[i * 4 + 1] = R() * 6.283; this.seed[i * 4 + 2] = 0.6 + R() * 0.8; this.seed[i * 4 + 3] = 0.55 + R() * 0.45;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3); this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(col, 3); this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    // 包围球手写：盖住整条船的甲板上空（点会漂，不每帧重算）
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, (SHIP.bowZ + SHIP.sternZ) / 2), (SHIP.sternZ - SHIP.bowZ) / 2 + 6);
    // 与 rose.js 花瓣雨同参数集（map + vertexColors + additive + sizeAttenuation），共用 shader 变体
    this.material = new THREE.PointsMaterial({ map: softDot(64), vertexColors: true, size: 0.085, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.baseOpacity = 0.7;
    this.enabled = true;
    this.points = new THREE.Points(geo, this.material);
    this.points.name = 'deckDust';
    this.points.frustumCulled = true;
    this.points.renderOrder = 2; // 在甲板 / 假光 decal 之后画，加法叠上去
    parent.add(this.points);
    this.setQuality(quality);
    this.update(0, 0);
  }

  setQuality(q) {
    this.quality = q;
    this.points.visible = this.enabled !== false && q !== 'low' && this.blend < 0.98;
  }

  /** QA / 菜单开关：update 每帧会按 quality / blend 重算 visible，外部想关请走这里而不是直接改 points.visible */
  setEnabled(v) { this.enabled = !!v; this.setQuality(this.quality); }

  /** @param {number} dt @param {number} universeBlend 0 甲板 → 1 宇宙视角（远看是几颗噪点，直接淡掉） */
  update(dt, universeBlend = 0) {
    this.blend = universeBlend;
    this.material.opacity = this.baseOpacity * (1 - universeBlend);
    this.points.visible = this.enabled !== false && this.quality !== 'low' && universeBlend < 0.98;
    if (!this.points.visible) return;
    this.t += dt * (this.reducedMotion ? 0.5 : 1);
    const t = this.t, n = this.count;
    const pos = this.posAttr.array, col = this.colAttr.array, B = this.base, S = this.seed;
    const r2 = LAMP_R * LAMP_R;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, i4 = i * 4;
      const p1 = S[i4], p2 = S[i4 + 1], f = S[i4 + 2], k = S[i4 + 3];
      // 三轴慢游走（幅度 0.45 / 0.35 / 0.45 m，周期十几秒），像室内无风时的灰尘
      const x = B[i3] + 0.45 * Math.sin(t * 0.21 * f + p1) + 0.12 * Math.sin(t * 0.9 * f + p2);
      const y = B[i3 + 1] + 0.35 * Math.sin(t * 0.17 * f + p2);
      const z = B[i3 + 2] + 0.45 * Math.cos(t * 0.19 * f + p1 * 0.7);
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
      // 亮度 = 底色 + Σ 灯（1 / (1 + d²/R²)），再乘每粒权重与慢闪
      let g = 0;
      for (let L = 0; L < LAMPS.length; L++) {
        const lp = LAMPS[L];
        const dx = x - lp[0], dy = y - lp[1], dz = z - lp[2];
        g += 1 / (1 + (dx * dx + dy * dy + dz * dz) / r2);
      }
      let b = BASE_GLOW + Math.min(1, g) * 0.9;
      b *= k * (0.72 + 0.28 * Math.sin(t * 1.9 * f + p2));
      col[i3] = WARM[0] * b; col[i3 + 1] = WARM[1] * b; col[i3 + 2] = WARM[2] * b;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  /** QA 用 */
  stats() { return { count: this.count, enabled: this.enabled, visible: this.points.visible, opacity: +this.material.opacity.toFixed(3), size: this.material.size, lamps: LAMPS.length }; }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
