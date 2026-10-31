// 同步 SVG 栅格器（H-4 · 窗口 B · 2026-09-07）：把 S 窗口的纹样 SVG 直接画进 Canvas 程序贴图（帆面 emissive、披风刺绣）。
// 为什么不用 <img> 或 SVGLoader：程序纹理生成函数（textures.js）是同步的、还要过 texcache；<img> 解码是异步的，
// SVGLoader 出的是几何不是像素。这里用 DOMParser + Path2D 同步画，支持 S 的 SVG 用到的全部元素：
// path / circle / ellipse / rect / line / polyline / polygon / g / defs / use，属性 fill / stroke / stroke-width / linecap / linejoin /
// dasharray / opacity / fill-opacity / stroke-opacity / transform（translate scale rotate matrix）。不支持文字、滤镜、渐变（S 的纹样 SVG 也没用）。
// SVG 文本来自 assets/（http fetch 或离线包内嵌），由 main.js 在建船 / 建人之前 registerSvgAssets() 登记；没登记就返回 false，调用方走程序画法。
import { getAsset, hasAsset } from '../util/assets.js';
import { hashStr } from '../util/texcache.js';

const registry = new Map();

export function registerSvg(name, text) { if (typeof text === 'string' && text.indexOf('<svg') >= 0) registry.set(name, text); }
export function getSvg(name) { return registry.get(name) || null; }
/** 缓存键用：登记过的这几张 SVG 的内容哈希（改了 SVG，贴图缓存自动失效） */
export function svgHash(names) { return hashStr(names.map((n) => registry.get(n) || '').join('\u0001')); }

/** 从 assets/ 读一组 SVG 登记进来（缺的跳过）。两条运行路一致：http fetch，file:// 内嵌解码。 */
export async function registerSvgAssets(names) {
  let n = 0;
  for (const name of names) {
    if (!hasAsset(name)) continue;
    try { registerSvg(name, await getAsset(name, 'text')); n++; } catch (e) { console.warn('SVG 纹样读取失败', name, e); }
  }
  return n;
}

const parsed = new Map();
function parse(text) {
  let doc = parsed.get(text);
  if (doc) return doc;
  doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  parsed.set(text, doc);
  return doc;
}

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
function nums(s) { return (String(s || '').match(NUM) || []).map(Number); }

function applyTransform(ctx, t) {
  if (!t) return;
  const re = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(t))) {
    const a = nums(m[2]);
    switch (m[1]) {
      case 'translate': ctx.translate(a[0] || 0, a[1] || 0); break;
      case 'scale': ctx.scale(a[0] == null ? 1 : a[0], a[1] == null ? (a[0] == null ? 1 : a[0]) : a[1]); break;
      case 'rotate': {
        const rad = (a[0] || 0) * Math.PI / 180;
        if (a.length >= 3) { ctx.translate(a[1], a[2]); ctx.rotate(rad); ctx.translate(-a[1], -a[2]); } else ctx.rotate(rad);
        break;
      }
      case 'matrix': if (a.length >= 6) ctx.transform(a[0], a[1], a[2], a[3], a[4], a[5]); break;
      case 'skewX': ctx.transform(1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0); break;
      case 'skewY': ctx.transform(1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0); break;
      default: break;
    }
  }
}

const INHERIT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'opacity'];

function styleOf(el, parent) {
  const st = Object.assign({}, parent);
  delete st.opacity; // opacity 不继承（按 SVG 规范，每层各自乘）
  for (const k of INHERIT) {
    const v = el.getAttribute(k);
    if (v != null && v !== '' && v !== 'inherit') st[k] = v;
  }
  return st;
}

function paintColor(v, override, fallback) {
  if (!v || v === 'none') return null;
  if (override) return override;
  if (v === 'currentColor') return fallback;
  return v;
}

function shapePath(el) {
  const tag = el.nodeName.toLowerCase();
  const p = new Path2D();
  const g = (k, d = 0) => { const v = parseFloat(el.getAttribute(k)); return isFinite(v) ? v : d; };
  switch (tag) {
    case 'path': { const d = el.getAttribute('d'); return d ? new Path2D(d) : null; }
    case 'circle': p.arc(g('cx'), g('cy'), g('r'), 0, Math.PI * 2); return p;
    case 'ellipse': p.ellipse(g('cx'), g('cy'), g('rx'), g('ry'), 0, 0, Math.PI * 2); return p;
    case 'rect': {
      const x = g('x'), y = g('y'), w = g('width'), h = g('height'), rx = g('rx', g('ry')), ry = g('ry', rx);
      if (rx > 0 || ry > 0) p.roundRect(x, y, w, h, [Math.min(rx, w / 2)]); else p.rect(x, y, w, h);
      return p;
    }
    case 'line': p.moveTo(g('x1'), g('y1')); p.lineTo(g('x2'), g('y2')); return p;
    case 'polyline': case 'polygon': {
      const a = nums(el.getAttribute('points'));
      for (let i = 0; i + 1 < a.length; i += 2) i ? p.lineTo(a[i], a[i + 1]) : p.moveTo(a[i], a[i + 1]);
      if (tag === 'polygon') p.closePath();
      return p;
    }
    default: return null;
  }
}

