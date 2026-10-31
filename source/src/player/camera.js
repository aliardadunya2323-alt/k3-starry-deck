// 相机两档：第三人称（球坐标弹簧 + 遮挡缩距）↔ 宇宙视角（OrbitControls 围绕船中心 12–520 m）。
// 同一个 distance 标量驱动：第三人称 2–8；> 8 → 0.6 s 过渡到轨道相机；轨道拉回到 ≤ 12 再滚一下 → 0.6 s 回到甲板。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from '../config.js';
import { clamp, lerp, damp, easeInOutCubic } from '../util/easing.js';

const _dir = new THREE.Vector3(), _desired = new THREE.Vector3(), _look = new THREE.Vector3(), _off = new THREE.Vector3();
const _lookOffset = new THREE.Vector3(0, 0.32, 0);
const _ray = new THREE.Raycaster();

export class CameraRig {
  constructor(camera, domElement, { occluders = [], reducedMotion = false } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.occluders = occluders;
    this.reducedMotion = reducedMotion;
    this.mode = 'deck'; // deck | toUniverse | universe | toDeck
    this.inputLocked = false; // 菜单输入锁在相机过渡结束后仍有效。
    this.yaw = Math.PI;            // 相机在目标的哪个方向：π = 目标的 −z 侧（人物面朝 +z 时在背后）
    this.pitch = CAMERA.pitch;
    this.distance = CAMERA.distance;
    this.occlDist = this.distance;
    this.pos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.target = new THREE.Vector3();      // 人物头顶（世界）
    this.lookScale = 1;                     // 看点抬高量的倍数（_lookOffset 0.32 是按 1.8 m 的人调的；猫形态 0.62 m 高，main.js 给 0.3，否则镜头从头顶俯视）
    this.lookDrop = 0;                      // 仅坐姿的视点下移（米）。0 = 站立。不写入 target，避免一帧内两次求位姿叠减
    this.universeBlend = 0;
    this.roomFraming = null; // Optional room constraint, selected by LevelSystem.
    this.orbitTarget = new THREE.Vector3(...CAMERA.universe.target);
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enabled = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = CAMERA.universe.minDistance;
    this.controls.maxDistance = CAMERA.universe.maxDistance;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.target.copy(this.orbitTarget);
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.9;
    this._trans = null;
    this.listeners = new Map();
    this.exitCooldown = 0;
    this.initialized = false;
    this._occlHold = 0; this._occlLast = this.distance;
    this._avatarHidden = false;
  }

  on(evt, fn) { (this.listeners.get(evt) || this.listeners.set(evt, []).get(evt)).push(fn); return this; }
  emit(evt, data) { for (const fn of this.listeners.get(evt) || []) fn(data); }

  /** 坐姿落差。非有限或非正数视为 0，站立路径与改前一致。 */
  _seatedDrop() {
    // Private apartment rest owns a separate, signed offset. The general
    // SeatSystem clears lookDrop every idle frame; neither system steals the
    // other's state. A cat on the raised cushion needs an upward offset.
    if (Number.isFinite(this.privateRestLookDrop)) return this.privateRestLookDrop;
    const drop = this.lookDrop;
    return Number.isFinite(drop) && drop > 0 ? drop : 0;
  }

  setInputLocked(locked) { this.inputLocked = !!locked; this._syncControls(); }
  _syncControls() { this.controls.enabled = this.mode === 'universe' && !this.inputLocked; }

