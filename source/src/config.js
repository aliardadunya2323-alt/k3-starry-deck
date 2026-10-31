// 全局常量：颜色令牌（与 _theme/k3-tokens.css 一致，复制值而不引用文件）、船的坐标、人物与相机参数。
// 坐标系：three.js 右手系，+Y 向上，船头朝 −Z，船尾在 +Z，甲板面 y = 0，单位米。

export const COLORS = {
  night: 0x070a13, deep: 0x04060c, blue: 0x142333, indigo: 0x1b2140, violet: 0x2a1f45, teal: 0x0f3a3f, dust: 0x4a3418,
  ink: 0xeee5d4, muted: 0xbdb6a9, faint: 0x877f70,
  gold: 0xb89250, goldDeep: 0x6f5628, bright: 0xe0bd7c, flare: 0xf6dfa4,
  wood: 0x332218, woodLit: 0x805837,
  magic: 0x87bbae, magicHot: 0xc9f0e4,
  lantern: 0xffb35c, starlight: 0xa8c0ff,
};

export const SHIP = {
  length: 60, beam: 14,
  bowZ: -30, sternZ: 30,
  mainDeck: { zMin: -18, zMax: 14 },
  bowDeck: { zMin: -30, zMax: -18 },
  // 船尾楼：05 写抬高 2.4，但门高 2.6 放不进 2.4 的墙，这里抬到 3.0（README 记录）。
  poop: { zMin: 14, zMax: 26, height: 3.0, wallZ: 14.2, wallThickness: 0.5 },
  railX: 6.6, railHeight: 1.1,
  // 后桅（05 写 (0,0,12)）立在船尾楼甲板上 z=19.5、基座 y=3.0：原位置离中门只有 2.2 m，会把中门和标签整个挡住（README 记录）。
  masts: [
    { z: -14, base: 0, height: 22, radius: 0.45, sails: [{ y: 6.4, h: 5.4, w: 11 }, { y: 12.8, h: 4.2, w: 8.5 }] },
    { z: 0, base: 0, height: 26, radius: 0.5, sails: [{ y: 6.8, h: 6.2, w: 13 }, { y: 14.0, h: 4.8, w: 10 }, { y: 19.6, h: 3.2, w: 7 }] },
    { z: 19.5, base: 3.0, height: 18, radius: 0.42, sails: [{ y: 4.6, h: 4.2, w: 9 }, { y: 9.8, h: 3.4, w: 6.5 }] },
  ],
  // 楼梯：左右各 12 级（两段 × 6，中间平台 0.6），每级高 0.25 深 0.32，从 wallZ 起向 +z 上升到船尾楼面。
  stairs: { xInner: 5.1, xOuter: 6.4, steps: 12, rise: 0.25, depth: 0.32, landing: 0.6, z0: 14.2 },
  wheel: { x: 0, z: 22 },
  telescope: { x: 0, z: -24, radius: 2.6 },
  bigSigil: { x: 0, y: 26, z: -8, diameter: 14, turnSeconds: 60 },
  spawn: { x: 2.2, z: -6, facing: 0 }, // facing 0 = 面朝 +Z（看向船尾楼三扇门）；x 偏 2.2 避开主桅正后方，第一眼就能看见三扇门
  lanterns: [
    { x: -6.2, y: 1.9, z: -20 }, { x: 6.2, y: 1.9, z: -20 },
    { x: -6.2, y: 1.9, z: -8 }, { x: 6.2, y: 1.9, z: -8 },
    { x: -6.2, y: 1.9, z: 4 }, { x: 6.2, y: 1.9, z: 4 },
    { x: -5.6, y: 4.9, z: 20 }, { x: 5.6, y: 4.9, z: 20 },
  ],
};

export const DOOR = { width: 1.6, height: 2.6, thickness: 0.08, hallDepth: 3.0, hallWidth: 3.0, hallHeight: 2.8 };

export const PLAYER = {
  radius: 0.35, height: 1.8, eye: 1.6,
  walkSpeed: 2.6, runSpeed: 5.0, accel: 14, decel: 18, turnRate: 12,
};

export const CAMERA = {
  fov: 62, near: 0.1, far: 1800,
  // 08-F.1（V-001）：默认距离 4.5 → 4.8、俯仰 18° → 13°（相机略低、抬头多 5°：出生第一眼三扇门 + 后桅帆 + 更多夜空入画）
  distance: 4.8, minDistance: 2, maxDistance: 8, pitch: 13 * Math.PI / 180,
  minPitch: -10 * Math.PI / 180, maxPitch: 60 * Math.PI / 180,
  spring: 8, occlusionPad: 0.3,
  universe: { target: [0, 4, 0], minDistance: 12, maxDistance: 520, enter: 8, exit: 12, transition: 0.6 },
};

export const DOOR_STATES = ['idle', 'near', 'ready', 'opening', 'entering', 'leaving'];

export const LINKS = Object.freeze({portal:"",sources:"",models:"",actions:""});

export const STORAGE = { lastDoor: 'k3-deck-demo-last-door', quality: 'k3-deck-demo-quality', sound: 'k3-deck-demo-sound', seenHelp: 'k3-deck-demo-seen-help', cooldown: 'k3-deck-demo-cooldown' };

// 技能冷却档（Esc 菜单里切换）：scale 乘在每个技能的基础冷却上
export const COOLDOWN_LEVELS = [
  { key: 'normal', scale: 1, label: '正常（冲刺 1.2 s · 魔法阵 2 s）' },
  { key: 'half', scale: 0.5, label: '一半' },
  { key: 'short', scale: 0.2, label: '极短' },
  { key: 'none', scale: 0, label: '无冷却 · 随便放' },
];
