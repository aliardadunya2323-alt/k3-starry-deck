// 天上的巨型紫金玫瑰（09-07 重做 · G-001b 由 D 程序生成）：
// 约 60 片花瓣按黄金角螺旋排布（不是一圈圈同心环）——内圈紧裹成螺旋花苞，外圈大瓣张开、瓣尖外翻卷边；
// 花瓣是杯状曲面：贴在虚拟圆柱上向内包、顶部向外反卷、边缘轻微波浪、中央一道浅折痕；背面用 gl_FrontFacing 压暗，正反两面有厚度感。
// 底部 5 片花萼 + 花托 + 短茎，从大阵外侧看（看到的是花背）也像一朵花。开花 / 凋谢动画、光、花瓣雨保留。
// 花轴 = 局部 +Y；放到天上后把 +Y 转向 target，让人在船上抬头正对花心。
// P-002（2026-09-07 晚，窗口 P）：全部花瓣合成一个 Mesh，开花 / 摆动在顶点着色器里算（见 petalMaterial 注释）；对外接口与视觉不变。
// X-001（2026-09-08 夜，窗口 X）：主人 18:30 拍板「紫金玫瑰去紫」——只改色值（BUCKETS / GOLD / 花萼 / 光晕 / 花瓣雨 / 背面 tint），几何、接口、合批一字未动。
import * as THREE from 'three';
import { softDot } from './textures.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hasAsset, loadGLB } from '../util/assets.js';
import { clamp, easeOutCubic, easeInOutCubic, lerp, rng } from '../util/easing.js';

// 外部玫瑰模型（可选）：assets/rose.glb，花轴 +Y，开后直径 ≈ 5，剪辑 Bloom（0→1 s 花苞→全开）与可选 Idle；花心节点名 Core。
let _roseGltf = null, _roseGltfPromise = null;
function roseGltf() {
  if (_roseGltf) return Promise.resolve(_roseGltf);
  if (!_roseGltfPromise) _roseGltfPromise = loadGLB('rose.glb').then((g) => (_roseGltf = g)).catch((e) => { console.warn('rose.glb 不可用，用程序花瓣', e); return null; });
  return _roseGltfPromise;
}

// 六个色段：t=0 花心 → t=1 最外圈。基部色 / 尖端色 / 自发光。
// 09-08 主人拍板「紫金玫瑰去紫」（X-001，A0 口径）：技能名不改，视觉不再靠紫——花心香槟金 #C6A56B，往外过渡到灰蓝 #41586A，
// 最外圈蓝黑 #142536；每片尖端（翻折处）偏灰蓝；花缘一线香槟金（rim 在 petalGeometry 里）。识别靠螺旋与层叠。
// emis 会再乘顶点色，所以只是偏暖 / 偏冷的近白，不另染色
const BUCKETS = [
  { base: 0xcbb07e, tip: 0xe9dbb8, emis: 0xfff0d0 }, // 花心：香槟金（比 #C6A56B 略淡，灯 + Bloom 叠上去正好落在香槟而不是橙）
  { base: 0xb9a37a, tip: 0x9db0be, emis: 0xf4ecdc }, // 过渡圈：根部香槟 → 尖端淡灰蓝，金心与蓝身之间不出硬边
  { base: 0x41586a, tip: 0x7c93a6, emis: 0xe0eaf4 },
  { base: 0x2a3f52, tip: 0x5a728a, emis: 0xd8e4f0 },
  { base: 0x1c2f42, tip: 0x41586a, emis: 0xd0dcec },
  { base: 0x142536, tip: 0x33475a, emis: 0xc8d6e8 },
];
const GOLD = new THREE.Color(0xc6a56b); // 花缘香槟金（A0）
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.5°
const _c = new THREE.Color();