  /** 第三人称期望位置（不含遮挡）。yaw / pitch / distance / target 都不改。 */
  _thirdPersonPose(outPos, outLook, distance = this.distance) {
    // A bed POV must not inherit the temporarily hidden avatar's form scale.
    const lookScale = Number.isFinite(this.privateRestLookScale) ? this.privateRestLookScale : this.lookScale;
    _dir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    outPos.copy(this.target).addScaledVector(_dir, distance);
    // Subtle shoulder parallax separates the head from centre-line masts.
    // Fade in close quarters; keeps camera within actor's safety envelope to avoid side wall/doorway penetration.
    const closeFrac = clamp((distance - 0.65) / 1.4, 0, 1);
    const shoulder = 0.32 * lookScale * closeFrac * Math.min(1, this.camera.aspect);
    outPos.x += Math.cos(this.yaw) * shoulder;
    outPos.z -= Math.sin(this.yaw) * shoulder;
    // 轻抬视点但为底部 HUD 留出身体空间；肩侧位移避免中轴背景相切。
    // 近距平滑降低看点高度 (0.18~0.32m)，消除遮挡缩距时仰拍天花板并将前方交互 UI/E 提示顶出视口的问题；
    // 机位本身不额外抬高，严格避免低顶天花板穿插风险。
    const lookElev = (0.18 + 0.14 * closeFrac) * lookScale;
    outLook.copy(this.target);
    outLook.y += lookElev;
    const drop = this._seatedDrop();
    if (drop) { outPos.y -= drop; outLook.y -= drop; }
    if (this.roomFraming) this.roomFraming.frame(outPos, outLook, this, distance);
  }

