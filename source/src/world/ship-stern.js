// 船尾家徽（H-1 收尾 · 2026-09-08 D-α）：assets/ship-crest.svg（GPT-6 v3 G3-003 交付，原创，931 B：双圈 + 翻开的书 + 三颗四角星）
// → SVGLoader 描边 → SigilFactory 金色网格，贴在船尾横板（transom，z = SHIP.sternZ）外侧，居中在两扇船尾拱窗之间；后面垫一片很淡的暗金柔光圆盘。
// 缺资产 / 解析失败都只是少这一块装饰，不报错。三角 ≈ 1.1k，2 个 draw call（描边 + 底衬）。
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { SigilFactory } from './sigil.js';
import { getAsset, hasAsset } from '../util/assets.js';
import { softDot } from './textures.js';
import { COLORS } from '../config.js';

const CREST_SIZE = 300;   // viewBox
const CREST_OUTER_R = 113; // 外圈半径（圆心 (150,145)，比 viewBox 中心高 5 单位）
const CREST_CY_OFFSET = 5;

/**
 * @param parent  挂到 ship.group
 * @param opts    { z: 横板 z, yCenter: 家徽中心高度（船局部）, diameter }
 * @returns {Promise<{group, inst}|null>}
 */
export async function buildSternCrest(parent, { z, yCenter = 2.0, diameter = 2.3 } = {}) {
  if (!hasAsset('ship-crest.svg')) return null;
  const text = await getAsset('ship-crest.svg', 'text');
  const paths = new SVGLoader().parse(text).paths;
  if (!paths.length) return null;
  const factory = new SigilFactory(paths, { size: CREST_SIZE, outerR: CREST_OUTER_R, strokeMax: 3.2 });
  const inst = factory.make({ diameter, color: COLORS.gold, dotColor: COLORS.gold, opacity: 0.9, glow: 0.8, strokeMul: 1.7 });
  const g = new THREE.Group();
  g.name = 'stern-crest';
  g.position.set(0, yCenter, z + 0.04);
  // 工厂以 viewBox 中心 (150,150) 为原点、y 翻转；圆心在 (150,145) → 图形整体高出 5 单位，平移回来让双圈正好居中
  inst.group.position.y = -(CREST_CY_OFFSET / (CREST_OUTER_R * 2)) * diameter;
  g.add(inst.group);
  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(diameter * 1.4, diameter * 1.4),
    new THREE.MeshBasicMaterial({ map: softDot(), color: COLORS.goldDeep, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  disc.position.z = -0.015;
  g.add(disc);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.noShadow = true; } });
  parent.add(g);
  return { group: g, inst };
}
