// 旅人：双形态程序生成人物 + 程序动画状态机。
//   chibi   —— Q 版：大头（下巴收圆的动漫头型）、大兜帽里露出白色刘海、深靛披风（CPU 逐帧变形、暗金下摆）、圆法杖青光、大眼腮红小嘴。默认形态。
//   awakened —— 觉醒态：原创白发异瞳、柔 V 下颌与后扬分束短发；新头按 surfaceRole 独立处理眼眉与头发。
//               分层虹膜与柔和脸部明暗、黑色紧身上衣 + 白裤 + 黑靴、
//               颈间黑面具、黑底红纹魔法披风（外黑内绯、下摆符文与背心印记发光、逐帧飘动）、黑刃。
//   cat      —— 猫形态（08 E.1，player/cat-form.js）：肩高 0.55 的大黑猫，金瞳、项圈金铃、尾巴摇；5 键第三档，全部技能照常能放。
// 三套形态共用同一根骨架式层级与同一套姿态参数（idle / walk / run / jump / interact / look + 挥杖叠加），权重 0.15 s 交叉淡入；猫在其上再叠一层自己的动作。
// 接口（controller / door / skills / main 都在调）：root、heading、state、setState、locked、interactT、playInteract、playLook、
//   playSwing / swingT、update(dt,{speed,running,airborne})、staffLight、toggleForm()、form、eyeHeight、handHeight。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, PLAYER } from '../config.js';
import * as TEX from '../world/textures.js';
import { hasAsset, loadGLB, isBundle } from '../util/assets.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // 只给 ?head=<url> 候选头直看用（生产路走 assets.js 的 loadGLB）
import { isRebuiltHead, prepareRebuiltHead } from './head-materials.js';
import { createNeckCollarBinding } from './neck-collar-binding.js';
import { createSleeveBinding } from './sleeve-binding.js';
import { createChibiSleeveBinding } from './chibi-sleeve-drape.js';
import { createFacePerformance } from './face-performance.js';
import { createBedRest } from './bed-rest.js';
import { makeRestHinge, createPrivateRest } from './private-rest.js';
import { createBenchRest } from './bench-rest.js';
import { createPianoPose } from './piano-pose.js';
import { createMemorialPose } from './memorial-pose.js';
import { createWorkstationPose } from './workstation-pose.js';
import { createDragonRiderPose } from './dragon-rider-pose.js';
import { attachContinuousTrousers } from './continuous-trousers.js';
import { createOutfitController } from './character-outfit.js';
import { tailoredTorsoGeometry, torsoFront, hangingMaskGeometry, hangingMaskStrapGeometry } from './costume-surface.js';
import { COSTUME_PATTERN_VERSION, foldedCollarPoint, foldedCollarGeometry, sleeveGeometry, forearmGeometry, trouserLegGeometry, trouserPelvisGeometry, bootGeometry, travelerHoodGeometry } from './costume-pattern.js';
import { CHARACTER_DETAIL_VERSION, DETAIL_CLOAK_COLS, DETAIL_CLOAK_ROWS, travelerHandGeometry, createTravelerGrip, dressPosteriorHair, cloakSurfacePoint, travelerClothMaterial, travelerSkinMaterial } from './character-detail.js';
import { CHARACTER_SHADING_VERSION, travelerGarmentMaterial } from './character-shading.js';
// textures.js 今晚被多个窗口整文件覆盖过（B 的 H-4 导出 cloakRuneTexture 00:29 被抹掉一次），这里按命名空间取、缺了就用本地兜底，不让启动挂掉
const cloakTex = TEX.cloak, softDot = TEX.softDot;
import { lerp, clamp, damp, easeOutCubic, rng } from '../util/easing.js';
import { buildCatRig, animateCat, attachCatHead } from './cat-form.js'; // 08 E.1（C）：第三形态 · 大黑猫（身体 + 动作层；技能不门控；R-001 猫头 glb 到位自动换）

const STATES = ['idle', 'walk', 'run', 'interact', 'look', 'jump', 'sit']; // sit：D-089 坐下看风景（world/seats.js 置 locked + setState('sit')，起身 setState('idle')）
const FORM_ORDER = ['chibi', 'awakened', 'cat']; // 5 键循环顺序（cat：08 E.1）
const FORM_TRANSITION_DURATION = 1.1;
const CROSS_FADE = 0.15;
const CLOAK_COLS = DETAIL_CLOAK_COLS, CLOAK_ROWS = DETAIL_CLOAK_ROWS;
const cloakPoint = new THREE.Vector3();
const FRONT = Math.PI / 2; // SphereGeometry 里 phi=π/2 才是 +z（正前）

// ---------- 材质 ----------
let _gradient = null;
function gradientMap() {
  if (_gradient) return _gradient;
  // 三阶赛璐璐：暗 / 中 / 亮
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  _gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  _gradient.minFilter = THREE.NearestFilter; _gradient.magFilter = THREE.NearestFilter; _gradient.needsUpdate = true;
  return _gradient;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra });
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0b0a10, side: THREE.BackSide });
const FACE_OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x76596c, side: THREE.BackSide });
const HAIR_OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x566079, side: THREE.BackSide });
const BODY_OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x343044, side: THREE.BackSide });
let _faceGradient = null;
// 头部独用柔和四阶明暗：保留鼻颊体积，夜间不把五官切成硬黑色块。
function faceGradientMap() {
  if (!_faceGradient) {
    _faceGradient = new THREE.DataTexture(new Uint8Array([148, 148, 148, 255, 188, 188, 188, 255, 224, 224, 224, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    _faceGradient.minFilter = THREE.NearestFilter; _faceGradient.magFilter = THREE.NearestFilter; _faceGradient.needsUpdate = true;
  }
  return _faceGradient;
}
/** 背面描边壳：同几何、放大 k、黑色 BackSide */
function outline(mesh, k = 1.05, material = OUTLINE_MAT) {
  const o = new THREE.Mesh(mesh.geometry, material);
  o.scale.setScalar(k);
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}

// 原创星航礼服细节。所有静态金属线合成一个网格，随 torso 动，不增灯或逐帧工作。
function dressTorso(torso, kind, trim) {
  const chibi = kind === 'chibi', pieces = [];
  const top = chibi ? 0.37 : 0.55, bottom = chibi ? 0.055 : 0.08;
  const point = (x, y, lift = 0.009) => torsoFront(kind, x, y, lift);
  const seam = (points, width = 0.0035) => pieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(([x, y]) => point(x, y))), 10, width, 4, false));
  const positions = [];
  const panel = (coords) => { for (const [x, y] of coords) { const p = point(x, y, 0.006); positions.push(p.x, p.y, p.z); } };
  // 两片贴合胸腔的缎面交领；紫金小旅人为月白，觉醒态为低饱和酒红。
  panel([[-0.13, top], [-0.015, top - 0.105], [-0.07, bottom + 0.12]]);
  panel([[0.13, top], [0.07, bottom + 0.12], [0.015, top - 0.105]]);
  // 前低后高的折叠围领：Q 版补上兜帽下的连接，觉醒态收住脖根，保留颈前面具。
  // 与交领共享一个网格和材质，滚边也并入既有金属网格，不增加 draw call。
  const collarPoint = (angle, v) => foldedCollarPoint(kind, angle, v);
  const collarSegments = 48;
  const collarRim = Array.from({ length: collarSegments }, (_, i) => collarPoint(i / collarSegments * Math.PI * 2, 1));
  pieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(collarRim, true), 48, 0.004, 5, true));
  const lapelGeo = new THREE.BufferGeometry(); lapelGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); lapelGeo.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i)); lapelGeo.computeVertexNormals();
  const collarGeo = foldedCollarGeometry(kind);
  const insetGeo = mergeGeometries([lapelGeo, collarGeo], false);
  insetGeo.userData.k3CollarTailoring = collarGeo.userData.k3CollarTailoring;
  lapelGeo.dispose(); collarGeo.dispose();
  const inset = new THREE.Mesh(insetGeo, travelerGarmentMaterial(chibi ? 0xd3c8e5 : 0x8b758e, 'satin', { side: THREE.DoubleSide }));
  inset.name = 'CostumeSatinLapel'; torso.add(inset);
  for (const side of [-1, 1]) {
    seam([[side * 0.13, top], [side * 0.105, top - 0.10], [side * 0.055, bottom + 0.13], [side * 0.055, bottom]]);
    seam([[side * 0.16, top - 0.035], [side * 0.14, top - 0.08], [side * 0.09, top - 0.12]], 0.0025);
  }
  const broochY = top - 0.055, broochZ = point(0, broochY, 0.025).z;
  const bezel = new THREE.TorusGeometry(0.034, 0.004, 5, 16); bezel.translate(0, broochY, broochZ); pieces.push(bezel);
  for (const [x, y, size] of [[0, broochY + 0.046, 0.009], [0, broochY - 0.053, 0.014], [-0.045, broochY, 0.008], [0.045, broochY, 0.008]]) {
    const detail = new THREE.OctahedronGeometry(size); detail.scale(0.7, 1.25, 0.35); detail.translate(x, y, broochZ); pieces.push(detail);
  }
  // PolyhedronGeometry 无索引，Tube/Torus 有索引；补顺序索引后才可安全合批。
  for (const piece of pieces) if (!piece.index) piece.setIndex(Array.from({ length: piece.attributes.position.count }, (_, i) => i));
  const metal = new THREE.Mesh(mergeGeometries(pieces, false), trim); metal.name = 'CostumeFiligree'; torso.add(metal);
  for (const piece of pieces) piece.dispose();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.024), toon(chibi ? 0x92cbe0 : 0xb54b68, { emissive: chibi ? 0x3b6b87 : 0x68172e, emissiveIntensity: 0.25 }));
  gem.scale.set(0.8, 1.1, 0.48); gem.position.set(0, broochY, broochZ); gem.name = 'CostumeStarGem'; torso.add(gem);
}

