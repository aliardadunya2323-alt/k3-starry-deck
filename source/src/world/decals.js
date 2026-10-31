// SVG 装饰（H-3 · 窗口 B · 2026-09-07）：让整船「有纹样」，全部纯附加、失败即跳过，不改船 / 门 / 碰撞的任何数字。
//   ① 门徽：三扇门各自的层徽（S 窗口 door-sources / models / actions.svg，与纯净流同源）替换门板上那枚通用六角星——
//      外环（刻度 / 六点）仍随门态旋转，中央图形（书卷 / 星图仪 / 罗盘）保持正立。接法：loadDecals().emblems 进 Door 的 deps.emblems（door.js D-074 钩子）。
//   ② 舱墙雕花板 ×2：三扇门之间的两段空墙各嵌一块暗金花框（ornaments/frame.svg）+ 淡印记浮雕。
//   ③ 主桅脚甲板法阵镶嵌：直径 7 m 的印记平铺在甲板上（低亮度，像嵌进木板的黄铜线）。
//   ④ 望远镜台底纹：台面金环内一枚小印记。
//   ⑤ 假光 decal（08 §六 A.3 · F.2）：8 盏舷墙灯笼脚下暖色光池 + 舷墙内侧竖光晕、三扇门门槛光斑、舱口罩房脚下与升降法阵一圈微光——加法 softDot，0 灯 0 新程序。
//   ⑥ 墙上爱心（08 主人 09-09 口信 · B）：assets/heart.svg → loadDecals().heart，给秘密基地明信片站贴墙。
//      W / H：`decals.heart.make({ diameter: 0.55, color: 0xB4485A, dotColor: 0xFFF8E8, opacity: 0.95, glow: 0.85, strokeMul: 1.05 })`，spinSpeed = 0。
// 资产：assets/door-*.svg、assets/frame.svg、assets/heart.svg（只用 path，无 text / 滤镜 / 位图；登记见 资产清单.md）。
// 预算：四张 SVG 共 5.8 KB；甲板视角三角增量约 +6k、draw call +8（每块装饰 1–2 个网格）。
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { COLORS, SHIP } from '../config.js';
import { SigilFactory } from './sigil.js';
import { emblemFactoryOptions } from './emblem-options.js';
import { softDot } from './textures.js';
import { DOOR_XS } from './ship.js';
import { getAsset, hasAsset } from '../util/assets.js';

const EMBLEMS = { sources: 'door-sources.svg', models: 'door-models.svg', actions: 'door-actions.svg' };
// 门徽 viewBox 200：外圈 r=93；离中心 ≥ 74 的子路径（两道外环 + 12 刻度 + 6 圆点）算外环，其余是正立的中央图形。
// door.js 走 deps.emblems 时传的是六角星的参数（直径 0.92 / 描边 4.2），这里换算成门徽自己的档（1.08 / 2.8）并翻正（mirror）
const EMBLEM_OPTS = { size: 200, outerR: 93, splitRadius: 74, strokeMax: 5.8, diameterScale: 1.08 / 0.92, strokeMulScale: 2.8 / 4.2, mirror: true };
// 花框 viewBox 300，方框外沿 8..292：diameter 就按整幅 300 单位算（outerR = 150）
const FRAME_OPTS = { size: 300, outerR: 150, strokeMax: 2.4 };
// 爱心 viewBox 200：外接圆 r≈88（尖 → 叶顶），不拆外环（整枚正立贴墙）
const HEART_OPTS = { size: 200, outerR: 88, strokeMax: 8 };

