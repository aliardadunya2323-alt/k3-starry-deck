// 资产通道：把 assets/ 里的文件（glb / svg / png / webp / json）拿到手，两条运行路一致：
//   http（src/main.js 直跑）  → fetch('assets/<name>')
//   file://（dist 离线包）     → 打包时 tools/build-standalone.mjs 把 assets/ 全部 base64 内嵌成 __K3_ASSETS__（esbuild inject），这里直接解码
// 用法：
//   const buf  = await getAsset('ship.glb');            // ArrayBuffer
//   const text = await getAsset('emblem.svg', 'text');  // string
//   const url  = await getAsset('wood.webp', 'dataurl'); // data:URL（给 TextureLoader）
//   const gltf = await loadGLB('wanderer.glb');         // GLTFLoader 解析后的 gltf（scene / animations）
//   const tex  = await loadTexture('wood.webp');        // THREE.Texture（sRGB）
// 规矩（P-003 起）：assets/ 里 < 200 KB 的小件内嵌进主包（合计 ≤ 2 MB）；≥ 200 KB 的大件打成 dist/assets/<name>.js 分片，
//   file:// 下第一次 getAsset 时插一个 <script> 等它到（与主包同一机制，不受 CORS 限制），主包体积不随大资产增长；分片合计 ≤ 24 MB。
//   每个文件在 资产清单.md 登记。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// eslint-disable-next-line no-undef
const INLINE = typeof __K3_ASSETS__ !== 'undefined' ? __K3_ASSETS__ : null;
// eslint-disable-next-line no-undef
const CHUNKS = typeof __K3_ASSET_CHUNKS__ !== 'undefined' ? __K3_ASSET_CHUNKS__ : null; // { name: bytes }，分片在 dist/assets/<name>.js
const MIME = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json', bin: 'application/octet-stream' };
const cache = new Map();
const chunkPending = new Map();
const ASSET_TIMEOUT_MS = 30000, INDEX_TIMEOUT_MS = 5000;

// 一次等待覆盖响应头和正文；失败不进 cache，下一次 getAsset 仍可重试。
function withTimeout(work, label, milliseconds = ASSET_TIMEOUT_MS, abort = () => {}, lateValue = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) { if (!error) { try { lateValue(value); } catch (_) {} } return; }
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error(`${label} 等待超过 ${milliseconds / 1000} 秒，可重新尝试`));
      try { abort(); } catch (_) { /* 超时结果已经返回，取消失败不遮蔽它 */ }
    }, milliseconds);
    Promise.resolve().then(work).then((value) => finish(null, value), (error) => finish(error));
  });
}

function readHttp(name, type, milliseconds = ASSET_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let cancelReader = null, cancelled = false;
  return withTimeout(async () => {
    const res = await fetch('assets/' + name, controller ? { signal: controller.signal } : undefined);
    if (cancelled) throw new Error(`assets/${name} 读取已取消`);
    if (!res.ok) throw new Error(`assets/${name} ${res.status}`);
    if (type === 'text') return res.text();
    if (type === 'json') return res.json();
    if (type !== 'dataurl') return res.arrayBuffer();
    const blob = await res.blob();
    if (cancelled) throw new Error(`assets/${name} 读取已取消`);
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      const finish = (error, value) => {
        fr.onload = fr.onerror = fr.onabort = null; cancelReader = null;
        if (error) reject(error); else resolve(value);
      };
      fr.onload = () => finish(null, fr.result);
      fr.onerror = () => finish(fr.error || new Error(`assets/${name} 读取失败`));
      fr.onabort = () => finish(new Error(`assets/${name} 读取已取消`));
      cancelReader = () => { finish(new Error(`assets/${name} 读取已取消`)); try { fr.abort(); } catch (_) {} };
      try { fr.readAsDataURL(blob); } catch (error) { finish(error); }
    });
  }, `assets/${name}`, milliseconds, () => { cancelled = true; if (controller) controller.abort(); if (cancelReader) cancelReader(); });
}

