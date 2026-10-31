// 程序纹理缓存（P-001，2026-09-07）
// 生成一张 1024² 木纹 ≈ 200–300 ms 主线程（4 倍降速的轻薄本上 ~1 s），全部程序纹理合计占启动阻塞的一半以上
// （实测 Sky 0.4 s + Ship 0.7 s + 门 / 人物 0.2 s）。每张纹理都是确定性的（固定种子 + 参数），所以：
//   · 首次生成后把最终 Canvas 编成无损 WebP 存进 IndexedDB（就绪后再慢慢存，不占启动；旧版存的 PNG 条目照常读取）；
//   · 下次启动 main.js 先 await load() 把全部 blob 解码成 ImageBitmap（解码在浏览器线程池里），生成函数命中缓存就把 bitmap
//     画回 Canvas 当纹理图（1–3 ms），不再逐像素算；
//   · 键 = 名字 | 参数 JSON | 生成函数源码哈希（含 noise.js 相关函数源码）| 版本号 → 改了生成代码自动失效，旧条目按前缀淘汰；
//   · file:// 与 http 两条路都可用（Chrome 在 file:// 下有 IndexedDB；打包后函数源码是压缩过的，同一份包内稳定）。
// 任何一步失败（无 IndexedDB / 隐私模式 / 配额）都静默退回现场生成，行为与没有缓存时完全一致。
const DB_NAME = 'k3-3d-texcache', STORE = 'tex', DB_VERSION = 1;
const CACHE_VERSION = 'v1';
const MAX_ENTRIES = 120;         // 超过就按时间淘汰最旧的。一次完整启动约 50 条（木纹类色 + 法线两条）；开发机 http 与 file:// 哈希不同、两套并存要 ~100 条，80 会互相冲掉
const LOAD_TIMEOUT_MS = 2500;    // 解码太慢就不等了（后到的条目只是白白解码，不影响正确性）

const bitmaps = new Map();       // key → { part → ImageBitmap }
const pending = [];              // 待存：{ key, prefix, parts: { part → canvas } }
const seedLog = [];              // 本次现场生成过的全部条目 { key, parts, ms }（给 tools/bake-texseed.mjs 导出「预烤缓存」用；canvas 本来就活着，不多占内存）
let db = null, enabled = false, loaded = false;
const stats = { hits: 0, misses: 0, stored: 0, loadedEntries: 0, loadMs: 0, seeded: 0, seedMs: 0 };
// 预烤缓存（D-085 · 2026-09-08 D-α）：离线包旁边的 dist/texseed.js 是「构建后在无缓存的浏览器里跑一遍、把所有现场生成的纹理编成 WebP」的产物
// （window.__K3_TEXSEED = { 'key#part': base64 }）。file:// 下 load() 先读 IndexedDB，再把种子里 IndexedDB 没有的条目解码进 bitmaps——
// 首次访问 / 每次更新后的第一次访问也走「命中」路径，不再逐像素算 1.9 s。键含函数源码哈希，所以种子过期就自然全部不命中、退回生成，不会错图。
// ?noseed=1 关掉（烤种子、A/B 用）。http 开发路不读种子（源码未压缩、哈希不同）。
const SEED_SRC = 'dist/texseed.js';
const SEED_TIMEOUT_MS = 2500;

export const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}
const tx = (mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode); const s = t.objectStore(STORE);
  const out = fn(s);
  t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
  t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
});

/** 启动时调一次：读全部条目并解码成 ImageBitmap。超时 / 失败都 resolve（缓存只是加速，不是依赖）。 */
export async function load() {
  if (loaded) return stats;
  loaded = true;
  const t0 = performance.now();
  try {
    db = await openDb();
    const rows = await tx('readonly', (s) => { const out = {}; const req = s.openCursor(); req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } }; return out; });
    enabled = true;
    const entries = Object.entries(rows || {});
    // 淘汰：超过上限按时间最旧的删
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (a[1].t || 0) - (b[1].t || 0));
      const drop = entries.splice(0, entries.length - MAX_ENTRIES);
      tx('readwrite', (s) => { for (const [k] of drop) s.delete(k); }).catch(() => {});
    }
    const decode = entries.map(async ([k, v]) => {
      try {
        const bmp = await createImageBitmap(v.blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const [key, part] = k.split('#');
        if (!bitmaps.has(key)) bitmaps.set(key, {});
        bitmaps.get(key)[part] = bmp;
        stats.loadedEntries++;
      } catch (e) { /* 坏条目：忽略，之后会被同前缀的新条目替掉 */ }
    });
    await Promise.race([Promise.all(decode), new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS))]);
  } catch (e) { enabled = false; }
  try { await seedFromBundle(); } catch (e) { /* 种子只是加速 */ }
  stats.loadMs = Math.round(performance.now() - t0);
  return stats;
}