async function factory(name, opts) {
  if (!hasAsset(name)) return null;
  let text = await getAsset(name, 'text');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // SVGLoader 只认 <use xlink:href>（SVG 1.1 写法）；S 的 frame.svg 是 SVG 2 的 <use href>，这里补上命名空间再喂给它
  if (/<use\b[^>]*\shref=/.test(text)) {
    text = text.replace(/(<use\b[^>]*?)\shref=/g, '$1 xlink:href=');
    if (!/xmlns:xlink=/.test(text)) text = text.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  const parsed = new SVGLoader().parse(text);
  const resolved = opts === EMBLEM_OPTS ? emblemFactoryOptions(parsed.xml, opts) : opts;
  return parsed.paths.length ? new SigilFactory(parsed.paths, resolved) : null;
}

/** 读全部装饰 SVG；缺哪张就少哪块装饰，不抛错 */
export async function loadDecals() {
  const emblems = {};
  for (const [id, file] of Object.entries(EMBLEMS)) {
    try { emblems[id] = await factory(file, EMBLEM_OPTS); } catch (e) { console.warn('门徽读取失败', file, e); emblems[id] = null; }
  }
  // H-5（B）：船内三层 22 间舱房各自的门徽 assets/emblem-<roomId>.svg（同一套外环 + 各馆中央图形；D 的 Level 把 deps.emblems 传给每扇房门）。
  // 房间 id 只从 D 的注册表读，不在这里另抄一份；GPT-6 v3 若交同名文件直接覆盖
  let frame = null;
  try { frame = await factory('frame.svg', FRAME_OPTS); } catch (e) { console.warn('花框读取失败', e); }
  let heart = null;
  try { heart = await factory('heart.svg', HEART_OPTS); } catch (e) { console.warn('爱心读取失败', e); }
  return { emblems, frame, heart };
}

/** 只读墙上爱心（W-009）：秘密基地 prebuild 用，不重扫 22 个舱房门徽 */
export async function loadHeartFactory() {
  try { return await factory('heart.svg', HEART_OPTS); } catch (e) { console.warn('爱心读取失败', e); return null; }
}

/* 门徽接入：main.js 把 loadDecals().emblems 放进 Door 的 deps.emblems，door.js（D-074 起）自己用它 make()；
   以前这里的 dressDoors()（建完门再换 door.sigil 实例）已删。 */

/** 舱墙雕花板 / 甲板法阵 / 望远镜台底纹：返回一个 Group（调用方 add 进 ship.group） */
export function buildShipDecals(sigilFactory, decals) {
  const g = new THREE.Group(); g.name = 'decals';
  const wallFace = SHIP.poop.wallZ - 0.012;   // 舱墙正面（z=wallZ）再往外 12 mm，避免与墙面 z-fight
  // ② 门之间两段空墙的中心：门在 x=±4.2 / 0，门洞含框 ±0.92 → 空墙 x ∈ [0.92, 3.28]，中心 ±2.1，宽 2.36
  for (const x of [-2.1, 2.1]) {
    if (decals.frame) {
      const f = decals.frame.make({ diameter: 1.9, color: COLORS.gold, dotColor: COLORS.bright, opacity: 0.8, glow: 0.55 });
      f.group.position.set(x, 1.5, wallFace); f.group.rotation.y = Math.PI;
      g.add(f.group);
    }
    // 板心的印记比门徽暗一档：墙是背景，门才是主角
    const s = sigilFactory.make({ diameter: 1.0, color: COLORS.gold, dotColor: COLORS.magic, opacity: 0.6, glow: 0.35, strokeMul: 2.8 });
    s.group.position.set(x, 1.5, wallFace); s.group.rotation.y = Math.PI;
    g.add(s.group);
  }
  // ③ 主桅脚的甲板法阵：主桅在 z=0，甲板 y=0；平铺（+z 法线转到 +y），低亮度
  {
    const m = SHIP.masts[1] || SHIP.masts[0];
    const s = sigilFactory.make({ diameter: 7, color: COLORS.gold, dotColor: COLORS.magic, opacity: 0.55, glow: 0.42, strokeMul: 1.4 });
    s.group.position.set(0, 0.012, m.z); s.group.rotation.x = -Math.PI / 2;
    g.add(s.group);
  }
  // ④ 望远镜台：台面 y=0.25、金环半径 1.1 → 环内一枚直径 2.0 的小印记
  {
    const T = SHIP.telescope;
    const s = sigilFactory.make({ diameter: 2.0, color: COLORS.gold, dotColor: COLORS.magic, opacity: 0.6, glow: 0.5, strokeMul: 2.2 });
    s.group.position.set(T.x, 0.257, T.z); s.group.rotation.x = -Math.PI / 2;
    g.add(s.group);
  }
  // ④ 假光（08 §六 A.3 · F.2 不用等建模的那半 · B 20:35）：灯池只有 9 盏真灯轮着点，远处的灯笼脚下是黑的；
  //    给 8 盏舷墙灯笼脚下各烘一片暖色光池、三扇门门槛前一片门缝光斑——加法软圆面片（softDot 同款材质，0 灯 0 新程序），远看整条船「灯都亮着」
  {
    const dot = softDot(128);
    const poolMat = new THREE.MeshBasicMaterial({ map: dot, color: COLORS.lantern || 0xffb35c, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, toneMapped: true });
    const wallMat = new THREE.MeshBasicMaterial({ map: dot, color: COLORS.lantern || 0xffb35c, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, toneMapped: true, side: THREE.DoubleSide });
    const doorMat = new THREE.MeshBasicMaterial({ map: dot, color: COLORS.gold, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, toneMapped: true });
    const P = SHIP.poop;
    for (const L of SHIP.lanterns) {
      const onPoop = L.z >= P.wallZ;
      const deckY = onPoop ? P.height : 0;
      const inward = Math.sign(L.x) * -1;                                    // 灯在舷墙上，光池往船心挪
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.2), poolMat);
      pool.rotation.x = -Math.PI / 2; pool.position.set(L.x + inward * 1.3, deckY + 0.008, L.z); pool.name = 'fake-light-pool';
      g.add(pool);
      // 舷墙内侧一片竖着的光晕（灯挂在墙上，墙面最亮）
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.2), wallMat);
      wash.position.set(L.x + inward * 0.22, deckY + 1.0, L.z); wash.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2; wash.name = 'fake-light-wash';
      g.add(wash);
    }
    for (const x of DOOR_XS) {
      const spill = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.0), doorMat);
      spill.rotation.x = -Math.PI / 2; spill.position.set(x, 0.009, P.wallZ - 1.05); spill.name = 'fake-light-door';
      g.add(spill);
    }
    // 舱口罩房脚下 + 升降法阵一圈微光（数字与 level-system HATCH / worldgate 甲板法阵同位，这里不 import 那两个文件以免环）
    const hatchPool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.0), poolMat);
    hatchPool.rotation.x = -Math.PI / 2; hatchPool.position.set(-3.4, 0.007, 6.5); hatchPool.name = 'fake-light-hatch';
    g.add(hatchPool);
    const gatePool = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), doorMat);
    gatePool.rotation.x = -Math.PI / 2; gatePool.position.set(1.8, 0.007, 6.5); gatePool.name = 'fake-light-gate';
    g.add(gatePool);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.noShadow = true; } });
  return g;
}
