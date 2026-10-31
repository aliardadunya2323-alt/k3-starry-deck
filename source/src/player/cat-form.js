// 猫形态（08 规划 §五 · E.1 · 窗口 C · 2026-09-08）：第三次变身——一只肩高 ≈ 0.55 m 的大黑猫，黑毛金瞳、项圈小金铃、尾巴会摇。
// 主人 §〇·6「变成一只可爱的大黑猫」+ 18:30 拍板「猫形态全部技能都能放，含大招与黑洞」→ 这里只管身体与动作，技能一律不门控。
//
// 与 character.js 的契约（Wanderer.update / _swapForm 每帧会写这些字段，缺一个就报错）：
//   R.group · R.hipsY · R.eyeHeight · R.handHeight · R.bobScale
//   R.hips（root 下，y = hipsY）→ R.torso → 身体 / R.headGroup / 前腿 R.armL R.armR / R.staff（空组，通用代码写它的旋转）
//   R.hips → 后腿 R.legL R.legR
//   R.lightAnchor：唯一那盏 staffLight 变身后挂到这里（额头）——灯数恒 9，不新建 Light
// 通用动画（走 / 跑 / 跳 / 待机 / 推门 / 抬头看星 / 挥杖）先按双足写完 legL/R · armL/R · torso · hips · headGroup，
// 再调 animateCat() 用猫的方式覆盖前腿 / 加尾巴 / 耳朵 / 金瞳 / 坐姿（look 状态 = 坐下抬头）。
// 材质全是场景里已有的变体（MeshToonMaterial + gradientMap / MeshBasicMaterial fog:false / MeshStandardMaterial）→ 0 新程序；≈ 2.6k 三角。
import * as THREE from 'three';
import { COLORS } from '../config.js';
import { lerp, clamp } from '../util/easing.js';
import { hasAsset, loadGLB } from '../util/assets.js';
import { makeCatLeg, poseCatPaws, makeCatTail, updateCatTail } from './cat-poses.js';

let _grad = null;
function gradientMap() {
  if (_grad) return _grad;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  _grad = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat); _grad.minFilter = _grad.magFilter = THREE.NearestFilter; _grad.needsUpdate = true;
  return _grad;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra });

export const CAT = { hipsY: 0.35, eyeHeight: 0.58, handHeight: 0.29, bobScale: 0.35 };

