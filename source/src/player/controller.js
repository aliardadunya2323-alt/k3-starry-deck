// 第三人称控制器：输入 → 相对相机方向的速度（加速 14 / 减速 18）→ 解析碰撞 → 位置；人物朝移动方向转身（12 rad/s）。
// 人物是船 group 的子节点，所有坐标都在船的局部空间里。
import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { angleDelta, damp } from '../util/easing.js';

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _wish = new THREE.Vector3();
const _target = new THREE.Vector3(), _diff = new THREE.Vector3(), _before = new THREE.Vector3(), _pushed = new THREE.Vector3();
const CAT_JUMP_SCALE = Math.sqrt(1.4);

export class Controller {
  constructor(wanderer, collider) {
    this.w = wanderer;
    this.collider = collider;
    this.pos = wanderer.root.position;   // 脚底，船局部坐标
    this.vel = new THREE.Vector3();
    this.locked = false;                 // 门脚本 / 菜单锁输入
    this.speed = 0;
    this.vy = 0;                         // 竖直速度（跳跃）
    this.airborne = false;
    this.gravity = 13;
    this.jumpSpeed = 4.6;                // 跳高 ≈ v²/2g ≈ 0.81 m
    this.onLand = null;
    this.speedScale = 1;                 // 技能临时改速（6 技能黑洞虚影 1.6×、且一律按跑速）
    // E.1：形态手感独立于技能速度。jumpScale 是“高度”倍率，因此内部使用
    // sqrt(1.4)，避免把初速度乘 1.4 导致实际跳高变成 1.96 倍。
    this.forceRun = false;
    // W-004（主人 09-08 12:00）：技能改空间规则的三个开关，默认全关 = 原行为
    this.noclip = false;                 // 6 黑洞虚影：不解析碰撞、不受重力，高度不变——穿墙 / 穿船 / 出船
    this.fly = false;                    // 7 翅膀：无重力，朝镜头看的方向飞 + Space 升 / C 降，速度 flySpeed（Shift ×flyBoost）
    this.flyPitch = 0;                   // 相机俯仰（skills 每帧从 camRig 抄过来），W 键沿视线方向飞
    this.flySpeed = PLAYER.runSpeed * 2.2; this.flyBoost = 2.0;
    this.stone = null;                   // 落脚石 { x, z, y, r }：出洞 / 收翅时脚下没地面，就站在这枚悬空法阵上（只能在盘内走动，可跳）
    this.bounds = null;                  // noclip / fly 的活动范围 { cx, cz, radius, minY, maxY } 或 { xMin, xMax, zMin, zMax, minY, maxY }（防走丢）
    this.onGround = true;                // 上一帧脚下是真实地面（不是落脚石、不在飞）
  }

  // 只从当前形态派生，黑洞 / 质量档 / teleport 不会覆盖；__k3.controller 可直接读。
  get formMoveScale() { return this.w.form === 'cat' ? 1.25 : 1; }
  get formJumpScale() { return this.w.form === 'cat' ? 1.4 : 1; } // 高度倍率

  /** 空格：起跳（脚本 / 菜单锁定时不跳；飞行 / 虚影中不跳） */
  jump() {
    if (this.locked || this.airborne || this._scripted || this.fly || this.noclip) return false;
    this.vy = this.jumpSpeed * (this.w.form === 'cat' ? CAT_JUMP_SCALE : 1);
    this.airborne = true;
    this.pos.y += 0.001;
    return true;
  }

  /** 把人物放到某处并面朝 heading（切层 / 法阵传送用：同时退出飞行 / 虚影 / 落脚石） */
  teleport(x, z, heading = 0) {
    this.fly = false; this.noclip = false; this.stone = null; this.airborne = false; this.vy = 0;
    this.pos.set(x, 0, z);
    this.collider.resolve(this.pos, PLAYER.radius);
    this.vel.set(0, 0, 0);
    this.w.heading = heading;
    this.w.root.rotation.y = heading;
  }