/** file:// 分片：插 <script src="dist/assets/<name>.js">，它执行后把 base64 挂在 window.__K3_ASSET_CHUNK[name]；同名并发只插一次 */
function loadChunk(name) {
  if (chunkPending.has(name)) return chunkPending.get(name);
  const p = new Promise((resolve, reject) => {
    const g = (window.__K3_ASSET_CHUNK = window.__K3_ASSET_CHUNK || {});
    // 只信本次 script 的完成事件；上次超时脚本可能迟到写入这个临时槽。
    delete g[name];
    const s = document.createElement('script');
    s.src = 'dist/assets/' + name.split('/').map(encodeURIComponent).join('/') + '.js';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); s.onload = s.onerror = null;
      delete g[name]; s.remove();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`资产分片 ${name} 等待超过 ${ASSET_TIMEOUT_MS / 1000} 秒，可重新尝试`)), ASSET_TIMEOUT_MS);
    s.onload = () => { const b64 = g[name]; finish(b64 ? null : new Error(`资产分片 dist/assets/${name}.js 里没有 ${name}`), b64); };
    s.onerror = () => finish(new Error(`资产分片 dist/assets/${name}.js 加载失败（把文件放进 3D模式/assets/ 后重跑 重打离线包.bat）`));
    try { document.head.appendChild(s); } catch (error) { finish(error); }
  }).finally(() => chunkPending.delete(name));
  chunkPending.set(name, p);
  return p;
}

// http 模式下 assets/ 里有什么：serve.js 对 assets/index.json 返回目录清单（不存在就 404 → 视为「不知道」，hasAsset 保守返回 true）
let httpList = null;
export const assetsReady = INLINE
  ? Promise.resolve()
  : readHttp('index.json', 'json', INDEX_TIMEOUT_MS).then((list) => { if (Array.isArray(list)) httpList = new Set(list); }).catch(() => {});

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const has = (obj, k) => !!obj && Object.prototype.hasOwnProperty.call(obj, k);
/** 资产是否存在（file:// 精确：内嵌或分片；http 下 await assetsReady 之后精确，之前保守 true） */
export function hasAsset(name) { return INLINE ? (has(INLINE, name) || has(CHUNKS, name)) : (httpList ? httpList.has(name) : true); }
export function isBundle() { return !!INLINE; }
/** 分片资产是否已经在内存里（还没加载的大件第一次 getAsset 会等一次本地文件读取） */
export function isChunked(name) { return !!INLINE && has(CHUNKS, name) && !has(INLINE, name); }

/** @param {'arraybuffer'|'text'|'dataurl'} type */
export async function getAsset(name, type = 'arraybuffer') {
  const key = name + '|' + type;
  if (cache.has(key)) return cache.get(key);
  const ext = name.split('.').pop().toLowerCase();
  let value;
  if (INLINE) {
    let b64;
    if (has(INLINE, name)) b64 = INLINE[name];
    else if (has(CHUNKS, name)) b64 = await loadChunk(name);
    else throw new Error(`离线包里没有资产 ${name}（把文件放进 3D模式/assets/ 后重跑 重打离线包.bat）`);
    if (type === 'dataurl') value = `data:${MIME[ext] || 'application/octet-stream'};base64,${b64}`;
    else if (type === 'text') value = new TextDecoder().decode(b64ToBuffer(b64));
    else value = b64ToBuffer(b64);
  } else {
    value = await readHttp(name, type);
  }
  cache.set(key, value);
  return value;
}