/**
 * 一片花瓣。v 沿长度 0→1，u 横向 -1→1。
 * 形状：基部窄（花爪）、约 0.62 处最宽、顶缘中央略尖、两肩外翻；贴在半径 R 的虚拟圆柱上向内包（spread），
 * 顶部按 flare 向外张、按 recurve 反卷下折，边缘 ruffle 波浪，中央折痕 crease。
 */
function petalGeometry({ L, W, R, spread, flare, recurve, ruffle, base, tip, seed, segU = 10, segV = 14 }) {
  const rand = rng(seed);
  const pos = [], col = [], uv = [], idx = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip);
  const ph = rand() * 6.283, wob = 0.92 + rand() * 0.16, shoulder = 0.75 + rand() * 0.5, tone = 0.93 + rand() * 0.14;
  const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    // 宽度：花爪窄 → 0.45 处最宽 → 顶缘收到 0.3 宽，配合两角下垂成圆头（倒卵形，不是矩形也不是尖头）
    const width = W * wob * (0.14 + 0.86 * Math.pow(sstep(0, 0.45, v), 0.7)) * (1 - 0.7 * Math.pow(sstep(0.5, 1, v), 2.2));
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * 2 - 1;
      const edge = Math.abs(u), e2 = edge * edge;
      const theta = u * spread * width;
      const topK = clamp((v - 0.45) / 0.55, 0, 1);
      const top2 = topK * topK;
      // 顶部向外张（肩部更甚）+ 瓣尖反卷
      const rc = Math.pow(clamp((v - 0.72) / 0.28, 0, 1), 2);
      const out = flare * top2 * (1 + 0.9 * e2 * shoulder) + recurve * rc * 0.8;
      const wave = ruffle * Math.sin(u * Math.PI * 2.6 + ph + v * 2.0) * top2 * (0.35 + 0.65 * e2);
      const crease = -0.045 * Math.max(0, 1 - edge / 0.22) * (0.3 + 0.7 * v);
      const r = R + out + wave + crease;
      // 虚拟圆柱以花轴为中心（花瓣中线落在半径 R 处、向两侧绕花轴包过去）；几何原点放在花瓣基部，
      // 这样 hinge 绕基部转开花瓣，而不是绕花轴把整片拖下去
      const x = r * Math.sin(theta);
      const z = r * Math.cos(theta) - R;
      // 反卷时瓣尖向下折；顶缘两角下垂成圆头
      const y = v * L - recurve * rc * 0.4 * L - 0.16 * L * e2 * sstep(0.55, 1, v);
      pos.push(x, y, z);
      // 颜色 = 烘进顶点色的明暗（自发光也乘它，夜里没灯也有立体感）：
      // 基部色 → 尖端色；根部暗（层间阴影）、杯心亮 / 两侧暗（曲面感）、瓣尖略深、边缘一线金、每片随机 ±7% 让相邻花瓣分得开
      _c.copy(cb).lerp(ct, Math.pow(v, 1.25) * 0.9 + e2 * 0.1);
      const rim = edge > 0.84 && v > 0.3 ? ((edge - 0.84) / 0.16) * 0.7 * clamp((v - 0.3) / 0.4, 0, 1) : 0; // 去紫后花缘是主要识别线，金边比紫金版（0.5）略实
      _c.lerp(GOLD, rim + 0.1 * top2 * e2);
      const shade = lerp(0.36, 1.0, Math.pow(v, 0.7)) * (1 - 0.22 * e2 + 0.1 * top2 * e2) * (1 - 0.12 * Math.max(0, 1 - edge / 0.18) * v) * (1 - 0.15 * rc) * tone;
      _c.multiplyScalar(shade);
      col.push(_c.r, _c.g, _c.b);
      uv.push((u + 1) / 2, v);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * (segU + 1) + i, b = a + segU + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 花瓣材质（P-002 合批版：一朵花的全部花瓣是一个 Mesh、一个材质）：
 * ① 自发光乘顶点色——顶点色里烘好的明暗（根部暗、杯心亮、边缘金）在夜空里没灯也能显出立体感，不会被一层平的自发光糊平；
 * ② 背面 = 翻折面，偏灰蓝 #41586A（gl_FrontFacing；去紫前是压暗偏紫），比蓝黑正面略亮，双面薄片有厚度感；
 * ③ 每片花瓣的黄金角 / 铰链位置 / 张角 / 开花延迟 / 摆动相位（aPetalA / aPetalB）与色段自发光色（aEmis）都在顶点属性里，
 *    开花（uOpen）与摆动（uTime）在顶点着色器里算——以前 60 片各一个 Mesh + 6 个材质、CPU 每帧改 60 个 hinge，
 *    大招 10 朵就是 200 个 draw call；现在每朵花瓣 1 个 draw call（透明双面两遍 = 2 次），形状 / 顶点色 / 开花顺序不变。
 *    material.emissive 固定为白，色段颜色由 aEmis 乘进去，与以前 emissive(bucket) × vColor 逐像素等价。
 */
