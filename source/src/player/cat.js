// 白猫：跟在旅人身后左侧的小伙伴。程序几何 + 赛璐璐；会走 / 小跑跟随、停下坐着、时不时看向主人、甩尾巴、抖耳朵；
// 跟随用平滑追踪 + 船的解析碰撞（不会掉出栏杆），进门脚本时跟进门厅。
import * as THREE from 'three';
import { makeCatLeg, poseCatPaws, makeCatTail, updateCatTail } from './cat-poses.js';
import { lerp, clamp, damp, angleDelta } from '../util/easing.js';

let _grad = null;
function gradientMap() {
  if (_grad) return _grad;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  _grad = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat); _grad.minFilter = _grad.magFilter = THREE.NearestFilter; _grad.needsUpdate = true;
  return _grad;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra });

export class Cat {
  constructor({ collider, reducedMotion = false } = {}) {
    this.collider = collider;
    this.reducedMotion = reducedMotion;
    this.root = new THREE.Group(); this.root.name = 'cat';
    this.heading = 0;
    this.vel = new THREE.Vector3();
    this.time = 0; this.phase = 0; this.speed = 0;
    this.sit = 0;           // 0 站 → 1 坐（平滑）
    this.idleT = 0;
    this.earTwitch = 0; this.nextTwitch = 3;
    this.lookAtOwner = 0;
    this._build();
  }

