// Door：一扇木门的全部——门框、铰链 pivot + 门板、门上小印记、门牌、门前金色粒子、世界标签、门缝暖光、门厅、状态机。
// 状态机 idle → near → ready → opening → entering → leaving（任一时刻只有一扇门不在 idle，由 DoorSystem 保证）。
// 表现严格对照 05 §五 的表格；数字都在这里，改了写 README。
import * as THREE from 'three';
import { COLORS, DOOR, PLAYER, STORAGE, SHIP } from '../config.js';
import { woodPlanks, softDot } from '../world/textures.js';
import { clamp, lerp, easeOutCubic, damp } from '../util/easing.js';

const NEAR_DIST = 6.0, LEAVE_DIST = 7.0, READY_DIST = 2.6, READY_LEAVE = 2.9, FACING_COS = Math.cos(60 * Math.PI / 180);
const OPEN_ANGLE = -95 * Math.PI / 180, OPEN_DURATION = 0.9, ENTER_DIST = 2.4, ENTER_DURATION = 1.2, FADE_DURATION = 0.5;
const _lp = new THREE.Vector3();

let _shared = null;
function shared() {
  if (_shared) return _shared;
  const wood = woodPlanks({ palette: 'door', seed: 17, planks: 8, size: 512 });
  wood.map.repeat.set(0.75, 1.1); wood.normal.repeat.set(0.75, 1.1);
  _shared = {
    // 固有木色已在纹理中：提高乘色，避免背光门扇只剩发光徽记。
    panel: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.76, color: 0xf0d2ab, emissive: 0x35271a, emissiveIntensity: 0.16 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x785334, roughness: 0.76, emissive: 0x332619, emissiveIntensity: 0.12 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x655847, roughness: 0.48, metalness: 0.45 }),
    plate: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.35, metalness: 0.7, emissive: COLORS.goldDeep, emissiveIntensity: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x473019, emissive: new THREE.Color(COLORS.lantern), emissiveIntensity: 0.95, roughness: 0.42 }),
    dot: softDot(),
    panelGeo: (() => { const g = new THREE.BoxGeometry(DOOR.width, DOOR.height, DOOR.thickness); g.translate(DOOR.width / 2, DOOR.height / 2, 0); return g; })(),
  };
  return _shared;
}

const _lampGlass = new Map();
/** 船内房门的灯罩材质：按颜色缓存共用（22 扇门 3 种色 = 3 份材质），固有色黑、只靠自发光 0.7（< Bloom 阈值 0.85，不糊） */
function lampGlass(color) {
  const key = new THREE.Color(color).getHexString();
  if (!_lampGlass.has(key)) _lampGlass.set(key, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: 0.7, roughness: 1, metalness: 0 }));
  return _lampGlass.get(key);
}

export class Door {
  /**
   * @param {object} cfg registry 里的一项
   * @param {object} deps { sigilFactory, labels, parent(船 group), gapLight, hallLight, reducedMotion }
   */
  constructor(cfg, deps) {
    this.cfg = cfg;
    this.id = cfg.id; this.title = cfg.title; this.target = cfg.target;
    this.x = cfg.x; this.z = cfg.z; this.normal = cfg.normal;
    this.sigilColor = cfg.sigilColor; this.sigilDot = cfg.sigilDot;
    this.deps = deps;
    this.state = 'idle';
    this.time = 0;
    this.stateTime = 0;
    this.normalV = new THREE.Vector3(...cfg.normal);
    this.center = new THREE.Vector3(cfg.x, 0, cfg.z);
    this.hinge = 0;                 // 当前门板角度
    this.openT = -1;                // 开门进度计时
    this.glowTween = null;
    this.ringT = -1;
    this.handleFlash = -1;
    this.nudged = false;
    this.listeners = new Map();
    this._build();
  }