const PETAL_VERT_HEAD = /* glsl */`
attribute vec3 aPetalA; // (pivot 黄金角, hinge y, hinge z = R)
attribute vec3 aPetalB; // (tilt 全开张角, delay 开花延迟, phase 摆动相位)
attribute vec3 aEmis;
uniform float uOpen, uTime, uSway;
varying vec3 vEmis;
mat3 k3RotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 k3RotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 k3RotZ(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;
// 与旧 CPU 版逐字对应：k = easeOutCubic(clamp((open·2.6 − delay)/1.4))；hinge.rotation = Euler(x: lerp(0.04, tilt, k), z: sin(t·0.8+phase)·0.02·open)（XYZ 序 = Rx·Rz）；
// mesh.scale = lerp(0.6, 1, k)（绕花瓣基部）；hinge.position = (0, hy, R)；pivot.rotation.y = 黄金角
const PETAL_VERT_NORMAL = /* glsl */`
#include <beginnormal_vertex>
float k3k = clamp((uOpen * 2.6 - aPetalB.y) / 1.4, 0.0, 1.0); k3k = 1.0 - pow(1.0 - k3k, 3.0);
mat3 k3R = k3RotY(aPetalA.x) * (k3RotX(mix(0.04, aPetalB.x, k3k)) * k3RotZ(sin(uTime * 0.8 + aPetalB.z) * 0.02 * uOpen * uSway));
objectNormal = k3R * objectNormal;
`;
const PETAL_VERT_POS = /* glsl */`
#include <begin_vertex>
transformed = k3R * (transformed * mix(0.6, 1.0, k3k)) + k3RotY(aPetalA.x) * vec3(0.0, aPetalA.y, aPetalA.z);
vEmis = aEmis;
`;
function petalMaterial(rich, uniforms) {
  const Mat = rich ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({ vertexColors: true, roughness: 0.48, metalness: 0.0, side: THREE.DoubleSide, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.72, transparent: true, opacity: 1 });
  if (rich) { m.sheen = 0.5; m.sheenRoughness = 0.5; m.sheenColor = new THREE.Color(0xa9bccd); } // 绒面光改灰蓝：紫底上暖绒光是粉调，蓝黑底上它会把花背糊成米灰（X-001 实拍）
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOpen = uniforms.uOpen; shader.uniforms.uTime = uniforms.uTime; shader.uniforms.uSway = uniforms.uSway;
    shader.vertexShader = PETAL_VERT_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', PETAL_VERT_NORMAL)
      .replace('#include <begin_vertex>', PETAL_VERT_POS);
    shader.fragmentShader = 'varying vec3 vEmis;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb * 0.7, vec3(0.023, 0.055, 0.098), 0.6);') // 翻折面灰蓝：目标取 #2A4258（线性）——花背朝天被方向光直射，albedo 要比 #41586A 深一档屏上才落在灰蓝而不是灰白
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb * vEmis * (gl_FrontFacing ? 1.0 : 0.6);');
  };
  m.customProgramCacheKey = () => 'k3-rose-petal-v3';
  return m;
}

export class SkyRose {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { position, target, scale, light(预建 PointLight 或 null), reducedMotion, layers(色段数 1–6，越少花瓣越少，给大招用轻量版), rain(默认 true) }
   *   tentacles / eye 参数已废弃（主人 09-07：丑且不需要），传了也忽略。
   */
  constructor(scene, { position = [8, 38, 64], target = [0, 4, -6], scale = 9, light = null, reducedMotion = false, layers = 6, rain = true, bloomTime = 2.6, witherTime = 1.6 } = {}) {
    this.scene = scene;
    this.light = light;
    this.reducedMotion = reducedMotion;
    this.bloomTime = bloomTime; this.witherTime = witherTime;
    this.layerCount = clamp(Math.round(layers), 1, BUCKETS.length);
    this.group = new THREE.Group();
    this.group.name = 'skyRose';
    this.group.position.set(...position);
    this.group.scale.setScalar(scale);
    this.setTarget(target);
    this.group.visible = false;
    this.state = 'hidden'; // hidden | blooming | open | withering
    this.t = 0;
    this.petals = []; // 每片的元数据（tilt / delay / phase），几何已合批进 this.petalMesh
    const rich = this.layerCount >= 6;
    // 六个色段始终全用（否则轻量版只剩金色段），layers 只决定花瓣数与细分；色段颜色进顶点属性，所以整朵只要一个花瓣材质
    this.petalUniforms = { uOpen: { value: 0 }, uTime: { value: 0 }, uSway: { value: reducedMotion ? 0 : 1 } };
    this.mats = [petalMaterial(rich, this.petalUniforms)];
    this.sepalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide, emissive: new THREE.Color(0x22364a), emissiveIntensity: 0.8, transparent: true, opacity: 1 });
    this._build(rain, rich);
    scene.add(this.group);
    this.glb = null;
    if (hasAsset('rose.glb')) this._attachGlb();
  }

  /** glb 玫瑰到位后替换程序花瓣（异步，未到位前先用程序花瓣） */
  async _attachGlb() {
    const gltf = await roseGltf();
    if (!gltf || this._disposed) return;
    const sceneClone = skeletonClone(gltf.scene);
    const holder = new THREE.Group();
    holder.add(sceneClone);
    const box = new THREE.Box3().setFromObject(sceneClone);
    const size = new THREE.Vector3(); box.getSize(size);
    const width = Math.max(size.x, size.z) || 1;
    holder.scale.setScalar(5.2 / Math.max(1e-3, width * 1.15));
    const mixer = new THREE.AnimationMixer(sceneClone);
    const bloomClip = gltf.animations.find((c) => c.name === 'Bloom') || gltf.animations[0] || null;
    const idleClip = gltf.animations.find((c) => c.name === 'Idle') || null;
    const bloom = bloomClip ? mixer.clipAction(bloomClip) : null;
    if (bloom) { bloom.play(); bloom.paused = true; bloom.setLoop(THREE.LoopOnce, 1); bloom.clampWhenFinished = true; }
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    if (idle) { idle.play(); idle.setEffectiveWeight(0.6); }
    const core = sceneClone.getObjectByName('Core');
    sceneClone.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material.transparent = true; } });
    this.glb = { holder, mixer, bloom, bloomDuration: bloomClip ? bloomClip.duration : 1, core, mats: [] };
    sceneClone.traverse((o) => { if (o.isMesh && o.material) this.glb.mats.push(o.material); });
    this.flower.visible = false;
    this.group.add(holder);
    this._applyOpen(this._lastOpen || 0);
  }

  setTarget(target) {
    const dir = new THREE.Vector3(...target).sub(this.group.position).normalize();
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }

  _build(withRain, rich) {
    this.flower = new THREE.Group();
    this.group.add(this.flower);
    // 花瓣数随 layers 走：6 → 60 片 / 10×14 细分（单朵近景），2 → 20 片 / 6×8（大阵 10 朵、165 m 外看）
    const N = Math.round(lerp(10, 60, (this.layerCount - 1) / 5));
    const segU = rich ? 10 : 6, segV = rich ? 14 : 8;
    const smooth = (x) => x * x * (3 - 2 * x);
    const petalGeos = [];
    const emisColor = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const t = N > 1 ? i / (N - 1) : 0;                 // 0 花心 → 1 最外
      const bucket = Math.min(BUCKETS.length - 1, Math.floor(t * BUCKETS.length));
      const b = BUCKETS[bucket];
      const R = lerp(0.07, 0.98, Math.pow(t, 1.15));
      const geo = petalGeometry({
        L: lerp(0.5, 1.75, Math.pow(t, 0.7)),
        W: lerp(0.42, 1.0, Math.sqrt(t)),
        R,
        spread: lerp(2.5, 0.6, Math.pow(t, 0.75)),
        flare: lerp(0.05, 0.2, t),
        recurve: lerp(0, 0.4, Math.pow(t, 1.4)),
        ruffle: lerp(0.008, 0.05, t),
        base: b.base, tip: b.tip, seed: 11 + i, segU, segV,
      });
      // 全开时的张角：花心保持直立（花苞螺旋），外圈平展；开花顺序外圈先、花心最后
      const petal = { tilt: lerp(0.05, 1.6, Math.pow(smooth(t), 0.7)), delay: 1.7 * (1 - t), phase: Math.random() * 6, pivot: i * GOLDEN, hingeY: 0.1 * (1 - t) - 0.06 * t, R, bucket };
      this.petals.push(petal);
      // 每片的变换参数 / 色段自发光色写进逐顶点属性（同一片所有顶点相同），合批后顶点着色器按它们摆放
      const n = geo.attributes.position.count;
      const a = new Float32Array(n * 3), bb = new Float32Array(n * 3), em = new Float32Array(n * 3);
      emisColor.set(b.emis);
      for (let v = 0; v < n; v++) {
        a[v * 3] = petal.pivot; a[v * 3 + 1] = petal.hingeY; a[v * 3 + 2] = R;
        bb[v * 3] = petal.tilt; bb[v * 3 + 1] = petal.delay; bb[v * 3 + 2] = petal.phase;
        em[v * 3] = emisColor.r; em[v * 3 + 1] = emisColor.g; em[v * 3 + 2] = emisColor.b;
      }
      geo.setAttribute('aPetalA', new THREE.BufferAttribute(a, 3));
      geo.setAttribute('aPetalB', new THREE.BufferAttribute(bb, 3));
      geo.setAttribute('aEmis', new THREE.BufferAttribute(em, 3));
      petalGeos.push(geo);
    }
    const petalGeo = mergeGeometries(petalGeos, false);
    for (const g of petalGeos) g.dispose();
    // 顶点在着色器里才被摆到花上，CPU 侧的包围球按合批前的花瓣局部坐标算会偏小 → 手写一个把全开的花整个包住的
    petalGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 3.2);
    this.petalMesh = new THREE.Mesh(petalGeo, this.mats[0]);
    this.petalMesh.name = 'petals';
    this.flower.add(this.petalMesh);
    // 花萼 5 片 + 花托 + 短茎（从背面 / 大阵外侧看得到）：不参与开花动画，合成一个网格省 6 次 draw call
    const sepalParts = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 5; i++) {
      const geo = petalGeometry({ L: 1.25, W: 0.36, R: 0.42, spread: 0.9, flare: 0.25, recurve: 0.2, ruffle: 0.01, base: 0x142536, tip: 0x33475a, seed: 101 + i, segU: 6, segV: 10 });
      geo.deleteAttribute('uv');
      // hinge：绕 x 张开 1.95 rad，位于 (0, -0.12, 0.42)；pivot：绕 y 转到各自方位
      m4.compose(new THREE.Vector3(0, -0.12, 0.42), q.setFromEuler(e.set(1.95, 0, 0)), new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m4);
      m4.makeRotationY((i / 5) * Math.PI * 2 + 0.4);
      geo.applyMatrix4(m4);
      sepalParts.push(geo);
    }
    const tint = (geo, hex) => { const n = geo.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(hex); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.deleteAttribute('uv'); return geo; };
    // 只留花托，不要花柄（主人 09-07：「玫瑰花不需要花柄」）
    const recept = tint(new THREE.SphereGeometry(0.42, 16, 12), 0x1c2f42); recept.scale(1, 0.8, 1); recept.translate(0, -0.22, 0);
    sepalParts.push(recept);
    this.sepals = new THREE.Mesh(mergeGeometries(sepalParts, false), this.sepalMat);
    this.flower.add(this.sepals);
    // 花心深处一粒金核（大部分被花苞挡住，只从缝里透出光）
    this.iris = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshStandardMaterial({ color: 0x8a5a20, roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(0xffd061), emissiveIntensity: 1.4 }));
    this.iris.position.y = 0.42;
    this.flower.add(this.iris);
    // 背后的光晕：去紫后改香槟金、更淡（暗色花瓣衬在暖光前面才读得出轮廓；A0「金 ≤ 8%」所以压到 0.2）
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(128), color: 0xc6a56b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.glow.scale.setScalar(6.5); this.glow.position.y = -0.6;
    this.group.add(this.glow);
    // 花瓣雨：香槟金 / 灰蓝 两色微粒（去紫前是金 / 紫）
    if (withRain) {
      const RN = 220, pos = new Float32Array(RN * 3), col = new Float32Array(RN * 3);
      this.rainSeed = new Float32Array(RN * 3);
      const gold = new THREE.Color(0xc6a56b), plum = new THREE.Color(0x7c93a6);
      for (let i = 0; i < RN; i++) {
        this.rainSeed[i * 3] = Math.random(); this.rainSeed[i * 3 + 1] = Math.random(); this.rainSeed[i * 3 + 2] = Math.random();
        const c = Math.random() < 0.55 ? gold : plum; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ map: softDot(64), vertexColors: true, size: 0.32, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);
    }
    this._applyOpen(0);
  }

  /** open ∈ [0,1]：0 花苞 1 全开 */
  _applyOpen(open) {
    this._lastOpen = open;
    if (this.glb) {
      if (this.glb.bloom) { this.glb.bloom.time = clamp(open, 0, 1) * this.glb.bloomDuration * 0.999; }
      this.glb.mixer.update(0);
      const s = lerp(0.6, 1, open);
      this.glb.holder.scale.setScalar(this.glb.holder.userData.base || (this.glb.holder.userData.base = this.glb.holder.scale.x));
      this.glb.holder.scale.multiplyScalar(s);
      return;
    }
    this.petalUniforms.uOpen.value = open; // 每片的张角 / 缩放按 delay 在顶点着色器里算
    this.sepals.scale.setScalar(lerp(0.35, 1, easeOutCubic(clamp(open * 2, 0, 1))));
    this.iris.scale.setScalar(lerp(0.5, 1, open));
  }

  toggle() { if (this.state === 'hidden' || this.state === 'withering') this.bloom(); else this.wither(); }

  bloom() {
    const resumeOpen = this.state === 'withering' ? 1 - easeInOutCubic(clamp(this.t / this.witherTime, 0, 1)) : 0;
    this.group.visible = true;
    this.state = 'blooming';
    this.t = resumeOpen * this.bloomTime;
    for (const m of this.mats) m.opacity = 1;
    this.sepalMat.opacity = 1;
  }

  wither() { if (this.state === 'hidden' || this.state === 'withering') return; this.state = 'withering'; this.t = 0; }

  get active() { return this.state !== 'hidden'; }
  get open() { return this.state === 'open' ? 1 : this.state === 'blooming' ? clamp(this.t / this.bloomTime, 0, 1) : this.state === 'withering' ? 1 - easeInOutCubic(clamp(this.t / this.witherTime, 0, 1)) : 0; }

  dispose() {
    this._disposed = true;
    if (this.glb) { this.glb.mixer.stopAllAction(); for (const m of this.glb.mats) m.dispose(); }
    this.scene.remove(this.group);
    if (this.rain) { this.scene.remove(this.rain); this.rain.geometry.dispose(); this.rain.material.dispose(); }
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.sepalMat.dispose();
    this.iris.material.dispose();
    if (this.light) this.light.intensity = 0;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  setStill(value) {
    this.reducedMotion = !!value;
    this.petalUniforms.uSway.value = this.reducedMotion ? 0 : 1;
    if (this.rain) this.rain.visible = !this.reducedMotion;
  }

  update(dt, camera) {
    if (this.state === 'hidden') { if (this.light) this.light.intensity = 0; return; }
    this.t += dt;
    let open = 1, fade = 1;
    if (this.state === 'blooming') { open = clamp(this.t / this.bloomTime, 0, 1); if (open >= 1) this.state = 'open'; }
    else if (this.state === 'withering') {
      const k = clamp(this.t / this.witherTime, 0, 1);
      open = 1 - easeInOutCubic(k); fade = 1 - k;
      if (k >= 1) { this.state = 'hidden'; this.group.visible = false; if (this.rain) this.rain.material.opacity = 0; if (this.light) this.light.intensity = 0; return; }
    }
    this._applyOpen(open);
    const pulse = this.reducedMotion ? 0.72 : 0.72 + 0.1 * Math.sin(this.t * 1.7);
    for (const m of this.mats) { m.opacity = fade; m.emissiveIntensity = pulse * fade; }
    this.sepalMat.opacity = fade;
    this.iris.material.emissiveIntensity = (this.reducedMotion ? 1.3 : 1.3 + 0.4 * Math.sin(this.t * 2.3)) * fade;
    this.glow.material.opacity = 0.2 * open * fade;
    if (this.glb) {
      for (const m of this.glb.mats) m.opacity = fade;
      if (this.glb.core && this.glb.core.material && this.glb.core.material.emissive) this.glb.core.material.emissiveIntensity = (this.reducedMotion ? 1.2 : 1.2 + 0.5 * Math.sin(this.t * 2.3)) * fade;
      if (!this.reducedMotion) this.glb.mixer.update(dt);
    }
    this.petalUniforms.uTime.value = this.t; // 花瓣摆动 sin(t·0.8+phase)·0.02·open 在顶点着色器里算（reducedMotion 时 uSway=0）
    if (!this.reducedMotion) this.group.rotateY(dt * 0.04);
    if (this.light) { this.light.position.copy(this.group.position); this.light.intensity = 4.5 * open * fade; }
    if (this.rain) this.rain.visible = !this.reducedMotion;
    if (this.rain && !this.reducedMotion) {
      const pos = this.rain.geometry.attributes.position;
      const base = this.group.position;
      for (let i = 0; i < pos.count; i++) {
        const s0 = this.rainSeed[i * 3], s1 = this.rainSeed[i * 3 + 1], s2 = this.rainSeed[i * 3 + 2];
        const life = (this.t * (0.02 + s2 * 0.02) + s1) % 1;
        const ang = s0 * Math.PI * 2 + this.t * 0.15;
        const r = 3 + s2 * 18 + life * 4;
        pos.setXYZ(i, base.x + Math.cos(ang) * r + Math.sin(this.t * 0.7 + i) * 0.8, base.y - 4 - life * 58, base.z + Math.sin(ang) * r);
      }
      pos.needsUpdate = true;
      this.rain.material.opacity = 0.7 * open * fade;
    }
  }
}
