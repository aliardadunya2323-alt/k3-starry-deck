// 解析碰撞器：船是我们自己生成的，所有边界都是已知解析式，不需要 BVH / 物理引擎。
// resolve(pos, radius) 在船的局部坐标里把胶囊中心推回可行走区域并贴地；同时给相机遮挡提供 Raycaster 目标（ship.occluders）。
import * as THREE from 'three';
import { SHIP } from '../config.js';
import { deckHalfWidth, stairHeight, CABIN_HALF, STAIR_END_Z } from './ship.js';

const P = SHIP.poop;
const T = SHIP.telescope;
const MAST_R = 0.75; // 桅杆 + 桅座 + 绳索桩一并当作一个圆柱

export class ShipCollider {
  constructor() {
    this.enabled = true;
    this._tmp = new THREE.Vector2();
    this.obstacles = []; // 主甲板上的附加圆柱障碍 { x, z, r }（船内三层的下舱口罩房等），按桅杆同样的推法处理
  }

  /** 楼梯口：|x| 在楼梯宽内且 z 在楼梯范围内 */
  inStairX(x, r) { const ax = Math.abs(x); return ax > CABIN_HALF + r * 0.6 && ax < SHIP.railX; }
  inStairZ(z) { return z >= P.wallZ - 0.01 && z <= STAIR_END_Z + 0.01; }

  /** 地面高度：按当前高度 y 判定所在层（主甲板 / 楼梯 / 船尾楼 / 门厅） */
  groundHeight(x, z, y, r) {
    if (z < P.wallZ) {
      // 望远镜台是一个可以走上去的 0.25 m 圆台
      const dx = x - T.x, dz = z - T.z;
      if (dx * dx + dz * dz < 1.25 * 1.25) return 0.25;
      return 0;
    }
    if (this.inStairX(x, r)) {
      if (z <= STAIR_END_Z) return stairHeight(z);
      return P.height;
    }
    // |x| < 舱室半宽：门厅（y 低）或船尾楼甲板（y 高）
    if (z <= STAIR_END_Z && y < 1.5) return 0;
    return P.height;
  }

  /**
   * 把位置推回合法区域。pos 会被就地修改。
   * @param {THREE.Vector3} pos 胶囊底部（脚）位置，船局部坐标
   * @param {number} r 胶囊半径
   * @param {object} opts { ignoreCabinWall } 进门脚本时忽略舱室前墙
   */
  resolve(pos, r, opts = {}) {
    if (!this.enabled) return;
    const onUpper = pos.y > 1.5; // 船尾楼层
    for (let pass = 0; pass < 2; pass++) {
      // 1. 船形轮廓
      const w = deckHalfWidth(pos.z) - r;
      if (pos.x > w) pos.x = w; else if (pos.x < -w) pos.x = -w;
      // 2. 前后端
      const zMin = SHIP.bowZ + 1.2 + r, zMax = SHIP.sternZ - 0.6 - r;
      if (pos.z < zMin) pos.z = zMin; else if (pos.z > zMax) pos.z = zMax;
      // 3. 桅杆（只挡同一层：主甲板上的桅杆 base=0，船尾楼上的 base=3）
      for (const m of SHIP.masts) {
        if (((m.base || 0) > 1.5) !== onUpper) continue;
        const dx = pos.x, dz = pos.z - m.z;
        const d2 = dx * dx + dz * dz, R = MAST_R + r;
        if (d2 < R * R) {
          let d = Math.sqrt(d2);
          let nx = dx, nz = dz;
          if (d < 1e-3) { nx = 1; nz = 0; d = 1; } // 正好站在圆心：往 +x 推
          pos.x += (nx / d) * (R - Math.sqrt(d2)); pos.z += (nz / d) * (R - Math.sqrt(d2));
        }
      }
      // 3b. 主甲板附加障碍（下舱口罩房等）
      if (!onUpper) for (const o of this.obstacles) {
        const dx = pos.x - o.x, dz = pos.z - o.z, R = o.r + r;
        if (dx * dx + dz * dz < R * R) {
          const d = Math.hypot(dx, dz);
          // At the exact center there is no radial direction; choose +x.
          if (d < 1e-8) pos.x += R;
          else { pos.x += (dx / d) * (R - d); pos.z += (dz / d) * (R - d); }
        }
      }
      // 4. 舵台底座（船尾楼上）
      if (onUpper) {
        const dx = pos.x - SHIP.wheel.x, dz = pos.z - SHIP.wheel.z;
        const R = 0.55 + r;
        if (dx * dx + dz * dz < R * R) {
          const d = Math.hypot(dx, dz);
          // At the exact center there is no radial direction; choose +x.
          if (d < 1e-8) pos.x += R;
          else { pos.x += (dx / d) * (R - d); pos.z += (dz / d) * (R - d); }
        }
      }
      // 5. 舱室前墙 z = wallZ（|x| < 舱室半宽）：下层只能在墙前，上层只能在墙后
      const inCabinX = Math.abs(pos.x) < CABIN_HALF; // 墙的真实跨度；角落交给第 6 步的侧墙
      if (inCabinX && !opts.ignoreCabinWall) {
        if (!onUpper) { if (pos.z > P.wallZ - r && pos.y < 1.5 && pos.z < P.wallZ + 1.0) pos.z = P.wallZ - r; }
        else { if (pos.z < P.wallZ + r) pos.z = P.wallZ + r; }
      }
      // 6. 舱室侧墙 / 楼梯井栏杆 x = ±CABIN_HALF，z ∈ [wallZ, STAIR_END_Z]
      if (this.inStairZ(pos.z)) {
        for (const s of [-1, 1]) {
          const wallX = s * CABIN_HALF;
          const dx = pos.x - wallX;
          if (Math.abs(dx) < r) {
            // 站在哪一侧就推向哪一侧（x=0 的一侧 = 舱室 / 船尾楼；外侧 = 楼梯）
            const side = (pos.x - wallX) * s >= 0 ? 1 : -1;
            pos.x = wallX + side * s * r;
          }
        }
        // 门厅内不能越过后墙
        if (!onUpper && inCabinX && pos.z > P.wallZ + P.wallThickness + 2.9 - r && pos.y < 1.5) pos.z = P.wallZ + P.wallThickness + 2.9 - r;
      }
      // 7. 楼梯井：上层的人从上方走到楼梯井 z 范围里就等于走下楼梯，不用挡
    }
    // 8. 贴地（跳跃在空中时由 controller 自己管 y，只算地面高度给它）
    const ground = this.groundHeight(pos.x, pos.z, pos.y, r);
    if (!opts.keepY || pos.y < ground) pos.y = ground;
    return ground;
  }
}