  /** 轨道相机的一个位姿（用当前 yaw 保持方向连续） */
  _orbitPose(outPos, outLook, distance, elev) {
    const pitch = Math.max(this.pitch, elev);
    _dir.set(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    outPos.copy(this.orbitTarget).addScaledVector(_dir, distance);
    outLook.copy(this.orbitTarget);
  }

  _startTransition(to, endDistance, duration, elev = 0.3, yawOffset = 0) {
    const startPos = this.camera.position.clone();
    const startLook = this.lookAt.clone();
    const endPos = new THREE.Vector3(), endLook = new THREE.Vector3();
    if (to === 'universe') { this.yaw += yawOffset; this._orbitPose(endPos, endLook, endDistance, elev); }
    this._trans = { to, t: 0, duration, startPos, startLook, endPos, endLook, endDistance };
    this.mode = to === 'universe' ? 'toUniverse' : 'toDeck';
    this._avatarHidden = false;
    this._syncControls();
    this.emit('modechange', this.mode);
  }

  /** yawOffset：脚本运镜（望远镜台）用它把机位转到船的 3/4 侧后方，比正后方好看 */
  enterUniverse(distance = 14, duration = CAMERA.universe.transition, elev = 0.3, yawOffset = 0) {
    if (this.mode === 'universe' || this.mode === 'toUniverse') return;
    if (this.noUniverse) { this.distance = Math.min(this.distance, CAMERA.maxDistance); return; } // 船内三层：不许升到宇宙视角（LevelSystem 置位）
    this._startTransition('universe', distance, duration, elev, yawOffset);
  }

  frameUniverse(distance) {
    if (!Number.isFinite(distance) || distance <= 0 || this.noUniverse) return false;
    const transition = this._trans;
    if (transition ? transition.to !== 'universe' : this.mode !== 'universe') return false;
    const position = transition ? transition.endPos : this.camera.position;
    const target = transition ? transition.endLook : this.controls.target;
    if (position.distanceToSquared(target) < 1e-8) return false;
    const bounded = clamp(distance, this.controls.minDistance, this.controls.maxDistance);
    position.sub(target).normalize().multiplyScalar(bounded).add(target);
    if (!transition) { this.camera.lookAt(target); this.controls.update(); }
    return true;
  }

  /** duration：从远处整船景回甲板时可放慢，镜头一路滑回人物背后，不是一下跳回去 */
  exitUniverse(duration = CAMERA.universe.transition) {
    if (this.mode === 'deck' || this.mode === 'toDeck') return;
    this.distance = CAMERA.maxDistance - 0.6;
    this.occlDist = this.distance;
    this._avatarHidden = false;
    this._startTransition('deck', this.distance, duration);
    this.exitCooldown = 0.5;
  }

  /** 直接进入宇宙视角（?view=universe）；默认机位在船的 3/4 侧后上方 */
  snapUniverse(distance = 60, yawOffset = 0.85) {
    this.yaw += yawOffset;
    this._orbitPose(this.camera.position, this.lookAt, distance, 0.42);
    this.camera.lookAt(this.lookAt);
    this.mode = 'universe';
    this._avatarHidden = false;
    this.controls.target.copy(this.orbitTarget);
    this._syncControls();
    this.controls.update();
    this.initialized = true;
    this.emit('modechange', this.mode);
  }

  /** 遮挡：从目标向相机打射线，命中则缩到命中点前 0.3 m */
  _occlusion(desiredDist) {
    if (!this.occluders.length) return desiredDist;
    // 射线从补偿后的视点出发。不改 this.target，否则同帧第二次求位姿会再减一次。
    _off.copy(this.target);
    const drop = this._seatedDrop();
    if (drop) _off.y -= drop;
    _dir.subVectors(_desired, _off);
    const len = _dir.length();
    if (len < 1e-4) return desiredDist;
    _dir.divideScalar(len);
    _ray.set(_off, _dir);
    _ray.far = len;
    const hits = _ray.intersectObjects(this.occluders, false);
    if (hits.length) return Math.max(0.6, hits[0].distance - CAMERA.occlusionPad);
    return desiredDist;
  }

  /**
   * @param {number} dt
   * @param {{look:{x,y}, zoom:number}} input
   * @param {THREE.Vector3} targetWorld 人物头顶世界坐标
   */
  update(dt, input, targetWorld) {
    if (this.inputLocked) input = { look: { x: 0, y: 0 }, zoom: 0 };
    this._syncControls();
    this.target.copy(targetWorld);
    this.exitCooldown = Math.max(0, this.exitCooldown - dt);
    const interacting = Math.abs(input.zoom) > 1e-6 || Math.abs(input.look.x) + Math.abs(input.look.y) > 0;

    if (this._trans) {
      const tr = this._trans;
      if (interacting && tr.duration > 1) { // 望远镜台的脚本运镜可被打断
        tr.t = tr.duration;
      }
      tr.t += dt;
      const k = easeInOutCubic(tr.t / tr.duration);
      if (tr.to === 'deck') { this._thirdPersonPose(tr.endPos, tr.endLook, this.distance); }
      this.camera.position.lerpVectors(tr.startPos, tr.endPos, k);
      if (this.roomFraming) this.roomFraming.constrain(this.camera.position, this.target, this._seatedDrop());
      this.lookAt.lerpVectors(tr.startLook, tr.endLook, k);
      this.camera.lookAt(this.lookAt);
      this.universeBlend = tr.to === 'universe' ? lerp(0, 0.45, k) : lerp(0.45, 0, k);
      if (tr.t >= tr.duration) {
        this._trans = null;
        if (tr.to === 'universe') {
          this.mode = 'universe';
          this.controls.target.copy(this.orbitTarget);
          this._syncControls();
          this.controls.update();
        } else {
          this.mode = 'deck';
          this.pos.copy(this.camera.position);
          this.occlDist = this.distance;
        }
        this.emit('modechange', this.mode);
      }
      return;
    }

    if (this.mode === 'universe') {
      this.controls.update();
      this.lookAt.copy(this.controls.target);
      const d = this.camera.position.distanceTo(this.controls.target);
      this.universeBlend = 0.45 + 0.55 * clamp((d - 12) / 260, 0, 1);
      // 记住方位，回甲板时方向连续
      _off.subVectors(this.camera.position, this.controls.target);
      this.yaw = Math.atan2(_off.x, _off.z);
      this.pitch = clamp(Math.asin(clamp(_off.y / (_off.length() || 1), -1, 1)), CAMERA.minPitch, CAMERA.maxPitch);
      if (input.zoom < -1e-6 && d <= CAMERA.universe.exit + 0.05 && this.exitCooldown === 0) this.exitUniverse();
      return;
    }

    // ---- 第三人称 ----
    if (input.look.x || input.look.y) {
      this.yaw -= input.look.x * 0.0042;
      this.pitch = clamp(this.pitch + input.look.y * 0.0032, CAMERA.minPitch, CAMERA.maxPitch);
    }
    if (input.zoom) {
      const limits=this.transportDistanceRange;
      this.distance = clamp(this.distance + input.zoom * (limits ? Math.max(.7,this.distance*.08) : .7), limits?.min??CAMERA.minDistance, limits?.max??(CAMERA.maxDistance+.6));
      if (!limits && this.distance > CAMERA.universe.enter && this.exitCooldown === 0) { this.enterUniverse(CAMERA.universe.minDistance + 2); return; }
      this.distance = Math.min(this.distance, limits?.max??CAMERA.maxDistance);
    }
    this._thirdPersonPose(_desired, _look);
    let occl = this._occlusion(this.distance);
    // 滞回：射线在遮挡边缘时会一帧命中一帧不命中，直接跟着走相机就会前后颤——记住最近一次命中 0.25 s
    if (occl < this.distance - 1e-3) { this._occlHold = 0.25; this._occlLast = occl; }
    else if (this._occlHold > 0) { this._occlHold -= dt; occl = Math.min(this.distance, this._occlLast); }
    // 遇挡快缩（约 0.08 s 到位，不是瞬跳）、松开 0.4 s 回弹
    // A newly snapped arrival has no preceding camera motion to ease. Start
    // inside the first obstruction; otherwise the first frames can see a wall
    // from outside after a floor lift or a room entry. Normal motion still eases.
    if (!this.initialized) this.occlDist = occl;
    else if (occl < this.occlDist) this.occlDist = lerp(this.occlDist, occl, this.reducedMotion ? 1 : damp(30, dt));
    else this.occlDist = lerp(this.occlDist, occl, damp(1 / 0.4 * 2.5, dt));
    this._thirdPersonPose(_desired, _look, this.occlDist);
    if (!this.initialized) { this.pos.copy(_desired); this.lookAt.copy(_look); this.initialized = true; }
    const k = this.reducedMotion ? 1 : damp(CAMERA.spring, dt);
    this.pos.lerp(_desired, k);
    if (this.roomFraming) this.roomFraming.constrain(this.pos, this.target, this._seatedDrop());
    this.camera.position.copy(this.pos);
    this.lookAt.lerp(_look, this.reducedMotion ? 1 : damp(CAMERA.spring * 1.4, dt));
    this.camera.lookAt(this.lookAt);
    this.universeBlend = 0;
  }

  /** 门脚本：dolly 到 distance / pitch（0.9 s） */
  dolly(distance, pitchRad) {
    this._dollyFrom = { d: this.distance, p: this.pitch };
    this._dollyTo = { d: distance, p: pitchRad };
    this._dollyT = 0;
  }
  updateDolly(dt) {
    if (!this._dollyTo) return;
    this._dollyT += dt / 0.9;
    const k = easeInOutCubic(this._dollyT);
    this.distance = lerp(this._dollyFrom.d, this._dollyTo.d, k);
    this.pitch = lerp(this._dollyFrom.p, this._dollyTo.p, k);
    this.occlDist = Math.min(this.occlDist, this.distance);
    if (this._dollyT >= 1) this._dollyTo = null;
  }

  /** 把相机放到人物背后（出生 / 返回时） */
  snapBehind(heading) {
    this.yaw = heading + Math.PI;
    this.pitch = CAMERA.pitch;
    this.distance = CAMERA.distance;
    this.occlDist = this.distance;
    this._avatarHidden = false;
    this.initialized = false;
  }
  /**
   * 贴墙近距遮挡时判定是否暂时隐藏角色，避免大头遮满屏幕；
   * 距离以相机与角色头部世界距离为准，带滞回（< 1.8 m 隐藏，>= 2.0 m 恢复）。
   * 仅在 deck 模式生效；其他视角模式不隐藏。
   */
  shouldHideAvatar(headPos) {
    if (this.mode !== 'deck') {
      this._avatarHidden = false;
      return false;
    }
    const head = headPos || this.target;
    const dist = this.camera.position.distanceTo(head);
    if (this._avatarHidden) {
      if (dist >= 2.0) this._avatarHidden = false;
    } else {
      if (dist < 1.8) this._avatarHidden = true;
    }
    return this._avatarHidden;
  }
}
