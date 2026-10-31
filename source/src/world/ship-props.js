// 船饰小件（M-001 / H-1 船精修剩余硬件 · 2026-09-08 · M 窗口）：纯附加，不动 ship.js 的坐标常量与 collision。
//   kit 来自 Blender 后台脚本 tools/blender/ship-props.py → assets/ship-props.glb（12 个零贴图网格，116 KB，内嵌主包）。
//   这里只做「摆位 + 合批 + 复用材质」：
//     · 鎏金立柱头 Finial：舷墙每根方柱顶（与 ship.js _buildBulwarks 同一组 z）+ 船尾楼前栏 / 楼梯井栏每根小柱顶 ≈ 83 颗；
//     · 立柱脚 Collar：舷墙方柱脚（楼梯井段不放，那几根柱本来就悬在楼梯上方）；
//     · 船尾横板雕饰 SternOrnament + 两角涡卷：贴 z = sternZ 外侧 2 cm，家徽 / 拱窗一个不挪；
//     · 船首鸮 BowOwl：立在船首斜桁上、印记正下方，面朝船头；书页四角鎏金护角 + 书脊端帽（BoxGeometry，挂进 ship.bowBook 局部系）；
//     · 甲板家具：木桶 / 木箱 / 麻绳盘，只放舷墙内侧一条带，无碰撞（同 W-001 道具已知项）。
//   材质全部复用 ship.mat.goldGlow / dark / iron，加 1 个无贴图 Standard（麻绳色，与 trim / goldGlow 同一 shader 变体）→ 0 新程序、0 新贴图、0 灯；
//   四个批次各 1 个网格 = 4 次 draw call；不用 InstancedMesh（USE_INSTANCING 会是新变体）。缺资产 / 解析失败只是少这些装饰，不报错。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP } from '../config.js';
import { hullHalfWidth, bulwarkTop, CABIN_HALF, STAIR_END_Z } from './ship.js';
import { loadGLB, hasAsset } from '../util/assets.js';

const ASSET = 'ship-props.glb';
const P = SHIP.poop;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

