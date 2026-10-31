// 光：Hemisphere 低环境 + 一盏银河方向光（唯一阴影光，只照船）+ 点光池（8 灯笼 + 3 门灯 + 舵灯 + 船尾灯共 13 个候选位，
// 只让离人物最近的 POOL 盏真正存在——点光数量在所有画质下都固定，避免 three.js 因灯数变化重编 shader）。
// 全场景点光恒为 9 盏：池 4 + 门缝 / 门厅 2（main.js）+ 法杖 1（character.js）+ 共享特效灯位 2（skills.js 的 FxLight）。
// 其中 8 盏挂在船组 / 船上天空组下，登岛时这些组整体隐藏，three.js 只数可见的灯——岛上会只剩法杖 1 盏、所有材质重编（落岛那帧约 1 s）。
// 所以 LightRig 每次渲染前补上同数量的零强度占位灯，可见点光总数在海上、岛上、各世界都保持 POINT_LIGHTS。
import * as THREE from 'three';
import { COLORS, SHIP } from '../config.js';
import { DOOR_XS } from './ship.js';

/** 点光池大小（三档相同：改它 = 改 NUM_POINT_LIGHTS = 全场景重编，所以不随画质变） */
export const POOL = 4;

/** 全场景可见点光数（占位灯补齐到这个数；新增真点光要同时改它，否则多出来的那盏照样触发全场景重编） */
export const POINT_LIGHTS = 9;

/**
 * 共享特效灯位：多个特效（闪电冲刺 / 魔法阵 / 变身；玫瑰 / 大招）同一帧各报一次需求，取最亮的那盏真正点亮。
 * 这样灯的数量恒定（不触发 shader 重编），代价是同时发生的特效只有最亮的一个真的照亮周围——实际几乎不同时发生。
 * 用法：每帧 `request(pos, color, intensity, distance, decay)` 任意次，最后 `apply()` 一次；不 request 的帧灯就是灭的。
 */
export class FxLight {
  constructor(parent, { distance = 10, decay = 2 } = {}) {
    this.light = new THREE.PointLight(0xffffff, 0, distance, decay);
    parent.add(this.light);
    this._pos = new THREE.Vector3();
    this._color = new THREE.Color();
    this._intensity = 0; this._distance = distance; this._decay = decay;
  }
  request(pos, color, intensity, distance, decay = 2) {
    if (!(intensity > this._intensity)) return;
    this._intensity = intensity; this._pos.copy(pos); this._color.set(color); this._distance = distance; this._decay = decay;
  }
  apply() {
    const L = this.light;
    if (this._intensity > 0) { L.position.copy(this._pos); L.color.copy(this._color); L.distance = this._distance; L.decay = this._decay; L.intensity = this._intensity; }
    else L.intensity = 0;
    this._intensity = 0;
  }
}

