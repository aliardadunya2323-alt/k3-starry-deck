// 全部纹理由 Canvas 2D 程序生成（0 资产字节，0 外部许可）。配色取自 ship.svg / wanderer.svg / k3-tokens。
// P-001：大张的（木纹 / 书脊 / 帆布 / 银河 / 星云 / 披风 / 星图）经 util/texcache.js 缓存到 IndexedDB——首次生成后
// 下次启动直接用解码好的 ImageBitmap，不再逐像素算。每个生成器拆成 xxxGen()（纯生成，返回 Canvas）+ 同名导出（缓存 + 建纹理）。
// 改了某个 xxxGen / 噪声函数，缓存键里的源码哈希会变、自动失效；改了 easing.js 里的 rng / smoothstep 这类间接依赖请 bump texcache.js 的 CACHE_VERSION。
import * as THREE from 'three';
import { noise2, fbm2, fbmWrapX, hash1 } from '../util/noise.js';
import { clamp, lerp, smoothstep, rng } from '../util/easing.js';
import { cached } from '../util/texcache.js';
import { drawSvg, tileSvg, getSvg, svgHash } from './svgraster.js'; // H-4（B）：帆面 / 披风的 SVG 纹样同步栅格化

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = [1, 1], wrap = THREE.RepeatWrapping, anisotropy = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

