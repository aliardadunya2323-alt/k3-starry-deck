// 值噪声 + fbm（思路来自 The Book of Shaders 第 13 章：多层噪声，频率 ×2、振幅 ×0.5 叠加）。
// 纯 JS，给 Canvas 2D 程序纹理用；不是 GLSL。

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 11) % 2147483647;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const fade = (t) => t * t * (3 - 2 * t);

// 2D 值噪声 ∈ [0,1]，周期 256（可无缝平铺）
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const a = PERM[X + PERM[Y]] / 255;
  const b = PERM[X + 1 + PERM[Y]] / 255;
  const c = PERM[X + PERM[Y + 1]] / 255;
  const d = PERM[X + 1 + PERM[Y + 1]] / 255;
  const u = fade(xf), v = fade(yf);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

// fbm ∈ [0,1]
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(fx, fy);
    norm += amp;
    amp *= gain; fx *= lacunarity; fy *= lacunarity;
  }
  return sum / norm;
}

// 平铺友好的 fbm：x 方向以 period 为周期（用于经度环绕的银河球）
export function fbmWrapX(x, y, period, octaves = 4) {
  // 把 x 映射到圆上取两次采样混合，消掉接缝
  const t = (x / period) % 1;
  const a = fbm2(x, y, octaves);
  const b = fbm2(x - period, y, octaves);
  const w = fade(t < 0.5 ? 1 : (1 - t) * 2); // 只在接缝附近混合
  return t < 0.5 ? a : a * w + b * (1 - w);
}

export const hash1 = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