function drawNode(ctx, el, parentStyle, opts, doc, depth) {
  if (depth > 32) return;
  const tag = el.nodeName.toLowerCase();
  if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'style' || tag === 'lineargradient' || tag === 'radialgradient' || tag === 'clippath' || tag === 'mask' || tag === 'filter') return;
  const st = styleOf(el, parentStyle);
  const op = parseFloat(st.opacity); const layerAlpha = isFinite(op) ? Math.max(0, Math.min(1, op)) : 1;
  ctx.save();
  if (layerAlpha !== 1) ctx.globalAlpha *= layerAlpha;
  applyTransform(ctx, el.getAttribute('transform'));
  if (tag === 'use') {
    const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    const ref = href.charAt(0) === '#' ? doc.getElementById(href.slice(1)) : null;
    if (ref) {
      ctx.translate(parseFloat(el.getAttribute('x')) || 0, parseFloat(el.getAttribute('y')) || 0);
      // use 上的 fill/stroke 等对被引用元素是「继承」而不是覆盖：被引用元素自己写了就用自己的
      drawNode(ctx, ref, st, opts, doc, depth + 1);
    }
    ctx.restore();
    return;
  }
  if (tag === 'g' || tag === 'svg' || tag === 'symbol' || tag === 'a') {
    for (const child of el.children) drawNode(ctx, child, st, opts, doc, depth + 1);
    ctx.restore();
    return;
  }
  const path = shapePath(el);
  if (path) {
    const fill = paintColor(st.fill == null ? '#000' : st.fill, opts.fill, opts.color);
    const stroke = paintColor(st.stroke == null ? 'none' : st.stroke, opts.stroke, opts.color);
    if (fill) {
      const fo = parseFloat(st['fill-opacity']);
      ctx.save(); if (isFinite(fo)) ctx.globalAlpha *= fo;
      ctx.fillStyle = fill; ctx.fill(path, 'nonzero'); ctx.restore();
    }
    if (stroke) {
      const so = parseFloat(st['stroke-opacity']);
      ctx.save(); if (isFinite(so)) ctx.globalAlpha *= so;
      ctx.strokeStyle = stroke;
      const w = parseFloat(st['stroke-width']); ctx.lineWidth = (isFinite(w) ? w : 1) * (opts.lineScale || 1);
      ctx.lineCap = st['stroke-linecap'] || 'butt'; ctx.lineJoin = st['stroke-linejoin'] || 'miter';
      const dash = st['stroke-dasharray']; ctx.setLineDash(dash && dash !== 'none' ? nums(dash) : []);
      ctx.stroke(path); ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * 把 SVG 画到 ctx 的 (x, y, w, h) 框里（按 viewBox 等比缩放、居中）。
 * opts：{ color: currentColor 用什么, stroke: 强制描边色, fill: 强制填充色, alpha: 整体透明度, lineScale: 线宽倍率, rotate: 弧度 }
 * 返回 true = 画了；false = 没登记 / 解析失败（调用方回退到程序画法）。
 */
export function drawSvg(ctx, textOrName, x, y, w, h, opts = {}) {
  const text = registry.get(textOrName) || (String(textOrName).indexOf('<svg') >= 0 ? textOrName : null);
  if (!text) return false;
  const doc = parse(text);
  if (!doc) return false;
  const root = doc.documentElement;
  const vb = nums(root.getAttribute('viewBox'));
  const vw = vb.length === 4 ? vb[2] : parseFloat(root.getAttribute('width')) || 100;
  const vh = vb.length === 4 ? vb[3] : parseFloat(root.getAttribute('height')) || 100;
  const vx = vb.length === 4 ? vb[0] : 0, vy = vb.length === 4 ? vb[1] : 0;
  const s = Math.min(w / vw, h / vh);
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.translate(x + w / 2, y + h / 2);
  if (opts.rotate) ctx.rotate(opts.rotate);
  ctx.scale(s, s);
  ctx.translate(-vx - vw / 2, -vy - vh / 2);
  const o = { color: opts.color || '#e0bd7c', stroke: opts.stroke || null, fill: opts.fill || null, lineScale: opts.lineScale || 1 };
  drawNode(ctx, root, { fill: '#000', stroke: 'none' }, o, doc, 0);
  ctx.restore();
  return true;
}

/** 沿一条水平带平铺：从 x0 到 x1，每格 cell 宽、带高 h、顶 y */
export function tileSvg(ctx, name, x0, x1, y, cell, h, opts = {}) {
  if (!registry.has(name)) return false;
  for (let x = x0; x < x1; x += cell) drawSvg(ctx, name, x, y, cell, h, opts);
  return true;
}