/** 预烤缓存：只在离线包（file://）里、且没带 ?noseed=1 时读 dist/texseed.js；IndexedDB 已有的条目不覆盖 */
async function seedFromBundle() {
  // eslint-disable-next-line no-undef
  if (typeof __K3_ASSETS__ === 'undefined') return;                          // http 开发路：源码未压缩，哈希对不上，别白读
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('noseed') === '1') return;
  const t0 = performance.now();
  const seed = await new Promise((resolve) => {
    if (window.__K3_TEXSEED) { resolve(window.__K3_TEXSEED); return; }
    const s = document.createElement('script');
    const timer = setTimeout(() => { s.remove(); resolve(null); }, SEED_TIMEOUT_MS);
    s.src = SEED_SRC;
    s.onload = () => { clearTimeout(timer); s.remove(); resolve(window.__K3_TEXSEED || null); };
    s.onerror = () => { clearTimeout(timer); s.remove(); resolve(null); };
    document.head.appendChild(s);
  });
  if (!seed) return;
  delete window.__K3_TEXSEED;
  const jobs = [];
  for (const [k, b64] of Object.entries(seed)) {
    const [key, part] = k.split('#');
    if (bitmaps.has(key) && bitmaps.get(key)[part]) continue;                // IndexedDB 里已有：不覆盖
    jobs.push((async () => {
      try {
        const bin = atob(b64); const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u8], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        if (!bitmaps.has(key)) bitmaps.set(key, {});
        bitmaps.get(key)[part] = bmp;
        stats.seeded++;
      } catch (e) { /* 坏条目：忽略，退回生成 */ }
    })());
  }
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, SEED_TIMEOUT_MS))]);
  stats.seedMs = Math.round(performance.now() - t0);
}

/**
 * 导出种子（tools/bake-texseed.mjs 在无缓存的浏览器里 await prebuilt 之后调）：本次现场生成的全部条目编成 WebP dataURL。
 * @param {{minMs?: number, quality?: number}} [o] minMs：只导出生成耗时 ≥ 该值的条目（便宜的不值得占字节）；quality：WebP 质量
 */
export function exportSeed({ minMs = 0, quality = 0.92, normalQuality = 0.9 } = {}) {
  const out = [];
  for (const e of seedLog) {
    if (e.ms < minMs) continue;
    for (const [part, canvas] of Object.entries(e.parts)) {
      if (!canvas || typeof canvas.toDataURL !== 'function') continue;
      // 法线图无损 WebP 一张 1024² 要 2.1 MB（噪声数据压不动），有损 0.9 约 300 KB、肉眼看不出；quality 1 = 无损，想要就传 normalQuality 1
      const q = /normal|bump|height|rough/i.test(part) ? normalQuality : quality;
      out.push({ k: e.key + '#' + part, w: canvas.width, h: canvas.height, ms: +e.ms.toFixed(1), data: canvas.toDataURL('image/webp', q) });
    }
  }
  return out;
}

/**
 * 包一层：命中返回 { part → ImageBitmap }，未命中执行 fn() 得到 { part → HTMLCanvasElement } 并排队入库。
 * @param {string} name 生成器名 @param {object} params 影响结果的全部参数 @param {Function[]} srcFns 参与哈希的函数（生成器本身 + 用到的噪声函数）
 */