const hex = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// 从颜色图亮度求法线贴图（简单 Sobel），strength 越大凹凸越强
// P-004：环绕邻域用行 / 列偏移直接取，去掉每像素 8 次带取模的闭包调用；Math.hypot → sqrt。输出与旧实现逐位一致（1024² 上 0 个像素不同），快 3×
function normalFromCanvas(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const d = sctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) / 255;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const o = img.data;
  for (let y = 0; y < h; y++) {
    const r0 = y * w, rm = (y === 0 ? h - 1 : y - 1) * w, rp = (y === h - 1 ? 0 : y + 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = x === 0 ? w - 1 : x - 1, xp = x === w - 1 ? 0 : x + 1;
      const dx = (lum[rm + xp] + 2 * lum[r0 + xp] + lum[rp + xp]) - (lum[rm + xm] + 2 * lum[r0 + xm] + lum[rp + xm]);
      const dy = (lum[rp + xm] + 2 * lum[rp + x] + lum[rp + xp]) - (lum[rm + xm] + 2 * lum[rm + x] + lum[rm + xp]);
      const nx = -dx * strength, ny = -dy * strength;
      const len = Math.sqrt(nx * nx + ny * ny + 1);
      const i = (r0 + x) * 4;
      o[i] = (nx / len * 0.5 + 0.5) * 255; o[i + 1] = (ny / len * 0.5 + 0.5) * 255; o[i + 2] = (1 / len * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** 木板：板条沿 v（纵向）铺，板缝 + 木纹 + 钉孔。palette: 'deck' | 'hull' | 'dark' | 'door'。返回 { map, normal } 纹理 */
export function woodPlanks({ size = 1024, planks = 8, palette = 'deck', seed = 7, plankLen = 3.2 } = {}) {
  const p = { size, planks, palette, seed, plankLen };
  const parts = cached('woodPlanks', p, [woodPlanksGen, normalFromCanvas, fbm2, noise2, rng], () => { const c = woodPlanksGen(p); return { map: c, normal: normalFromCanvas(c, palette === 'deck' ? 0.95 : 1.6) }; }, ['map', 'normal']);
  return { map: tex(parts.map), normal: tex(parts.normal, { srgb: false }) };
}
function woodPlanksGen({ size, planks, palette, seed, plankLen }) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = rng(seed);
  const pal = {
    deck: { a: [172, 150, 113], b: [136, 111, 78], c: [96, 75, 52] },      // ship.svg #b49461 → #392919
    hull: { a: [178, 130, 80], b: [114, 78, 48], c: [54, 37, 23] },        // ship.svg #966a3e → #553823；D-086 整体提亮一档：原来平均 sRGB 49 ≈ 线性 0.03，船外看船体就是黑剪影
    dark: { a: [110, 78, 48], b: [64, 44, 28], c: [22, 16, 12] },
    door: { a: [128, 88, 55], b: [80, 54, 34], c: [40, 27, 18] },
  }[palette];
  const pw = size / planks;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  // 每块板随机偏色与相位
  const tone = new Array(planks).fill(0).map(() => (R() - 0.5) * (palette === 'deck' ? 0.34 : 0.6));
  const phase = new Array(planks).fill(0).map(() => R() * 100);
  const segLen = size * (plankLen / (planks * 0.5)); // 纵向分段长度（像素）
  // P-004：只随 x 变的（板号、板缝暗度）按列预算，只随 (y, 板) 变的（端缝）按行预算，颜色插值不再每像素 new 两个数组（1024² = 200 万次分配、GC 占启动 100 ms）。
  // 输出与旧写法一致（1024² 上 420 万个通道值里 1 个差 1/255）
  const [a0, a1, a2] = pal.a, [b0, b1, b2] = pal.b, [c0, c1, c2] = pal.c;
  const colP = new Int32Array(size), colSeam = new Float32Array(size);
  for (let x = 0; x < size; x++) { const p = Math.floor(x / pw); const lx = (x - p * pw) / pw; colP[x] = p; colSeam[x] = smoothstep(0.0, 0.06, Math.min(lx, 1 - lx)); } // lx：0..1 板内横向；板缝两侧变暗
  const off = phase.map((ph, p) => (p % 2) * segLen * 0.5 + ph * 3); // 纵向端缝错缝
  const endSeam = new Float32Array(planks);
  for (let y = 0; y < size; y++) {
    for (let p = 0; p < planks; p++) { const ly = ((y + off[p]) % segLen) / segLen; endSeam[p] = smoothstep(0.0, 0.012, Math.min(ly, 1 - ly)); }
    for (let x = 0; x < size; x++) {
      const p = colP[x];
      // 木纹：沿纵向拉长的噪声
      const g = fbm2(x * 0.02 + phase[p], y * 0.0035 + phase[p], 3);
      const rings = 0.5 + 0.5 * Math.sin((g * 14 + x * 0.05) * 1.7);
      const t = clamp(0.45 + tone[p] + (g - 0.5) * 0.9 + rings * 0.12, 0, 1);
      let r, g2, b;
      if (t < 0.5) { const k = t * 2; r = c0 + (b0 - c0) * k; g2 = c1 + (b1 - c1) * k; b = c2 + (b2 - c2) * k; }
      else { const k = (t - 0.5) * 2; r = b0 + (a0 - b0) * k; g2 = b1 + (a1 - b1) * k; b = b2 + (a2 - b2) * k; }
      const seamFloor = palette === 'deck' ? 0.56 : 0.35;
      const dark = seamFloor + (1 - seamFloor) * Math.min(colSeam[x], endSeam[p]);
      // 细颗粒
      const grain = (noise2(x * 0.9, y * 0.9) - 0.5) * (palette === 'deck' ? 6 : 18);
      const i = (y * size + x) * 4;
      d[i] = clamp(r * dark + grain, 0, 255); d[i + 1] = clamp(g2 * dark + grain * 0.8, 0, 255); d[i + 2] = clamp(b * dark + grain * 0.6, 0, 255); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 钉孔
  ctx.fillStyle = 'rgba(20,14,10,0.85)';
  for (let p = 0; p < planks; p++) {
    const off = (p % 2) * segLen * 0.5 + phase[p] * 3;
    for (let k = -1; k < size / segLen + 1; k++) {
      const yy = k * segLen - (off % segLen) + segLen * 0.06;
      for (const fx of [0.22, 0.78]) {
        ctx.beginPath(); ctx.arc(p * pw + pw * fx, yy, size / 512, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  return c;
}

/** 书脊条：舷侧一圈「知识」——一排排书脊（木色 / 暗金 / 靛 / 青） */
export function bookSpines({ width = 2048, height = 256, seed = 3 } = {}) {
  const p = { width, height, seed };
  const parts = cached('bookSpines', p, [bookSpinesGen, rng], () => ({ map: bookSpinesGen(p) }));
  return { map: tex(parts.map, { repeat: [1, 1], wrap: THREE.RepeatWrapping }) };
}
function bookSpinesGen({ width, height, seed }) {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  const R = rng(seed);
  ctx.fillStyle = '#1a120c';
  ctx.fillRect(0, 0, width, height);
  const cols = ['#38271e', '#514631', '#61503a', '#2d3530', '#1b2140', '#0f3a3f', '#6f5628', '#2a1f45', '#805837'];
  let x = 0;
  while (x < width) {
    const w = 10 + R() * 18;
    const h = height * (0.72 + R() * 0.26);
    const col = cols[Math.floor(R() * cols.length)];
    ctx.fillStyle = col;
    ctx.fillRect(x, height - h, w - 2, h);
    // 书脊高光与金线
    ctx.fillStyle = 'rgba(255,230,180,0.08)';
    ctx.fillRect(x + 1, height - h, 2, h);
    ctx.fillStyle = R() < 0.6 ? 'rgba(201,168,115,0.55)' : 'rgba(135,187,174,0.4)';
    const bands = 1 + Math.floor(R() * 3);
    for (let b = 0; b < bands; b++) {
      const yy = height - h + h * (0.12 + 0.3 * b + R() * 0.1);
      ctx.fillRect(x + 1, yy, w - 4, 1.5);
    }
    x += w;
  }
  // 顶部阴影（书架板）
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)'); grd.addColorStop(0.35, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, width, height);
  return c;
}

/** 帆布：织纹 + 淡符文 / 星图（emissive 单独一张） */
export function sailCloth({ size = 1024, seed = 11 } = {}) {
  const p = { size, seed, svg: svgHash(['sigil.svg', 'frame.svg']) };   // SVG 内容进缓存键：换了纹样贴图自动重生成
  const parts = cached('sailCloth', p, [sailClothGen, fbm2, noise2, rng], () => sailClothGen(p), ['map', 'emissive']);
  return { map: tex(parts.map, { wrap: THREE.ClampToEdgeWrapping }), emissive: tex(parts.emissive, { wrap: THREE.ClampToEdgeWrapping }) };
}

// G3-003 v4: the three archived drawings now have explicit large/medium/small consumers.
// Build the woven fabric once. Reuse it when composing the three patterns; geometry,
// wind deformation and the legacy fallback stay in their existing owners.
const SAIL_RUNE_NAMES = ['g3-sail-rune-1.svg', 'g3-sail-rune-2.svg', 'g3-sail-rune-3.svg'];
const SAIL_RUNE_SIZES = [1024, 768, 512];
export function sailClothSet() {
  if (!SAIL_RUNE_NAMES.every(name => getSvg(name))) return [sailCloth()];
  const p = { size: 1024, seed: 11, sizes: SAIL_RUNE_SIZES, names: SAIL_RUNE_NAMES, svg: svgHash(SAIL_RUNE_NAMES) };
  const required = ['map0', 'emissive0', 'map1', 'emissive1', 'map2', 'emissive2'];
  const parts = cached('sailClothG3', p, [sailClothSetGen, sailClothGen, fbm2, noise2, rng, drawSvg], () => sailClothSetGen(p), required);
  return SAIL_RUNE_NAMES.map((name, i) => ({
    name, map: tex(parts['map' + i], { wrap: THREE.ClampToEdgeWrapping }),
    emissive: tex(parts['emissive' + i], { wrap: THREE.ClampToEdgeWrapping }),
  }));
}
function sailClothSetGen({ size, seed, sizes, names }) {
  const fabric = sailClothGen({ size, seed, plain: true });
  const result = {};
  names.forEach((name, i) => {
    const edge = sizes[i], map = canvas(edge, edge), emissive = canvas(edge, edge);
    const paint = map.getContext('2d'), glow = emissive.getContext('2d');
    paint.drawImage(fabric.map, 0, 0, edge, edge);
    glow.drawImage(fabric.emissive, 0, 0, edge, edge);
    // A faint pigment remains visible in daylight; the warm emissive pass preserves night detail.
    drawSvg(paint, name, edge * 0.04, edge * 0.04, edge * 0.92, edge * 0.92,
      { stroke: 'rgb(96,74,40)', fill: 'rgb(96,74,40)', alpha: 0.20, lineScale: 1.25 });
    drawSvg(glow, name, edge * 0.04, edge * 0.04, edge * 0.92, edge * 0.92,
      { stroke: 'rgb(224,189,124)', fill: 'rgb(246,223,164)', lineScale: 1.25 });
    result['map' + i] = map; result['emissive' + i] = emissive;
  });
  return result;
}

function sailClothGen({ size, seed, plain = false }) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const weave = 0.5 + 0.5 * Math.sin(x * 0.9) * Math.sin(y * 0.9);
    const n = fbm2(x * 0.006, y * 0.006, 4);
    const stain = fbm2(x * 0.02 + 40, y * 0.02 + 40, 3);
    const base = mix3([191, 167, 128], [125, 119, 100], n * 0.7 + stain * 0.3); // ship.svg sail #bfa780 → #7d7764
    const v = 0.9 + weave * 0.1;
    const i = (y * size + x) * 4;
    d[i] = base[0] * v; d[i + 1] = base[1] * v; d[i + 2] = base[2] * v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 缝线
  ctx.strokeStyle = 'rgba(60,50,40,0.35)'; ctx.lineWidth = 2;
  for (let k = 1; k < 8; k++) { ctx.beginPath(); ctx.moveTo(0, k * size / 8); ctx.lineTo(size, k * size / 8); ctx.stroke(); }
  // 符文与星图（emissive）
  const e = canvas(size, size);
  const ectx = e.getContext('2d');
  // 底色不是纯黑：帆布自带一点微光，背光面 / 下面不会死黑
  ectx.fillStyle = 'rgb(46,42,36)'; ectx.fillRect(0, 0, size, size);
  if (plain) return { map: c, emissive: e };
  const R = rng(seed);
  ectx.strokeStyle = 'rgba(224,189,124,1)'; ectx.lineWidth = 3; ectx.lineCap = 'round';
  // 星座线
  const pts = [];
  for (let i = 0; i < 26; i++) pts.push([R() * size, R() * size]);
  for (let i = 0; i < pts.length; i++) {
    const j = Math.floor(R() * pts.length);
    const dist = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (dist < size * 0.3) { ectx.beginPath(); ectx.moveTo(pts[i][0], pts[i][1]); ectx.lineTo(pts[j][0], pts[j][1]); ectx.stroke(); }
  }
  ectx.fillStyle = 'rgba(246,223,164,1)';
  for (const p of pts) { ectx.beginPath(); ectx.arc(p[0], p[1], 5, 0, Math.PI * 2); ectx.fill(); }
  if (getSvg('sigil.svg')) {
    // H-4：帆面法阵用 S 窗口的印记 SVG（外环刻度 + 符文环 + 双线六角星）栅格化，四边再压一圈 frame.svg 的金线密纹——
    // hero-painting 里帆面是「金线密纹」，这才对得上；没登记 SVG 时走下面的程序画法
    drawSvg(ectx, 'sigil.svg', size * 0.19, size * 0.19, size * 0.62, size * 0.62, { stroke: 'rgb(224,189,124)', fill: 'rgb(246,223,164)', lineScale: 1.6 });
    if (getSvg('frame.svg')) drawSvg(ectx, 'frame.svg', size * 0.03, size * 0.03, size * 0.94, size * 0.94, { stroke: 'rgb(224,189,124)', fill: 'rgb(224,189,124)', alpha: 0.72, lineScale: 1.5 });
    // 布面本身也印一层极淡的同款（背光 / 白天视角下帆不是白板）
    ctx.save(); ctx.globalAlpha = 0.16; drawSvg(ctx, 'sigil.svg', size * 0.19, size * 0.19, size * 0.62, size * 0.62, { stroke: 'rgb(96,74,40)', fill: 'rgb(96,74,40)', lineScale: 1.6 }); ctx.restore();
    return { map: c, emissive: e };
  }
  // 中央六角星
  const cx = size / 2, cy = size / 2, r = size * 0.22;
  ectx.lineWidth = 4;
  for (const rot of [0, Math.PI]) {
    ectx.beginPath();
    for (let k = 0; k < 3; k++) { const a = rot + -Math.PI / 2 + k * Math.PI * 2 / 3; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; k === 0 ? ectx.moveTo(px, py) : ectx.lineTo(px, py); }
    ectx.closePath(); ectx.stroke();
  }
  ectx.beginPath(); ectx.arc(cx, cy, r * 1.15, 0, Math.PI * 2); ectx.stroke();
  ectx.setLineDash([6, 14]); ectx.beginPath(); ectx.arc(cx, cy, r * 1.3, 0, Math.PI * 2); ectx.stroke(); ectx.setLineDash([]);
  // 符文刻痕环
  for (let k = 0; k < 36; k++) {
    const a = k / 36 * Math.PI * 2; const rr = r * 1.45;
    const len = 6 + (k % 3) * 8;
    ectx.beginPath(); ectx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ectx.lineTo(cx + Math.cos(a) * (rr + len), cy + Math.sin(a) * (rr + len)); ectx.stroke();
  }
  return { map: c, emissive: e };
}

/** 银河带：等距柱状投影，斜 24° 的带，靛 → 紫 → 少量青 与 金尘 */
export function galaxy({ width = 1024, height = 512 } = {}) {
  const p = { width, height };
  const parts = cached('galaxy', p, [galaxyGen, fbmWrapX, noise2], () => ({ map: galaxyGen(p) }));
  const t = tex(parts.map, { wrap: THREE.ClampToEdgeWrapping, anisotropy: 2 });
  t.wrapS = THREE.RepeatWrapping;
  return { map: t };
}
function galaxyGen({ width, height }) {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const tilt = 24 * Math.PI / 180;
  // D-075：按门户 hero-painting 调色——深海军蓝底、靛蓝带、青蓝亮部、少量暗金尘，去掉偏紫
  const NIGHT = [4, 7, 18], INDIGO = [10, 18, 54], VIOLET = [16, 30, 86], TEAL = [30, 90, 160], DUST = [70, 56, 30], PALE = [110, 140, 210];
  for (let y = 0; y < height; y++) {
    const lat = (y / height - 0.5) * Math.PI;         // -π/2..π/2
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;          // 0..2π
      // 银河带中心线：纬度 = tilt·sin(lon)（绕着球的一条斜带）
      const bandCenter = Math.sin(lon) * tilt * 1.2;
      const dist = Math.abs(lat - bandCenter);
      const n1 = fbmWrapX(x * 0.006, y * 0.006, width * 0.006, 5);
      const n2 = fbmWrapX(x * 0.02 + 17, y * 0.02 + 5, width * 0.02, 4);
      const n3 = fbmWrapX(x * 0.05 + 99, y * 0.05 + 31, width * 0.05, 3);
      // D-075：银河带收窄、整体压暗——门户 hero-painting 的宇宙是深海军蓝底上几条亮丝，不是满天亮云
      const bandW = 0.2 + n1 * 0.16;
      let band = Math.exp(-(dist * dist) / (bandW * bandW)) * (0.55 + n1 * 0.9);
      band *= 0.6 + n2 * 0.8;
      // 暗尘带（吸收）沿中心线
      const dust = Math.exp(-(dist * dist) / (0.03 + n2 * 0.03)) * smoothstep(0.35, 0.7, n3);
      band *= 1 - dust * 0.75;
      const glow = clamp(band * 0.95, 0, 1.4);
      // 全天微弱星云
      const ambient = Math.pow(n1, 3) * 0.3;
      // 颜色：靛 → 紫 → 青 / 金尘
      let col = mix3(NIGHT, INDIGO, clamp(glow * 1.1 + ambient, 0, 1));
      col = mix3(col, VIOLET, clamp((glow - 0.25) * 1.3 * n2, 0, 1));
      col = mix3(col, TEAL, clamp((n3 - 0.6) * 2.5, 0, 1) * glow * 0.6);
      col = mix3(col, DUST, clamp((n2 - 0.55) * 3, 0, 1) * glow * 0.55);
      col = mix3(col, PALE, clamp(glow - 0.8, 0, 0.6));
      const i = (y * width + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 星云广告牌：软噪声 alpha，中心亮边缘消失 */
export function nebula({ size = 256, seed = 1, tint = [42, 31, 69], hot = [135, 187, 174] } = {}) {
  const p = { size, seed, tint, hot };
  const parts = cached('nebula', p, [nebulaGen, fbm2, noise2], () => ({ map: nebulaGen(p) }));
  return tex(parts.map, { wrap: THREE.ClampToEdgeWrapping });
}
function nebulaGen({ size, seed, tint, hot }) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const off = seed * 37.1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size - 0.5, v = y / size - 0.5;
    const r = Math.hypot(u, v) * 2;
    const n = fbm2(x * 0.02 + off, y * 0.02 + off, 5);
    const n2 = fbm2(x * 0.06 + off + 9, y * 0.06 + off + 9, 3);
    let a = smoothstep(1.0, 0.15, r) * Math.pow(n, 1.6) * 1.6;
    a *= 0.7 + n2 * 0.6;
    const col = mix3(tint, hot, clamp((n2 - 0.5) * 1.4, 0, 1) * 0.7);
    const i = (y * size + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = clamp(a, 0, 1) * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * 旋涡星云广告牌（D-075，对着门户 hero-painting 的那种蓝色丝缕旋涡）：极坐标域扭曲 + 脊状噪声（1−|2n−1|）出丝缕，
 * 丝缕越靠近中心越亮、越偏 hot 色（青白），外围是深蓝底；alpha 径向消失。
 */
export function nebulaSwirl({ size = 512, seed = 21, tint = [16, 34, 92], hot = [150, 215, 255], swirl = 2.6 } = {}) {
  const p = { size, seed, tint, hot, swirl };
  const parts = cached('nebulaSwirl', p, [nebulaSwirlGen, fbm2, noise2], () => ({ map: nebulaSwirlGen(p) }));
  return tex(parts.map, { wrap: THREE.ClampToEdgeWrapping });
}
function nebulaSwirlGen({ size, seed, tint, hot, swirl }) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const off = seed * 53.7;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size - 0.5, v = y / size - 0.5;
    const r = Math.hypot(u, v) * 2;
    const ang = Math.atan2(v, u) + swirl * Math.pow(Math.max(0, 1 - r), 1.3); // 越靠中心转得越多 → 旋臂
    const wx = Math.cos(ang) * r, wy = Math.sin(ang) * r;
    // 域扭曲：先用一层噪声推一下采样点，丝缕才会弯
    const px = wx * 3.2 + off, py = wy * 3.2 + off;
    const q1 = fbm2(px + 1.7, py + 9.2, 4), q2 = fbm2(px + 8.3, py + 2.8, 4);
    const n = fbm2(px + (q1 - 0.5) * 1.6, py + (q2 - 0.5) * 1.6, 6);
    // 脊状：只有 n 落在 0.5 附近一条很窄的带里才亮（fbm 值本来就挤在 0.5 周围，阈值不卡紧整张就是一片白云）
    const ridge = 1 - Math.abs(2 * n - 1);
    const fil = Math.pow(clamp((ridge - 0.86) / 0.14, 0, 1), 1.5);
    // 底云压得很淡（深空要保持深），亮的只有丝缕
    const body = Math.pow(fbm2(px * 0.5 + 40, py * 0.5 + 40, 4), 2.2);
    const fall = smoothstep(0.95, 0.15, r);
    const a = fall * (body * 0.22 + fil * 0.95) * (0.5 + 0.8 * (1 - r));
    const hotK = clamp(fil * 1.5 * (1 - r * 0.6) + body * 0.04, 0, 1);
    const col = mix3(tint, hot, hotK);
    const i = (y * size + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = clamp(a, 0, 1) * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * 星球贴图（D-075，H-2 彩色星球）：纬向条带（fbm 沿纬度扭一下）+ 大气边缘，等距柱状投影 512×256。
 * palette：[深色, 主色, 亮带色, 风暴/斑点色]；bands 条带数；storm>0 加一颗大风暴斑。
 */
export function planetTexture({ seed = 1, palette = [[20, 40, 90], [70, 120, 190], [180, 210, 240], [230, 240, 255]], bands = 9, storm = 0, width = 512, height = 256 } = {}) {
  const p = { seed, palette, bands, storm, width, height };
  const parts = cached('planet', p, [planetTextureGen, fbmWrapX, fbm2, noise2], () => ({ map: planetTextureGen(p) }));
  return tex(parts.map, { wrap: THREE.RepeatWrapping, anisotropy: 4 });
}
function planetTextureGen({ seed, palette, bands, storm, width, height }) {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const off = seed * 71.3;
  const [dark, mid, light, hot] = palette;
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const warp = (fbmWrapX(x * 0.012 + off, y * 0.02 + off, width * 0.012, 4) - 0.5) * 0.12;
      const band = 0.5 + 0.5 * Math.sin((v + warp) * Math.PI * bands + Math.sin((v + warp) * Math.PI * bands * 0.37) * 1.3);
      const turb = fbmWrapX(x * 0.03 + off + 7, y * 0.03 + off + 3, width * 0.03, 4);
      let k = clamp(band * 0.75 + turb * 0.35, 0, 1);
      let col = mix3(dark, mid, smoothstep(0.05, 0.55, k));
      col = mix3(col, light, smoothstep(0.55, 0.95, k));
      if (storm > 0) {
        const sx = ((x / width) - 0.62), sy = (v - 0.42);
        const s = Math.exp(-(sx * sx * 6 + sy * sy * 40) * 3) * storm;
        col = mix3(col, hot, clamp(s * (0.7 + turb * 0.6), 0, 1));
      }
      const i = (y * width + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 披风：深靛底 + 下摆暗金花纹；emissive 只有花纹 */
export function cloak({ size = 512 } = {}) {
  const p = { size, svg: svgHash(['divider.svg', 'sigil-mini.svg', 'g3-cloak-chibi.svg']) };
  const parts = cached('cloak', p, [cloakGen, fbm2, noise2], () => cloakGen(p), ['map', 'emissive']);
  return { map: tex(parts.map, { wrap: THREE.ClampToEdgeWrapping }), emissive: tex(parts.emissive, { wrap: THREE.ClampToEdgeWrapping }) };
}
function cloakGen({ size }) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm2(x * 0.03, y * 0.03, 3);
    const v = y / size; // 0 顶 1 底
    const base = mix3([35, 39, 57], [10, 16, 26], v * 0.7 + (n - 0.5) * 0.3); // wanderer.svg #232739 → #0a101a
    const i = (y * size + x) * 4;
    d[i] = base[0]; d[i + 1] = base[1]; d[i + 2] = base[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const e = canvas(size, size);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, size, size);
  // G3-003 v4 original embroidery: same cloth texture and existing cloak geometry.
  if (getSvg('g3-cloak-chibi.svg')) {
    const embroidery = { stroke: 'rgb(224,189,124)', fill: 'rgb(224,189,124)', lineScale: 1.15 };
    drawSvg(ctx, 'g3-cloak-chibi.svg', 0, 0, size, size, { ...embroidery, alpha: 0.85 });
    drawSvg(ectx, 'g3-cloak-chibi.svg', 0, 0, size, size, embroidery);
    return { map: c, emissive: e };
  }
  if (getSvg('divider.svg')) {
    // H-4：Q 版披风的刺绣——下摆一圈 S 的分隔纹（divider.svg 平铺两格）夹在两道金线里，背心一枚小印记（sigil-mini.svg）；
    // 画布 u = 绕背角度（0.5 是背中）、y 向下 = 肩 → 下摆
    const gold = 'rgb(184,146,80)', bright = 'rgb(224,189,124)';
    const embroider = (target, alpha) => {
      target.save(); target.globalAlpha = alpha;
      target.strokeStyle = gold; target.lineWidth = 3; target.lineCap = 'round';
      const yb = size * 0.905;
      target.beginPath(); target.moveTo(0, yb); target.lineTo(size, yb); target.stroke();
      target.beginPath(); target.moveTo(0, yb - size * 0.075); target.lineTo(size, yb - size * 0.075); target.stroke();
      tileSvg(target, 'divider.svg', 0, size, yb - size * 0.07, size / 2, size * 0.065, { stroke: bright, fill: bright, lineScale: 1.3 });
      if (getSvg('sigil-mini.svg')) drawSvg(target, 'sigil-mini.svg', size * 0.36, size * 0.34, size * 0.28, size * 0.28, { stroke: bright, fill: bright, alpha: 0.9, lineScale: 1.2 });
      target.restore();
    };
    embroider(ctx, 0.85);
    embroider(ectx, 1);
    return { map: c, emissive: e };
  }
  const drawOrnament = (target, alpha) => {
    target.strokeStyle = `rgba(184,146,80,${alpha})`; target.lineWidth = 3; target.lineCap = 'round';
    const yb = size * 0.9;
    target.beginPath(); target.moveTo(0, yb); target.lineTo(size, yb); target.stroke();
    target.beginPath(); target.moveTo(0, yb - 14); target.lineTo(size, yb - 14); target.stroke();
    // 卷草与小菱形
    for (let k = 0; k < 10; k++) {
      const x0 = k * size / 10 + size / 20;
      target.beginPath(); target.moveTo(x0 - 16, yb - 7); target.lineTo(x0, yb - 30); target.lineTo(x0 + 16, yb - 7); target.lineTo(x0, yb + 0); target.closePath(); target.stroke();
      target.beginPath(); target.arc(x0, yb - 46, 5, 0, Math.PI * 2); target.stroke();
      target.beginPath(); target.moveTo(x0 - 24, yb - 40); target.quadraticCurveTo(x0 - 12, yb - 64, x0, yb - 52); target.stroke();
      target.beginPath(); target.moveTo(x0 + 24, yb - 40); target.quadraticCurveTo(x0 + 12, yb - 64, x0, yb - 52); target.stroke();
    }
    // 中脊一条细金线
    target.lineWidth = 2;
    target.beginPath(); target.moveTo(size / 2, 0); target.lineTo(size / 2, yb - 60); target.stroke();
  };
  drawOrnament(ctx, 0.9);
  drawOrnament(ectx, 1);
  return { map: c, emissive: e };
}

/**
 * 觉醒态披风的红纹 emissive（H-4，B）：接口同 character.js 里的 runeTexture()——返回 sRGB CanvasTexture，黑底红纹。
 * 有 SVG 时：下摆两道线之间平铺 pattern.svg 的六角格刺绣带，背心一枚完整印记（sigil.svg），两侧边缘线保留；
 * 没 SVG 时：原来的程序画法（短划符文 + 双圈两三角）。character.js 只需 import 这个替换本地 runeTexture()。
 */
export function cloakRuneTexture({ size = 512, color = '#ff3448', hot = '#ff6b7a' } = {}) {
  const S = size;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  // Only the emissive drawing changes; current red lining, material and animation stay intact.
  if (getSvg('g3-cloak-awakened.svg')) {
    drawSvg(g, 'g3-cloak-awakened.svg', 0, 0, S, S,
      { stroke: color, fill: hot, lineScale: 1.15 });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  g.strokeStyle = color; g.lineCap = 'round';
  g.lineWidth = 3; g.beginPath(); g.moveTo(0, S * 0.83); g.lineTo(S, S * 0.83); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.moveTo(0, S * 0.94); g.lineTo(S, S * 0.94); g.stroke();
  if (getSvg('pattern.svg') && getSvg('sigil.svg')) {
    tileSvg(g, 'pattern.svg', 0, S, S * 0.84, S * 0.09, S * 0.09, { stroke: color, fill: color, alpha: 0.95, lineScale: 1.6 });
    drawSvg(g, 'sigil.svg', S * 0.27, S * 0.28, S * 0.46, S * 0.46, { stroke: color, fill: hot, lineScale: 1.5 });
  } else {
    for (let i = 0; i < 26; i++) { const x = ((i + 0.5) / 26) * S; g.lineWidth = 2; g.beginPath(); g.moveTo(x, S * 0.87); g.lineTo(x + ((i % 3) - 1) * 5, S * 0.9); if (i % 2) { g.moveTo(x - 4, S * 0.885); g.lineTo(x + 4, S * 0.885); } g.stroke(); }
    const cx = S * 0.5, cy = S * 0.5, r = S * 0.19;
    g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r * 0.84, 0, Math.PI * 2); g.stroke();
    const tri = (rot) => { g.beginPath(); for (let k = 0; k < 3; k++) { const a = rot + (k * Math.PI * 2) / 3; const x = cx + Math.cos(a) * r * 0.8, y = cy + Math.sin(a) * r * 0.8; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); };
    g.lineWidth = 3; tri(-Math.PI / 2); tri(Math.PI / 2);
    g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  }
  g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.moveTo(3, 0); g.lineTo(3, S); g.moveTo(S - 3, 0); g.lineTo(S - 3, S); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 羊皮纸 / 星图桌面：门厅象征物用 */
export function starChart({ size = 512, seed = 5 } = {}) {
  const p = { size, seed };
  const parts = cached('starChart', p, [starChartGen, fbm2, noise2, rng], () => ({ map: starChartGen(p) }));
  return tex(parts.map, { wrap: THREE.ClampToEdgeWrapping });
}
function starChartGen({ size, seed }) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = rng(seed);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm2(x * 0.01 + 3, y * 0.01 + 3, 4);
    const base = mix3([214, 190, 140], [150, 120, 78], n);
    const i = (y * size + x) * 4;
    d[i] = base[0]; d[i + 1] = base[1]; d[i + 2] = base[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(60,40,20,0.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.24, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(size / 2 + Math.cos(a) * size * 0.36, size / 2 + Math.sin(a) * size * 0.36); ctx.lineTo(size / 2 + Math.cos(a) * size * 0.4, size / 2 + Math.sin(a) * size * 0.4); ctx.stroke(); }
  ctx.fillStyle = 'rgba(40,30,20,0.9)';
  const pts = [];
  for (let i = 0; i < 40; i++) { const p = [R() * size, R() * size]; pts.push(p); ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 30; i++) { const a = pts[Math.floor(R() * pts.length)], b = pts[Math.floor(R() * pts.length)]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < size * 0.3) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
  // 四个模型的标记：四个小六角星
  for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
    const cx = fx * size, cy = fy * size, r = size * 0.05;
    ctx.strokeStyle = 'rgba(111,86,40,0.9)'; ctx.lineWidth = 2;
    for (const rot of [0, Math.PI]) { ctx.beginPath(); for (let k = 0; k < 3; k++) { const a = rot - Math.PI / 2 + k * Math.PI * 2 / 3; k === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); ctx.stroke(); }
  }
  return c;
}

/** 流星：细长渐变 */
export function meteorStreak() {
  const c = canvas(256, 16);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(230,236,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 16);
  const v = ctx.createLinearGradient(0, 0, 0, 16);
  v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = v; ctx.fillRect(0, 0, 256, 16);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** 软圆粒子（门前金色粒子 / 灯笼光晕） */
export function softDot(size = 64) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** PlantToy only: a neutral leaf silhouette, retaining existing vertex colours.
 * Same 32px clamp-to-edge texture budget as its old soft particle; no atlas,
 * extra material, animation state, light or network asset. */
export function plantLeaf(size = 32) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.save(); ctx.scale(size, size);
  const body = ctx.createLinearGradient(.27, .75, .75, .14);
  body.addColorStop(0, 'rgba(255,255,255,0.40)');
  body.addColorStop(.52, 'rgba(255,255,255,0.76)');
  body.addColorStop(1, 'rgba(255,255,255,0.46)');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.moveTo(.33, .72);
  ctx.bezierCurveTo(.14, .43, .33, .16, .76, .12);
  ctx.bezierCurveTo(.88, .52, .64, .80, .33, .72); ctx.closePath(); ctx.fill();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.82)'; ctx.lineWidth = .024;
  ctx.beginPath(); ctx.moveTo(.22, .86); ctx.quadraticCurveTo(.53, .54, .75, .15); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.43)'; ctx.lineWidth = .013;
  for (const [x,y,tx,ty] of [[.38,.67,.27,.47],[.46,.56,.31,.36],[.54,.44,.42,.24],[.39,.66,.59,.69],[.47,.54,.71,.54],[.56,.42,.78,.36]]) {
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(tx,ty); ctx.stroke();
  }
  ctx.restore();
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

export { hash1 };