  on(evt, fn) { (this.listeners.get(evt) || this.listeners.set(evt, []).get(evt)).push(fn); return this; }
  emit(evt, data) { for (const fn of this.listeners.get(evt) || []) fn(data); }

  _build() {
    const S = shared();
    const { sigilFactory, labels, parent } = this.deps;
    const g = new THREE.Group(); g.name = 'door-' + this.id;
    g.position.set(this.x, 0, this.z);
    // 门在 z=wallZ 的墙上、朝 −z：所有局部坐标里，门外是 −z。船内三层的房间门开在 x=±3 的侧墙上（normal ±x），整组按 normal 转过去即可（甲板三门 normal (0,0,−1) → 0）
    g.rotation.y = Math.atan2(-this.normalV.x, -this.normalV.z);
    // 门框
    const jambD = SHIP.poop.wallThickness + 0.06;
    for (const s of [-1, 1]) { const j = new THREE.Mesh(new THREE.BoxGeometry(0.12, DOOR.height + 0.12, jambD), S.frame); j.position.set(s * (DOOR.width / 2 + 0.06), (DOOR.height + 0.12) / 2, jambD / 2 - 0.03); j.castShadow = true; g.add(j); }
    const head = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width + 0.24, 0.12, jambD), S.frame); head.position.set(0, DOOR.height + 0.06, jambD / 2 - 0.03); head.castShadow = true; g.add(head);
    // 门牌（金属牌 + CSS2D 文字）
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 0.03), S.plate); plate.position.set(0, DOOR.height + 0.26, -0.03); g.add(plate);
    this.plateLabel = labels.create(this.cfg.plate, { key: '', keyLabel: '' });
    this.plateLabel.el.className = 'k3-plate';
    this.plateLabel.obj.position.set(0, DOOR.height + 0.26, -0.06);
    g.add(this.plateLabel.obj);
    this.plateLabel.show();
    // 门上灯（灯体；光由 LightRig 的点光池提供）。甲板三门用 S.glass（暖光 ×0.95，保留灯罩轮廓）；
    // 船内三层的房门（cfg.lampColor 有值）在 3 m 内贴着相机，×2.4 过 Bloom 阈值后整颗灯 + 灯臂糊成一团白（09-08 长廊两侧那两团白斑就是它），
    // 改用按层色缓存的黑底自发光 0.7（同色共用一份材质）
    const lampArm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.36), S.iron); lampArm.position.set(0, DOOR.height + 0.36, -0.2); g.add(lampArm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), this.cfg.lampColor ? lampGlass(this.cfg.lampColor) : S.glass); lamp.position.set(0, DOOR.height + 0.22, -0.38); g.add(lamp);
    this.lampMesh = lamp;
    // 铰链 pivot（门框 −x 侧），门板向 +x 偏 0.8（几何已平移），绕 y 转
    this.pivot = new THREE.Group();
    this.pivot.position.set(-DOOR.width / 2, 0, 0.12);
    g.add(this.pivot);
    this.panel = new THREE.Mesh(S.panelGeo, S.panel);
    this.panel.castShadow = true; this.panel.receiveShadow = true;
    this.pivot.add(this.panel);
    // 门板上的铁箍两道 + 门把手（自由边一侧，x=1.45）
    for (const y of [0.55, 2.05]) { const band = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width - 0.1, 0.07, 0.02), S.iron); band.position.set(DOOR.width / 2, y, -DOOR.thickness / 2 - 0.01); this.pivot.add(band); }
    this.handleMat = S.plate.clone();
    const handleBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), this.handleMat); handleBase.rotation.x = Math.PI / 2; handleBase.position.set(DOOR.width - 0.18, 1.05, -DOOR.thickness / 2 - 0.02); this.pivot.add(handleBase);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 20), this.handleMat); handle.position.set(DOOR.width - 0.18, 0.98, -DOOR.thickness / 2 - 0.06); this.pivot.add(handle);
    // 门上小印记（在门板上，随门转）。deps.emblems[id] 给了各门专属的门徽工厂（B 窗口 decals.js，H-3）就用它，接口同 sigilFactory
    this.sigil = ((this.deps.emblems && this.deps.emblems[this.id]) || sigilFactory).make({ diameter: 0.92, color: this.sigilColor, dotColor: this.sigilDot, opacity: 0.95, glow: 0.15, strokeMul: 4.2 });
    this.sigil.group.position.set(DOOR.width / 2, 1.72, -DOOR.thickness / 2 - 0.02);
    this.pivot.add(this.sigil.group);
    // 印记闪耀时的光环（Ring 缩放 1→3，alpha 1→0）
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.sigilColor).multiplyScalar(1.6), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.ring.position.set(0, 1.72, -0.2); this.ring.visible = false; g.add(this.ring);
    // 门前金色粒子（Points，18 颗，1.2 s 生命循环）
    const N = 18; const pos = new Float32Array(N * 3); this.particleSeed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { this.particleSeed[i * 2] = (Math.random() - 0.5) * 1.5; this.particleSeed[i * 2 + 1] = Math.random(); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ map: S.dot, color: this.sigilColor, size: 0.09, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.particles.position.set(0, 0, -0.5); this.particles.visible = false; g.add(this.particles);
    // 世界标签（门上方 3.0 m）
    this.label = labels.create(this.cfg.label, { key: 'E', keyLabel: '' });
    this.label.obj.position.set(0, 3.45, -0.1); // 05 写 3.0，但门牌在 2.86，抬到 3.45 免得重叠
    g.add(this.label.obj);
    // 门厅：甲板三门用 hall.js 的三种（船局部坐标）；房间门给 cfg.hallBuilder(door) → 门局部坐标（+z 是门里），跟门一起转
    if (typeof this.cfg.hallBuilder === 'function') { this.hall = this.cfg.hallBuilder(this); g.add(this.hall); }
    else { this.hall = new THREE.Group(); parent.add(this.hall); }
    this.group = g;
    parent.add(g);
  }

  /** 把共享灯放到门局部坐标 (lx, ly, lz) 对应的位置（灯挂在别的父节点下，先转世界再转回去；甲板门结果与原来完全一致） */
  _placeLight(light, lx, ly, lz) {
    if (!light) return;
    _lp.set(lx, ly, lz);
    this.group.localToWorld(_lp);
    if (light.parent) light.parent.worldToLocal(_lp);
    light.position.copy(_lp);
  }

  /** 门前 dist 米、面朝门的出生点（船局部）：{x, z, heading} */
  spawnPoint(dist = 3) {
    return { x: this.x + this.normalV.x * dist, z: this.z + this.normalV.z * dist, heading: Math.atan2(-this.normalV.x, -this.normalV.z) };
  }

  _setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this._enter(s, prev);
    this.emit('state', { door: this, state: s, prev });
  }

  _tweenGlow(to, dur) { this.glowTween = { from: this.sigil.glow, to, dur, t: 0 }; }

  _enter(s, prev) {
    const { gapLight, hallLight } = this.deps;
    switch (s) {
      case 'idle':
        this._tweenGlow(0.15, 0.8);
        this.sigil.spinSpeed = 0;
        this.label.hide(); this.label.setState(''); this.label.setNudge(false);
        this.plateLabel.el.classList.remove('is-lit');
        this.particles.visible = false;
        this.hall.visible = false;
        this.nudged = false;
        break;
      case 'near':
        this._tweenGlow(0.6, prev === 'idle' ? 0.5 : 0.3);
        this.sigil.spinSpeed = this.deps.reducedMotion ? 0 : Math.PI * 2 / 6;
        this.label.show(); this.label.setState('near'); this.label.setNudge(false);
        this.plateLabel.el.classList.add('is-lit');
        this.particles.visible = true;
        this.hall.visible = true;
        break;
      case 'ready':
        this.sigil.spinSpeed = this.deps.reducedMotion ? 0 : Math.PI * 2 / 3;
        this.label.show(); this.label.setState('ready'); this._suppressDist = undefined;
        this.handleFlash = 0;
        break;
      case 'opening':
        this.openT = 0;
        this._tweenGlow(2.0, 0.25);
        this.ringT = 0; this.ring.visible = true; this.ring.scale.setScalar(1);
        this.label.setState('near'); this.label.setNudge(false); this.label.hide();
        this.group.updateMatrixWorld(true);
        this._placeLight(gapLight, 0, 1.3, 0.7); gapLight.intensity = 0;
        this._placeLight(hallLight, 0, 2.3, SHIP.poop.wallThickness + 1.6); hallLight.intensity = 0;
        break;
      case 'entering':
        break;
      case 'leaving':
        try { sessionStorage.setItem(STORAGE.lastDoor, this.id); } catch (e) { /* 忽略 */ }
        break;
    }
  }

  /** 由 DoorSystem 每帧调用 */
  update(dt, ctx) {
    this.time += dt; this.stateTime += dt;
    const { playerPos, playerHeading, active, canInteract } = ctx;
    const dx = playerPos.x - this.x, dz = playerPos.z - this.z;
    const dist = Math.hypot(dx, dz);
    const fx = Math.sin(playerHeading), fz = Math.cos(playerHeading);
    const facing = (fx * -this.normalV.x + fz * -this.normalV.z) > FACING_COS;
    this.dist = dist;

    const { candidate } = ctx; // DoorSystem 算出的「离人最近的门」；只有它能离开 idle
    switch (this.state) {
      case 'idle':
        if (dist <= NEAR_DIST && candidate === this && (active === null || active === this)) this._setState('near');
        break;
      case 'near':
        if (dist > LEAVE_DIST || (candidate && candidate !== this && candidate.dist < dist - 0.5)) this._setState('idle');
        else if (dist <= READY_DIST && facing && canInteract) this._setState('ready');
        break;
      case 'ready':
        if (dist > LEAVE_DIST || (candidate && candidate !== this && candidate.dist < dist - 0.5)) this._setState('idle');
        else if (!(dist <= READY_LEAVE && facing) || !canInteract) this._setState('near');
        else if (this.stateTime > 4 && !this.nudged) { this.nudged = true; this.label.setNudge(true); }
        break;
      case 'opening':
        this.openT += dt;
        {
          const k = easeOutCubic(this.openT / OPEN_DURATION);
          this.hinge = OPEN_ANGLE * k;
          const deg = -this.hinge * 180 / Math.PI;
          if (deg > 30) this.deps.gapLight.intensity = lerp(this.deps.gapLight.intensity, 3.5, damp(1 / 0.5 * 3, dt));
          this.deps.hallLight.intensity = lerp(this.deps.hallLight.intensity, 2.2, damp(3, dt));
          if (this.openT >= OPEN_DURATION) { this.hinge = OPEN_ANGLE; this._setState('entering'); }
        }
        break;
      case 'entering':
        this.deps.gapLight.intensity = lerp(this.deps.gapLight.intensity, 3.5, damp(6, dt));
        this.deps.hallLight.intensity = lerp(this.deps.hallLight.intensity, 3.0, damp(3, dt));
        if (this.stateTime >= ENTER_DURATION) this._setState('leaving');
        break;
      case 'leaving':
        break;
    }
    // 门板
    this.pivot.rotation.y = this.hinge;
    // 印记发光曲线
    if (this.glowTween) {
      const tw = this.glowTween; tw.t += dt;
      const k = clamp(tw.t / tw.dur, 0, 1);
      this.sigil.setGlow(lerp(tw.from, tw.to, k));
      this.sigil.targetGlow = this.sigil.glow;
      if (k >= 1) this.glowTween = null;
    }
    this.sigil.update(dt);
    // 光环
    if (this.ringT >= 0) {
      this.ringT += dt / 0.6;
      const k = clamp(this.ringT, 0, 1);
      this.ring.scale.setScalar(lerp(1, 3, k));
      this.ring.material.opacity = 1 - k;
      if (k >= 1) { this.ringT = -1; this.ring.visible = false; }
    }
    // 门把手高光闪一次
    if (this.handleFlash >= 0) {
      this.handleFlash += dt / 0.45;
      const k = clamp(this.handleFlash, 0, 1);
      this.handleMat.emissiveIntensity = 0.25 + Math.sin(k * Math.PI) * 2.4;
      this.handleMat.emissive.set(k < 1 ? COLORS.flare : COLORS.goldDeep);
      if (k >= 1) { this.handleFlash = -1; this.handleMat.emissiveIntensity = 0.25; }
    }
    // 粒子
    if (this.particles.visible) {
      const pos = this.particles.geometry.attributes.position;
      const fade = this.state === 'near' || this.state === 'ready' ? 1 : 0;
      this.particles.material.opacity = lerp(this.particles.material.opacity, 0.85 * fade, damp(4, dt));
      for (let i = 0; i < pos.count; i++) {
        const life = (this.time * (1 / 1.2) + this.particleSeed[i * 2 + 1]) % 1;
        const x = this.particleSeed[i * 2] + Math.sin(this.time * 1.7 + i) * 0.06;
        pos.setXYZ(i, x, life * 1.7, Math.cos(this.time * 1.3 + i * 2) * 0.12);
      }
      pos.needsUpdate = true;
      if (this.particles.material.opacity < 0.02 && fade === 0) this.particles.visible = false;
    }
    // 返回出生在门前时标签只亮 1.5 s；人一动（> 0.4 m）就再显示
    if (this._suppressDist !== undefined && this.state === 'near' && Math.abs(dist - this._suppressDist) > 0.4) { this._suppressDist = undefined; this.label.show(); }
    // 室内仍用第三人称 deck 模式，但不能套用甲板船尾楼的 z/y 边界。
    // 外部甲板保留防透视限制；近身提示和 14m 门牌裁剪继续走同一状态机。
    const onDoorSurface = ctx.mode === 'deck' && (this.cfg.interior === true || (playerPos.y < 1.5 && playerPos.z < SHIP.poop.wallZ + 0.6));
    this.plateLabel.obj.visible = onDoorSurface && dist < 14;
    if (!onDoorSurface && this.label.obj.visible) this.label.obj.visible = false;
    else if (onDoorSurface && (this.state === 'near' || this.state === 'ready') && !this.label.obj.visible) this.label.obj.visible = true;
  }

  /** 在 ready 状态按 E：开门流程由 DoorSystem 编排，这里只切状态 */
  open() { if (this.state === 'ready') { this._setState('opening'); return true; } return false; }

  /** 返回出生在门前：标签显示 1.5 s 后淡出，直到人动起来 */
  suppressLabelAfter(ms = 1500) {
    setTimeout(() => { if (this.state === 'near') { this._suppressDist = this.dist; this.label.hide(); } }, ms);
  }

  /** 返回时：门关、印记 near 亮度 */
  reset() {
    this.hinge = 0; this.pivot.rotation.y = 0; this.openT = -1; this.ringT = -1; this.ring.visible = false;
    this.state = 'idle'; this.stateTime = 0;
    this.sigil.setGlow(0.15); this.sigil.targetGlow = 0.15; this.sigil.spinSpeed = 0;
    this.label.hide(); this.label.setState(''); this.label.setNudge(false);
    this.particles.visible = false; this.hall.visible = false;
    this.nudged = false;
  }
}

/** 三扇门 + 望远镜台的编排：谁是 active、E 键分发、开门脚本（人物 / 相机 / UI） */