export function cached(name, params, srcFns, fn, requiredParts = ['map']) {
  const prefix = name + '|' + JSON.stringify(params);
  const key = prefix + '|' + hashStr(srcFns.map((f) => f.toString()).join('\n') + CACHE_VERSION);
  const hit = bitmaps.get(key);
  // Individual cache records may finish writing or decoding at different times.
  // A multi-part texture is reusable only when every required image is present.
  if (hit && requiredParts.every(part => hit[part] && hit[part].width > 0 && hit[part].height > 0 && hit[part].complete !== false)) {
    stats.hits++;
    // 命中的 ImageBitmap 先画回一张 Canvas 再交给 three.js：three 上传 ImageBitmap 时不设 UNPACK_FLIP_Y / PREMULTIPLY_ALPHA
    // （沿用上一次上传留下的 GL 状态），直接用会随上传顺序时而正、时而上下颠倒；画回 Canvas 后与现场生成走完全相同的路径。
    // 1024² 一次 drawImage 约 1–3 ms，相对逐像素生成的 200–300 ms 可以忽略。
    const out = {};
    for (const [part, img] of Object.entries(hit)) {
      if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        img.close();
        hit[part] = c;
      }
      out[part] = hit[part];
    }
    return out;
  }
  stats.misses++;
  const t0 = performance.now();
  const parts = fn();
  // Repair an incomplete in-memory group without sharing the pending-write object.
  if (hit) bitmaps.set(key, { ...parts });
  seedLog.push({ key, parts, ms: performance.now() - t0 });
  if (enabled) pending.push({ key, prefix, parts });
  return parts;
}

/**
 * 就绪之后由 main.js 调：把排队的 Canvas 编成无损 WebP 存进库（逐张、让出主线程）。
 * 旧版本条目不按前缀主动删（http 开发路与 file:// 离线包的函数源码不同、哈希不同，两套并存才不会互相冲掉），只靠 load() 的数量上限淘汰。
 */
export async function flush(beforeEach = async () => {}, allowedImages = null) {
  if (!enabled || !pending.length) return stats;
  const jobs = pending.splice(0);
  const selected=allowedImages?jobs.filter(job=>Object.values(job.parts).some(image=>allowedImages.has(image))):jobs;
  if(allowedImages)pending.push(...jobs.filter(job=>!selected.includes(job)));
  // 编码格式（2026-10-07 实测改）：Chromium 的 toBlob('image/png') 只在主线程空闲期编码，渲染循环一直跑就没有空闲期，
  // 等满 1 s 后在主线程一次性同步编完（canvas_async_blob_creator IdleTaskStartTimeoutEvent，1024² 一张 40–60 ms），
  // 冷缓存进秘密基地后约 65 s 里每 1.2 s 卡一下。WebP 在线程池编码；quality 1 = 无损，读回仍走 createImageBitmap，
  // 旧 PNG 条目照样能读。不支持 WebP 编码的浏览器 toBlob 自动退回 PNG。
  // 以前用 requestIdleCallback({ timeout: 2000 }) + 250 ms 间隔：渲染循环一直跑、高刷屏上根本没有「空闲期」，rIC 每次都等满 2 s 超时，
  // 实测每张 2–4 s、一次 45 s 的会话只入库 10–15 张，回头客要来 3–4 次缓存才全热（P-004 剖面）。
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const job of selected) {
    for (const [part, canvas] of Object.entries(job.parts)) {
      if (!canvas || typeof canvas.toBlob !== 'function') continue;
      await pause(60);
      await beforeEach();
      try {
        const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/webp', 1));
        await tx('readwrite', (s) => { s.put({ blob, t: Date.now(), w: canvas.width, h: canvas.height }, job.key + '#' + part); });
        stats.stored++;
      } catch (e) { enabled = false; return stats; } // 配额满 / 被禁：本次放弃，下次启动再试
    }
  }
  return stats;
}

export const texCacheStats = () => ({ ...stats, enabled, entries: bitmaps.size, pending: pending.length });

/** 清空（菜单 / 调试用；下次启动重新生成） */
export async function clear() {
  try { if (!db) db = await openDb(); await tx('readwrite', (s) => { s.clear(); }); bitmaps.clear(); } catch (e) { /* 忽略 */ }
}