export class LightRig {
  constructor(scene, shipGroup, { quality = 'high' } = {}) {
    this.scene = scene;
    this.ship = shipGroup;
    this.time = 0;
    // 冷色天空 / 暖色甲板的柔和反照；保持灯数、强度曲线与点光池不变。
    // 旧天空色的线性亮度过低，背光木面与金属成为纯黑，灯芯却过曝。
    this.hemi = new THREE.HemisphereLight(0x435575, 0x49372a, 0.85);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(COLORS.starlight, 1.1);
    this.sun.position.set(-40, 60, 45); // 左上后方（银河方向）
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 34; sc.bottom = -34; sc.near = 20; sc.far = 160;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    // 放在世界空间（不跟船摇）：阴影相机若随船每帧微动，阴影贴图像素会逐帧重采样 → 走路时阴影边缘一颤一颤（主人 09-07 反馈）
    scene.add(this.sun, this.sun.target);

    // 候选灯位（船局部坐标）
    this.candidates = [
      ...SHIP.lanterns.map((l) => ({ pos: new THREE.Vector3(l.x, l.y, l.z), color: COLORS.lantern, intensity: 3.2, distance: 12, phase: Math.random() * 6, k: 1.3 + Math.random() * 1.2 })),
      ...DOOR_XS.map((x) => ({ pos: new THREE.Vector3(x, 2.75, SHIP.poop.wallZ - 0.35), color: COLORS.lantern, intensity: 2.4, distance: 7, phase: Math.random() * 6, k: 1.1 + Math.random() })),
      { pos: new THREE.Vector3(0, SHIP.poop.height + 2.2, SHIP.wheel.z + 1.2), color: COLORS.lantern, intensity: 1.6, distance: 7, phase: 1, k: 1.5 },
      { pos: new THREE.Vector3(0, 3.6, SHIP.sternZ + 0.2), color: COLORS.lantern, intensity: 2.0, distance: 9, phase: 2, k: 1.2 },
    ];
    this.poolSize = POOL;
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const L = new THREE.PointLight(COLORS.lantern, 0, 9, 2);
      shipGroup.add(L);
      this.pool.push({ light: L, cand: null, fade: 0 }); // fade 0..1 淡入淡出，避免灯位切换时「跳」
    }
    this._focus = new THREE.Vector3();
    // 占位灯直接挂场景根（永不隐藏）；渲染前 three.js 先调 scene.onBeforeRender 再收集灯，这里补齐数量正好赶上这一帧。
    this.fill = new THREE.Group(); this.fill.name = 'point-light-fill'; scene.add(this.fill);
    this.fillLights = [];
    for (let i = 0; i < POINT_LIGHTS; i++) { const L = new THREE.PointLight(0x000000, 0, 0.01, 2); L.visible = false; this.fill.add(L); this.fillLights.push(L); }
    this._tracked = null; this._trackCalls = 0;
    const before = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => { this.keepPointLightCount(); before.apply(scene, args); };
    this.setQuality(quality);
  }

  /** 数一遍当前真正会被渲染的点光（自身和所有祖先都可见、且挂在场景上），不足 POINT_LIGHTS 的用占位灯补上 */
  keepPointLightCount() {
    // 别的模块的灯在 LightRig 之后才建，所以第一次用到时再收集，之后隔一阵重收一次（灯被换父节点也照样算对）
    if (!this._tracked || ++this._trackCalls % 240 === 0) { const list = []; this.scene.traverse((o) => { if (o.isPointLight && o.parent !== this.fill) list.push(o); }); this._tracked = list; }
    let shown = 0;
    for (const L of this._tracked) { for (let o = L; o; o = o.parent) { if (!o.visible) break; if (o === this.scene) { shown++; break; } } }
    const need = POINT_LIGHTS - shown;
    for (let i = 0; i < this.fillLights.length; i++) this.fillLights[i].visible = i < need;
  }

  /** 画质只改阴影贴图尺寸（2048 / 1024 / 512）。阴影开关与灯数不随画质变——那两样会换 shader 变体、全场景重编。 */
  setQuality(q) {
    const size = q === 'low' ? 512 : q === 'medium' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  /** 宇宙视角下给整船补一层「银河背光」，否则船体在远处是一团黑 */
  setUniverseBlend(t) {
    this.sun.intensity = 1.1 + 1.6 * t;
    this.hemi.intensity = 0.85 + 0.9 * t;
  }

  /** focus: 船局部坐标里的关注点（人物 / 相机目标） */
  update(dt, focusLocal) {
    this.time += dt;
    this._focus.copy(focusLocal);
    // 每 6 帧重算一次「最近的 N 盏」（人一帧走不了 2 cm，没必要每帧排序）；淡入淡出仍每帧算
    this._tick = (this._tick || 0) + 1;
    if (!this._sorted || this._tick % 6 === 1) {
      for (const c of this.candidates) c._d = c.pos.distanceToSquared(this._focus);
      this._sorted = this.candidates.slice().sort((a, b) => a._d - b._d).slice(0, this.poolSize);
      for (const c of this.candidates) c._wanted = false;
      for (const c of this._sorted) c._wanted = true;
    }
    const sorted = this._sorted;
    const n = Math.min(this.poolSize, this.pool.length);
    // 1. 不在目标集合里的灯淡出；淡完释放
    for (let i = 0; i < n; i++) {
      const slot = this.pool[i];
      if (slot.cand && !slot.cand._wanted) {
        slot.fade = Math.max(0, slot.fade - dt * 2.5);
        if (slot.fade === 0) slot.cand = null;
      }
    }
    // 2. 目标集合里没被持有的候选 → 分给空槽
    for (const c of sorted) {
      let held = false;
      for (let i = 0; i < n; i++) if (this.pool[i].cand === c) { held = true; break; }
      if (held) continue;
      let slot = null;
      for (let i = 0; i < n; i++) if (this.pool[i].cand === null) { slot = this.pool[i]; break; }
      if (!slot) break;
      slot.cand = c; slot.fade = 0;
    }
    // 3. 写入
    for (let i = 0; i < n; i++) {
      const slot = this.pool[i];
      const L = slot.light;
      const c = slot.cand;
      if (!c) { L.intensity = 0; continue; }
      if (c._wanted) slot.fade = Math.min(1, slot.fade + dt * 2.5);
      L.position.copy(c.pos);
      L.color.set(c.color);
      L.distance = c.distance;
      const flicker = 1 + 0.08 * Math.sin(this.time * c.k + c.phase) + 0.03 * Math.sin(this.time * c.k * 3.7 + c.phase);
      L.intensity = c.intensity * flicker * slot.fade;
    }
    // 预编译（renderer.compile 按场景当前可见的灯编）可能落在两次渲染之间，这里也补一次
    this.keepPointLightCount();
  }
}