/** kit 几何摆到船局部坐标：底面中心落在 (x, y, z)，绕 Y 转 ry，整体缩放 s */
function place(geo, x, y, z, ry = 0, s = 1) {
  _q.setFromAxisAngle(_Y, ry); _v.set(x, y, z); _s.set(s, s, s);
  return geo.clone().applyMatrix4(_m.compose(_v, _q, _s));
}
/** 合批前统一属性：无贴图材质删 uv（kit 里金 / 铁件本来没有），确保有 normal */
function norm(geo, keepUV) {
  if (!keepUV && geo.attributes.uv) geo.deleteAttribute('uv');
  if (geo.attributes.uv2) geo.deleteAttribute('uv2');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

/**
 * @param ship  world/ship.js 的 Ship 实例（用 ship.group / ship.mat / ship.bowBook）
 * @returns {Promise<{group, meshes, stats}|null>}
 */
export async function buildShipProps(ship) {
  if (!hasAsset(ASSET)) return null;
  let gltf;
  try { gltf = await loadGLB(ASSET); } catch (e) { console.warn('ship-props.glb 加载失败，船饰小件跳过', e); return null; }
  gltf.scene.updateMatrixWorld(true);
  const kit = {};
  gltf.scene.traverse((o) => { if (o.isMesh) kit[o.name] = o.geometry.clone().applyMatrix4(o.matrixWorld); });
  const need = ['Finial', 'Collar', 'SternOrnament', 'SternVoluteL', 'SternVoluteR', 'BowOwl', 'BowOwlEyes', 'Barrel', 'BarrelHoops', 'RopeCoil', 'Crate', 'CrateStraps'];
  const missing = need.filter((n) => !kit[n]);
  if (missing.length) { console.warn('ship-props.glb 缺件，船饰小件跳过：', missing.join(' ')); return null; }

  const gold = [], wood = [], iron = [], rope = [];
  const stats = { finials: 0, collars: 0, barrels: 0, crates: 0, coils: 0 };

  // ---------- ① 舷墙立柱：柱头 + 柱脚（与 ship.js _buildBulwarks 的立柱循环同一组位置） ----------
  {
    const zMin = SHIP.bowZ + 0.6, zMax = SHIP.sternZ - 0.2;
    for (const side of [-1, 1]) for (let z = zMin + 1; z < zMax; z += 2) {
      gold.push(place(kit.Finial, side * (hullHalfWidth(z) - 0.32), bulwarkTop(z) + 0.04, z)); stats.finials++;
      // 柱脚座 kit.Collar 首轮截图核过后不放：方柱在舷墙阴影里是黑的，金脚座看着像一排掉在甲板上的金块。
      // 想开：const base = z >= P.wallZ ? P.height : 0; gold.push(place(kit.Collar, x, base, z))（楼梯井段 P.wallZ..STAIR_END_Z 跳过）
    }
  }
  // ---------- ② 船尾楼前栏 + 楼梯井内侧栏的小柱顶（ship.js rail()：len/0.9 根，横杆顶面在 H + 1.09） ----------
  {
    const y = P.height + 1.09, z0 = P.wallZ + 0.05;
    const nF = Math.max(2, Math.round((CABIN_HALF * 2) / 0.9));
    for (let i = 0; i <= nF; i++) { gold.push(place(kit.Finial, -CABIN_HALF + (CABIN_HALF * 2 * i) / nF, y, z0, 0, 0.7)); stats.finials++; }
    const lenS = STAIR_END_Z - z0, nS = Math.max(2, Math.round(lenS / 0.9));
    for (const side of [-1, 1]) for (let i = 1; i <= nS; i++) { gold.push(place(kit.Finial, side * CABIN_HALF, y, z0 + (lenS * i) / nS, 0, 0.7)); stats.finials++; } // i=0 与前栏端柱重合
  }
  // ---------- ③ 船尾横板雕饰（kit 里已是船局部 x / y，浮雕朝 +z；贴横板外侧 2 cm） ----------
  for (const n of ['SternOrnament', 'SternVoluteL', 'SternVoluteR']) gold.push(place(kit[n], 0, 0, SHIP.sternZ + 0.02));
  // 横板内衬：ship.js 的横板是朝 +z 的单面 ShapeGeometry，站在船尾楼甲板往后看它被背面剔除，星空 / 雕饰 / 拱窗框会从「墙」里漏进来（M 截图核出）。
  // 补一片朝 −z 的木板盖住甲板以上那段（y 3.0 → 舷墙顶），并进木件批次；uv 按 2.4 m 一格与甲板同尺度
  {
    const top = bulwarkTop(SHIP.sternZ), y0 = P.height - 0.05, w = 2 * (hullHalfWidth(SHIP.sternZ) - 0.02);
    const g = new THREE.PlaneGeometry(w, top - y0, 4, 1);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2.4, pos.getY(i) / 2.4);
    g.rotateY(Math.PI).translate(0, (y0 + top) / 2, SHIP.sternZ - 0.005);
    wood.push(g);
  }
  // ---------- ④ 船首鸮：立在斜桁上、印记 (0, 3.4, −30.4) 正下方 ----------
  {
    // ship.js _buildBow 的斜桁：中心 (0, 2.4, bowZ−2.6)，rotation.x = −π/2 + 0.28，CylinderGeometry(0.1, 0.16, 7)：轴向 (0, cos a, sin a)
    const a = -Math.PI / 2 + 0.28, dy = Math.cos(a), dz = Math.sin(a), cz = SHIP.bowZ - 2.6;
    const z = SHIP.bowZ - 1.0;
    const t = (z - cz) / dz;                         // 沿轴参数（米，从中心算）
    const axisY = 2.4 + t * dy, r = 0.13 - 0.03 * (t / 3.5); // 半径 0.16（根）→ 0.10（尖）
    const s = 0.85;
    gold.push(place(kit.BowOwl, 0, axisY + r - 0.012, z, 0, s));
    gold.push(place(kit.BowOwlEyes, 0, axisY + r - 0.012, z, 0, s));
  }
  // ---------- ⑤ 船首书：四角鎏金护角 + 书脊两端帽（挂进 ship.bowBook 的局部系：页 BoxGeometry(1.1, 0.08, 1.5) 在 (±0.55, 0, 0) 转 z ±0.35） ----------
  if (ship.bowBook && !ship.bowBook.userData.ownsBinding) {
    ship.bowBook.updateMatrix();
    const bookM = ship.bowBook.matrix;
    for (const sd of [-1, 1]) {
      const pageM = new THREE.Matrix4().compose(new THREE.Vector3(sd * 0.55, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sd * 0.35), new THREE.Vector3(1, 1, 1));
      for (const zc of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.16, 0.1, 0.16).translate(sd * (0.55 - 0.07), 0, zc * (0.75 - 0.07));
        gold.push(g.applyMatrix4(pageM).applyMatrix4(bookM));
      }
    }
    for (const zc of [-1, 1]) gold.push(new THREE.BoxGeometry(0.2, 0.24, 0.06).translate(0, 0, zc * 0.79).applyMatrix4(bookM));
  }
  // ---------- ⑥ 甲板家具：只放舷墙内侧一条带（避开 8 盏灯笼 / spawn (2.2,−6) / 望远镜台 r 2.6 / 三门 / 舱口 / 法阵 (1.8, 6.5) / 楼梯井） ----------
  {
    const furniture = [
      // 主甲板（y 0）：左舷两只并排的桶、一只木箱、一盘绳；右舷一盘绳、桶 + 箱
      ['Barrel', -6.05, 0, -11.55, 0.4], ['Barrel', -6.02, 0, -10.85, 2.1],
      ['Crate', -6.0, 0, -2.6, 0.15], ['RopeCoil', -5.95, 0, 8.6, 1.2],
      ['RopeCoil', 6.0, 0, -11.3, -0.6], ['Barrel', 6.05, 0, 1.3, 1.0], ['Crate', 5.95, 0, 2.15, -0.2],
      // 船头甲板（船体收窄，x ±5.4）
      ['RopeCoil', -5.45, 0, -21.2, 2.4], ['Barrel', 5.4, 0, -22.4, 0.7],
      // 船尾楼甲板（y 3，x ±5.1）：舵轮 (0, 22) 两侧各一件，尾栏前一盘绳
      ['Crate', -5.1, P.height, 24.6, 0.3], ['Barrel', 5.1, P.height, 24.3, 1.9], ['RopeCoil', -1.6, P.height, 27.4, 0.5],
    ];
    for (const [kind, x, y, z, ry] of furniture) {
      if (kind === 'Barrel') { wood.push(place(kit.Barrel, x, y, z, ry)); iron.push(place(kit.BarrelHoops, x, y, z, ry)); stats.barrels++; }
      else if (kind === 'Crate') { wood.push(place(kit.Crate, x, y, z, ry)); iron.push(place(kit.CrateStraps, x, y, z, ry)); stats.crates++; }
      else { rope.push(place(kit.RopeCoil, x, y, z, ry)); stats.coils++; }
    }
  }

  // ---------- 合批（每批 1 个网格；木件保留 uv 给 dark 的木纹贴图，其余删 uv） ----------
  const g = new THREE.Group(); g.name = 'ship-props';
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8b7352, roughness: 0.95, metalness: 0.0 }); // 无贴图 → 与 trim 同一程序
  const batch = (list, mat, name, { keepUV = false, shadow = true } = {}) => {
    if (!list.length) return null;
    const geo = mergeGeometries(list.map((x) => norm(x, keepUV)), false);
    if (!geo) { console.warn('ship-props 合批失败：', name); return null; }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat); mesh.name = name;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    if (!shadow) mesh.userData.noShadow = true;
    g.add(mesh);
    return mesh;
  };
  // 金件用 goldGlow（自发光 0.35，Bloom 阈值 0.85 之下）：船首 / 船尾 / 栏杆都在 9 盏灯照不到的地方，纯 trim 在夜航里是黑的（M 首轮截图核过）
  // 只有木件（桶 / 箱落在甲板上）投影；金件在栏杆顶 / 船外，铁箍 / 绳盘太小——阴影通道会把 castShadow 网格再画一遍（calls / 三角翻倍），
  // 出生点 A/B：全部投影 +8 calls / +37k 三角（124.8k 超 120k 预算），只木件投影 +5 calls / +20k
  const meshes = {
    gold: batch(gold, ship.mat.goldGlow, 'props-gold', { shadow: false }),
    wood: batch(wood, ship.mat.dark, 'props-wood', { keepUV: true }),
    iron: batch(iron, ship.mat.iron, 'props-iron', { shadow: false }),
    rope: batch(rope, ropeMat, 'props-rope', { shadow: false }),
  };
  ship.group.add(g);
  let tris = 0; g.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  stats.triangles = Math.round(tris); stats.calls = Object.values(meshes).filter(Boolean).length;
  return { group: g, meshes, stats };
}