// ---------- 头型：动漫构造法——颅骨是圆，下颌是从圆两侧斜切下来收到小下巴的楔形（不是把球压尖）----------
// 剖面表都以 R 为单位、y 向下为负：w 半宽、zf 脸前缘、zb 后缘（下颌角在 −0.8R 附近拐弯、颌底向前扫到下巴）、n 超椭圆指数（>2 脸颊更平）。
// 眼睛在颅骨圆的水平中线（y≈0）略下——因为下颌把脸拉长了，眼睛自然落在整张脸的上半，这正是二次元的比例。
const HEAD = {
  awakened: {
    jaw: 1.45,
    w: [[0, 1.0], [-0.3, 0.985], [-0.6, 0.92], [-0.85, 0.82], [-1.1, 0.62], [-1.3, 0.38], [-1.45, 0.13]],
    zf: [[0, 0.96], [-0.4, 0.955], [-0.8, 0.93], [-1.1, 0.9], [-1.3, 0.84], [-1.45, 0.72]],
    zb: [[0, -1.0], [-0.4, -0.86], [-0.8, -0.56], [-1.0, -0.2], [-1.25, 0.28], [-1.45, 0.56]],
    n: [[0, 2.0], [-0.8, 2.5], [-1.45, 2.0]],
    skin: '#f6e7db',
  },
  chibi: {
    // Q 版：颅骨大而圆，下颌很短、脸颊鼓，整张脸接近圆形（不是蛋）
    jaw: 0.95,
    w: [[0, 1.0], [-0.3, 1.0], [-0.55, 0.95], [-0.75, 0.8], [-0.88, 0.5], [-0.95, 0.1]],
    zf: [[0, 0.98], [-0.5, 0.96], [-0.8, 0.88], [-0.95, 0.7]],
    zb: [[0, -1.0], [-0.4, -0.9], [-0.7, -0.55], [-0.85, -0.1], [-0.95, 0.45]],
    n: [[0, 2.2], [-0.95, 2.2]],
    skin: '#fbeee5',
  },
};
const U_POW = 0.55; // 贴图 u 对正前角差的幂：正前 ±40° 占贴图宽度的 44%，脸的像素密度是后脑的 3 倍
const uOf = (dphi) => 0.5 + 0.5 * Math.sign(dphi) * Math.pow(Math.abs(dphi) / Math.PI, U_POW);
function pw(table, y) {
  if (y >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) { const [y1, v1] = table[i]; if (y >= y1) { const [y0, v0] = table[i - 1]; return lerp(v0, v1, (y0 - y) / (y0 - y1)); } }
  return table[table.length - 1][1];
}
/** 头几何：上半球 + 下颌剖面；uv 的 u 以正前为中心非线性拉伸，v 从头顶 1 到下巴 0 */
function headGeometry(R, kind) {
  const H = HEAD[kind];
  const cols = 48, rowsTop = 14, rowsLow = 18;
  const yTop = 1, yChin = -H.jaw;
  const pos = [], uv = [], idx = [];
  const vOf = (y) => 1 - (yTop - y) / (yTop - yChin);
  const pushRow = (y, w, d, zc, n) => {
    const v = vOf(y);
    for (let c = 0; c <= cols; c++) {
      const phi = (c / cols) * Math.PI * 2;
      const ca = Math.cos(phi), sa = Math.sin(phi), ex = 2 / n;
      const x = -w * Math.sign(ca) * Math.pow(Math.abs(ca), ex);
      const z = zc + d * Math.sign(sa) * Math.pow(Math.abs(sa), ex);
      pos.push(x * R, y * R, z * R);
      let dphi = phi - Math.PI / 2; if (dphi > Math.PI) dphi -= Math.PI * 2;
      uv.push(uOf(dphi), v);
    }
  };
  for (let r = 0; r <= rowsTop; r++) {
    const th = (r / rowsTop) * (Math.PI / 2);
    const y = Math.cos(th), s = Math.sin(th);
    const zf = 0.96 * s, zb = -(1.0 + 0.05 * Math.sin(Math.PI * y)) * s; // 前额略平、后脑略鼓
    pushRow(y, s, (zf - zb) / 2, (zf + zb) / 2, 2.0);
  }
  for (let r = 1; r <= rowsLow; r++) {
    const y = -(r / rowsLow) * H.jaw;
    const w = pw(H.w, y), zf = pw(H.zf, y), zb = pw(H.zb, y), n = pw(H.n, y);
    pushRow(y, w, (zf - zb) / 2, (zf + zb) / 2, n);
  }
  pushRow(yChin - 0.02, 0.002, 0.002, pw(H.zf, yChin) * 0.9, 2.0); // 封底
  const rows = rowsTop + rowsLow + 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, b = a + cols + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** 头表面上 (dphi, y) 处的局部坐标（R 单位），给眼睛发光点等贴表面的小件定位 */
function headSurface(kind, dphi, y) {
  const H = HEAD[kind];
  const w = pw(H.w, y), zf = pw(H.zf, y), zb = pw(H.zb, y), n = pw(H.n, y), d = (zf - zb) / 2, zc = (zf + zb) / 2;
  const phi = Math.PI / 2 + dphi, ca = Math.cos(phi), sa = Math.sin(phi), ex = 2 / n;
  return new THREE.Vector3(-w * Math.sign(ca) * Math.pow(Math.abs(ca), ex), y, zc + d * Math.sign(sa) * Math.pow(Math.abs(sa), ex));
}

// ---------- 脸：直接画进头的贴图。所有五官都用「头面坐标」(h = 绕头弧长 / R，即弧度；y = 高度 / R) 描点，再经 uOf/vOf 映射到像素，
// 所以贴图 u 的非线性拉伸不会把眼睛画歪；二次元眼是 3D 几何做不出的，贴图才对味。 ----------
function headTexture(kind) {
  const H = HEAD[kind];
  const S = 1024;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const yTop = 1, yChin = -H.jaw;
  const px = (h, y) => [uOf(h) * S, ((yTop - y) / (yTop - yChin)) * S];
  const path = (pts, close = false) => { g.beginPath(); pts.forEach(([h, y], i) => { const [X, Y] = px(h, y); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); if (close) g.closePath(); };
  const ellPts = (ch, cy, rh, ry, rot = 0, a0 = 0, a1 = Math.PI * 2, N = 48) => { const pts = []; for (let i = 0; i <= N; i++) { const a = a0 + ((a1 - a0) * i) / N; const ex = rh * Math.cos(a), ey = ry * Math.sin(a); pts.push([ch + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]); } return pts; };
  const fillEll = (ch, cy, rh, ry, style, rot = 0) => { path(ellPts(ch, cy, rh, ry, rot), true); g.fillStyle = style; g.fill(); };
  const stroke = (pts, style, width) => { path(pts); g.strokeStyle = style; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); };
  g.fillStyle = H.skin; g.fillRect(0, 0, S, S);
  // 皮肤明暗：颌底一圈略暗、额头（发帽下）略暗，给 toon 三阶之外一点过渡
  const [, jawY] = px(0, yChin + 0.35), [, chinY] = px(0, yChin);
  let gr = g.createLinearGradient(0, jawY, 0, chinY); gr.addColorStop(0, 'rgba(120,70,70,0)'); gr.addColorStop(1, 'rgba(120,70,70,.25)'); g.fillStyle = gr; g.fillRect(0, jawY, S, chinY - jawY);
  /**
   * 一只眼：ch 中心弧长、cy 高度、rh/ry 半径、rot 外眼角上挑（人物左眼 ch>0，右眼 ch<0）；
   * o = { irisTop, irisBot, sclera, pupil, lash, red, lashW, lowerW, irisScale, highlightBig }
   */
  const eye = (ch, cy, rh, ry, rot, o) => {
    const outer = ch > 0 ? 1 : -1;
    const r = rot * outer;
    g.save();
    path(ellPts(ch, cy, rh, ry, r), true); g.fillStyle = o.sclera; g.fill(); g.clip();
    const [, topY] = px(ch, cy + ry), [, botY] = px(ch, cy - ry);
    gr = g.createLinearGradient(0, topY, 0, botY); gr.addColorStop(0, o.irisTop); gr.addColorStop(1, o.irisBot);
    const irh = rh * o.irisScale, iry = ry * 0.96;
    fillEll(ch, cy - ry * 0.06, irh, iry, gr);
    if (o.red) { path(ellPts(ch, cy - ry * 0.06, irh * 0.66, iry * 0.66), true); g.strokeStyle = '#ff2d3d'; g.lineWidth = 6; g.stroke(); }
    fillEll(ch, cy - ry * 0.1, irh * 0.42, iry * 0.5, o.pupil);
    // 上睑投影
    fillEll(ch, cy + ry * 0.78, rh * 1.3, ry * 0.5, 'rgba(30,22,40,.38)');
    // 高光：左上一大、右下一小
    fillEll(ch - rh * 0.34 * outer, cy + ry * 0.3, rh * (o.highlightBig ? 0.26 : 0.17), ry * (o.highlightBig ? 0.24 : 0.18), 'rgba(255,255,255,.96)');
    fillEll(ch + rh * 0.3 * outer, cy - ry * 0.42, rh * 0.11, ry * 0.1, 'rgba(255,255,255,.8)');
    g.restore();
    // 上眼线（粗，外眼角上挑出一小截睫毛）、下眼线（细）
    stroke(ellPts(ch, cy, rh * 1.04, ry * 1.04, r, Math.PI * 0.04, Math.PI * 0.96), o.lash, o.lashW);
    const tipA = outer > 0 ? Math.PI * 0.08 : Math.PI * 0.92;
    const [th, ty] = ellPts(ch, cy, rh * 1.04, ry * 1.04, r, tipA, tipA, 1)[0];
    stroke([[th, ty], [th + outer * rh * 0.32, ty + ry * 0.42]], o.lash, o.lashW * 0.8);
    stroke(ellPts(ch, cy, rh, ry, r, Math.PI * 1.15, Math.PI * 1.85), o.lowerLash, o.lowerW);
  };
  if (kind === 'awakened') {
    // 男性动漫眼：偏窄长、上睑平、虹膜不撑满、眉压得近。人物左眼（ch>0）= 赫眼：黑眼白 + 红虹膜 + 红环
    const ey = -0.08, rh = 0.235, ry = 0.15, sep = 0.27;
    const base = { pupil: '#07050a', lash: '#120e16', lowerLash: 'rgba(18,14,22,.7)', lashW: 11, lowerW: 3.5, irisScale: 0.52, highlightBig: false };
    eye(-sep, ey, rh, ry, 0.12, { ...base, irisTop: '#4e5a6a', irisBot: '#98a6b6', sclera: '#f5f3f1', red: false });
    eye(sep, ey, rh, ry, 0.12, { ...base, irisTop: '#a80a20', irisBot: '#ff3838', sclera: '#100508', red: true });
    // 眉：细、平中带挑，靠近眼睛
    for (const s of [-1, 1]) stroke([[s * 0.1, 0.14], [s * 0.26, 0.17], [s * 0.42, 0.13]], '#3a3a44', 7);
    // 鼻：一短竖线 + 鼻底一点；嘴：微抿的一线；左眼下淡血痕
    stroke([[0.0, -0.5], [-0.02, -0.67]], 'rgba(120,90,90,.55)', 4);
    stroke([[-0.03, -0.69], [0.03, -0.69]], 'rgba(120,90,90,.4)', 3);
    stroke([[-0.09, -0.98], [0, -1.0], [0.09, -0.98]], '#7a3a44', 5);
    stroke([[0.34, -0.28], [0.37, -0.56]], 'rgba(190,30,50,.5)', 3);
  } else {
    // Q 版：眼在脸的下半、竖长大眼、虹膜上深下亮、两点大高光、粗上睫毛、细眉、腮红、猫嘴 ω
    const ey = -0.3, rh = 0.26, ry = 0.28, sep = 0.31;
    const base = { pupil: '#0a0e1c', lash: '#141018', lowerLash: 'rgba(20,16,24,.6)', lashW: 14, lowerW: 4, irisScale: 0.82, highlightBig: true, red: false };
    for (const s of [-1, 1]) eye(s * sep, ey, rh, ry, 0.08, { ...base, irisTop: '#1c2a52', irisBot: '#6fc3e6', sclera: '#fbfaf8' });
    for (const s of [-1, 1]) stroke([[s * 0.12, 0.1], [s * 0.3, 0.14], [s * 0.46, 0.09]], 'rgba(70,60,80,.8)', 5);
    for (const s of [-1, 1]) fillEll(s * 0.5, -0.54, 0.13, 0.07, 'rgba(245,120,135,.5)');
    stroke([[-0.09, -0.72], [-0.045, -0.77], [0, -0.725], [0.045, -0.77], [0.09, -0.72]], '#7a3a44', 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- 头发：贴着头皮铺的发丝带（不是炸开的锥子）----------
const _sv = new THREE.Vector3(), _sv2 = new THREE.Vector3(), _tp = new THREE.Vector3(), _nn = new THREE.Vector3();
const sph = (theta, phi, r, out) => out.set(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
/**
 * 一条发丝：在半径 R 的头球面上从 a=[theta,phi] 铺到 b，宽 w、末端渐尖；三列顶点（左 / 中隆起 / 右）有厚度感；
 * lift 让末端离开头皮微翘，sweep 让中段侧扫。
 */
function ribbon(parts, R, a, b, w, { segs = 7, lift = 0.4, taper = 0.9, sweep = 0, ridge = 0.08, rise = 1.06 } = {}) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const theta = lerp(a[0], b[0], s), phi = lerp(a[1], b[1], s) + sweep * Math.sin(s * Math.PI);
    const r = R * (rise + 0.015 * s) + R * lift * 0.12 * s * s * s;
    sph(theta, phi, r, _sv);
    sph(theta, phi + 0.02, r, _sv2); _tp.subVectors(_sv2, _sv).normalize();
    _nn.copy(_sv).normalize();
    const hw = w * (1 - taper * s * s) * 0.5 + 0.0015;
    pos.push(_sv.x - _tp.x * hw, _sv.y - _tp.y * hw, _sv.z - _tp.z * hw);
    pos.push(_sv.x + _nn.x * ridge * w, _sv.y + _nn.y * ridge * w, _sv.z + _nn.z * ridge * w);
    pos.push(_sv.x + _tp.x * hw, _sv.y + _tp.y * hw, _sv.z + _tp.z * hw);
    if (i < segs) { const k = i * 3; idx.push(k, k + 1, k + 3, k + 1, k + 4, k + 3, k + 1, k + 2, k + 4, k + 2, k + 5, k + 4); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  parts.push(g);
}
function hairGeometry(R, kind) {
  const parts = [], rnd = rng(kind === 'awakened' ? 7 : 3);
  const cap = (phi0, phiLen, th0, thLen, ws = 24, hs = 10) => parts.push(new THREE.SphereGeometry(R * 1.06, ws, hs, phi0, phiLen, th0, thLen));
  if (kind === 'awakened') {
    // 发帽：头顶到眉线上方一圈；后脑与两侧再往下盖到耳上 / 后颈
    cap(0, Math.PI * 2, 0, Math.PI * 0.4);
    cap(FRONT - Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.4, Math.PI * 0.05, 12, 2); // 前额发帽再压低一点，刘海之间不露头皮
    cap(Math.PI * 1.02, Math.PI * 0.96, Math.PI * 0.4, Math.PI * 0.26, 18, 6);
    cap(FRONT + Math.PI * 0.34, Math.PI * 0.2, Math.PI * 0.4, Math.PI * 0.18, 8, 5);
    cap(FRONT - Math.PI * 0.54, Math.PI * 0.2, Math.PI * 0.4, Math.PI * 0.18, 8, 5);
    // 刘海 16 束：从发际线（0.26π）垂到眉 / 眼（0.48–0.58π），宽而密地盖住额头，中偏左分缝，向两侧微扫，左眼（+x 侧）上方几束更长遮一点眼角
    const N = 16;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N - 0.5;
      const phi0 = FRONT + u * Math.PI * 0.92 + (rnd() - 0.5) * 0.06;
      const long = u > 0.02 && u < 0.3 ? 0.07 : 0;
      const end = Math.PI * (0.48 + rnd() * 0.05 + long);
      ribbon(parts, R, [Math.PI * 0.26, phi0 - u * 0.2], [end, phi0 + u * 0.15], R * (0.3 + rnd() * 0.1), { segs: 7, taper: 0.9, lift: 0.5 });
    }
    // 鬓角：两侧各两束到下颌
    for (const sgn of [-1, 1]) for (const [dp, end, w] of [[0.4, 0.7, 0.22], [0.48, 0.63, 0.18]]) ribbon(parts, R, [Math.PI * 0.36, FRONT + sgn * Math.PI * dp], [Math.PI * end, FRONT + sgn * Math.PI * (dp + 0.04)], R * w, { segs: 6, taper: 0.85, lift: 0.3 });
    // 后颈短发
    for (let i = 0; i < 10; i++) { const phi0 = Math.PI * 1.08 + ((i + 0.5) / 10) * Math.PI * 0.84; ribbon(parts, R, [Math.PI * 0.42, phi0], [Math.PI * (0.66 + rnd() * 0.06), phi0 + (rnd() - 0.5) * 0.1], R * 0.3, { segs: 5, taper: 0.9, lift: 0.7 }); }
    // 头顶几撮微翘的碎发：乱一点，但贴着头
    for (let i = 0; i < 7; i++) { const phi0 = rnd() * Math.PI * 2; ribbon(parts, R, [Math.PI * 0.08, phi0], [Math.PI * 0.34, phi0 + (rnd() - 0.5) * 0.5], R * 0.22, { segs: 4, taper: 0.9, lift: 1.6, rise: 1.075 }); }
  } else {
    // Q 版：兜帽下露出的刘海 + 两侧发
    cap(0, Math.PI * 2, 0, Math.PI * 0.36, 20, 8);
    for (let i = 0; i < 7; i++) { const u = (i + 0.5) / 7 - 0.5; const phi0 = FRONT + u * Math.PI * 0.7; ribbon(parts, R, [Math.PI * 0.28, phi0 - u * 0.12], [Math.PI * (0.44 + rnd() * 0.05), phi0 + u * 0.1], R * 0.3, { segs: 6, taper: 0.9, lift: 0.5 }); }
    for (const sgn of [-1, 1]) ribbon(parts, R, [Math.PI * 0.34, FRONT + sgn * Math.PI * 0.4], [Math.PI * 0.6, FRONT + sgn * Math.PI * 0.44], R * 0.24, { segs: 5, taper: 0.85, lift: 0.3 });
  }
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts, false);
}

// ---------- 魔法披风：外黑内绯，下摆刺绣 + 背心印记发光——贴图优先用 textures.js 的 cloakRuneTexture()（B，H-4：SVG 刺绣），
// 没有那个导出时用下面这张程序画的兜底（下摆两道纹 + 符文短划 + 背心双圈两三角）----------
function runeTextureFallback() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#ff3448'; g.lineCap = 'round';
  g.lineWidth = 3; g.beginPath(); g.moveTo(0, S * 0.85); g.lineTo(S, S * 0.85); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.moveTo(0, S * 0.92); g.lineTo(S, S * 0.92); g.stroke();
  for (let i = 0; i < 26; i++) { const x = ((i + 0.5) / 26) * S; g.lineWidth = 2; g.beginPath(); g.moveTo(x, S * 0.87); g.lineTo(x + ((i % 3) - 1) * 5, S * 0.9); if (i % 2) { g.moveTo(x - 4, S * 0.885); g.lineTo(x + 4, S * 0.885); } g.stroke(); }
  const cx = S * 0.5, cy = S * 0.5, r = S * 0.19;
  g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r * 0.84, 0, Math.PI * 2); g.stroke();
  const tri = (rot) => { g.beginPath(); for (let k = 0; k < 3; k++) { const a = rot + (k * Math.PI * 2) / 3; const x = cx + Math.cos(a) * r * 0.8, y = cy + Math.sin(a) * r * 0.8; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); };
  g.lineWidth = 3; tri(-Math.PI / 2); tri(Math.PI / 2);
  g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fillStyle = '#ff3448'; g.fill();
  g.lineWidth = 4; g.beginPath(); g.moveTo(3, 0); g.lineTo(3, S); g.moveTo(S - 3, 0); g.lineTo(S - 3, S); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const cloakRuneTexture = () => (typeof TEX.cloakRuneTexture === 'function' ? TEX.cloakRuneTexture() : runeTextureFallback());
/** 披风网格（列 = 绕背的角度，行 = 从肩到下摆），顶点由 _deformCloak 逐帧写 */
function cloakGeometry() {
  const geo = new THREE.BufferGeometry();
  const n = (CLOAK_COLS + 1) * (CLOAK_ROWS + 1);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let r = 0; r <= CLOAK_ROWS; r++) for (let c = 0; c <= CLOAK_COLS; c++) { const i = r * (CLOAK_COLS + 1) + c; uv[i * 2] = c / CLOAK_COLS; uv[i * 2 + 1] = 1 - r / CLOAK_ROWS; }
  for (let r = 0; r < CLOAK_ROWS; r++) for (let c = 0; c < CLOAK_COLS; c++) { const a = r * (CLOAK_COLS + 1) + c, b = a + CLOAK_COLS + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  return geo;
}

export class Wanderer {
  constructor({ reducedMotion = false, form = 'chibi', outfit = 'voyager' } = {}) {
    this.reducedMotion = reducedMotion;
    this.root = new THREE.Group();
    this.root.name = 'wanderer';
    this.heading = 0;
    this.time = 0;
    this.phase = 0;
    this.speed = 0;
    this.weights = { idle: 1, walk: 0, run: 0, interact: 0, look: 0, jump: 0, sit: 0 }; // sit 三处（这里 / target / update 的 P 表）须与 STATES 同步，缺一处 update 每帧抛错或算出 NaN（X 00:58 止血补齐）
    this.target = { idle: 1, walk: 0, run: 0, interact: 0, look: 0, jump: 0, sit: 0 };
    this.state = 'idle';
    this.idleTime = 0;
    this.interactT = -1;
    this.lookT = -1;
    this.swingT = -1;
    this.airborne = false;
    this.locked = false;
    this.form = form;
    this.formT = -1;           // ≥0 变身进行中
    this.dot = softDot(64);
    this.rigs = { chibi: this._buildChibi(), awakened: this._buildAwakened(), cat: buildCatRig() }; // cat：08 E.1 第三形态（C · player/cat-form.js）
    for (const k of Object.keys(this.rigs)) { this.rigs[k].group.visible = k === form; this.root.add(this.rigs[k].group); }
    this.rig = this.rigs[form];
    this.outfitController = createOutfitController(this.rigs);
    this.outfitController.set(outfit);
    this.privateRest = createPrivateRest(this.rigs);
    this.bedRest = createBedRest(this.rigs);
    this.benchRest = createBenchRest(this.rigs);
    this.pianoPose = createPianoPose(this.rigs);
    this.memorialPose = createMemorialPose(this.rigs);
    this.workstationPose = createWorkstationPose(this.rigs);
    this.dragonRiderPose = createDragonRiderPose(this.rigs);
    // 唯一的法杖光（数量恒定）：挂在当前形态的杖头 / 刃身
    this.staffLight = new THREE.PointLight(COLORS.magic, 1.2, 4, 2);
    this.rig.lightAnchor.add(this.staffLight);
    // 变身用光：不再是真 PointLight（全场景灯数恒定 9 盏，见 lights.js），只记需求 {color, intensity, position(root 局部)}，
    // 由 skills.js 的共享近身灯位 fxNear 每帧读取代为发光（P-001）
    this.formLight = { color: new THREE.Color(0xffffff), intensity: 0, position: new THREE.Vector3(0, 1.0, 0) };
    this._buildTransformFx();
    this._deformCloak(this.rigs.chibi, 0, 0, 1);
    this._deformCloak(this.rigs.awakened, 0, 0, 1);
  }

  get eyeHeight() { return this.rig.eyeHeight; }
  get handHeight() { return this.rig.handHeight; }
  get outfit() { return this.outfitController.current; }
  setOutfit(key) {
    if (this.formT >= 0 || this.locked || this.airborne ||
        [this.privateRest, this.bedRest, this.benchRest, this.pianoPose,
         this.memorialPose, this.workstationPose, this.dragonRiderPose].some(p => p?.active)) return false;
    if (!this.outfitController.set(key)) return false;
    for (const rig of [this.rigs.chibi, this.rigs.awakened]) this._deformCloak(rig, this.time, 0, 0);
    return true;
  }

  // ======================= Q 版 =======================
  _buildChibi() {
    const R = {};
    const g = new THREE.Group(); g.name = 'rig-chibi';
    g.userData.k3CharacterShading = CHARACTER_SHADING_VERSION;
    g.userData.k3CostumePattern = COSTUME_PATTERN_VERSION;
    g.userData.k3CharacterDetail = CHARACTER_DETAIL_VERSION;
    const robe = travelerGarmentMaterial(0x605475), robeDark = travelerGarmentMaterial(0x45415b), skin = travelerSkinMaterial(0xf6e4d6), dark = travelerGarmentMaterial(0x161827, 'leather'), wood = toon(0x65516b), hairMat = toon(0xe6e4ec, { side: THREE.DoubleSide }), gold = new THREE.MeshStandardMaterial({ color: 0xe8c98a, roughness: 0.38, metalness: 0.55, emissive: COLORS.goldDeep, emissiveIntensity: 0.22 });
    R.hipsY = 0.62; R.eyeHeight = 1.24; R.handHeight = 0.85; R.bobScale = 0.7;
    R.sitDrop = 0.17; R.sitLeg = -1.25; // 坐姿：髋从 0.62 落到 0.45 凳面，腿前伸 72°（腿长 0.5 < 凳高，脚悬空晃着）
    R.hips = new THREE.Group(); R.hips.position.y = R.hipsY; g.add(R.hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), robe); pelvis.scale.set(1, 0.7, 0.9); pelvis.castShadow = true; R.hips.add(pelvis);
    R.torso = new THREE.Group(); R.hips.add(R.torso);
    const chest = new THREE.Mesh(tailoredTorsoGeometry('chibi'), robe); chest.name = 'TailoredTorso'; chest.castShadow = true; R.torso.add(chest); outline(chest, 1.02, BODY_OUTLINE_MAT);
    dressTorso(R.torso, 'chibi', gold);
    // 头：大头（颅骨圆 + 短下颌收成小下巴，脸直接画在头贴图上）+ 刘海 + 大兜帽（前敞 ~95°）
    R.headGroup = new THREE.Group(); R.headGroup.position.set(0, 0.44, 0.02); R.torso.add(R.headGroup);
    const HR = 0.2, HY = 0.18; // 颅骨球心高度：下巴在球心下 0.95R，正好落到脖子
    const head = new THREE.Mesh(headGeometry(HR, 'chibi'), toon(0xffffff, { map: headTexture('chibi'), emissive: new THREE.Color(0x1c1414) })); head.position.y = HY; head.scale.set(1.06, 1, 1.02); head.castShadow = true; R.headGroup.add(head); outline(head, 1.045);
    R.headMesh = head; R.headY = HY; // attachHeads() 换 glb 头（GPT G3-001）时把这两个程序件藏掉
    const hair = new THREE.Mesh(hairGeometry(HR, 'chibi'), hairMat); hair.position.y = HY; hair.castShadow = true; R.headGroup.add(hair);
    R.hair = hair;
    const hoodMat = travelerClothMaterial({ color: 0x59516f, side: THREE.DoubleSide, emissive: 0x242337, emissiveIntensity: 0.10 });
    const hood = new THREE.Mesh(travelerHoodGeometry(), hoodMat); hood.name = 'SewnTravelerHood';
    // The hood now has a real turned cloth edge and lining. A scaled inverted
    // copy would cross that thin edge and reintroduce a rigid double contour.
    hood.castShadow = true; R.headGroup.add(hood);
    R.outfitParts = { top: robe, bottom: robeDark, pelvis, hood };
    // 手臂（枢轴在肩）
    const mkArm = (x) => {
      const a = new THREE.Group(); a.position.set(x, 0.38, 0.02);
      const sleeve = new THREE.Mesh(sleeveGeometry('chibi', Math.sign(x)), robe); sleeve.name = 'TailoredSleeve'; sleeve.castShadow = true; a.add(sleeve);
      const hand = new THREE.Mesh(travelerHandGeometry('chibi', x < 0), skin); hand.name = x < 0 ? 'GrippingHand' : 'RelaxedHand'; hand.position.y = -0.33; hand.castShadow = true; a.add(hand);
      a.restHinge = makeRestHinge([sleeve], [hand], -.16);
      R.torso.add(a); a.sleeveBinding = createChibiSleeveBinding(sleeve, R.torso, Math.sign(x)); return a;
    };
    R.armL = mkArm(0.24); R.armR = mkArm(-0.24);
    // 法杖（右手）
    R.staff = new THREE.Group(); R.staff.position.set(0, -0.3, 0.1); R.armR.add(R.staff);
    R.gripFollower = createTravelerGrip(R.armR.getObjectByName('GrippingHand').geometry);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.5, 8), wood); shaft.position.y = 0.2; shaft.castShadow = true; R.staff.add(shaft);
    for (const y of [-0.15, 0.6]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 6, 12), gold); band.rotation.x = Math.PI / 2; band.position.y = y; R.staff.add(band); }
    const crown = new THREE.Group(); crown.position.y = 0.95; R.staff.add(crown);
    R.orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.magicHot).multiplyScalar(1.25), fog: false });
    R.orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), R.orbMat); R.orb.position.y = 0.16; crown.add(R.orb);
    R.halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshBasicMaterial({ color: COLORS.magic, transparent: true, opacity: 0.07, depthWrite: false, fog: false })); R.halo.position.y = 0.16; crown.add(R.halo);
    R.lightAnchor = new THREE.Group(); R.lightAnchor.position.y = 0.16; crown.add(R.lightAnchor);
    // 腿（短）
    const mkLeg = (x) => {
      const l = new THREE.Group(); l.position.set(x, -0.08, 0);
      const leg = new THREE.Mesh(trouserLegGeometry('chibi'), robeDark); leg.name = 'TailoredTrousers'; leg.castShadow = true; l.add(leg);
      const boot = new THREE.Mesh(bootGeometry('chibi'), dark); boot.name = 'TailoredBoot'; boot.position.set(0, -0.46, 0.03); boot.castShadow = true; l.add(boot);
      l.restHinge = makeRestHinge([leg], [boot], -.21);
      R.hips.add(l); return l;
    };
    R.legL = mkLeg(0.11); R.legR = mkLeg(-0.11);
    R.restHinges = [R.legL.restHinge, R.legR.restHinge, R.armL.restHinge, R.armR.restHinge];
    // 披风（CPU 变形，深靛 + 暗金下摆）
    const ct = cloakTex();
    R.cloakMat = travelerClothMaterial({ map: ct.map, emissiveMap: ct.emissive, emissive: new THREE.Color(COLORS.gold), emissiveIntensity: 0.55, side: THREE.DoubleSide }, true);
    R.cloak = new THREE.Mesh(cloakGeometry(), R.cloakMat); R.cloak.castShadow = true; R.cloak.frustumCulled = false; R.torso.add(R.cloak);
    R.cloakDims = { yTop: 0.4, yHem: -0.56, r0: 0.22, r1: 0.44, flareScale: 1, wave: 0.02 };
    R.group = g;
    return R;
  }

  // ======================= 觉醒态 =======================
  _buildAwakened() {
    const R = {};
    const g = new THREE.Group(); g.name = 'rig-awakened';
    g.userData.k3CharacterShading = CHARACTER_SHADING_VERSION;
    g.userData.k3CostumePattern = COSTUME_PATTERN_VERSION;
    g.userData.k3CharacterDetail = CHARACTER_DETAIL_VERSION;
    const skin = travelerSkinMaterial(0xf5e6da), black = travelerGarmentMaterial(0x554f67), blackSoft = travelerGarmentMaterial(0x545064, 'satin'), white = travelerGarmentMaterial(0xd9d9e6), hairMat = toon(0xe6e4ec, { side: THREE.DoubleSide }), boot = travelerGarmentMaterial(0x171521, 'leather');
    const silverGold = new THREE.MeshStandardMaterial({ color: 0xd4bdac, roughness: 0.4, metalness: 0.5, emissive: 0x32232b, emissiveIntensity: 0.2 });
    R.hipsY = 0.95; R.eyeHeight = 1.83; R.handHeight = 1.3; R.bobScale = 1.0;
    R.sitDrop = 0.42; R.sitLeg = -1.0; // 坐姿：髋从 0.95 落到 0.53（凳面 0.45 + 腿根 0.08），腿前伸 57°，脚尖正好点地
    R.hips = new THREE.Group(); R.hips.position.y = R.hipsY; g.add(R.hips);
    // 骶部 + 白裤
    const pelvis = new THREE.Mesh(trouserPelvisGeometry(), white); pelvis.name = 'TailoredPelvis'; pelvis.castShadow = true; R.hips.add(pelvis); outline(pelvis, 1.015, BODY_OUTLINE_MAT);
    R.outfitParts = { top: black, bottom: white, pelvis };
    R.torso = new THREE.Group(); R.hips.add(R.torso);
    // 黑色紧身上衣：胸腔略宽、腰收
    const chest = new THREE.Mesh(tailoredTorsoGeometry('awakened'), black); chest.name = 'TailoredTorso'; chest.castShadow = true; R.torso.add(chest); outline(chest, 1.015, BODY_OUTLINE_MAT);
    dressTorso(R.torso, 'awakened', silverGold);
    // Shoulders now slope into the neck in the torso mesh; no horizontal bar.
    // 脖子、衣领、披风扣、颈间面具（黑色半面具挂在颈前）
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.12, 10), skin); neck.position.y = 0.68; R.torso.add(neck); R.neckMesh = neck;
    R.clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3448).multiplyScalar(0.9), fog: false })); R.clasp.position.set(0, 0.63, 0.085); R.torso.add(R.clasp);
    const mask = new THREE.Mesh(hangingMaskGeometry(), travelerGarmentMaterial(0x0d0b11, 'leather', { side: THREE.DoubleSide })); mask.name = 'HangingBlackMask'; mask.position.set(0, .50, torsoFront('awakened', 0, .50, .014).z); R.torso.add(mask);
    const maskStrap = new THREE.Mesh(hangingMaskStrapGeometry(), black); maskStrap.name = 'BlackMaskStrap'; R.torso.add(maskStrap);
    // 头：颅骨圆 + 楔形下颌收成小下巴（动漫构造法，脸直接画在头贴图上）+ 贴头白发
    R.headGroup = new THREE.Group(); R.headGroup.position.set(0, 0.67, 0.02); R.torso.add(R.headGroup);
    const HR = 0.125, HY = 0.175; // 颅骨球心高度：下巴在球心下 1.45R，略压进脖子
    const head = new THREE.Mesh(headGeometry(HR, 'awakened'), toon(0xffffff, { map: headTexture('awakened'), emissive: new THREE.Color(0x1a1212) })); head.position.y = HY; head.castShadow = true; R.headGroup.add(head); outline(head, 1.045);
    R.headMesh = head; R.headY = HY;
    // 左眼红光（人物左眼 = 面朝 +z 时的 +x 侧）：一粒不触发 Bloom 的暗红点（亮度乘数 ≤ 1，否则整张脸糊成红雾），贴在眼睛位置的头表面上
    R.eyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3040).multiplyScalar(0.9), fog: false }));
    R.eyeGlow.position.copy(headSurface('awakened', 0.27, -0.08)).multiplyScalar(HR * 1.01); R.eyeGlow.position.y += HY; R.headGroup.add(R.eyeGlow);
    const hair = new THREE.Mesh(hairGeometry(HR, 'awakened'), hairMat); hair.position.y = HY; hair.castShadow = true; R.headGroup.add(hair);
    R.hair = hair;
    // 手臂
    const mkArm = (x) => {
      const a = new THREE.Group(); a.position.set(x, 0.54, 0.02);
      const upper = new THREE.Mesh(sleeveGeometry('awakened', Math.sign(x)), black); upper.name = 'TailoredSleeve'; upper.castShadow = true; a.add(upper);
      const fore = new THREE.Mesh(forearmGeometry(), skin); fore.name = 'ForearmSurface'; fore.position.y = -0.3; fore.castShadow = true; a.add(fore);
      const hand = new THREE.Mesh(travelerHandGeometry('awakened', x < 0), skin); hand.name = x < 0 ? 'GrippingHand' : 'RelaxedHand'; hand.position.y = -0.63; hand.castShadow = true; a.add(hand);
      a.restHinge = makeRestHinge([upper, fore], [hand], -.3);
      outline(upper, 1.02, BODY_OUTLINE_MAT); outline(fore, 1.02, BODY_OUTLINE_MAT);
      R.torso.add(a); a.sleeveBinding = createSleeveBinding(upper, R.torso); return a;
    };
    R.armL = mkArm(0.255); R.armR = mkArm(-0.255);
    // 黑刃（右手）：细长黑刀，刃口一线红
    R.staff = new THREE.Group(); R.staff.position.set(0, -0.62, 0.08); R.armR.add(R.staff);
    R.gripFollower = createTravelerGrip(R.armR.getObjectByName('GrippingHand').geometry);
    R.staffGripHome = R.staff.position.clone();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.24, 8), blackSoft); grip.position.y = 0.02; R.staff.add(grip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.03), toon(0x2a2430)); guard.position.y = 0.15; R.staff.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.05, 0.008), toon(0x101018)); blade.position.y = 0.69; blade.castShadow = true; R.staff.add(blade);
    R.orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a3a).multiplyScalar(1.3), fog: false });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.006, 1.02, 0.012), R.orbMat); edge.position.set(0.016, 0.69, 0); R.staff.add(edge);
    R.orb = edge; R.halo = new THREE.Group();
    // 红光挂在刃根（刃尖在头旁边，挂高了整张脸被染成粉色）
    R.lightAnchor = new THREE.Group(); R.lightAnchor.position.y = 0.28; R.staff.add(R.lightAnchor);
    // 腿：白裤 + 黑靴
    const mkLeg = (x) => {
      const l = new THREE.Group(); l.position.set(x, -0.08, 0);
      const thigh = new THREE.Mesh(trouserLegGeometry('awakened'), white); thigh.name = 'TailoredTrousers'; thigh.castShadow = true; l.add(thigh); outline(thigh, 1.015, BODY_OUTLINE_MAT);
      const bootM = new THREE.Mesh(bootGeometry('awakened'), boot); bootM.name = 'TailoredBoot'; bootM.position.set(0, -0.82, 0.05); bootM.castShadow = true; l.add(bootM);
      l.restHinge = makeRestHinge([thigh], [bootM], -.38);
      R.hips.add(l); return l;
    };
    R.legL = mkLeg(0.12); R.legR = mkLeg(-0.12);
    R.restHinges = [R.legL.restHinge, R.legR.restHinge, R.armL.restHinge, R.armR.restHinge];
    // 魔法披风：外黑（符文 / 印记发光）+ 内绯，同一张网格两面各一个材质；逐帧 _deformCloak 飘动
    const geo = cloakGeometry();
    // H-4（B）：黑底红纹刺绣——下摆 pattern.svg 六角格刺绣带 + 背心整枚 sigil.svg + 边缘线（textures.js cloakRuneTexture，走 texcache）
    R.cloakMat = travelerClothMaterial({ color: 0x453d56, emissiveMap: cloakRuneTexture(), emissive: new THREE.Color(0xff2a40), emissiveIntensity: 0.85, side: THREE.FrontSide });
    R.cloak = new THREE.Mesh(geo, R.cloakMat); R.cloak.castShadow = true; R.cloak.frustumCulled = false; R.torso.add(R.cloak);
    R.cloakInner = new THREE.Mesh(geo, travelerClothMaterial({ color: 0x7a1428, side: THREE.BackSide, emissive: new THREE.Color(0x3a0812), emissiveIntensity: 0.18 })); R.cloakInner.frustumCulled = false; R.torso.add(R.cloakInner);
    R.cloakDims = { yTop: 0.6, yHem: -0.82, r0: 0.21, r1: 0.4, flareScale: 2.1, wave: 0.045 };
    R.group = g;
    return R;
  }

  _buildTransformFx() {
    // 白光圆盘（从脚扫到头）+ 黑羽粒子
    this.fxRing = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.fxRing.rotation.x = -Math.PI / 2; this.fxRing.visible = false; this.root.add(this.fxRing);
    const N = 40; const pos = new Float32Array(N * 3); this.fxSeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.fxSeed[i * 3] = Math.random(); this.fxSeed[i * 3 + 1] = Math.random(); this.fxSeed[i * 3 + 2] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fxFeathers = new THREE.Points(g, new THREE.PointsMaterial({ map: this.dot, color: 0x1a0a14, size: 0.16, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }));
    this.fxFeathers.visible = false; this.fxFeathers.frustumCulled = false; this.root.add(this.fxFeathers);
    this.fxRed = new THREE.Points(g.clone(), new THREE.PointsMaterial({ map: this.dot, color: new THREE.Color(0xff2040).multiplyScalar(1.4), size: 0.1, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.fxRed.visible = false; this.fxRed.frustumCulled = false; this.root.add(this.fxRed);
  }

  // ---------- 披风（两套形态共用；flare 由姿态给、flutter 由速度给）----------
  _deformCloak(R, t, flare, flutter) {
    if (!R.cloak) return;
    const pos = R.cloak.geometry.attributes.position;
    let i = 0;
    for (let r = 0; r <= CLOAK_ROWS; r++) {
      const v = r / CLOAK_ROWS;
      for (let c = 0; c <= CLOAK_COLS; c++, i++) {
        const u = c / CLOAK_COLS;
        cloakSurfacePoint(R.cloakDims, u, v, t, flare, flutter, cloakPoint);
        pos.setXYZ(i, cloakPoint.x, cloakPoint.y, cloakPoint.z);
      }
    }
    pos.needsUpdate = true;
    R.cloak.geometry.computeVertexNormals();
  }

  // ---------- 形态 ----------
  /** 5：切换形态（chibi → awakened → cat → chibi），带 1.1 s 变身特效；变身中再按返回 false */
  toggleForm() {
    return this.setForm(FORM_ORDER[(FORM_ORDER.indexOf(this.form) + 1) % FORM_ORDER.length]);
  }
  setForm(form, instant = false) {
    if (!FORM_ORDER.includes(form) || this.formT >= 0 || form === this.form) return false;
    this.formT = 0; this.nextForm = form;
    this.fxRing.visible = true; this.fxFeathers.visible = true; this.fxRed.visible = true;
    if (instant === true) this._updateTransform(FORM_TRANSITION_DURATION);
    return true;
  }
  _swapForm() {
    const from = this.rig, to = this.rigs[this.nextForm];
    from.facePerformance?.reset();
    to.facePerformance?.reset();
    from.group.visible = false; to.group.visible = true;
    // 法杖光换家
    this.staffLight.removeFromParent(); to.lightAnchor.add(this.staffLight);
    this.staffLight.color.set(this.nextForm === 'awakened' ? 0xe77d8c : this.nextForm === 'cat' ? 0xe8b84a : COLORS.magic); // 猫：额头金瞳微光
    this.staffLight.distance = this.nextForm === 'awakened' ? 1.65 : this.nextForm === 'cat' ? 2.5 : 4;
    this.form = this.nextForm; this.rig = to;
    // 保持朝向与姿态连续：把当前旋转复制过去
    for (const k of ['legL', 'legR', 'armL', 'armR', 'torso', 'headGroup', 'staff']) if (from[k] && to[k]) to[k].rotation.copy(from[k].rotation);
  }
  _updateTransform(dt) {
    if (this.formT < 0) return;
    this.formT += dt;
    const T = FORM_TRANSITION_DURATION, k = clamp(this.formT / T, 0, 1);
    const toAwakened = this.nextForm === 'awakened';
    // 光盘从脚底扫到头顶再收
    const h = this.rig.eyeHeight + 0.35;
    this.fxRing.position.y = easeOutCubic(Math.min(1, k * 1.6)) * h;
    this.fxRing.material.opacity = Math.sin(Math.PI * k) * 0.95;
    this.fxRing.scale.setScalar(1 + 0.6 * Math.sin(Math.PI * k));
    this.formLight.color.set(toAwakened ? (k < 0.5 ? 0xffffff : 0xff3050) : this.nextForm === 'cat' && k >= 0.5 ? 0xffd27a : 0xffffff);
    this.formLight.intensity = 9 * Math.sin(Math.PI * k);
    // 羽片 / 红粒子
    const pf = this.fxFeathers.geometry.attributes.position, pr = this.fxRed.geometry.attributes.position;
    for (let i = 0; i < pf.count; i++) {
      const s0 = this.fxSeed[i * 3], s1 = this.fxSeed[i * 3 + 1], s2 = this.fxSeed[i * 3 + 2];
      const a = s0 * Math.PI * 2 + k * 3, r = 0.2 + s1 * 0.5 + k * 0.9;
      pf.setXYZ(i, Math.cos(a) * r, 0.3 + s2 * 1.5 + k * 1.2 - k * k * 0.8, Math.sin(a) * r);
      pr.setXYZ(i, Math.cos(a + 1) * r * 0.7, 0.5 + s1 * 1.2 + k * 1.6, Math.sin(a + 1) * r * 0.7);
    }
    pf.needsUpdate = true; pr.needsUpdate = true;
    this.fxFeathers.material.opacity = Math.sin(Math.PI * k) * (toAwakened ? 0.9 : 0.5);
    this.fxRed.material.opacity = toAwakened ? Math.sin(Math.PI * k) * 0.9 : 0;
    if (k >= 0.45 && this.form !== this.nextForm) this._swapForm();
    if (k >= 1) { this.formT = -1; this.fxRing.visible = false; this.fxFeathers.visible = false; this.fxRed.visible = false; this.formLight.intensity = 0; }
  }

  // ---------- 状态 ----------
  setState(name) {
    if (!STATES.includes(name) || this.state === name) return;
    this.state = name;
    for (const s of STATES) this.target[s] = s === name ? 1 : 0;
  }
  playInteract() { this.interactT = 0; this.setState('interact'); return new Promise((res) => setTimeout(res, 900)); }
  playLook(duration = 4) { this.lookT = 0; this.lookDuration = duration; this.setState('look'); }
  setDragonRiding(on, scale) {
    if (on) {
      if (this.privateRest.active) this.setPrivateRest(false);
      const started = this.dragonRiderPose.begin(scale);
      if (started) {
        this.interactT = -1; this.lookT = -1; this.swingT = -1;
        this.setState('sit');
        for (const state of STATES) this.weights[state] = this.target[state];
      }
      return started;
    }
    if (!this.dragonRiderPose.reset()) return false;
    this.setState('idle');
    for (const state of STATES) this.weights[state] = this.target[state];
    return true;
  }
  getDragonSeatHeight() { return this.dragonRiderPose.seatHeight(this.rig, this.form); }
  setBenchRest(on, options) {
    if (on) { this.interactT = -1; this.lookT = -1; this.swingT = -1; return this.benchRest.begin(options); }
    if (!this.benchRest.reset()) return false;
    for (const rig of [this.rigs.chibi, this.rigs.awakened]) { this._deformCloak(rig, 0, 0, 0); rig.cloak.geometry.computeVertexNormals(); }
    this.setState('idle');
    for (const state of STATES) this.weights[state] = this.target[state];
    return true;
  }
  setBedRest(on, options) {
    if (on) {
      this.setDragonRiding(false); this.setPrivateRest(false); this.setBenchRest(false);
      this.interactT = -1; this.lookT = -1; this.swingT = -1;
      this.setState(this.form === 'cat' ? 'sit' : 'idle');
      for (const state of STATES) this.weights[state] = this.target[state];
      return this.bedRest.begin(options);
    }
    if (!this.bedRest.reset()) return false;
    for (const rig of [this.rigs.chibi, this.rigs.awakened]) { this._deformCloak(rig, 0, 0, 0); rig.cloak.geometry.computeVertexNormals(); }
    this.setState('idle');
    for (const state of STATES) this.weights[state] = this.target[state];
    return true;
  }
  setPrivateRest(on, options) {
    if (on) {
      this.setDragonRiding(false);
      this.interactT = -1; this.lookT = -1; this.swingT = -1;
      this.setState(this.form === 'cat' ? 'sit' : 'idle');
      // Private rest teleports into a calibrated pose. Snap its blend weights
      // too: an idle character receives dt=0 in the static-environment mode.
      for (const state of STATES) this.weights[state] = this.target[state];
      return this.privateRest.begin(options);
    }
    this.privateRest.reset();
    for (const rig of [this.rigs.chibi, this.rigs.awakened]) { this._deformCloak(rig, 0, 0, 0); rig.cloak.geometry.computeVertexNormals(); }
    this.setState('idle');
    for (const state of STATES) this.weights[state] = this.target[state];
    return true;
  }
  setExpression(name, strength = .5, seconds = 2) {
    return this.rig.facePerformance?.setExpression(name, strength, seconds) || false;
  }
  setGaze(x, y, seconds = 2) {
    return this.rig.facePerformance?.setGaze?.(x, y, seconds) || false;
  }
  playSwing() { if (this.swingT >= 0 && this.swingT < 0.3) return false; this.swingT = 0; return true; }

  setPianoPlaying(on,options) {
    if(on){
      if(this.privateRest.active||this.bedRest.active||this.benchRest.active||this.dragonRiderPose.active)return false;
      this.interactT=this.lookT=this.swingT=-1;this.setState('idle');
      for(const state of STATES)this.weights[state]=this.target[state];
      return this.pianoPose.begin({...options,form:this.form});
    }
    if(!this.pianoPose.reset())return false;
    for(const rig of [this.rigs.chibi,this.rigs.awakened]){this._deformCloak(rig,0,0,0);rig.cloak.geometry.computeVertexNormals();}
    this.setState('idle');return true;
  }

  setMemorialHolding(on,options) {
    if(on){
      if(this.privateRest.active||this.bedRest.active||this.benchRest.active||this.pianoPose.active||this.dragonRiderPose.active)return false;
      this.interactT=this.lookT=this.swingT=-1;this.setState('idle');
      for(const state of STATES)this.weights[state]=this.target[state];
      return this.memorialPose.begin({...options,form:this.form});
    }
    if(!this.memorialPose.reset())return false;
    for(const rig of [this.rigs.chibi,this.rigs.awakened]){this._deformCloak(rig,0,0,0);rig.cloak.geometry.computeVertexNormals();}
    this.setState('idle');return true;
  }

  setWorkstationUsing(on,options) {
    if(on){
      if(this.privateRest.active||this.bedRest.active||this.benchRest.active||this.pianoPose.active||this.memorialPose.active||this.dragonRiderPose.active)return false;
      this.interactT=this.lookT=this.swingT=-1;this.setState('idle');
      for(const state of STATES)this.weights[state]=this.target[state];
      return this.workstationPose.begin({...options,form:this.form});
    }
    if(!this.workstationPose.reset())return false;
    for(const rig of [this.rigs.chibi,this.rigs.awakened]){this._deformCloak(rig,0,0,0);rig.cloak.geometry.computeVertexNormals();}
    this.setState('idle');return true;
  }

  update(dt, motion) {
    this.workstationPose.advance();
    this.pianoPose.advance();
    this.memorialPose.advance();
    this.time += dt;
    const speed = motion.speed;
    this.speed = speed;
    this.airborne = !!motion.airborne;
    if (this.interactT >= 0) {
      this.interactT += dt;
      if (this.interactT > 0.9) { this.interactT = -1; if (!this.locked) this.setState('idle'); }
    } else if (this.airborne && !this.locked) {
      this.lookT = -1; this.idleTime = 0; this.setState('jump');
    } else if (this.lookT >= 0) {
      this.lookT += dt;
      if (this.lookT > this.lookDuration || speed > 0.2) { this.lookT = -1; this.setState('idle'); }
    } else if (!this.locked) {
      if (speed > PLAYER.walkSpeed * 1.15) this.setState('run');
      else if (speed > 0.15) this.setState('walk');
      else this.setState('idle');
      if (this.state === 'idle') { this.idleTime += dt; if (this.idleTime > 8 && !this.reducedMotion) { this.idleTime = -6; this.playLook(4); } }
      else this.idleTime = 0;
    }
    if (this.swingT >= 0) { this.swingT += dt; if (this.swingT > 0.55) this.swingT = -1; }
    for (const s of STATES) { const w = this.weights[s], tgt = this.target[s]; this.weights[s] = tgt > w ? Math.min(tgt, w + dt / CROSS_FADE) : Math.max(tgt, w - dt / CROSS_FADE); }
    const W = this.weights;
    const runBlend = clamp((speed - PLAYER.walkSpeed) / (PLAYER.runSpeed - PLAYER.walkSpeed), 0, 1);
    const stride = lerp(1.35, 2.0, runBlend) * (this.form === 'chibi' ? 0.8 : this.form === 'cat' ? 0.7 : 1);
    if (speed > 0.05) this.phase += dt * Math.PI * 2 * speed / stride;
    else this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, damp(6, dt));
    const s1 = Math.sin(this.phase), s2 = Math.sin(this.phase * 2);
    const bobWave = 0.5 - 0.5 * Math.cos(this.phase * 2);
    const t = this.time;
    const P = {
      idle: { leg: 0, armL: 0.04 * Math.sin(t * 0.9), armR: 0.03 * Math.sin(t * 0.9 + 1), armRRaise: 0, lean: 0.03, bob: 0.012 * Math.sin(t * 1.3), head: 0.05 * Math.sin(t * 0.5), flare: 0.0, staffTilt: 0.06 },
      walk: { leg: 0.42 * s1, armL: -0.22 * s1, armR: 0.12 * s1, armRRaise: 0, lean: 0.06, bob: 0.016 * bobWave - 0.006, head: 0.012 * s2, flare: 0.08, staffTilt: 0.12 },
      run: { leg: 0.72 * s1, armL: -0.42 * s1, armR: 0.2 * s1, armRRaise: -0.2, lean: 0.17, bob: 0.03 * bobWave - 0.012, head: 0.02 * s2, flare: 0.26, staffTilt: 0.3 },
      interact: (() => { const it = Math.max(0, this.interactT); const raise = it < 0.3 ? it / 0.3 : it < 0.7 ? 1 : Math.max(0, 1 - (it - 0.7) / 0.2); return { leg: 0, armL: 0.1 * raise, armR: 0, armRRaise: -1.25 * raise, lean: 0.12 * raise, bob: -0.02 * raise, head: 0.08 * raise, flare: 0.02, staffTilt: 0.5 * raise }; })(),
      look: { leg: 0, armL: 0.08, armR: 0, armRRaise: -0.35, lean: -0.06, bob: 0.01 * Math.sin(t * 1.3), head: -0.5, flare: 0.02, staffTilt: -0.1 },
      jump: { leg: 0, armL: 0.35, armR: 0.1, armRRaise: -0.55, lean: -0.05, bob: 0.02, head: -0.12, flare: 0.34, staffTilt: -0.2 },
      // sit（D-089 坐下看风景）：STATES 加了 'sit' 但表里没有这一项 → mix() 每帧抛 `reading 'leg'`、渲染循环第一帧就死（X 00:45 诊断）。
      // K 00:55 先补一组坐姿兜底值让循环活过来（大腿前抬、手放膝、微后仰），D-α 做 D-089 时按坐具高度调即可
      // 坐姿（D-089）：leg 只做占位（真正的腿是下面 W.sit × R.sitLeg 整体前伸、髋部按 R.sitDrop 落到凳面），手搭在腿上、身子微微后靠、抬头看风景
      sit: { leg: 0, armL: 0.55, armR: 0.5, armRRaise: 0, lean: -0.06, bob: 0.008 * Math.sin(t * 1.1), head: -0.08 + 0.03 * Math.sin(t * 0.7), flare: 0.0, staffTilt: 0.35 },
    };
    const mix = (k) => STATES.reduce((acc, s) => acc + W[s] * P[s][k], 0);
    const leg = mix('leg'), armL = mix('armL'), armR = mix('armR'), armRRaise = mix('armRRaise');
    const lean = mix('lean'), bob = mix('bob'), head = mix('head'), flare = mix('flare'), staffTilt = mix('staffTilt');
    const legTuck = W.jump * 0.55;
    let swingRaise = 0, swingSweep = 0;
    if (this.swingT >= 0) { const k = this.swingT / 0.55; swingRaise = -1.9 * Math.sin(Math.PI * Math.min(1, k * 1.15)); swingSweep = k < 0.35 ? 0 : -1.1 * Math.sin(Math.PI * (k - 0.35) / 0.65); }

    const R = this.rig;
    const sitLeg = W.sit * (R.sitLeg !== undefined ? R.sitLeg : -1.1); // 坐下：两腿一起向前伸（负 = 朝 +z 前方），Q 版脚悬空、觉醒态脚尖点地
    R.legL.rotation.x = leg + legTuck + sitLeg; R.legR.rotation.x = -leg + legTuck + sitLeg;
    R.armL.rotation.x = armL; R.armL.rotation.z = 0.12 + W.jump * 0.5;
    R.armR.rotation.x = armR + armRRaise + swingRaise; R.armR.rotation.z = -0.1 - W.jump * 0.5 + swingSweep;
    R.staff.rotation.x = -armRRaise * 0.85 + staffTilt * 0.4 - swingRaise * 0.35; R.staff.rotation.z = -0.02 + swingSweep * 0.3;
    R.torso.rotation.x = lean;
    R.hips.position.y = R.hipsY + bob * R.bobScale - W.sit * (R.sitDrop !== undefined ? R.sitDrop : 0.3); // 坐下：髋部落到凳面高度
    R.headGroup.rotation.x = head;
    // Still mode freezes the body clock; face requests must still expire and
    // reduced-motion eye channels must reach zero after the preference changes.
    R.facePerformance?.update(Number.isFinite(motion.faceDt) ? motion.faceDt : dt, this.state, this.reducedMotion);
    // 光：Q 版青光呼吸 / 觉醒态红光
    const breath = 1 + 0.18 * Math.sin(t * 2.1) + 0.06 * Math.sin(t * 5.3);
    const swingGlow = this.swingT >= 0 ? Math.sin(Math.PI * this.swingT / 0.55) : 0;
    this.staffLight.intensity = (this.form === 'chibi' ? 0.26 : this.form === 'cat' ? 0.3 : 0.075) * breath + (this.form === 'awakened' ? 0.85 : 3.0) * swingGlow; // 0.6 会把 glb 白发顶烧成一片白
    const trail = clamp(speed / PLAYER.runSpeed, 0, 1);
    if (this.form === 'chibi') {
      R.orbMat.color.set(COLORS.magicHot).multiplyScalar(0.76 + 0.10 * breath + 1.0 * swingGlow);
      R.halo.scale.setScalar(0.9 + 0.15 * Math.sin(t * 2.1) + 1.4 * swingGlow);
      if (!this.reducedMotion || speed > 0.05) this._deformCloak(R, t, flare, 1);
    } else if (this.form === 'cat') {
      // 猫形态（08 E.1 · C）：通用双足动画之上，前腿 / 尾巴 / 耳朵 / 金瞳 / 坐姿由 cat-form.js 覆盖
      animateCat(R, { W, phase: this.phase, s1, t, dt, speed: this.dragonRiderPose.active ? 0 : speed, swingT: this.swingT, breath, swingGlow, lean, head, reducedMotion: this.reducedMotion });
    } else {
      R.orbMat.color.set(0xff2a3a).multiplyScalar(0.84 + 0.10 * breath + 1.2 * swingGlow);
      R.eyeGlow.material.color.set(0xff3040).multiplyScalar(0.7 + 0.15 * breath + 0.4 * swingGlow);
      R.eyeGlow.scale.setScalar(1 + 0.3 * swingGlow);
      // 魔法披风：静止时也有一点"浮"，跑起来向后扬、抖得更厉害；符文随呼吸明灭、挥刀时暴亮
      if (!this.reducedMotion || speed > 0.05) this._deformCloak(R, t, flare + 0.12 * trail + 0.25 * swingGlow, 0.8 + 1.4 * trail + 1.5 * swingGlow);
      R.cloakMat.emissiveIntensity = 0.42 + 0.12 * Math.sin(t * 1.9) + 0.85 * swingGlow;
      R.clasp.rotation.y = t * 1.5;
      // 发丝随步微颤
      (R.hairSway || R.hair).rotation.z = 0.015 * Math.sin(t * 2.4) + 0.025 * s1 * clamp(speed / 3, 0, 1);
    }
    if (this.privateRest.active) {
      // Regenerate cloth before applying the absolute seated drape, including
      // reduced-motion mode; otherwise a previous deformation could accumulate.
      if (R.cloak) this._deformCloak(R, this.reducedMotion ? 0 : t, 0, this.reducedMotion ? 0 : .12);
      this.privateRest.apply(R, this.form, t, this.reducedMotion);
    }
    if (this.benchRest.active) {
      if (R.cloak) this._deformCloak(R, 0, 0, 0);
      this.benchRest.apply(R, this.form);
    }
    if (this.bedRest.active) {
      if (R.cloak) this._deformCloak(R, 0, 0, 0);
      this.bedRest.apply(R, this.form);
    }
    this._updateTransform(dt);
    if(this.pianoPose.active){if(R.cloak)this._deformCloak(R,0,0,0);this.pianoPose.apply(R,this.form);}
    this.root.rotation.y = this.heading;
    if(this.memorialPose.active){try{if(R.cloak)this._deformCloak(R,0,0,0);this.memorialPose.apply(R,this.form);}catch(e){this.memorialPose.abort(e);}}
    if(this.workstationPose.active){try{if(R.cloak)this._deformCloak(R,0,0,0);this.workstationPose.apply(R,this.form);}catch(e){this.workstationPose.abort(e);}}
    // A form swap may replace the active rig on this frame. Apply the rider
    // override to that final rig before its current costume bindings follow.
    if (this.dragonRiderPose.active) {
      const rideRig = this.rig;
      if (rideRig.cloak) this._deformCloak(rideRig, this.reducedMotion ? 0 : t, 0, this.reducedMotion ? 0 : .12);
      this.dragonRiderPose.apply(rideRig, this.form);
    }
    // A form swap can replace R on this frame; bind the final rig, not R.
    const finalRig=this.rig,gripEnabled=!this.bedRest.active&&!this.privateRest.active&&!this.dragonRiderPose.active&&finalRig.staff.parent===finalRig.armR;
    finalRig.gripFollower?.update(finalRig.staff.quaternion,gripEnabled);
    // Rotate the gripped prop around the same wrist as the fingers. Private
    // rest owns its reparented prop placement and must never be overwritten.
    if(gripEnabled&&finalRig.staffGripHome)finalRig.staff.position.copy(finalRig.staffGripHome).add(finalRig.gripFollower.offset);
    // Follow the final pose, including private-rest overrides and a form swap.
    this.rig.neckBinding?.update();
    this.rig.armL?.sleeveBinding?.update();
    this.rig.armR?.sleeveBinding?.update();
    this.rig.trousersBinding?.update();
    if(this.pianoPose.active)this.pianoPose.finishCloth();
    if(this.memorialPose.active)this.memorialPose.finishCloth();
    if(this.workstationPose.active){try{this.workstationPose.finishCloth();}catch(e){this.workstationPose.abort(e);}}
  }
}

// ---------- GPT-6 G3-001 头模（assets/head-chibi.glb / head-awakened.glb）：到位就替换程序头 / 发，缺资产或加载失败保留程序头 ----------
// 契约（v3 任务包 02 §三 / claims/G3-001.md）：根节点单位变换、原点在颅骨球心、+Z 正前、单位米；HeadAsset > Head / Hair / EyeL / EyeR，
// EyeL / EyeR 是空节点（人物左眼在 +X）。材质是 PBR + 内嵌 2048² 贴图 → 这里转 toon + 描边壳，贴图缩到 1024（P：两张 2048 常驻 44 MB 显存）。
function downscaleTexture(tex, size) {
  const img = tex && tex.image;
  if (!img || !(img.width > size)) return;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  tex.image = c; tex.needsUpdate = true; // flipY 保持 glTF 的 false，画布按原方向画进去即可
  if (typeof img.close === 'function') img.close();
}
// 设定稿：左眼红瞳黑巩膜、右眼灰蓝瞳白巩膜；glb 脸贴图两只都画成了红瞳 → 觉醒态在缩到 1024 的画布上把右眼虹膜改成灰蓝（Q 版保持双红）。
// 五官全在贴图里、EyeR 是空节点：取 Head 网格里离 EyeR 最近的 6 个顶点的 uv 均值当虹膜中心（glTF uv 原点左上、flipY=false → py = v·H，
// 实测落在 (0.730, 0.439)·1024 ≈ (747, 449)，虹膜圆心 (746, 452)、半径 ≈ 0.043·W）。处理半径 0.06·W：盖住整个虹膜，离左眼（间距 0.46·W）很远。
// 圈内不做硬分类，按「红溢出量」ex = r − max(g, b) 换色：溢出的红重分配成灰蓝（主色 (192,16,32) → (122,154,192) ≈ #7a9ac0，暗环 (80,0,0) → 暗青灰），
// 白高光 / 黑瞳线 ex=0 原样保留，抗锯齿边缘按 ex 渐变；肤色 (255,224,208) 偏橙（g > b）用 b ≥ g−4 的色相门挡掉，眼下若有淡红血痕也过不了这道门。
function recolorRightIris(head, eyeR) {
  const tex = head && head.material && head.material.map, g = head && head.geometry;
  if (!eyeR || !tex || !tex.image || !g || !g.attributes.position || !g.attributes.uv) return;
  let c = tex.image;
  if (typeof c.getContext !== 'function') { const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; k.getContext('2d').drawImage(c, 0, 0); tex.image = c = k; }
  head.updateWorldMatrix(true, false); eyeR.updateWorldMatrix(true, false);
  const p = head.worldToLocal(eyeR.getWorldPosition(new THREE.Vector3()));
  const pos = g.attributes.position, uv = g.attributes.uv, near = [];
  for (let i = 0; i < pos.count; i++) {
    const d2 = (pos.getX(i) - p.x) ** 2 + (pos.getY(i) - p.y) ** 2 + (pos.getZ(i) - p.z) ** 2;
    if (near.length < 6 || d2 < near[near.length - 1][0]) { near.push([d2, i]); near.sort((a, b) => a[0] - b[0]); if (near.length > 6) near.pop(); }
  }
  let u = 0, v = 0; for (const [, i] of near) { u += uv.getX(i); v += uv.getY(i); } u /= near.length; v /= near.length;
  const W = c.width, H = c.height, r = Math.round(0.06 * W), cx = Math.round(u * W), cy = Math.round(v * H);
  const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r), x1 = Math.min(W, cx + r + 1), y1 = Math.min(H, cy + r + 1);
  const ctx = c.getContext('2d'), img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = img.data, r2 = r * r;
  // 守门（GPT v3 头右眼灰蓝已画进贴图）：圈内「明显红」的像素不到 60 个就说明虹膜本来不是红的，什么都别动——再跑会把眼周暖色误改
  let reds = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
    const k = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
    if (d[k] - Math.max(d[k + 1], d[k + 2]) > 40 && d[k + 2] >= d[k + 1] - 4) reds++;
  }
  if (reds < 60) return;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
    const k = ((y - y0) * (x1 - x0) + (x - x0)) * 4, R0 = d[k], G0 = d[k + 1], B0 = d[k + 2], m = Math.max(G0, B0), ex = R0 - m;
    if (ex <= 4 || B0 < G0 - 4) continue;
    const w = clamp((ex - 4) / 20, 0, 1); // 4 → 24 渐入：高光边上 90% 白的像素也跟着去红，纯红全换；肤色与白 / 黑的混合像素 g > b 早被色相门挡掉
    d[k] = R0 + w * (m + 0.56 * ex - R0); d[k + 1] = G0 + w * 0.86 * ex; d[k + 2] = Math.min(255, B0 + w * ex);
  }
  ctx.putImageData(img, x0, y0); tex.needsUpdate = true;
}
function mountGlbHead(R, gltf, form) {
  const root = gltf.scene;
  const rebuiltHead = isRebuiltHead(root);
  let bakedAnimeFace = rebuiltHead;
  root.traverse((o) => { if (o.userData && o.userData.k3FaceStyle === 'anime-cute-v1') bakedAnimeFace = true; });
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); }); // 先收集：outline() 会往 mesh 下挂壳，边遍历边挂会无限递归
  let headMesh = null;
  if (rebuiltHead) {
    const surfaces = prepareRebuiltHead(root);
    headMesh = surfaces.head;
    dressPosteriorHair(surfaces.hair, form);
    R.hairSway = surfaces.hair; // Only the explicit hair role moves; eyes, eyebrows and lips stay on the face.
  }
  for (const o of rebuiltHead ? [] : meshes) {
    const old = o.material, map = old.map || null;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; downscaleTexture(map, 1024); }
    const isHead = /head/i.test(o.name);
    // 脸的柔和四阶仅作用 Head；白发无贴图时保留原蓝灰分层，不再强制漂成纯白。
    const baseColor = map ? new THREE.Color(0xffffff) : (old.color ? old.color.clone() : new THREE.Color(0xe6e8f0));
    o.material = new THREE.MeshToonMaterial({ color: baseColor, map, side: old.side, gradientMap: isHead ? faceGradientMap() : gradientMap(), emissive: map ? new THREE.Color(0xffffff) : baseColor.clone(), emissiveMap: map, emissiveIntensity: isHead ? 0.16 : 0.045 });
    o.castShadow = true;
    if (isHead || !bakedAnimeFace) outline(o, isHead ? 1.012 : (form === 'awakened' ? 1.0015 : 1.004), isHead ? FACE_OUTLINE_MAT : HAIR_OUTLINE_MAT); // 新细发不叠近共面壳，避免全身视距下黑色虚线。
    if (old && old.dispose) old.dispose();
    if (isHead) headMesh = headMesh || o; else R.hairSway = o;
  }
  if (form === 'awakened' && !bakedAnimeFace) { try { recolorRightIris(headMesh, root.getObjectByName('EyeR')); } catch (e) { console.warn('右眼虹膜换色失败，保留贴图原色', e); } }
  root.position.y = R.headY;
  if (rebuiltHead) {
    // The former long pointed chin used a higher mount. Seat the new rounded jaw
    // against the existing collar without changing the rig/controller origins.
    root.position.y += form === 'awakened' ? -0.022 : 0.006;
    if (R.neckMesh) R.neckMesh.visible = false; // The authored neck now supplies the one continuous connection.
  }
  R.headGroup.add(root);
  if (R.headMesh) R.headMesh.visible = false;
  if (R.hair) R.hair.visible = false;
  const eyeL = root.getObjectByName('EyeL');
  if (R.eyeGlow && eyeL) { R.eyeGlow.removeFromParent(); eyeL.add(R.eyeGlow); R.eyeGlow.position.set(0, 0, 0.006); }
  if (R.eyeGlow && bakedAnimeFace) R.eyeGlow.visible = false; // 新版虹膜已烘焙高光；保留对象供动作更新，隐藏旧实心红球。
  R.glbHead = root;
  R.neckBinding = createNeckCollarBinding(headMesh, R.torso);
  R.facePerformance = createFacePerformance(root);
}
async function attachHeads(w) {
  const jobs = [];
  // 候选头直看（M 01:05 建议）：http 开发路下 ?head=<url> / ?head-chibi=<url> 直接从任意 URL 载入候选 glb 换到对应形态，不用把候选临时塞进 assets/（别人同时重打会把候选烤进包）
  let override = {};

  for (const [form, file] of [['chibi', 'head-chibi.glb'], ['awakened', 'head-awakened.glb']]) {
    if (override[form]) { jobs.push(new GLTFLoader().loadAsync(override[form]).then((gltf) => mountGlbHead(w.rigs[form], gltf, form)).catch((e) => console.warn(`?head 候选 ${override[form]} 加载失败`, e))); continue; }
    if (!hasAsset(file)) continue;
    jobs.push(loadGLB(file).then((gltf) => mountGlbHead(w.rigs[form], gltf, form)).catch((e) => console.warn(`${file} 加载失败，保留程序头`, e)));
  }
  if (w.rigs.cat) jobs.push(attachCatHead(w.rigs.cat)); // R-001 猫头（assets/cat-head.glb）：有就换，没有静默
  await Promise.all(jobs);
}

/** 工厂：与 main.js 的 `await createWanderer(opts)` 接口一致；glb 头在这里等到位（在预编译之前，新材质一起编） */
export async function createWanderer(opts = {}) {
  const w = new Wanderer(opts);
  await attachHeads(w);
  await attachContinuousTrousers(w.rigs.awakened);
  return w;
}