/** 建猫 rig（root 局部：+z 正前，脚底 y = 0，站姿） */
export function buildCatRig() {
  const R = {};
  const g = new THREE.Group(); g.name = 'rig-cat';
  // 毛色不是纯黑：暗甲板上纯黑只剩剪影，toon 三阶要读得出（背影靠耳朵 / 尾巴 / 铃铛认）
  const fur = toon(0x30303d), furLight = toon(0x3b3546), earIn = toon(0x4a2a34), noseMat = toon(0x2a1a22), pupilMat = toon(0x0a0a0c);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd9b34a).multiplyScalar(1.25), fog: false });
  const collarMat = new THREE.MeshStandardMaterial({ color: 0x8e2f3a, roughness: 0.7, metalness: 0.05 });
  const bellMat = new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.35, metalness: 0.75, emissive: new THREE.Color(COLORS.goldDeep), emissiveIntensity: 0.3 });
  Object.assign(R, CAT);
  R.eyeMat = eyeMat;
  R.mats = { fur, furLight, eye: eyeMat, pupil: pupilMat, nose: noseMat, earIn }; // attachCatHead 按节点名套这几个（0 新程序）
  R.headParts = [];                                                            // 程序头的零件；glb 头到位就整批藏掉

  R.hips = new THREE.Group(); R.hips.position.y = R.hipsY; g.add(R.hips);
  R.torso = new THREE.Group(); R.hips.add(R.torso);
  // 身体：胶囊沿 z，前胸略高
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), fur); body.scale.set(.19,.178,.42); body.castShadow = true; R.torso.add(body); R.body = body;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12), fur); chest.position.set(0, 0.028, 0.24); chest.scale.set(1, 1.08, 1.05); chest.castShadow = true; R.torso.add(chest);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), furLight); belly.position.set(0, -0.06, 0.02); belly.scale.set(1, 0.7, 1.5); R.torso.add(belly);
  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), fur); rump.position.set(0, 0.0, -0.28); rump.scale.set(1.05, 1, 1); rump.castShadow = true; R.torso.add(rump);

  // 头：大圆头 + 小吻 + 大金瞳（竖瞳）+ 圆耳 + 胡须；lightAnchor 在额头
  R.headGroup = new THREE.Group(); R.headGroup.position.set(0, 0.2, 0.44); R.torso.add(R.headGroup);
  const hp = (m) => { R.headGroup.add(m); R.headParts.push(m); return m; };
  const skull = hp(new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), fur)); skull.scale.set(1.08, 0.96, 1); skull.castShadow = true;
  const cheekL = hp(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), fur)); cheekL.position.set(0.1, -0.07, 0.13); cheekL.scale.set(1.1, 0.8, 0.9);
  const cheekR = hp(cheekL.clone()); cheekR.position.x = -0.1;
  const muzzle = hp(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), fur)); muzzle.position.set(0, -0.075, 0.165); muzzle.scale.set(1.15, 0.75, 1);
  const nose = hp(new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), noseMat)); nose.position.set(0, -0.055, 0.235); nose.scale.set(1.2, 0.8, 0.8);
  R.eyes = [];
  for (const s of [-1, 1]) {
    const eye = hp(new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), eyeMat)); eye.position.set(s * 0.085, 0.03, 0.165); eye.scale.set(0.95, 1.25, 0.55); R.eyes.push(eye);
    const pupil = hp(new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), pupilMat)); pupil.position.set(s * 0.085, 0.03, 0.19); pupil.scale.set(0.45, 1.5, 0.5);
    const ear = hp(new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 5), fur)); ear.position.set(s * 0.12, 0.19, -0.02); ear.rotation.z = -s * 0.28; ear.castShadow = true;
    const inner = hp(new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.11, 5), earIn)); inner.position.set(s * 0.12, 0.185, 0.008); inner.rotation.z = -s * 0.28;
    R['ear' + (s < 0 ? 'L' : 'R')] = ear; R['earIn' + (s < 0 ? 'L' : 'R')] = inner;
    for (const dy of [-0.01, 0.02]) { const w = hp(new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.2, 4), furLight)); w.rotation.z = Math.PI / 2; w.rotation.y = s * 0.3; w.position.set(s * 0.15, -0.06 + dy, 0.2); }
  }
  R.lightAnchor = new THREE.Group(); R.lightAnchor.position.set(0, 0.07, 0.2); R.headGroup.add(R.lightAnchor);
  // 项圈 + 小金铃（K 的雕塑也有，一家的）
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 24), collarMat); collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.02, 0.38); collar.scale.set(1, 1, 0.9); R.torso.add(collar);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), bellMat); bell.position.set(0, -0.16, 0.44); R.torso.add(bell); R.bell = bell;

  const front = x => makeCatLeg(R.torso, {x,y:-.026,z:.27,upper:.145,lower:.15,radius:.048,pawRadius:.067,material:fur});
  const hind = x => makeCatLeg(R.hips, {x,y:-.03,z:-.26,upper:.18,lower:.17,radius:.057,pawRadius:.069,material:fur,hind:true});
  R.armL=front(.13); R.armR=front(-.13); R.legL=hind(.14); R.legR=hind(-.14);
  R.catLegs=[R.armL,R.armR,R.legL,R.legR];
  const tail=makeCatTail(R.torso,fur,new THREE.Vector3(0,.08,-.40),{count:6,step:.115,radius:.038});
  R.tail=tail.joints; R.tailMesh=tail.mesh;
  // 通用代码每帧写 R.staff.rotation：猫没有杖，给个空组吃掉
  R.staff = new THREE.Group(); R.staff.visible = false; R.torso.add(R.staff);
  R._twitch = { t: 0, next: 3, side: 'L' };
  R.group = g;
  poseCatPaws(g,R.catLegs,{phase:0,speed:0}); updateCatTail(R.tailMesh);
  return R;
}

/**
 * R-001 猫头 glb（`assets/cat-head.glb`，R 21:15 契约：headGroup 局部、原点 = 颅球中心 ≈ 颈根、+z 前、单位米、纯几何无材质；
 * 节点 CatHead / CatEyes / CatPupils / CatNose / CatEarL / CatEarR / CatEarInL / CatEarInR / CatWhiskers，耳壳原点在耳根）——
 * 到位就换掉程序头（整批藏掉 headParts、按节点名套已有材质 → 0 新程序），耳朵引用换到 glb 节点让抖耳 / 跳跃后贴照旧；缺资产 / 失败保留程序头。
 * 由 character.js 的 attachHeads() 在预编译之前调（新材质一起编）。
 */