  _build() {
    const fur = toon(0xf6f3ee), furShade = toon(0xe6e1d8), pink = toon(0xf0a0a8), dark = toon(0x1a1418);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd9b34a).multiplyScalar(1.0), fog: false });
    const R = this.parts = {};
    // 身体（胶囊，趴 / 坐时缩放）
    R.body = new THREE.Group(); R.body.position.y = 0.2; this.root.add(R.body);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 6, 12), fur); torso.rotation.x = Math.PI / 2; torso.castShadow = true; R.body.add(torso);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), furShade); belly.position.set(0, -0.03, 0.02); belly.scale.set(1, 0.7, 1.3); R.body.add(belly);
    // 头
    R.head = new THREE.Group(); R.head.position.set(0, 0.11, 0.2); R.head.scale.setScalar(1.12); R.body.add(R.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), fur); skull.scale.set(1.05, 0.95, 1); skull.castShadow = true; R.head.add(skull);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), fur); muzzle.position.set(0, -0.03, 0.08); muzzle.scale.set(1.2, 0.8, 1); R.head.add(muzzle);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), pink); nose.position.set(0, -0.02, 0.125); R.head.add(nose);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat); eye.position.set(s * 0.04, 0.015, 0.09); eye.scale.set(0.9, 1.15, 0.6); R.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), dark); pupil.position.set(s * 0.04, 0.015, 0.101); pupil.scale.set(0.5, 1.4, 0.5); R.head.add(pupil);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 4), fur); ear.position.set(s * 0.06, 0.09, -0.01); ear.rotation.z = -s * 0.3; ear.castShadow = true; R.head.add(ear);
      const earIn = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), pink); earIn.position.set(s * 0.06, 0.085, 0.005); earIn.rotation.z = -s * 0.3; R.head.add(earIn);
      R['ear' + (s < 0 ? 'L' : 'R')] = ear; R['earIn' + (s < 0 ? 'L' : 'R')] = earIn;
      // 胡须
      for (const dy of [-0.005, 0.01]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.09, 4), furShade); w.rotation.z = Math.PI / 2; w.position.set(s * 0.07, -0.03 + dy, 0.105); w.rotation.y = s * 0.25; R.head.add(w); }
    }
    const leg=(x,z,hind)=>makeCatLeg(R.body,{x,y:-.047,z,upper:hind?.086:.074,lower:hind?.094:.076,radius:hind?.03:.026,pawRadius:.035,material:fur,hind});
    R.legFL=leg(-.06,.105,false); R.legFR=leg(.06,.105,false);
    R.legBL=leg(-.065,-.1,true); R.legBR=leg(.065,-.1,true);
    R.catLegs=[R.legFL,R.legFR,R.legBL,R.legBR];
    const tail=makeCatTail(R.body,fur,new THREE.Vector3(0,.04,-.17),{count:5,step:.065,radius:.022});
    R.tail=tail.joints; R.tailMesh=tail.mesh;
    poseCatPaws(this.root,R.catLegs,{phase:0,speed:0,size:.5});
    updateCatTail(R.tailMesh);
  }

  /** 放到主人身后 */
  place(x, z, heading) { this.root.position.set(x, 0, z); this.heading = heading; this.root.rotation.y = heading; this.collider.resolve(this.root.position, 0.18); }

  /**
   * @param {number} dt
   * @param {{pos:THREE.Vector3, heading:number, speed:number, inHall:boolean}} owner 主人（船局部坐标）
   */
  update(dt, owner) {
    this.time += dt;
    const P = this.parts;
    // 目标点：主人身后 1.3 m、左手边 0.7 m（面朝 +z 时左手是 +x）；owner.goal 给了就直奔那个点（6 技能：钻进黑洞）
    const fx = Math.sin(owner.heading), fz = Math.cos(owner.heading);
    const lx = fz, lz = -fx; // 左手方向
    // Explicit private scenes may invite the companion to a nearby floor spot.
    // A real skill goal always takes precedence; the scene releases its token.
    const goal = owner.goal || this.privateSceneGoal;
    const tx = goal ? goal.x : owner.pos.x - fx * 1.3 + lx * 0.7, tz = goal ? goal.z : owner.pos.z - fz * 1.3 + lz * 0.7;
    const dx = tx - this.root.position.x, dz = tz - this.root.position.z;
    const dist = Math.hypot(dx, dz);
    // 跟随：距离越远越快（最快 6.5 m/s），近处不动（死区 0.35）
    let want = dist > 0.35 ? clamp((dist - 0.35) * 3.2, 0, 6.5) : 0;
    if (dist > 14) { this.root.position.set(tx, this.root.position.y, tz); want = 0; } // 落太远直接追上（比如冲刺 / 传送）
    const vx = dist > 1e-4 ? dx / dist * want : 0, vz = dist > 1e-4 ? dz / dist * want : 0;
    this.vel.x = lerp(this.vel.x, vx, damp(8, dt)); this.vel.z = lerp(this.vel.z, vz, damp(8, dt));
    this.root.position.x += this.vel.x * dt; this.root.position.z += this.vel.z * dt;
    this.collider.resolve(this.root.position, 0.18, { ignoreCabinWall: owner.inHall });
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // 朝向：动时朝运动方向；停下且主人不动时看主人
    if (this.speed > 0.15) { const wantH = Math.atan2(this.vel.x, this.vel.z); this.heading += angleDelta(this.heading, wantH) * damp(10, dt); this.lookAtOwner = lerp(this.lookAtOwner, 0, damp(4, dt)); }
    else { this.lookAtOwner = lerp(this.lookAtOwner, 1, damp(2, dt)); }
    this.root.rotation.y = this.heading;
    // 坐下：主人与自己都静止 > 2.5 s
    if (this.speed < 0.1 && owner.speed < 0.1) this.idleT += dt; else this.idleT = 0;
    this.sit = lerp(this.sit, this.idleT > 2.5 ? 1 : 0, damp(3, dt));
    // 步态
    const stride = 0.55;
    if (this.speed > 0.05) this.phase += dt * Math.PI * 2 * this.speed / stride; else this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, damp(6, dt));
    const motion=clamp(this.speed/3,0,1);
    P.body.rotation.set(-.38*this.sit,0,0);
    P.body.position.y=lerp(.2,.163,this.sit)+Math.sin(this.phase*2)*.003*motion-.023*motion*(1-this.sit);
    poseCatPaws(this.root,P.catLegs,{phase:this.phase,speed:this.speed,sit:this.sit,run:motion,size:.5});
    // 头：看主人（水平转 + 俯仰）
    const toOwnerX = owner.pos.x - this.root.position.x, toOwnerZ = owner.pos.z - this.root.position.z;
    const relYaw = angleDelta(this.heading, Math.atan2(toOwnerX, toOwnerZ));
    P.head.rotation.y = clamp(relYaw, -1.1, 1.1) * this.lookAtOwner;
    P.head.rotation.x = -P.body.rotation.x-.12*this.lookAtOwner+(this.reducedMotion?0:.025*Math.sin(this.time*.7))*(1-this.sit);
    // 耳朵偶尔一抖
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) { this.earTwitch = 0.25; this.nextTwitch = 2.5 + Math.random() * 4; this._twitchSide = Math.random() < 0.5 ? 'L' : 'R'; }
    for(const side of ['L','R']) P['ear'+side].rotation.x=P['earIn'+side].rotation.x=0;
    if (this.earTwitch > 0) { this.earTwitch -= dt; const k = Math.sin(Math.PI * clamp(this.earTwitch / 0.25, 0, 1)); const e = P['ear' + this._twitchSide], ei = P['earIn' + this._twitchSide]; e.rotation.x = ei.rotation.x = -0.6 * k; }
    // 尾巴：走时左右摆，坐时卷起、尖端轻扫
    const sway=this.reducedMotion?0:Math.sin(this.time*1.8)*(.2+.15*motion);
    for (let i = 0; i < P.tail.length; i++) {
      const j = P.tail[i];
      j.rotation.x = lerp(-0.9 + i * 0.28, -1.2 + i * 0.55, this.sit) + (this.reducedMotion?0:Math.sin(this.time*1.6+i*.7)*.04);
      j.rotation.z = sway * (0.25 + i * 0.12) * (1 - this.sit * 0.6) + (this.reducedMotion?0:this.sit * Math.sin(this.time * 1.1 + i) * 0.1 * i / 4);
    }
    updateCatTail(P.tailMesh);
  }
}
