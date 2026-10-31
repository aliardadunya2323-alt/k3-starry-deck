// 甲板近景细节：不改可走面、门洞或碰撞。罗盘以多视图为参考做真实低浮雕。
// R8 样板预算 <= 3600 三角、4 个网格、2 新材质、0 新贴图 / 灯。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP, DOOR } from '../config.js';
import { createDeckCompassParts, DECK_COMPASS } from './ship-compass.js';

// 木纹周期 2.4m，与船身甲板同一量级。dark 贴图 v 为板长、u 横向排 6 块板。
// 只改木盒 uv：竖柱（柱脚 / 柱身 / 柱头）v 沿局部 y，横楣 v 沿局部 x。
// 端面投影截面两条边，不把整张贴图或构件长轴铺进窄面。法线与颜色共用这一套 uv。
const WOOD_UV_PERIOD = 2.4;

function projectWoodBoxUV(geo, grain) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const alongY = grain === 'y';
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (alongY) {
      if (ay > ax && ay > az) {
        u = x / WOOD_UV_PERIOD;
        v = z / WOOD_UV_PERIOD;
      } else if (ax > ay && ax > az) {
        u = z / WOOD_UV_PERIOD;
        v = y / WOOD_UV_PERIOD;
      } else {
        u = x / WOOD_UV_PERIOD;
        v = y / WOOD_UV_PERIOD;
      }
    } else if (ax > ay && ax > az) {
      u = z / WOOD_UV_PERIOD;
      v = y / WOOD_UV_PERIOD;
    } else if (ay > ax && ay > az) {
      u = z / WOOD_UV_PERIOD;
      v = x / WOOD_UV_PERIOD;
    } else {
      u = y / WOOD_UV_PERIOD;
      v = x / WOOD_UV_PERIOD;
    }
    // Center the narrow trim inside one plank; avoid a seam through its center.
    uv.setXY(i, u + 1 / 12, v);
  }
}

export function buildShipFinish(ship) {
  const group = new THREE.Group(); group.name = 'ship-finish';
  const wood = [], brass = [];
  const box = (list, w, h, d, x, y, z, grain) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (list === wood) projectWoodBoxUV(geo, grain);
    geo.translate(x, y, z); list.push(geo);
  };
  const front = SHIP.poop.wallZ;
  // 门洞外缘的柱脚、柱身和细金线；门铰链 / 门扇的活动空间不变。
  for (const x of [-4.2, 0, 4.2]) {
    for (const side of [-1, 1]) {
      const px = x + side * (DOOR.width / 2 + 0.18);
      box(wood, 0.14, 2.52, 0.13, px, 1.38, front - 0.045, 'y');
      box(wood, 0.21, 0.18, 0.18, px, 0.09, front - 0.07, 'y');
      box(wood, 0.21, 0.10, 0.18, px, 2.64, front - 0.07, 'y');
      box(brass, 0.025, 2.30, 0.015, px, 1.38, front - 0.12);
    }
    // 上楣的两层线脚停在门牌下方，不遮挡灯、文字与徽记。
    box(wood, 2.10, 0.08, 0.17, x, 2.72, front - 0.07, 'x');
    box(brass, 2.14, 0.018, 0.19, x, 2.748, front - 0.07);
  }
  // 现有楼梯前缘的细铜包边，贴面不抬高可行走高度。
  const stairs = SHIP.stairs;
  const cabinHalf = 5.3;
  const width = SHIP.railX - cabinHalf;
  for (const side of [-1, 1]) for (let i = 0; i < stairs.steps; i++) {
    const landing = i >= stairs.steps / 2 ? stairs.landing : 0;
    const z = stairs.z0 + i * stairs.depth + landing;
    box(brass, width - 0.10, 0.025, 0.025,
      side * (cabinHalf + width / 2), (i + 1) * stairs.rise - 0.025, z - 0.008);
  }
  // 桅座与桅杆的束环：沿用低分段几何，给出生点前景留下细高光。
  for (const mast of SHIP.masts) {
    const base = mast.base || 0;
    for (const y of [0.54, 1.30, 4.20]) {
      const radius = mast.radius * (1 - 0.55 * y / mast.height) + 0.012;
      const ring = new THREE.TorusGeometry(radius, 0.025, 4, 12);
      ring.rotateX(Math.PI / 2); ring.translate(0, base + y, mast.z); brass.push(ring);
    }
  }
  // 罗盘向后让出望远镜互动范围；最大浮雕21mm，行走高度/碰撞仍由原甲板负责。
  const compass = createDeckCompassParts();
  brass.push(...compass.brass);
  // This deck has no image-based metal reflection environment. A satin rather
  // than mirror-like brass keeps its body colour readable without emission.
  ship.mat.finishBrass = ship.mat.trim.clone();
  ship.mat.finishBrass.color.setHex(0xe6c788);
  ship.mat.finishBrass.metalness = .16;
  ship.mat.finishBrass.roughness = .43;
  ship.mat.finishBrass.emissive.setHex(0x000000);
  ship.mat.finishBrass.emissiveIntensity = 0;
  ship.mat.compassEnamel = new THREE.MeshStandardMaterial({ color: 0x152c40, roughness: .34, metalness: .4 });
  group.userData.compass = { ...DECK_COMPASS };
  // 贴着原有舷边的短铜节奏线，引导目光向前甲板；中央活动区保持开敞。
  for (const side of [-1, 1]) for (const z of [-12, -8, -4, 0, 4, 8]) {
    box(brass, 0.025, 0.012, 2.4, side * (SHIP.railX - 0.36), 0.012, z);
  }
  for (const [parts, material, name] of [[wood, ship.mat.dark, 'wood'], [brass, ship.mat.finishBrass, 'brass'], [compass.bronze, ship.mat.iron, 'bronze'], [compass.enamel, ship.mat.compassEnamel, 'enamel']]) {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ship-finish-' + name;
    mesh.receiveShadow = true;
    // 小附饰不投影，低画质下不额外增加阴影 pass。
    mesh.castShadow = false; group.add(mesh);
  }
  ship.group.add(group);
  return group;
}
