// 技能：F 挥杖（青光弧）、1 闪电折线冲刺、2 原地暗金六边形魔法阵、3 天上的紫金玫瑰（开 / 谢）、4 大招玫瑰大阵。
// 性能纪律（P-001，2026-09-07）：
//   · 特效材质全部常驻、只隐藏不 dispose。three.js 的 shader program 挂在材质上、材质 dispose 才释放；
//     以前每次施放建一套材质、用完 dispose，等于每次都现场重编 shader（实测挥杖 10 ms、闪电 15 ms、玫瑰 580 ms、大招 430 ms 的卡顿都来自这里）。
//   · 特效对象走对象池（arc / bolt / hex），几何预分配 + setDrawRange，不再每次 new 几何；
//   · 大招的 10 朵玫瑰、光束网、超大法阵整套预建一次（main.js 在就绪后调 prebuild()）反复用，10 朵共享同一套花瓣材质；
//   · 灯只有两盏共享灯位（FxLight：近身 = 冲刺 / 魔法阵 / 变身，天空 = 玫瑰 / 大招），数量恒定 → 不触发 shader 重编。
import * as THREE from 'three';
import { COLORS, PLAYER } from '../config.js';
import { softDot } from '../world/textures.js';
import { SkyRose } from '../world/rose.js';
import { FxLight } from '../world/lights.js';
import { clamp, lerp, easeOutCubic, rng } from '../util/easing.js';

const DASH_DIST = 6.5, DASH_TIME = 0.14, DASH_CD = 1.2;
const HEX_CD = 2.0, HEX_LIFE = 7.0, HEX_MAX = 3, HEX_R = 1.6;
const SWING_CD = 0.35;
const BOLT_SEGS = 14, BOLT_FORKS = 3, BOLT_FORK_SEGS = 3;
const BOLT_LINE_VERTS = (BOLT_SEGS + BOLT_FORKS * BOLT_FORK_SEGS) * 2; // 46，固定
const BOLT_MAX_DOTS = 400;
const ULT_LIGHT_POS = new THREE.Vector3(0, 26, 0);
const _v = new THREE.Vector3(), _q = new THREE.Vector3();

export class Skills {
  constructor({ scene, shipGroup, wanderer, controller, collider, camera, camRig, sigilFactory, reducedMotion = false }) {
    this.scene = scene; this.ship = shipGroup; this.w = wanderer; this.ctl = controller; this.collider = collider;
    this.camera = camera; this.camRig = camRig; this.sigilFactory = sigilFactory; this.reducedMotion = reducedMotion;
    this.cool = { dash: 0, hex: 0, swing: 0, rose: 0, ult: 0, rift: 0, wings: 0 };
    this.cat = null;         // main.js 就绪后塞进来：6 技能（黑洞）要带猫一起进出
    this.rift = null;        // 6 技能状态
    this.wings = null;       // 7 技能状态（W-004）：{ t, phase: 'unfold' | 'fly' | 'fold', k }
    this.wingsRig = null; this.stoneRig = null; this.stoneFx = null; this.descend = null;
    this.cooldownScale = 1;  // 设置里可调：1 正常 / 0.5 一半 / 0.2 极短 / 0 无冷却
    this.effects = [];       // { update(dt) → false 时回收, dispose() }
    this.hexes = [];
    this.dot = softDot(64);
    this.listeners = new Map();
    // 两盏共享特效灯位（近身：船局部坐标；天空：世界坐标）
    this.fxNear = new FxLight(shipGroup, { distance: 14, decay: 2 });
    this.fxSky = new FxLight(scene, { distance: 260, decay: 1 });
    // 玫瑰的光不再是真灯：SkyRose 只往这个代理对象写 position / intensity，update() 里转给 fxSky
    this._roseGlow = { position: new THREE.Vector3(), intensity: 0 };
    // 3 技能的单朵要明显比大阵里的（scale 5.2）大：scale 12，放远一点免得花瓣扫到船尾楼（主人 09-07）
    this.rose = new SkyRose(scene, { light: this._roseGlow, reducedMotion, scale: 12, position: [8, 44, 76] });
    this.ult = null;         // 大招状态
    this.ultRig = null;      // 大招预建的对象（prebuild / 首次施放时建）
    this._ultBuild = null; this._ultBuildRunning = false; this._ultBuildError = null;
    this._fovPunch = 0;
    this._baseFov = camera.fov;
    this._dash = null;
    // 对象池：材质常驻。先各建一个（隐藏）让启动预编译把它们的 shader 一起编了
    this.pools = { arc: [this._buildArc()], bolt: [this._buildBolt()], hex: [this._buildHex()] };
    this.setStill(reducedMotion);
  }