  /** 把 pos 限制在 bounds 里（noclip / fly 用），返回是否碰到了边 */
  _clampBounds(pos = this.pos) {
    const b = this.bounds; if (!b) return false;
    let hit = false;
    if (b.radius !== undefined) {
      const dx = pos.x - b.cx, dz = pos.z - b.cz, d = Math.hypot(dx, dz);
      if (d > b.radius) { const k = b.radius / d; pos.x = b.cx + dx * k; pos.z = b.cz + dz * k; hit = true; }
    } else {
      if (pos.x < b.xMin) { pos.x = b.xMin; hit = true; } else if (pos.x > b.xMax) { pos.x = b.xMax; hit = true; }
      if (pos.z < b.zMin) { pos.z = b.zMin; hit = true; } else if (pos.z > b.zMax) { pos.z = b.zMax; hit = true; }
    }
    if (pos.y < b.minY) { pos.y = b.minY; hit = true; } else if (pos.y > b.maxY) { pos.y = b.maxY; hit = true; }
    return hit;
  }

  /** 飞行：速度向量沿相机视线（含俯仰）+ 竖直键；无重力无碰撞，只受 bounds */
  _updateFly(dt, input, cameraYaw, response = null) {
    const mv = this.locked ? { x: 0, y: 0 } : input.move;
    const boost = !this.locked && input.run;
    const cp = Math.cos(this.flyPitch), spch = Math.sin(this.flyPitch);
    // 相机在 yaw / pitch 方向上看向目标：前 = −dir（水平分量 −sin/−cos yaw，竖直分量 −sin pitch：相机往下看，W 就往下飞）
    _fwd.set(-Math.sin(cameraYaw) * cp, -spch, -Math.cos(cameraYaw) * cp);
    _right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw)); // 与地面模式同一个「右」（−fwd.z, fwd.x）
    _wish.set(0, 0, 0).addScaledVector(_fwd, mv.y).addScaledVector(_right, mv.x);
    if (!this.locked) { if (input.up) _wish.y += 1; if (input.down) _wish.y -= 1; }
    const wishLen = Math.min(1, _wish.length());
    if (wishLen > 0.001) _wish.normalize();
    const maxSpeed = this.flySpeed * (boost ? this.flyBoost : 1) * wishLen;
    _target.copy(_wish).multiplyScalar(maxSpeed);
    _diff.copy(_target).sub(this.vel);
    // A chart-scale transport may supply response in m/s² for this call only.
    // Existing wings, local dragon flight and walking retain their defaults.
    const step = (wishLen > 0.001 ? response?.acceleration ?? 16 : response?.braking ?? 10) * dt;
    if (_diff.length() <= step) this.vel.add(_diff); else this.vel.addScaledVector(_diff.normalize(), step);
    if (this.vel.lengthSq() < 1e-6) this.vel.set(0, 0, 0);
    this.pos.addScaledVector(this.vel, dt);
    this._clampBounds();
    this.airborne = true; this.vy = 0; this.onGround = false;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.4) { const want = Math.atan2(this.vel.x, this.vel.z); this.w.heading += angleDelta(this.w.heading, want) * damp(PLAYER.turnRate, dt); }
  }

  /**
   * @param {number} dt
   * @param {{move:{x,y}, run:boolean}} input
   * @param {number} cameraYaw 相机绕 y 的方位角（相机相对目标的方向），移动以它为「前」
   */
  update(dt, input, cameraYaw) {
    if (this.fly) return this._updateFly(dt, input, cameraYaw);
    const mv = this.locked ? { x: 0, y: 0 } : input.move;
    const wantRun = !this.locked && (input.run || this.forceRun);
    // 相机前向（水平）：相机在 yaw 方向上，所以「前」= −yaw 方向
    _fwd.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.set(0, 0, 0).addScaledVector(_fwd, mv.y).addScaledVector(_right, mv.x);
    const wishLen = Math.min(1, _wish.length());
    if (wishLen > 0.001) _wish.normalize();
    const maxSpeed = (wantRun ? PLAYER.runSpeed : PLAYER.walkSpeed) * wishLen * this.formMoveScale * this.speedScale;
    // 目标速度与加减速（全部复用模块级向量，不在每帧分配）
    _target.copy(_wish).multiplyScalar(maxSpeed);
    _diff.copy(_target).sub(this.vel);
    const rate = wishLen > 0.001 ? PLAYER.accel : PLAYER.decel;
    const step = rate * dt;
    if (_diff.length() <= step) this.vel.add(_diff); else this.vel.addScaledVector(_diff.normalize(), step);
    if (this.vel.lengthSq() < 1e-6) this.vel.set(0, 0, 0);
    // 位移 + 碰撞（空中：自己积分 y，落到地面高度即着陆）
    this.pos.addScaledVector(this.vel, dt);
    if (this.noclip) {
      // 6 黑洞虚影：不碰撞、不掉、高度不变，只受活动范围限制（穿墙 / 穿船 / 出船）
      this._clampBounds();
      this.airborne = false; this.vy = 0; this.onGround = false;
      this.speed = Math.hypot(this.vel.x, this.vel.z);
      if (this.speed > 0.2) { const want = Math.atan2(this.vel.x, this.vel.z); this.w.heading += angleDelta(this.w.heading, want) * damp(PLAYER.turnRate, dt); }
      return;
    }
    if (this.airborne) { this.vy -= this.gravity * dt; this.pos.y += this.vy * dt; }
    _before.copy(this.pos);
    let ground;
    if (this.stone) {
      // 落脚石：脚下只有这一枚悬空法阵——在盘内走动，走到边就停；地面高度 = 石的高度
      const s = this.stone, dx = this.pos.x - s.x, dz = this.pos.z - s.z, d = Math.hypot(dx, dz), lim = s.r - PLAYER.radius;
      if (d > lim) { const k = lim / d; this.pos.x = s.x + dx * k; this.pos.z = s.z + dz * k; }
      ground = s.y;
      if (!this.airborne) this.pos.y = ground;
      this.onGround = false;
    } else {
      ground = this.collider.resolve(this.pos, PLAYER.radius, { keepY: this.airborne });
      this.onGround = !this.airborne;
    }
    if (this.airborne && (this.pos.y <= ground + 1e-4 || this.vy < -12)) {
      this.pos.y = ground; this.airborne = false; this.vy = 0;
      if (this.onLand) this.onLand();
    }
    // 被挡住的分量从速度里去掉（贴墙滑行，不会抖）
    _pushed.copy(_before).sub(this.pos);
    _pushed.y = 0;
    if (_pushed.lengthSq() > 1e-8) { _pushed.normalize(); const along = this.vel.dot(_pushed); if (along > 0) this.vel.addScaledVector(_pushed, -along); }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // 转身
    if (this.speed > 0.2) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      const d = angleDelta(this.w.heading, want);
      this.w.heading += d * damp(PLAYER.turnRate, dt);
    }
  }

  /** 脚本：朝 heading 方向自动走 distance 米，用时 duration（门厅进入用），忽略舱室前墙 */
  async walkScripted(dirX, dirZ, distance, duration) {
    const start = this.pos.clone();
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len; dirZ /= len;
    this.w.heading = Math.atan2(dirX, dirZ);
    const speed = distance / duration;
    let t = 0;
    return new Promise((resolve) => {
      const tick = (dt) => {
        t += dt;
        const k = Math.min(1, t / duration);
        this.pos.set(start.x + dirX * distance * k, start.y, start.z + dirZ * distance * k);
        if (!this.noclip && !this.stone) this.collider.resolve(this.pos, PLAYER.radius, { ignoreCabinWall: true }); // 虚影 / 落脚石上：不解析（否则会被拽回船上）
        this.speed = speed;
        if (k >= 1) { this._scripted = null; this.speed = 0; resolve(); }
      };
      this._scripted = tick;
    });
  }

  /** 每帧由 main 调用：若有脚本在跑则推进它 */
  tickScripted(dt) { if (this._scripted) this._scripted(dt); }
}