let _gltf = null;
/** 解析 glb（不走 fetch，所以 file:// 也行）。返回 { scene, animations, ... } */
export async function loadGLB(name, { isolated = false, releaseLate = () => {} } = {}) {
  const buf = await getAsset(name, 'arraybuffer');
  _gltf = _gltf || new GLTFLoader();
  // 保留成功读取的原始字节供重试；迟到解析不再交给调用方。
  // GLTFLoader 可能共享图像缓存，不擅自关闭迟到 gltf 的贴图。
  // Optional native rigs use embedded GLBs and own each parse's blob images.
  // Existing callers keep their shared-loader behavior and no-close default.
  const loader = isolated ? new GLTFLoader() : _gltf;
  return withTimeout(() => new Promise((resolve, reject) => loader.parse(buf, 'assets/', resolve, reject)), `GLB ${name} 解析`, ASSET_TIMEOUT_MS, () => {}, releaseLate);
}

const _texLoader = new THREE.TextureLoader();
// 每次 createImageBitmap 的产物由该调用独占；不可取消的解码迟到后立即关闭。
const decodeBitmap = (source, options, label) => withTimeout(
  () => createImageBitmap(source, options), label, ASSET_TIMEOUT_MS, () => {}, (bitmap) => bitmap.close()
);
/**
 * 贴图：默认 sRGB；法线 / 粗糙度等传 { srgb:false }；maxSize 给了就等比缩到不超过它（脸贴图 2048² 源文件运行时只要 1024²）。
 * 解码走 createImageBitmap（浏览器线程池，不占主线程；4096×2048 JPEG 在 <img> 路上是 100–200 ms 主线程），
 * 再画回 Canvas 交给 three——three 上传 ImageBitmap 时不设 UNPACK_FLIP_Y（沿用上次 GL 状态），直接用会随上传顺序上下颠倒（texcache.js 同一处理）。
 * 不支持 createImageBitmap 的环境退回 TextureLoader。
 */
export async function loadTexture(name, { srgb = true, repeat = null, maxSize = 0 } = {}) {
  let tex;
  if (typeof createImageBitmap === 'function') {
    const buf = await getAsset(name, 'arraybuffer');
    const ext = name.split('.').pop().toLowerCase();
    const blob = new Blob([buf], { type: MIME[ext] || 'application/octet-stream' });
    const opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    let bmp = await decodeBitmap(blob, opts, `贴图 ${name} 解码`);
    try {
      if (maxSize > 0 && Math.max(bmp.width, bmp.height) > maxSize) {
        const k = maxSize / Math.max(bmp.width, bmp.height);
        const small = await decodeBitmap(bmp, { ...opts, resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' }, `贴图 ${name} 缩放`);
        bmp.close(); bmp = small;
      }
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      tex = new THREE.CanvasTexture(c);
    } finally { bmp.close(); }
  } else {
    const url = await getAsset(name, 'dataurl');
    tex = await withTimeout(() => _texLoader.loadAsync(url), `贴图 ${name} 解码`, ASSET_TIMEOUT_MS, () => {}, (lateTexture) => lateTexture.dispose());
  }
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  tex.anisotropy = 4;
  return tex;
}

/**
 * 把 glb 里内嵌的贴图统一缩到 maxSize（脸 2048² → 1024²：显存 22 MB → 5.5 MB，屏上 < 200 px 的脸看不出差别）。
 * 在 loadGLB 之后、加进场景之前调一次；只处理 image 是 HTMLImageElement / ImageBitmap / Canvas 的贴图。
 */
export async function shrinkTextures(gltfScene, maxSize = 1024) {
  const seen = new Set(), jobs = [];
  gltfScene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) {
      const t = m[k]; if (!t || !t.image || seen.has(t)) continue; seen.add(t);
      const w = t.image.width, h = t.image.height; if (!w || Math.max(w, h) <= maxSize) continue;
      jobs.push((async () => {
        const kk = maxSize / Math.max(w, h);
        const bmp = await decodeBitmap(t.image, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: Math.round(w * kk), resizeHeight: Math.round(h * kk), resizeQuality: 'high' }, 'GLB 贴图缩放');
        try {
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          if (t.image.close) t.image.close();
          t.image = c; t.needsUpdate = true;
        } finally { bmp.close(); }
      })());
    }
  });
  await Promise.all(jobs);
  return seen.size;
}