  // Apply both startup and live menu intent to active effects and reusable pools.
  // Skill clocks, collisions, input, and essential appearance/exit transitions keep running.
  setStill(value) {
    this.reducedMotion = !!value;
    this.rose.setStill(this.reducedMotion);
    for (const h of [...this.hexes, ...this.pools.hex]) h.sigil.spinSpeed = this.reducedMotion ? 0 : -0.5;
    if (this.ultRig) {
      this.ultRig.bigSig.spinSpeed = this.reducedMotion ? 0 : -0.06;
      for (const r of this.ultRig.roses) r.rose.setStill(this.reducedMotion);
    }
    if (this.reducedMotion && (this._fovPunch > 0 || this.ult?.phase === 'teleport')) {
      this._fovPunch = 0;
      this.camera.fov = this._baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  on(evt, fn) { (this.listeners.get(evt) || this.listeners.set(evt, []).get(evt)).push(fn); return this; }
  emit(evt, data) { for (const fn of this.listeners.get(evt) || []) fn(data); }

  get canAct() { return !this.ctl.locked && !this.ctl._scripted && !this._dash && !this.rift; }
  /** 6 技能进行中（人在黑洞里 / 正在进出）：其他技能与推门都不该响应 */
  get riftActive() { return !!this.rift; }
  /** 7 技能：正在飞 */
  get flying() { return !!this.ctl.fly; }
  /** 猫的临时目标点（人进洞后猫直奔洞口）；null = 正常跟随。main.js 每帧传给 cat.update */
  get catGoal() { const S = this.rift; return S && !S.catIn && (S.phase === 'enter' || S.phase === 'ghost') && !this.w.root.visible ? S.hole : null; }
  static BASE_CD = { dash: DASH_CD, hex: HEX_CD, swing: SWING_CD, rose: 0.8, ult: 15, rift: 6, wings: 0.8 };
  /** 按设置缩放后的冷却秒数 */
  cd(id) { return Skills.BASE_CD[id] * this.cooldownScale; }
  cooldownFraction(id) { const max = this.cd(id); return max <= 0 ? 0 : clamp(this.cool[id] / max, 0, 1); }
  setCooldownScale(s) { this.cooldownScale = Math.max(0, s); for (const k of Object.keys(this.cool)) this.cool[k] = Math.min(this.cool[k], this.cd(k)); }

  /**
   * 就绪后由 main.js 调用：预建大招整套（10 朵玫瑰 / 光束 / 法阵，隐藏），返回需要预编译的根对象。
   * 这样第一次按 4 不再现场建几何 + 编 shader（实测 430 ms）。在此之前按 4 也能用，只是走同步建（老路）。
   */
  prebuild() {
    const rig = this._ensureUlt();
    const roots = [rig.sig, rig.flash, ...rig.roses.map((r) => r.rose.group)];
    for (const b of [...rig.beams, ...rig.spokes]) roots.push(b.line, b.points);
    // 6 技能黑洞整套也预建（材质常驻，首次施放不编 shader）
    this.riftRig = this.riftRig || this._buildRift();
    roots.push(this.riftRig.g, ...this.riftRig.trail.map((T) => T.g));
    // 7 技能翅膀 + 落脚石法阵也预建（W-004）
    this.wingsRig = this.wingsRig || this._buildWings();
    this.stoneRig = this.stoneRig || this._buildStone();
    roots.push(this.wingsRig.root, this.stoneRig.g);
    return roots;
  }

  /** Background caller advances one phase; the original synchronous API stays intact. */
  prebuildStep() {
    if (!this._advanceUltBuild()) return { done: false };
    return { done: true, value: this.prebuild() };
  }

  // ---------- 材质工厂（常驻） ----------
  _additive(color, { opacity = 0.95, side = THREE.FrontSide } = {}) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    m.userData.base = opacity;
    return m;
  }
  _dotsMat(color, size, opacity = 0.9) {
    return new THREE.PointsMaterial({ map: this.dot, color: new THREE.Color(color), size, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  }

  // ---------- F 挥杖 ----------
  _buildArc() {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.035, 6, 28, 2.0), this._additive(0xffffff, { opacity: 0 }));
    arc.visible = false; this.w.root.add(arc);
    return { arc, sparks: this._sparks(this.w.root, 14) };
  }
  swing() {
    if (!this.canAct || this.cool.swing > 0) return false;
    if (!this.w.playSwing()) return false;
    this.cool.swing = this.cd('swing');
    // 青光弧：一段 Torus 弧从右到左横扫，0.4 s 淡掉；觉醒态黑刃是红弧
    const A = this.pools.arc.pop() || this._buildArc();
    const hh = this.w.handHeight || 1.35;
    const awakened = this.w.form === 'awakened';
    A.arc.material.color.set(awakened ? 0xff4a5a : COLORS.magicHot).multiplyScalar(1.6);
    A.arc.material.opacity = 0;
    A.arc.position.set(0, hh, 0.35);
    A.arc.rotation.set(Math.PI / 2 + 0.35, 0, 0);
    A.arc.scale.setScalar(1);
    A.sparks.reset(_v.set(0.2, hh + 0.05, 0.6), awakened ? 0xff6a7a : 0x9fe8d8, 0.5, false);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt; const k = t / 0.55;
        A.arc.visible = k > 0.3;
        const kk = clamp((k - 0.3) / 0.7, 0, 1);
        A.arc.rotation.z = this.reducedMotion ? -0.3 : lerp(0.9, -1.8, kk);
        A.arc.material.opacity = Math.sin(Math.PI * kk) * (this.reducedMotion ? 0.6 : 0.95);
        A.arc.scale.setScalar(this.reducedMotion ? 1 : 1 + kk * 0.35);
        A.sparks.update(dt);
        return t < 0.6;
      },
      dispose: () => { A.arc.visible = false; A.sparks.hide(); this.pools.arc.push(A); },
    });
    this.emit('used', 'swing');
    return true;
  }

  // ---------- 1 闪电折线冲刺 ----------
  _buildBolt() {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_LINE_VERTS * 3), 3));
    const line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8ffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_MAX_DOTS * 3), 3));
    dotGeo.setDrawRange(0, 0);
    const points = new THREE.Points(dotGeo, this._dotsMat(new THREE.Color(0x9ff2ff).multiplyScalar(1.5), 0.42, 1));
    line.frustumCulled = points.frustumCulled = false;
    line.visible = points.visible = false;
    this.ship.add(line, points);
    return { line, points, end: new THREE.Vector3() };
  }
  // 飞行冲刺沿用飞行空间规则；地面冲刺仍逐步碰撞探路。
  _resolveDashPosition(pos, flying) {
    if (flying) this.ctl._clampBounds(pos);
    else this.collider.resolve(pos, PLAYER.radius);
  }
  dash() {
    if (!this.canAct || this.cool.dash > 0 || this.camRig.mode !== 'deck') return false;
    const start = this.ctl.pos.clone(), flying = this.ctl.fly;
    const dirX = Math.sin(this.w.heading), dirZ = Math.cos(this.w.heading);
    // 分步探路：每 0.25 m 一步做碰撞，撞到墙就停在那里
    const probe = start.clone();
    let travelled = 0;
    for (let s = 0; s < DASH_DIST / 0.25; s++) {
      const next = probe.clone(); next.x += dirX * 0.25; next.z += dirZ * 0.25;
      this._resolveDashPosition(next, flying);
      const moved = Math.hypot(next.x - probe.x, next.z - probe.z);
      if (moved < 0.12) break;
      probe.copy(next); travelled += moved;
    }
    if (travelled < 0.6) { this.cool.dash = Math.min(0.25, this.cd('dash')); return false; }
    const end = probe.clone();
    this.cool.dash = this.cd('dash');
    this._dash = { t: 0, start, end, flying };
    this.w.setState('run');
    this._fovPunch = this.reducedMotion ? 0 : 0.001;
    // 闪电：主折线 + 三条分叉，线芯 + 光点，0.45 s 淡掉；终点一盏闪光（共享近身灯位）
    const R = rng((Date.now() & 0xffff) | 1);
    const A = start.clone().setY(start.y + 1.1), B = end.clone().setY(end.y + 1.1);
    const perp = new THREE.Vector3(-dirZ, 0, dirX);
    const pts = [];
    for (let i = 0; i <= BOLT_SEGS; i++) {
      const p = A.clone().lerp(B, i / BOLT_SEGS);
      const amp = Math.sin(Math.PI * i / BOLT_SEGS) * 0.75;
      p.addScaledVector(perp, (R() - 0.5) * amp * 1.6);
      p.y += (R() - 0.5) * amp * 1.1;
      pts.push(p);
    }
    const segs = [];
    for (let i = 0; i < BOLT_SEGS; i++) segs.push(pts[i], pts[i + 1]);
    for (let b = 0; b < BOLT_FORKS; b++) { // 分叉
      const i0 = 2 + Math.floor(R() * (BOLT_SEGS - 4));
      let p = pts[i0].clone();
      const side = R() < 0.5 ? -1 : 1;
      for (let s = 0; s < BOLT_FORK_SEGS; s++) {
        const q = p.clone().addScaledVector(perp, side * (0.35 + R() * 0.5)).add(new THREE.Vector3(dirX * 0.4 * R(), (R() - 0.3) * 0.6, dirZ * 0.4 * R()));
        segs.push(p, q); p = q;
      }
    }
    const bolt = this.pools.bolt.pop() || this._buildBolt();
    const lp = bolt.line.geometry.attributes.position;
    for (let i = 0; i < segs.length; i++) lp.setXYZ(i, segs[i].x, segs[i].y, segs[i].z);
    lp.needsUpdate = true;
    // 光点沿线密布（宽度感），写进预分配缓冲，超出上限就不再加
    const dp = bolt.points.geometry.attributes.position;
    let nd = 0;
    outer: for (let i = 0; i < segs.length; i += 2) {
      const a = segs[i], b = segs[i + 1];
      const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.18));
      for (let k = 0; k <= n; k++) { if (nd >= BOLT_MAX_DOTS) break outer; _v.copy(a).lerp(b, k / n); dp.setXYZ(nd++, _v.x, _v.y, _v.z); }
    }
    dp.needsUpdate = true;
    bolt.points.geometry.setDrawRange(0, nd);
    bolt.line.material.opacity = 1; bolt.points.material.opacity = 1; bolt.points.material.size = 0.42;
    bolt.line.visible = bolt.points.visible = true;
    bolt.end.copy(B);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt; const k = clamp(t / 0.45, 0, 1);
        const flicker = this.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(t * 80);
        bolt.line.material.opacity = (1 - k) * flicker;
        bolt.points.material.opacity = (1 - k) * flicker * (this.reducedMotion ? 0.42 : 1);
        bolt.points.material.size = (this.reducedMotion ? 0.2 : 0.42) * (1 - k * 0.5);
        this.fxNear.request(bolt.end, 0xbdf6ff, (this.reducedMotion ? 3 : 9) * (1 - k), 14, 1.6);
        return t < 0.45;
      },
      dispose: () => { bolt.line.visible = bolt.points.visible = false; this.pools.bolt.push(bolt); },
    });
    this.emit('used', 'dash');
    return true;
  }

  // ---------- 2 六边形魔法阵 ----------
  _buildHex() {
    const g = new THREE.Group();
    g.rotation.x = -Math.PI / 2; // 平铺在甲板上（局部 z 朝上）
    g.visible = false;
    const gold = (mul, op = 0.95) => this._additive(new THREE.Color(COLORS.gold).multiplyScalar(mul), { opacity: op, side: THREE.DoubleSide });
    const r = HEX_R;
    const outerHex = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 6, 1), gold(1.7));
    const innerHex = new THREE.Mesh(new THREE.RingGeometry(r * 0.6, r * 0.625, 6, 1), gold(1.5)); innerHex.rotation.z = Math.PI / 6;
    const circle = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r * 0.815, 72, 1), gold(1.3));
    const marks = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const d = new THREE.Mesh(new THREE.RingGeometry(r * 0.04, r * 0.085, 4, 1), gold(2.0)); d.position.set(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97, 0.002); marks.add(d);
      // 花纹：六段弧交错在圆与外六边形之间
      const arc = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r * 0.885, 24, 1, a + 0.12, Math.PI / 3 - 0.24), gold(1.2, 0.8)); marks.add(arc);
      const arc2 = new THREE.Mesh(new THREE.RingGeometry(r * 0.68, r * 0.7, 20, 1, a + Math.PI / 6 - 0.35, 0.7), gold(1.1, 0.7)); marks.add(arc2);
    }
    const sigil = this.sigilFactory.make({ diameter: r * 1.12, color: COLORS.gold, dotColor: COLORS.bright, opacity: 0.95, glow: 1.6, strokeMul: 3.6 });
    sigil.group.position.z = 0.004;
    sigil.spinSpeed = this.reducedMotion ? 0 : -0.5;
    g.add(outerHex, innerHex, circle, marks, sigil.group);
    const sparks = this._sparks(g, 36);
    this.ship.add(g);
    return { g, t: 0, sigil, sparks, mats: [outerHex.material, innerHex.material, circle.material, ...marks.children.map((m) => m.material)] };
  }
  hex() {
    if (!this.canAct || this.cool.hex > 0 || this.camRig.mode !== 'deck') return false;
    this.cool.hex = this.cd('hex');
    const p = this.ctl.pos;
    const H = this.pools.hex.pop() || this._buildHex();
    H.g.position.set(p.x, p.y + 0.03, p.z);
    H.g.scale.setScalar(0.001);
    H.g.rotation.z = -Math.PI / 2;
    H.g.visible = true;
    for (const m of H.mats) m.opacity = m.userData.base;
    H.sigil.setOpacity(0.95);
    H.sigil.inner.rotation.z = 0;
    H.sparks.reset(_v.set(0, 0, 0.05), COLORS.bright, HEX_R * 0.9, true); // 升起的金色粒子
    H.t = 0;
    this.hexes.push(H);
    while (this.hexes.length > HEX_MAX) this._releaseHex(this.hexes.shift());
    this.emit('used', 'hex');
    return true;
  }
  _releaseHex(h) { h.g.visible = false; h.sparks.hide(); this.pools.hex.push(h); }

  // ---------- 3 玫瑰 ----------
  toggleRose() {
    if (this.cool.rose > 0 || this.rift) return false;
    this.cool.rose = Math.max(0.3, this.cd('rose')); // 至少 0.3 s，免得一次按键被当成两次开合
    this.rose.toggle();
    this.emit('used', 'rose');
    this.emit('rose', this.rose.state);
    return true;
  }

  // ---------- 4 大招：玫瑰大阵 ----------
  // 一个真正的球：中心 (0,8,0)、半径 60，把整条船连船底都包进去。甲板施放先用 4.5 s 把相机升到 165 m 的宇宙视角，
  // 视野到位后球面上 10 朵玫瑰（上下各 4 圈 + 天顶天底）同时凭空弹出并快开 → +1.5 s 起玫瑰之间与到阵心的金色光束逐条连成网
  // → +3.4 s 船身周围展开直径 130 m 的超大法阵（六边形 + 圆环 + 印记 + 光辐）+ 线框球 + 两道竖直大环 → +5.2 s 阵成停 4 s → 传送特效 → 门户。再按 4 提前收。
  /** 预建大招整套（只建一次，反复用）：玫瑰 / 光束 / 法阵全部隐藏待命。 */
  _ensureUlt() {
    while (!this._advanceUltBuild()) { /* User first-use drains the same partial builder. */ }
    return this.ultRig;
  }

  _advanceUltBuild() {
    if (this.ultRig) return true;
    if (this._ultBuildError) throw this._ultBuildError;
    if (this._ultBuildRunning) throw new Error('Ultimate construction cannot reenter its iterator');
    const builder = this._ultBuild || (this._ultBuild = this._buildUltSteps());
    this._ultBuildRunning = true;
    try {
      const step = builder.next();
      if (!step.done) return false;
      // Preferences may change between background phases. Publish only a full,
      // current rig; never hide/reset a rig that a first-use caller already cast.
      const rig = step.value;
      for (const r of rig.roses) r.rose.setStill(this.reducedMotion);
      rig.bigSig.spinSpeed = this.reducedMotion ? 0 : -0.06;
      this.ultRig = rig;
      this._ultBuild = null;
      return true;
    } catch (error) {
      // Failed partial objects remain hidden, at most once per Skills instance.
      // Do not silently restart and duplicate scene objects after a failure.
      this._ultBuildError = error;
      this._ultBuild = null;
      throw error;
    } finally { this._ultBuildRunning = false; }
  }

  *_buildUltSteps() {
    const center = new THREE.Vector3(0, 8, 0);
    const R = 60;
    const spots = [];
    const ring = (n, elDeg, phase) => { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + phase, el = elDeg * Math.PI / 180; spots.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el))); } };
    ring(4, 32, 0.4);                // 上圈 4 朵
    ring(4, -32, 0.4 + Math.PI / 4); // 下圈 4 朵（错开 45°）
    spots.push(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)); // 天顶、天底
    const roses = [];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const p = center.clone().addScaledVector(s, R);
      // 阵中玫瑰 60 m 外看不清细节：轻量版（layers 2 → 20 片、粗细分），无花瓣雨；1.4 s 快开（它们是"凭空出现"的）
      const rose = new SkyRose(this.scene, { position: p.toArray(), target: center.toArray(), scale: 5.2, light: null, reducedMotion: this.reducedMotion, layers: 2, rain: false, bloomTime: 1.4 });
      roses.push({ rose, pos: p, delay: i * 0.04, started: false, baseScale: 5.2 });
      yield; // Each hidden rose is a separate construction phase.
    }
    // 出现时的闪光：每朵位置一颗大光点（常驻材质，隐藏待命）
    const flash = new THREE.Points(new THREE.BufferGeometry().setFromPoints(roses.map((r) => r.pos)), this._dotsMat(new THREE.Color(0xfff8e8).multiplyScalar(2.2), 26, 0)); // X-001 去紫：白紫闪 → 暖白芯
    flash.frustumCulled = false; flash.visible = false; this.scene.add(flash);
    yield;
    // P-002 起每朵玫瑰只有 1 个花瓣材质（花瓣合批，开花进度 uOpen 是材质 uniform、每朵不同），所以不再让 10 朵共用材质；
    // 10 朵 × 3 个材质（花瓣 / 花萼 / 花心）共 30 个，shader 程序仍只编一套（同 key 命中缓存）
    // 光束：每朵连最近的 3 朵（成多面体笼）+ 连阵心；去重
    const edges = [];
    const key = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
    const seen = new Set();
    for (let i = 0; i < roses.length; i++) {
      const near = roses.map((r, j) => ({ j, d: r.pos.distanceTo(roses[i].pos) })).filter((e) => e.j !== i).sort((a, b) => a.d - b.d).slice(0, 3);
      for (const n of near) { const k = key(i, n.j); if (!seen.has(k)) { seen.add(k); edges.push([roses[i].pos, roses[n.j].pos]); } }
    }
    for (const r of roses) edges.push([r.pos, center]);
    // 玫瑰到法阵面（赤道面）的竖直光辐（上半球向下、下半球向上）
    const spokePairs = roses.filter((r) => Math.abs(r.pos.y - center.y) > 1).map((r) => [r.pos, new THREE.Vector3(r.pos.x, center.y, r.pos.z)]);
    // P-002：光束 + 光辐全部合批成 1 个 LineSegments + 1 个 Points（以前每束 2 次 draw call × ~39 束）；每束仍是一个独立的视图对象
    const views = this._beamBatch([...edges, ...spokePairs]);
    const beams = views.slice(0, edges.length).map((v, i) => ({ ...v, delay: 3.2 + i * 0.14, k: 0 }));
    const spokes = views.slice(edges.length).map((v, i) => ({ ...v, delay: 5.4 + i * 0.1, k: 0 }));
    yield;
    // 超大法阵（水平，绕船中心）
    const sig = new THREE.Group();
    sig.position.copy(center);
    sig.rotation.x = -Math.PI / 2;
    sig.visible = false;
    const gold = (mul, op = 0.9) => this._additive(new THREE.Color(COLORS.gold).multiplyScalar(mul), { opacity: op, side: THREE.DoubleSide });
    const SR = 65;
    const mats = [];
    const add = (mesh) => { sig.add(mesh); mats.push(mesh.material); return mesh; };
    add(new THREE.Mesh(new THREE.RingGeometry(SR * 0.965, SR, 6, 1), gold(1.8)));
    add(new THREE.Mesh(new THREE.RingGeometry(SR * 0.84, SR * 0.85, 128, 1), gold(1.4)));
    add(new THREE.Mesh(new THREE.RingGeometry(SR * 0.58, SR * 0.6, 6, 1), gold(1.5))).rotation.z = Math.PI / 6;
    yield;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      add(new THREE.Mesh(new THREE.RingGeometry(SR * 0.88, SR * 0.905, 40, 1, a + 0.1, Math.PI / 3 - 0.2), gold(1.2, 0.75)));
      add(new THREE.Mesh(new THREE.RingGeometry(SR * 0.03, SR * 0.07, 4, 1), gold(2.2))).position.set(Math.cos(a) * SR * 0.98, Math.sin(a) * SR * 0.98, 0.1);
      yield;
    }
    const bigSig = this.sigilFactory.make({ diameter: SR * 1.1, color: COLORS.gold, dotColor: COLORS.bright, opacity: 0.9, glow: 1.7, strokeMul: 2.6 });
    bigSig.group.position.z = 0.2; bigSig.spinSpeed = this.reducedMotion ? 0 : -0.06;
    sig.add(bigSig.group);
    yield;
    // 球壳：线框球 + 两道竖直大环，让它一眼是「封印球」而不是一张平盘
    const shellMat = this._additive(new THREE.Color(COLORS.gold).multiplyScalar(1.2), { opacity: 0.11 }); shellMat.wireframe = true;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 18), shellMat);
    shell.rotation.x = Math.PI / 2; // 挂在 sig 下（sig 已绕 x 转 −90°），这里转回去让极点在上下
    sig.add(shell); mats.push(shell.material);
    yield;
    for (const rz of [0, Math.PI / 2]) {
      const ringV = new THREE.Mesh(new THREE.RingGeometry(R * 0.995, R * 1.005, 128, 1), gold(1.3, 0.55));
      ringV.rotation.x = Math.PI / 2; ringV.rotation.y = rz; // 竖直大环（两道互相垂直）
      sig.add(ringV); mats.push(ringV.material);
      yield;
    }
    // 传送时从阵心扩散的一圈光环
    const wave = new THREE.Mesh(new THREE.RingGeometry(SR * 0.2, SR * 0.24, 96), gold(2.4, 0));
    wave.visible = false; sig.add(wave);
    sig.scale.setScalar(0.001);
    this.scene.add(sig);
    return { center, roses, beams, spokes, sig, sigMats: mats, bigSig, wave, flash };
  }

  ultimate() {
    if (this.ult) { this._dispelUlt(); return true; }
    if (this.cool.ult > 0 || this.ctl.locked || this.rift) return false;
    this.cool.ult = this.cd('ult');
    const rig = this._ensureUlt();
    // 时序（主人 09-07：先把视野拉出去，再让玫瑰一起凭空出现，再连线）：
    // 甲板视角施放 → 相机 4.5 s 升到宇宙视角 → appearAt 十朵同时"啪"地弹出（0.5 s 弹出 + 白紫闪光，1.4 s 开到全开）
    // → +1.5 s 起光束逐条连 → +3.4 s 法阵展开 → +5.2 s 阵成。已在宇宙视角时 appearAt 只留 0.5 s。
    const appearAt = this.camRig.mode === 'deck' ? 4.6 : 0.5;
    rig.roses.forEach((r, i) => { r.started = false; r.delay = appearAt + i * 0.04; r.rose.group.scale.setScalar(0.001); });
    rig.beams.forEach((b, i) => { b.reset(); b.k = 0; b.delay = appearAt + 1.5 + i * 0.14; });
    rig.spokes.forEach((s, i) => { s.reset(); s.k = 0; s.delay = appearAt + 3.9 + i * 0.1; });
    for (const m of rig.sigMats) m.opacity = m.userData.base;
    rig.bigSig.setOpacity(0.9);
    rig.sig.scale.setScalar(0.001); rig.sig.rotation.z = 0; rig.sig.visible = true;
    rig.wave.visible = false; rig.wave.scale.setScalar(1); rig.wave.material.opacity = 0;
    rig.flash.visible = false; rig.flash.material.opacity = 0;
    // 传送：法阵成形后停 HOLD 秒让人看完，再放 2.4 s 传送特效 → 门户。这段时间里按 4 = 取消（只收阵）。
    this.ult = { t: 0, center: rig.center, roses: rig.roses, beams: rig.beams, spokes: rig.spokes, sig: rig.sig, sigMats: rig.sigMats, bigSig: rig.bigSig, wave: rig.wave, flash: rig.flash, appearAt, sigAt: appearAt + 3.4, life: 26, fading: false, fadeT: 0, phase: 'forming', formedAt: appearAt + 5.2, hold: 4.0, teleT: 0 };
    if (this.camRig.mode === 'deck') this.camRig.enterUniverse(165, 4.5, 0.3, 0.85); // 半径 60 的球要 165 m 才装得进画面
    this.emit('used', 'ult');
    this.emit('ult', true);
    return true;
  }

  /** 收阵（不传送）。传送特效已开始就不能取消。 */
  _dispelUlt() { if (this.ult && !this.ult.fading && this.ult.phase !== 'teleport') { this.ult.fading = true; this.ult.fadeT = 0; this.ult.phase = 'fading'; for (const r of this.ult.roses) r.rose.wither(); this.emit('ult-cancel'); } }

  /** 阵成 → 传送：默认开（main 里可关：skills.teleportOnComplete = false） */
  teleportOnComplete = true;

  /**
   * 金色光束（P-002 合批）：所有光束合成一个 LineSegments + 一个 Points（2 次 draw call；以前每束线芯 + 光点链 2 次 × ~39 束 = ~78 次）。
   * 每束的显示进度是 uniform 数组 uK[束号]；顶点带 aT（沿束 0→1，线段两端都用后一点的进度）/ aBeam（束号）/ aStart（束起点，仅线）：
   * aT ≥ uK 的线段顶点折回起点（零长度、不画），点移出裁剪空间。仍是 three 自带的 LineBasicMaterial / PointsMaterial（onBeforeCompile 注入两行），
   * 所以 fade / pulse 还是改 material.opacity / size。返回每束一个视图对象，接口与旧 _beam 一致：grow(k) / fade(f) / pulse(t) / reset() / hide()，
   * line / points 指向共享的两个对象。
   * @param {Array<[THREE.Vector3, THREE.Vector3]>} pairs
   */
  _beamBatch(pairs) {
    const MAXB = 64;
    if (pairs.length > MAXB) console.warn(`光束 ${pairs.length} 束超过合批上限 ${MAXB}，多出的不显示`);
    const uK = { value: new Float32Array(MAXB) };
    const lp = [], la = [], lt = [], lb = [], pp = [], pt = [], pb = [];
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    pairs.forEach(([a, b], bi) => {
      const n = Math.max(6, Math.ceil(a.distanceTo(b) / 1.2));
      for (let j = 0; j <= n; j++) {
        p.copy(a).lerp(b, j / n);
        pp.push(p.x, p.y, p.z); pt.push(j / (n + 1)); pb.push(bi);
        if (j < n) {
          q.copy(a).lerp(b, (j + 1) / n);
          lp.push(p.x, p.y, p.z, q.x, q.y, q.z); la.push(a.x, a.y, a.z, a.x, a.y, a.z);
          lt.push((j + 1) / (n + 1), (j + 1) / (n + 1)); lb.push(bi, bi);
        }
      }
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lineGeo.setAttribute('aStart', new THREE.Float32BufferAttribute(la, 3));
    lineGeo.setAttribute('aT', new THREE.Float32BufferAttribute(lt, 1));
    lineGeo.setAttribute('aBeam', new THREE.Float32BufferAttribute(lb, 1));
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    dotGeo.setAttribute('aT', new THREE.Float32BufferAttribute(pt, 1));
    dotGeo.setAttribute('aBeam', new THREE.Float32BufferAttribute(pb, 1));
    const HEAD = `attribute float aT;\nattribute float aBeam;\nuniform float uK[${MAXB}];\n`;
    const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.flare), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    lineMat.onBeforeCompile = (s) => {
      s.uniforms.uK = uK;
      s.vertexShader = HEAD + 'attribute vec3 aStart;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tif (aT >= uK[int(aBeam + 0.5)]) transformed = aStart;');
    };
    lineMat.customProgramCacheKey = () => 'k3-beam-line';
    const dotMat = this._dotsMat(new THREE.Color(COLORS.bright).multiplyScalar(1.5), 1.6, 0.85);
    dotMat.onBeforeCompile = (s) => {
      s.uniforms.uK = uK;
      s.vertexShader = HEAD + s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tif (aT >= uK[int(aBeam + 0.5)]) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    };
    dotMat.customProgramCacheKey = () => 'k3-beam-dots';
    const line = new THREE.LineSegments(lineGeo, lineMat), points = new THREE.Points(dotGeo, dotMat);
    line.frustumCulled = points.frustumCulled = false;
    line.visible = points.visible = false;
    this.scene.add(line, points);
    return pairs.map((_, bi) => ({
      line, points,
      grow: (k) => { uK.value[bi] = k; if (k > 0) line.visible = points.visible = true; },
      fade: (f) => { lineMat.opacity = 0.9 * f; dotMat.opacity = 0.85 * f; },
      pulse: (t) => { dotMat.size = this.reducedMotion ? 1.6 : 1.6 + 0.5 * Math.sin(t * 3); },
      reset: () => { uK.value[bi] = 0; line.visible = points.visible = false; lineMat.opacity = 0.9; dotMat.opacity = 0.85; dotMat.size = 1.6; },
      hide: () => { line.visible = points.visible = false; },
    }));
  }

  _updateUlt(dt, lookTarget) {
    const U = this.ult; U.t += dt;
    const t = U.t;
    // 玫瑰凭空出现：到点 bloom() + 0.5 s 从 0 弹到满尺寸（略过冲），出现的一瞬每朵位置一颗白紫闪光
    for (const r of U.roses) {
      if (!r.started && t >= r.delay) { r.started = true; r.rose.bloom(); }
      if (r.started) { const pk = clamp((t - r.delay) / 0.5, 0, 1); const pop = pk < 1 && !this.reducedMotion ? 1 + 0.18 * Math.sin(Math.PI * pk) : 1; r.rose.group.scale.setScalar(Math.max(0.001, r.baseScale * easeOutCubic(pk) * pop)); }
      r.rose.update(dt, this.camera, lookTarget);
    }
    const fk = clamp((t - U.appearAt) / 0.7, 0, 1);
    U.flash.visible = !this.reducedMotion && fk > 0 && fk < 1 && !U.fading;
    if (U.flash.visible) { U.flash.material.opacity = Math.sin(Math.PI * fk); U.flash.material.size = 12 + 30 * fk; }
    const easeK = (b, dur, delay) => { const k = clamp((t - delay) / dur, 0, 1); b.grow(easeOutCubic(k)); b.k = k; };
    for (const b of U.beams) easeK(b, 0.55, b.delay);
    for (const s of U.spokes) easeK(s, 0.5, s.delay);
    // 法阵展开：sigAt 起 1.4 s 到位
    const grow = easeOutCubic(clamp((t - U.sigAt) / 1.4, 0, 1));
    U.sig.scale.setScalar(this.reducedMotion ? 1 : Math.max(0.001, grow));
    U.sig.rotation.z = this.reducedMotion ? 0 : -Math.PI * (1 - grow) * 0.5 + t * 0.02;
    U.bigSig.update(dt);
    let pulse = this.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 1.4);
    let fade = 1, boost = 1;
    // 阵成 → 停 hold 秒 → 传送特效（2.4 s）→ 门户
    if (U.phase === 'forming' && t >= U.formedAt) {
      U.phase = 'ready';
      this.emit('ult-ready', { hold: U.hold, teleport: this.teleportOnComplete });
    }
    if (U.phase === 'ready' && this.teleportOnComplete && t >= U.formedAt + U.hold) {
      U.phase = 'teleport'; U.teleT = 0;
      U.wave.visible = true;
      this.emit('ult-teleport', { duration: 2.4 });
    }
    if (U.phase === 'teleport') {
      U.teleT += dt;
      const k = clamp(U.teleT / 2.4, 0, 1);
      // 光束脉动加剧、法阵越来越亮、一圈光环从阵心扩散、花心金核亮到最大、阵光暴涨
      pulse = this.reducedMotion ? 1 : 1 + 1.6 * easeOutCubic(k) + 0.3 * Math.sin(t * 12);
      boost = 1 + (this.reducedMotion ? 0.35 : 1.4) * k;
      U.sig.scale.setScalar(this.reducedMotion ? 1 : 1 + 0.18 * easeOutCubic(k));
      U.wave.visible = !this.reducedMotion;
      const wk = clamp(U.teleT / 1.2, 0, 1);
      U.wave.scale.setScalar(lerp(1, 5.2, easeOutCubic(wk)));
      U.wave.material.opacity = (1 - wk) * 0.9;
      for (const r of U.roses) r.rose.iris.material.emissiveIntensity = 1.3 + 3 * k;
      this.camera.fov = this._baseFov + (this.reducedMotion ? 0 : 10 * Math.sin(Math.PI * k)); this.camera.updateProjectionMatrix();
      if (k >= 1) { U.phase = 'gone'; this.camera.fov = this._baseFov; this.camera.updateProjectionMatrix(); }
    }
    if (!U.fading && !this.teleportOnComplete && t > U.life) this._dispelUlt();
    if (U.fading) { U.fadeT += dt; fade = 1 - clamp(U.fadeT / 2.4, 0, 1); }
    for (const m of U.sigMats) m.opacity = Math.min(1, m.userData.base * fade * boost * (this.reducedMotion ? grow : 1));
    U.bigSig.setOpacity(Math.min(1, 0.9 * fade * boost * (this.reducedMotion ? grow : 1)));
    for (const b of [...U.beams, ...U.spokes]) { b.fade(Math.min(1, fade * pulse)); b.pulse(t); }
    const li = (6 + (this.reducedMotion ? 8 : 34) * (U.phase === 'teleport' ? clamp(U.teleT / 2.4, 0, 1) : 0)) * grow * fade;
    if (li > 0) this.fxSky.request(ULT_LIGHT_POS, 0xe0bd7c, li, 260, 0.9);
    if (U.fading && U.fadeT >= 2.4) this._hideUlt();
  }

  /** 收起大招整套（不销毁，下次复用） */
  _hideUlt() {
    const U = this.ult; if (!U) return;
    for (const r of U.roses) { const ro = r.rose; if (ro.state !== 'hidden') { ro.state = 'hidden'; ro.t = 0; ro.group.visible = false; } }
    for (const b of [...U.beams, ...U.spokes]) b.hide();
    U.sig.visible = false; U.sig.scale.setScalar(0.001);
    U.wave.visible = false; U.flash.visible = false;
    this.camera.fov = this._baseFov; this.camera.updateProjectionMatrix();
    this.ult = null;
    this.emit('ult', false);
  }

  /** 立刻清掉大招（浏览器后退回到本页时用） */
  clearUlt() { this._hideUlt(); }

  get ultActive() { return !!this.ult; }

  // ---------- 6 空间撕裂 · 黑洞 ----------
  // 挥杖 → 身前 1.9 m 撕开一道竖长的黑洞（先是一条裂缝，0.7 s 撑成椭圆，边缘紫红撕裂光 + 空间裂纹 + 被吸进去的光尘）→ 人走进去、
  // 猫紧跟着钻进去 → 黑洞变成半透明的"虚影"，WASD 移动的其实是隐身的旅人，黑洞跟着他飘（能被墙挡） → 再按 6：黑洞实体化，
  // 人从里面走出来，猫随后钻出 → 黑洞收成一条线消失，进冷却。人在洞里期间其他技能 / 推门不响应。
  _buildRift() {
    const g = new THREE.Group(); g.visible = false; this.ship.add(g);
    const mats = {};
    // 黑洞本体：纯黑椭圆盘（实体时不透明、写深度；虚影时 0.3）
    mats.core = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, side: THREE.DoubleSide, fog: false });
    const core = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mats.core); core.renderOrder = 2; g.add(core);
    // 洞心一圈深紫渐暗（让黑不是死黑）
    mats.inner = this._additive(new THREE.Color(0x3a1060), { opacity: 0.55, side: THREE.DoubleSide });
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.98, 48, 1), mats.inner); inner.position.z = 0.004; g.add(inner);
    // 撕裂边：两圈参差的锯齿环（顶点色：内亮外暗），反向转
    const torn = (seed, ri0, ro0, spike) => {
      const N = 96, R0 = rng(seed), pos = [], col = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const j = Math.pow(Math.abs(Math.sin(a * 6.5 + seed)), 3) * spike + Math.pow(Math.abs(Math.sin(a * 11 + seed * 2)), 5) * spike * 0.6 + R0() * 0.03;
        const ri = ri0 + (R0() - 0.5) * 0.03, ro = ro0 + j;
        pos.push(Math.cos(a) * ri, Math.sin(a) * ri, 0, Math.cos(a) * ro, Math.sin(a) * ro, 0);
        col.push(1.0, 0.55, 1.0, 0.45, 0.08, 0.7);
        if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, m); mesh.position.z = 0.01; g.add(mesh);
      return mesh;
    };
    const rimA = torn(3, 0.96, 1.04, 0.22), rimB = torn(9, 0.98, 1.02, 0.14);
    rimB.position.z = 0.012;
    mats.rimA = rimA.material; mats.rimB = rimB.material;
    // 空间裂纹：从洞边向外放射的折线，撕开 / 合上时闪
    const cr = [], R1 = rng(17);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + R1() * 0.4;
      let r = 1.02, x = Math.cos(a) * r, y = Math.sin(a) * r;
      for (let s = 0; s < 3; s++) { const a2 = a + (R1() - 0.5) * 0.9; r += 0.25 + R1() * 0.35; const nx = Math.cos(a2) * r, ny = Math.sin(a2) * r; cr.push(x, y, 0, nx, ny, 0); x = nx; y = ny; }
    }
    const crackGeo = new THREE.BufferGeometry(); crackGeo.setAttribute('position', new THREE.Float32BufferAttribute(cr, 3));
    mats.crack = new THREE.LineBasicMaterial({ color: new THREE.Color(0xd070ff).multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const cracks = new THREE.LineSegments(crackGeo, mats.crack); cracks.position.z = 0.02; g.add(cracks);
    // 被吸进去的光尘：沿螺旋往洞心掉
    const N = 140, sp = new Float32Array(N * 3), seed = new Float32Array(N * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const swirlGeo = new THREE.BufferGeometry(); swirlGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    mats.swirl = this._dotsMat(new THREE.Color(0xc080ff).multiplyScalar(1.5), 0.07, 0.9);
    const swirl = new THREE.Points(swirlGeo, mats.swirl); swirl.frustumCulled = false; swirl.position.z = 0.03; g.add(swirl);
    for (const o of [core, inner, rimA, rimB, cracks, swirl]) o.frustumCulled = false;
    // 残影：6 份（盘 + 撕裂边）的淡拷贝，虚影移动时每 50 ms 落一份在身后、0.45 s 内淡掉（主人：「加一点点拖延的残影」）
    const trail = [];
    for (let i = 0; i < 6; i++) {
      const tg = new THREE.Group(); tg.visible = false; this.ship.add(tg);
      const tc = new THREE.Mesh(core.geometry, new THREE.MeshBasicMaterial({ color: 0xb8e8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      const tr = new THREE.Mesh(rimA.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      tr.position.z = 0.01; tc.frustumCulled = tr.frustumCulled = false;
      tg.add(tc, tr);
      trail.push({ g: tg, core: tc, rim: tr, life: 0 });
    }
    return { g, core, inner, rimA, rimB, cracks, swirl, seed, mats, trail, trailT: 0, trailI: 0, lastPos: new THREE.Vector3() };
  }
  castRift() {
    if (this.rift) {
      // 人在洞里：再按 6 = 实体化 → 走出来。进出过程中按无效
      if (this.rift.phase === 'ghost') { this.rift.phase = 'solidify'; this.rift.t = 0; this.emit('rift-exit'); return true; }
      return false;
    }
    if (this.cool.rift > 0 || this.ctl.locked || this.ctl._scripted || this._dash || this.camRig.mode !== 'deck') return false;
    if (this.ctl.fly) { this._foldWings(true); this.ctl.noclip = true; this.ctl.bounds = this._bounds(); } // 飞着开洞：翅膀立刻收起，人悬在原高度（先进 noclip，撑洞那 0.7 s 别被碰撞拽回船上）（W-004）
    this.riftRig = this.riftRig || this._buildRift();
    const Rg = this.riftRig;
    const h = this.w.heading, dx = Math.sin(h), dz = Math.cos(h);
    const p = this.ctl.pos;
    // 洞开在身前 1.9 m，贴着地面高度浮起 1.15 m；朝向与人的朝向一致（人正对着洞面）
    const at = new THREE.Vector3(p.x + dx * 1.9, p.y, p.z + dz * 1.9);
    if (this.ctl.onGround && !this.ctl.stone) this.collider.resolve(at, 0.5, { ignoreCabinWall: false }); // 站在落脚石 / 半空时洞就开在空中，不往船上拽
    Rg.g.position.set(at.x, at.y + 1.15, at.z);
    Rg.g.rotation.set(0, h, 0);
    Rg.g.scale.set(0.001, 1.1, 1);
    Rg.g.visible = true;
    this.w.playSwing();
    this.ctl.locked = true;
    this.rift = { t: 0, phase: 'open', at, hole: new THREE.Vector3(at.x, at.y, at.z), heading: h, Rg, catIn: false, ghost: 0 };
    this.emit('used', 'rift');
    this.emit('rift', true);
    return true;
  }
  _updateRift(dt) {
    const S = this.rift, Rg = S.Rg, M = Rg.mats;
    S.t += dt;
    const t = S.t, cat = this.cat;
    const w = this.w, ctl = this.ctl;
    // 各阶段：open(0.7) → enter(1.3) → ghost(自由) → solidify(0.6) → exit(1.3) → close(0.5)
    if (S.phase === 'open') {
      const k = clamp(t / 0.7, 0, 1);
      Rg.g.scale.set(Math.max(0.001, 0.55 * easeOutCubic(k)), 1.1 * (0.6 + 0.4 * easeOutCubic(k)), 1);
      M.crack.opacity = Math.sin(Math.PI * k) * (this.reducedMotion ? 0.6 : 0.6 + 0.4 * Math.sin(t * 40));
      S.ghost = 0;
      if (k >= 1) { S.phase = 'enter'; S.t = 0; ctl.locked = false; ctl.walkScripted(Math.sin(S.heading), Math.cos(S.heading), 2.1, 1.3); ctl.locked = true; }
    } else if (S.phase === 'enter') {
      const k = clamp(t / 1.3, 0, 1);
      M.crack.opacity = 0.25 * (1 - k);
      // 走到洞面（≈ 0.9）时人被"吸"进去：缩小 + 消失，洞闪一下
      if (k > 0.72 && w.root.visible) { const s = clamp(1 - (k - 0.72) / 0.2, 0.05, 1); w.root.scale.set(s, s, s); }
      if (k >= 0.92 && w.root.visible) {
        // 杖顶那盏是真实 PointLight（character.js:313）：跟着 root 一起藏会让场景点光 9 → 8，three 把灯数写进着色器正文，可见的 14 个材质当场重编、冻 670 ms（P 14:05 实测）。
        // 藏人前把灯 attach 到船组、让它跟着黑洞飘（洞口留一团小魔法光，正好），出洞 / 结束再挂回手杖——灯数全程恒 9，0 重编
        if (w.staffLight) { this.ship.attach(w.staffLight); w.staffLight.position.copy(Rg.g.position); }
        w.root.visible = false; w.root.scale.set(1, 1, 1); S.flash = 0.35;
      }
      if (k >= 1) {
        S.phase = 'ghost'; S.t = 0; ctl.locked = false; ctl.vel.set(0, 0, 0);
        // W-004：虚影期无视空间——不碰撞、不掉、高度不变，穿墙 / 穿船 / 出船；只用活动范围兜底防走丢；离开落脚石
        this._hideStone(); ctl.noclip = true; ctl.bounds = this._bounds();
      }
    } else if (S.phase === 'ghost') {
      // 虚影：像水一样淡而透明，跟着（隐身的）旅人飘、正对相机；移动比跑步还快（1.6× 跑速），身后落残影
      S.ghost = Math.min(1, S.ghost + dt / 0.6);
      ctl.speedScale = 1.6; ctl.forceRun = true;
      const p = ctl.pos;
      Rg.g.position.set(p.x, p.y + 1.15 + (this.reducedMotion ? 0 : 0.05 * Math.sin(t * 1.7)), p.z);
      Rg.g.rotation.y = this.camRig.yaw;
      // 水面般的微微晃动
      Rg.g.scale.set(0.55 * (1 + (this.reducedMotion ? 0 : 0.025 * Math.sin(t * 3.1))), 1.1 * (1 + (this.reducedMotion ? 0 : 0.02 * Math.sin(t * 2.3 + 1))), 1);
      Rg.g.rotation.z = this.reducedMotion ? 0 : 0.04 * Math.sin(t * 1.3);
      S.hole.set(p.x, p.y, p.z);
      if (w.staffLight && w.staffLight.parent === this.ship) w.staffLight.position.copy(Rg.g.position); // 杖灯跟着洞
      // 残影
      Rg.trailT += dt;
      const moving = ctl.speed > 0.8;
      if (!this.reducedMotion && moving && Rg.trailT >= 0.05) {
        Rg.trailT = 0;
        const T = Rg.trail[Rg.trailI = (Rg.trailI + 1) % Rg.trail.length];
        T.g.position.copy(Rg.g.position); T.g.rotation.copy(Rg.g.rotation); T.g.scale.copy(Rg.g.scale);
        T.life = 1; T.g.visible = true;
      }
      // 猫：直奔洞口（catGoal），到了就钻进去
      if (cat && !S.catIn && cat.root.visible) { const c = cat.root.position; if (Math.hypot(c.x - p.x, c.z - p.z) < 0.75) { cat.root.visible = false; S.catIn = true; S.flash = 0.25; } }
    } else if (S.phase === 'solidify') {
      const k = clamp(t / 0.6, 0, 1);
      S.ghost = 1 - easeOutCubic(k);
      ctl.speedScale = 1; ctl.forceRun = false;
      Rg.g.rotation.z = 0;
      Rg.g.scale.set(0.55, 1.1, 1);
      M.crack.opacity = Math.sin(Math.PI * k) * 0.8;
      Rg.g.rotation.y = w.heading + Math.PI; // 洞面转向人要走出的方向（人从洞里朝前走）
      if (k >= 1) {
        S.phase = 'exit'; S.t = 0;
        const p = ctl.pos;
        S.at.set(p.x, p.y, p.z);
        Rg.g.position.set(p.x, p.y + 1.15, p.z);
        w.root.visible = true; w.root.scale.set(0.05, 0.05, 0.05);
        this._restoreStaffLight();
        S.flash = 0.35;
        // W-004：出洞时看脚下——3.5 m 内有真实地面就照旧走出来落地；悬在虚空 / 太高就凝一枚落脚石托住，人原地成形
        ctl.noclip = false; ctl.bounds = null;
        const gy = this._groundBelow(p);
        if (gy !== null && p.y - gy <= 3.5) {
          // 人还是 0.05 倍大小、洞在闪：这一刻把脚贴到地面没人看得见（免得下落途中被碰撞器当成船尾楼层推走）
          p.y = gy; S.at.y = gy; Rg.g.position.y = gy + 1.15;
          ctl.airborne = false; ctl.vy = 0; ctl.locked = false; ctl.walkScripted(Math.sin(w.heading), Math.cos(w.heading), 1.8, 1.3); ctl.locked = true;
        }
        else { this._makeStone(p); ctl.airborne = false; ctl.vy = 0; ctl.vel.set(0, 0, 0); ctl.locked = true; this.emit('stone', true); }
      }
    } else if (S.phase === 'exit') {
      const k = clamp(t / 1.3, 0, 1);
      const s = clamp(k / 0.25, 0.05, 1); w.root.scale.set(s, s, s);
      // 猫在人走出 0.45 s 后从洞里钻出来、跟上
      if (cat && S.catIn && k > 0.35) { cat.place(S.at.x, S.at.z, w.heading); cat.root.visible = true; S.catIn = false; S.flash = 0.2; }
      if (k >= 1) { S.phase = 'close'; S.t = 0; ctl.locked = false; w.root.scale.set(1, 1, 1); }
    } else if (S.phase === 'close') {
      const k = clamp(t / 0.5, 0, 1);
      Rg.g.scale.set(Math.max(0.001, 0.55 * (1 - easeOutCubic(k))), 1.1 * (1 - 0.4 * k), 1);
      M.crack.opacity = Math.sin(Math.PI * k) * 0.7;
      if (k >= 1) { this._endRift(); return; }
    }
    // 通用外观：虚影系数 ghost（0 实体黑洞 / 1 水一样的淡影：洞体从纯黑变成极淡的青白、几乎透明）、闪光、旋转、光尘
    const gh = S.ghost, flash = S.flash > 0 ? Math.sin(Math.PI * clamp(S.flash / 0.35, 0, 1)) * (this.reducedMotion ? 0.15 : 1) : 0;
    if (S.flash > 0) S.flash -= dt;
    M.core.color.setRGB(lerp(0, 0.55, gh), lerp(0, 0.8, gh), lerp(0, 1.0, gh));
    M.core.opacity = lerp(1, 0.13, gh);
    M.core.depthWrite = gh < 0.5;
    M.inner.opacity = lerp(0.55, 0.07, gh) + 0.4 * flash;
    M.rimA.opacity = lerp(0.95, 0.11, gh) + 0.6 * flash;
    M.rimB.opacity = lerp(0.8, 0.08, gh) + 0.6 * flash;
    M.swirl.opacity = lerp(0.9, 0.22, gh) + 0.5 * flash;
    M.swirl.color.setRGB(lerp(0.75, 0.6, gh) * 1.5, lerp(0.5, 0.9, gh) * 1.5, 1.0 * 1.5);
    // 残影淡出（越老越小越淡）
    for (const T of Rg.trail) {
      if (T.life <= 0) continue;
      T.life -= dt / 0.45;
      if (T.life <= 0) { T.life = 0; T.g.visible = false; continue; }
      const a = T.life * T.life;
      T.core.material.opacity = 0.05 * a; T.rim.material.opacity = 0.11 * a;
      T.g.scale.set(0.55 * (0.85 + 0.15 * T.life), 1.1 * (0.85 + 0.15 * T.life), 1);
    }
    if (!this.reducedMotion) { Rg.rimA.rotation.z = t * 0.9; Rg.rimB.rotation.z = -t * 1.4; Rg.inner.rotation.z = t * 2.2; }
    const sp = Rg.swirl.geometry.attributes.position, seed = Rg.seed;
    const T = performance.now() * 0.001;
    Rg.swirl.visible = !this.reducedMotion;
    for (let i = 0; !this.reducedMotion && i < sp.count; i++) {
      const s0 = seed[i * 3], s1 = seed[i * 3 + 1], s2 = seed[i * 3 + 2];
      const life = (T * (0.35 + s2 * 0.4) + s1) % 1;         // 1 → 0 往里掉
      const r = 0.12 + (1 - life) * 1.25;
      const a = s0 * Math.PI * 2 + T * (1.5 + 3.0 / (r + 0.2));
      sp.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r * 1.05, 0.02 + life * 0.05);
    }
    sp.needsUpdate = true;
    if (S.phase !== 'ghost') { const gp = Rg.g.position; this.fxNear.request(_v.set(gp.x, gp.y, gp.z), 0xb060ff, 6 * (1 - gh) + 14 * flash, 9, 2); }
    else this.fxNear.request(_v.copy(Rg.g.position), 0x8040d0, 1.6 + 6 * flash, 6, 2);
  }
  _endRift() {
    const S = this.rift; if (!S) return;
    S.Rg.g.visible = false;
    for (const T of S.Rg.trail) { T.life = 0; T.g.visible = false; }
    this.ctl.speedScale = 1; this.ctl.forceRun = false;
    this.ctl.noclip = false; this.ctl.bounds = null;
    this.w.root.visible = true; this.w.root.scale.set(1, 1, 1);
    this._restoreStaffLight();
    if (this.cat && !this.cat.root.visible) { const p = this.ctl.pos; this.cat.place(p.x - Math.sin(this.w.heading) * 1.2, p.z - Math.cos(this.w.heading) * 1.2, this.w.heading); this.cat.root.visible = true; }
    this.ctl.locked = false;
    this.cool.rift = this.cd('rift');
    this.rift = null;
    this.emit('rift', false);
  }
  /** 杖顶灯挂回当前形态的手杖灯位（黑洞期间它被 attach 到船组跟着洞飘） */
  _restoreStaffLight() {
    const w = this.w, L = w.staffLight, anchor = w.rig && w.rig.lightAnchor;
    if (L && anchor && L.parent !== anchor) { anchor.add(L); L.position.set(0, 0, 0); }
  }
  /** 立刻结束 6 技能（换页 / 后退回来时用） */
  clearRift() { if (this.rift) { this.ctl._scripted = null; this._endRift(); } }

  // ---------- 7 翅膀 · 飞行（W-004，主人 09-08 12:00：「背后长个翅膀，可以往四处飞，比跑快，按 Shift 更快」） ----------
  // 按 7：背后展开一对魔法翅膀（金线描边 + 淡青光膜，两侧各 4 根光羽，肩点扇出），进入飞行：无重力、无碰撞，W 朝镜头看的方向飞（含俯仰），
  // A/D 平移，Space 升 / C 降；2.2× 跑速，Shift 再 ×2（≈ 22 m/s）。活动范围：甲板模式以船心为圆 360 m、高 −14…280 m；层内是走廊外扩 10 m 的盒子。
  // 再按 7 收翅：脚下 3.5 m 内有真实地面 → 落下去；悬在虚空 / 太高 → 脚下凝出一枚「落脚石」法阵托住（同 6 出洞）——石上能转身、能跳、能开洞、能再起飞。
  // 猫不会飞：人离船时它自己会退到最近的船边等着（cat.js 追不到 14 m 就贴着碰撞边缘）。
  _buildWings() {
    const root = new THREE.Group(); root.name = 'wings'; root.visible = false;
    this.w.root.add(root);
    // 光膜用普通半透明混合（加法会被 Bloom 抬成一团白），顶点色根金 → 尖青；只有外沿金线走加法
    const membrane = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false });
    const edge = new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.gold || 0xe0bd7c).multiplyScalar(1.15), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    // 每侧：4 根光羽 = 从肩点扇出、彼此重叠的宽三角面片（半宽 15–26 cm，连成一片翼面），外沿一条金线
    const side = (sgn) => {
      const g = new THREE.Group();
      const pos = [], col = [], line = [];
      const feathers = [[1.0, 0.08, 0.26], [1.4, 0.38, 0.24], [1.55, 0.72, 0.2], [1.3, 1.05, 0.15]]; // [长, 仰角, 半宽]
      for (const [L, ang, hw] of feathers) {
        const ex = Math.cos(ang) * sgn, ey = Math.sin(ang);           // 羽轴方向（翼展沿 ±x、上扬）
        const nx = -ey * hw * sgn, ny = Math.cos(ang) * hw;           // 羽轴的法向 × 半宽
        const bx = ex * L * 0.4, by = ey * L * 0.4;                   // 最宽处在 40% 长度
        const tx = ex * L, ty = ey * L;
        pos.push(0, 0, 0, bx + nx, by + ny, 0, tx, ty, -0.03, 0, 0, 0, tx, ty, -0.03, bx - nx, by - ny, 0);
        for (let v = 0; v < 6; v++) { const tip = v === 2 || v === 4; col.push(tip ? 0.35 : 0.85, tip ? 0.62 : 0.66, tip ? 0.92 : 0.36); } // 根金 → 尖青
        line.push(0, 0, 0, tx, ty, -0.03);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, membrane); mesh.frustumCulled = false; g.add(mesh);
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
      const lines = new THREE.LineSegments(lg, edge); lines.frustumCulled = false; g.add(lines);
      g.rotation.y = -sgn * 0.42; // 翼尖向后掠
      root.add(g);
      return g;
    };
    return { root, L: side(-1), R: side(1), mats: [membrane, edge] };
  }
  /** 落脚石：一枚悬空的金色法阵（外环 + 淡青光盘 + 细环），出洞 / 收翅时脚下没地面就凝在脚下 */
  _buildStone() {
    const g = new THREE.Group(); g.name = 'void-stone'; g.visible = false; g.rotation.x = -Math.PI / 2; this.ship.add(g);
    const gold = new THREE.Color(COLORS.gold || 0xe0bd7c);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.84, 1.0, 48), this._additive(gold.clone().multiplyScalar(1.4), { opacity: 0.8, side: THREE.DoubleSide }));
    const thin = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.14, 48), this._additive(gold.clone().multiplyScalar(1.2), { opacity: 0.45, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 32), this._additive(new THREE.Color(0x6fb8ff), { opacity: 0.16, side: THREE.DoubleSide }));
    disc.position.z = -0.005;
    for (const m of [ring, thin, disc]) { m.frustumCulled = false; m.material.userData.base = m.material.opacity; g.add(m); }
    return { g, ring, thin, disc, mats: [ring.material, thin.material, disc.material] };
  }
  /** 脚下有没有真实地面：把位置抄一份去 resolve，被水平推动了 = 不在可走区（船外 / 层外 / 撞在障碍里）；返回地面 y 或 null */
  _groundBelow(p, tol = 0.06) {
    // ShipCollider 按探测点的 y 判断「在哪一层」（y > 1.5 = 船尾楼层，只存在于舱室后墙之后），所以在半空中要分别按 当前高度 / 船尾楼 3.0 / 主甲板 0 三个高度各探一次，
    // 取水平没被推动、且不高于人的最高地面；LevelCollider 与 y 无关，三次结果相同
    let best = null;
    for (const y of [p.y, 3.0, 0]) {
      _q.set(p.x, y, p.z);
      const gy = this.collider.resolve(_q, PLAYER.radius, { keepY: true });
      if (gy === undefined) return null;
      if (Math.hypot(_q.x - p.x, _q.z - p.z) > tol) continue;
      if (gy > p.y + 0.5) continue;
      if (best === null || gy > best) best = gy;
    }
    return best;
  }
  /** noclip / fly 的活动范围：甲板模式绕船心 360 m；层内走廊外扩 10 m */
  _bounds() {
    const c = this.collider, p = this.ctl.pos;
    // Outdoor worlds may author their own bounded flight/ghost space. Never snap
    // an activation into a volume that does not contain the current player.
    const b = typeof c?.world?.motionBounds === 'function' ? c.world.motionBounds(p) : null;
    if (b && ['xMin','xMax','zMin','zMax','minY','maxY'].every(k => Number.isFinite(b[k])) &&
        b.xMin < b.xMax && b.zMin < b.zMax && b.minY < b.maxY &&
        p.x >= b.xMin && p.x <= b.xMax && p.z >= b.zMin && p.z <= b.zMax && p.y >= b.minY && p.y <= b.maxY) return b;
    if (c && c.y0 !== undefined && c.halfL !== undefined) return { xMin: -(c.halfW + 10), xMax: c.halfW + 10, zMin: -(c.halfL + 10), zMax: c.halfL + 10, minY: c.y0 - 1, maxY: c.y0 + 10 };
    return { cx: 0, cz: 0, radius: 360, minY: -14, maxY: 280 };
  }
  _makeStone(p) {
    this.stoneRig = this.stoneRig || this._buildStone();
    this.ctl.stone = { x: p.x, z: p.z, y: p.y, r: 1.05 };
    const g = this.stoneRig.g; g.position.set(p.x, p.y + 0.02, p.z); g.scale.setScalar(0.001); g.visible = true;
    this.stoneFx = { t: 0, on: true, k: 0 };
  }
  _hideStone() { this.ctl.stone = null; if (this.stoneFx) this.stoneFx.on = false; }
  /** 7：展翅起飞 / 收翅落地（返回 true 表示有动作） */
  toggleWings() {
    if (this.rift || this.ctl.locked || this.ctl._scripted || this._dash || this.camRig.mode !== 'deck') return false;
    if (this.ctl.fly) return this._landWings();
    if (this.cool.wings > 0) return false;
    this.wingsRig = this.wingsRig || this._buildWings();
    this._hideStone();
    this.ctl.fly = true; this.ctl.noclip = false; this.ctl.bounds = this._bounds();
    this.ctl.airborne = true; this.ctl.vy = 0;
    this.wings = { t: 0, phase: 'unfold', k: 0, flap: 0 };
    this.wingsRig.root.visible = true;
    this.w.playSwing();
    this.emit('used', 'wings'); this.emit('wings', true);
    return true;
  }
  _landWings() {
    const p = this.ctl.pos, gy = this._groundBelow(p);
    this.ctl.fly = false; this.ctl.bounds = null; this.ctl.vel.set(0, 0, 0);
    // 3.5 m 内有地面：不用重力落（ShipCollider 会把 y > 1.5 的下落中的人当成船尾楼层推过去），改为 noclip 下 0.25–0.7 s 滑降到地面再恢复碰撞
    if (gy !== null && p.y - gy <= 3.5) { this.descend = { y0: p.y, y1: gy, t: 0, dur: 0.25 + 0.12 * (p.y - gy) }; this.ctl.noclip = true; this.ctl.locked = true; this.ctl.airborne = false; this.ctl.vy = 0; }
    else { this._makeStone(p); this.ctl.airborne = false; this.ctl.vy = 0; this.emit('stone', true); }
    if (this.wings) { this.wings.phase = 'fold'; this.wings.t = 0; }
    this.cool.wings = this.cd('wings');
    this.emit('wings', false);
    return true;
  }
  /** 收翅（instant：立刻隐藏，开洞 / 切层用） */
  _foldWings(instant = false) {
    if (this.ctl.fly) { this.ctl.fly = false; this.ctl.bounds = null; this.ctl.vel.set(0, 0, 0); this.ctl.airborne = false; this.ctl.vy = 0; this.emit('wings', false); }
    if (!this.wings) return;
    if (instant) { this.wings = null; if (this.wingsRig) this.wingsRig.root.visible = false; }
    else { this.wings.phase = 'fold'; this.wings.t = 0; }
  }
  /** 立刻结束 7 技能与落脚石（切层 / 法阵传送 / 换页时用） */
  clearFlight() { this._foldWings(true); this._hideStone(); this.descend = null; if (this.stoneRig) { this.stoneRig.g.visible = false; this.stoneFx = null; } }
  _updateWings(dt) {
    const ctl = this.ctl, W = this.wings;
    ctl.flyPitch = this.camRig.pitch;
    // 收翅滑降：noclip 下把 y 缓到地面，到了再交还碰撞与输入（teleport 把 noclip 关了就作废）
    const D = this.descend;
    if (D) {
      if (!ctl.noclip) this.descend = null;
      else { D.t += dt; const k = easeOutCubic(clamp(D.t / D.dur, 0, 1)); ctl.pos.y = lerp(D.y0, D.y1, k); if (k >= 1) { ctl.noclip = false; ctl.locked = false; ctl.airborne = false; ctl.vy = 0; this.descend = null; } }
    }
    // 被 teleport() 等外力退出了飞行而翅膀还开着 → 收
    if (W && W.phase !== 'fold' && !ctl.fly) { W.phase = 'fold'; W.t = 0; this.emit('wings', false); }
    if (W) {
      W.t += dt;
      const rig = this.wingsRig;
      if (W.phase === 'unfold') { W.k = easeOutCubic(clamp(W.t / 0.45, 0, 1)); if (W.k >= 1) W.phase = 'fly'; }
      else if (W.phase === 'fold') { W.k = 1 - easeOutCubic(clamp(W.t / 0.4, 0, 1)); if (W.k <= 0) { rig.root.visible = false; this.wings = null; } }
      if (this.wings) {
        // 挂在肩后（随形态换高度）；扑翼频率随速度：悬停 1.1 Hz、飞 2.0 Hz、加速 2.8 Hz
        rig.root.position.set(0, this.w.eyeHeight * 0.78, -0.13);
        const boost = ctl.speed > ctl.flySpeed * 1.3 || Math.abs(ctl.vel.y) > ctl.flySpeed * 1.3;
        const hz = !ctl.fly ? 0.8 : ctl.vel.lengthSq() < 0.3 ? 1.1 : boost ? 2.8 : 2.0;
        if (!this.reducedMotion) W.flap += dt * hz * Math.PI * 2;
        const a = 0.22 + 0.38 * Math.sin(W.flap) * W.k;
        rig.L.rotation.z = -a; rig.R.rotation.z = a;
        rig.root.scale.setScalar(Math.max(0.001, W.k));
        rig.root.rotation.x = ctl.fly ? -0.25 * clamp(ctl.speed / ctl.flySpeed, 0, 1) : 0; // 前飞时翅根略前倾
        for (const m of rig.mats) m.opacity = (m === rig.mats[0] ? 0.55 : 0.8) * (0.75 + 0.25 * W.k);
        this.fxNear.request(_v.copy(this.w.root.position).add(rig.root.position), 0xffd890, 1.4 * W.k, 6, 2);
      }
    }
    // 落脚石：0.35 s 凝出、常驻慢转、离开后 0.4 s 淡掉
    const F = this.stoneFx;
    if (F && this.stoneRig) {
      const g = this.stoneRig.g;
      if (!this.reducedMotion) F.t += dt;
      F.k = F.on ? Math.min(1, F.k + dt / 0.35) : Math.max(0, F.k - dt / 0.4);
      const k = easeOutCubic(F.k);
      g.scale.setScalar(Math.max(0.001, k)); g.rotation.z = F.t * 0.35;
      for (const m of this.stoneRig.mats) m.opacity = m.userData.base * k * (this.reducedMotion ? 0.85 : 0.85 + 0.15 * Math.sin(F.t * 2.4));
      if (k > 0.01) this.fxNear.request(_v.set(g.position.x, g.position.y + 0.6, g.position.z), 0xffd080, 1.6 * k, 5, 2);
      if (!F.on && F.k <= 0) { g.visible = false; this.stoneFx = null; }
    }
  }

  /** 小粒子发生器（材质常驻，reset() 换位置 / 颜色 / 半径后反复用）：parent 下、center 附近、count 颗，寿命循环 */
  _sparks(parent, count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = this._dotsMat(0xffffff, 0.09, 0.9);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    parent.add(pts);
    const S = { points: pts, center: new THREE.Vector3(), radius: 1, flat: false, t: 0 };
    S.reset = (center, color, radius, flat = false) => { S.center.copy(center); S.radius = radius; S.flat = flat; S.t = 0; mat.color.set(color).multiplyScalar(1.4); mat.opacity = 0.9; pts.visible = !this.reducedMotion; };
    S.update = (dt, fade = 1) => {
      pts.visible = !this.reducedMotion;
      if (this.reducedMotion) return;
      S.t += dt;
      const t = S.t, c = S.center, radius = S.radius;
      for (let i = 0; i < count; i++) {
        const s0 = seed[i * 3], s1 = seed[i * 3 + 1], s2 = seed[i * 3 + 2];
        const life = (t * (0.6 + s2 * 0.6) + s1) % 1;
        const a = s0 * Math.PI * 2 + t * 0.4;
        const rr = radius * (0.25 + s2 * 0.75);
        if (S.flat) { pos[i * 3] = c.x + Math.cos(a) * rr; pos[i * 3 + 1] = c.y + Math.sin(a) * rr; pos[i * 3 + 2] = c.z + life * 1.6; }
        else { pos[i * 3] = c.x + Math.cos(a) * rr * 0.5; pos[i * 3 + 1] = c.y + life * 0.9; pos[i * 3 + 2] = c.z + Math.sin(a) * rr * 0.5; }
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 0.9 * fade;
    };
    S.hide = () => { pts.visible = false; };
    return S;
  }

  /** @param {THREE.Vector3} [lookTarget] 旅人头顶世界坐标 */
  update(dt, lookTarget) {
    for (const k of Object.keys(this.cool)) this.cool[k] = Math.max(0, this.cool[k] - dt);
    if (this.ult) this._updateUlt(dt, lookTarget);
    if (this.rift) this._updateRift(dt);
    this._updateWings(dt);
    // 坐姿、门脚本或飞行切换接管人物后，旧冲刺不再覆盖位置。
    if (this._dash && (this.ctl.locked || this.ctl._scripted || this._dash.flying !== this.ctl.fly)) this._dash = null;
    // 冲刺位移
    if (this._dash) {
      const d = this._dash; d.t += dt;
      const k = easeOutCubic(clamp(d.t / DASH_TIME, 0, 1));
      this.ctl.pos.lerpVectors(d.start, d.end, k);
      this._resolveDashPosition(this.ctl.pos, d.flying);
      this.ctl.speed = PLAYER.runSpeed * 1.4;
      this.ctl.vel.set(0, 0, 0);
      if (d.t >= DASH_TIME) this._dash = null;
    }
    // 相机 FOV 一顿（0.35 s）
    if (this._fovPunch > 0) {
      this._fovPunch += dt;
      const k = clamp(this._fovPunch / 0.35, 0, 1);
      this.camera.fov = this._baseFov + 9 * Math.sin(Math.PI * k);
      this.camera.updateProjectionMatrix();
      if (k >= 1) { this._fovPunch = 0; this.camera.fov = this._baseFov; this.camera.updateProjectionMatrix(); }
    }
    // 一次性效果
    for (let i = this.effects.length - 1; i >= 0; i--) { if (!this.effects[i].update(dt)) { this.effects[i].dispose(); this.effects.splice(i, 1); } }
    // 魔法阵：0.6 s 展开、7 s 存续、1 s 淡出；缓慢自转；最新的一座给近身灯位报一次需求
    for (let i = this.hexes.length - 1; i >= 0; i--) {
      const h = this.hexes[i]; h.t += dt;
      const grow = easeOutCubic(clamp(h.t / 0.6, 0, 1));
      const fade = h.t > HEX_LIFE ? clamp(1 - (h.t - HEX_LIFE) / 1.0, 0, 1) : 1;
      h.g.scale.setScalar(this.reducedMotion ? 1 : Math.max(0.001, grow));
      h.g.rotation.z = this.reducedMotion ? 0 : -Math.PI / 2 * (1 - grow) + h.t * 0.25;
      const appearance = this.reducedMotion ? grow : 1;
      for (const m of h.mats) m.opacity = fade * m.userData.base * appearance;
      h.sigil.setOpacity(0.95 * fade * appearance);
      h.sigil.update(dt);
      h.sparks.update(dt, fade * grow);
      if (i === this.hexes.length - 1 && fade > 0) this.fxNear.request(_v.set(h.g.position.x, h.g.position.y + 1.2, h.g.position.z), COLORS.bright, 2.4 * fade * grow, 9, 2);
      if (h.t > HEX_LIFE + 1.0) { this._releaseHex(h); this.hexes.splice(i, 1); }
    }
    // 变身光（character.js 只记需求，不再自带 PointLight）
    const fl = this.w.formLight;
    if (fl && fl.intensity > 0) this.fxNear.request(_v.copy(this.w.root.position).add(fl.position), fl.color, fl.intensity, 7, 1.5);
    // 玫瑰
    this.rose.update(dt, this.camera, lookTarget);
    if (this._roseGlow.intensity > 0) this.fxSky.request(this._roseGlow.position, 0xf2e2c0, this._roseGlow.intensity, 150, 1.0); // X-001 去紫：玫瑰天光紫 → 暖白（比大招天光 0xe0bd7c 中性一档，蓝黑花瓣不被照黄）
    this.fxNear.apply();
    this.fxSky.apply();
  }
}