export async function attachCatHead(R) {
  if (!R || !hasAsset('cat-head.glb')) return false;
  try {
    const gltf = await loadGLB('cat-head.glb');
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) return false;
    const M = R.mats;
    const matFor = (n) => /Pupil/i.test(n) ? M.pupil : /Eye/i.test(n) ? M.eye : /Nose/i.test(n) ? M.nose : /EarIn/i.test(n) ? M.earIn : /Whisker/i.test(n) ? M.furLight : M.fur;
    let meshes = 0;
    root.traverse((o) => { if (o.isMesh) { o.material = matFor(o.name || (o.parent && o.parent.name) || ''); o.castShadow = true; meshes++; } });
    if (!meshes) return false;
    for (const p of R.headParts) p.visible = false;
    root.name = 'cat-head-glb';
    R.headGroup.add(root);
    const pick = (n) => root.getObjectByName(n);
    const eL = pick('CatEarL'), eR = pick('CatEarR');
    if (eL && eR) { R.earL = eL; R.earR = eR; R.earInL = pick('CatEarInL') || eL; R.earInR = pick('CatEarInR') || eR; }
    const eyes = pick('CatEyes'); if (eyes) R.eyes = [eyes];
    R.glbHead = root;
    return true;
  } catch (e) { console.warn('cat-head.glb 加载失败，保留程序猫头', e); return false; }
}

/**
 * 猫的动作层（在 Wanderer.update 通用双足动画之后调，覆盖前腿 / 加尾巴 / 耳朵 / 金瞳 / 坐姿）
 * @param R buildCatRig 的 rig
 * @param c { W（六状态权重）, phase, s1, t, dt, speed, swingT, breath, swingGlow, lean, head, reducedMotion }
 */
export function animateCat(R, c) {
  const { W, t, dt, speed } = c;
  const sit = clamp((W.look || 0) + (W.sit || 0), 0, 1);
  const run = clamp(speed / 5, 0, 1), moving = clamp(speed / 2, 0, 1);
  // Absolute quadruped poses: biped lean and rear-leg rotations never survive this layer.
  const breath = c.reducedMotion ? 0 : Math.sin(t * 1.6) * .003;
  R.hips.position.set(0, lerp(CAT.hipsY, .262, sit) + breath * (1-sit) + Math.sin(c.phase*2)*.006*moving - .055*run*moving*(1-sit), 0);
  R.torso.rotation.set(-.30*sit + .025*run*Math.sin(c.phase*2),0,0);
  R.body.scale.set(.19, .178 + breath, .42 + .009*run*Math.sin(c.phase*2));
  const swipe=c.swingT>=0?Math.sin(Math.PI*clamp(c.swingT/.55,0,1)):0;
  poseCatPaws(R.group,R.catLegs,{phase:c.phase,speed,sit,run,jump:W.jump,swipe,reach:W.interact});
  R.headGroup.rotation.set(-R.torso.rotation.x - .10*sit + .012*Math.sin(t*.7)*(1-sit), c.reducedMotion?0:.025*Math.sin(t*.65)*(1-W.run),0);
  R.eyeMat.color.set(0xd9b34a).multiplyScalar(1.0 + .08*c.breath + .35*c.swingGlow);
  R.bell.position.x = .009 * Math.sin(c.phase) * moving;
  const tw=R._twitch; tw.next-=dt;
  if(tw.next<=0){tw.t=.25;tw.next=3+Math.random()*4;tw.side=Math.random()<.5?'L':'R';}
  tw.t=Math.max(0,tw.t-dt);
  for(const side of ['L','R']){
    const flick=side===tw.side&&tw.t>0?-0.3*Math.sin(Math.PI*tw.t/.25):0;
    R['ear'+side].rotation.x=R['earIn'+side].rotation.x=flick-.25*W.jump;
  }
  const sway=c.reducedMotion?0:Math.sin(t*1.8)*(.16+.15*moving);
  for(let i=0;i<R.tail.length;i++){
    const j=R.tail[i];
    j.rotation.x=lerp(-.62+i*.16,-1.15+i*.42,sit)-W.jump*.16+(c.reducedMotion?0:Math.sin(t*1.5+i*.6)*.025);
    j.rotation.z=sway*(.2+i*.07)*(1-sit*.65)+sit*.10*i;
  }
  updateCatTail(R.tailMesh);
}
