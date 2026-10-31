// 画质与守门：设备检测 → 默认档；fps 连续 3 s < 30 → 自动降一档；pixelRatio ≤ 1.5；prefers-reduced-motion。
import { STORAGE } from '../config.js';

export const LEVELS = ['low', 'medium', 'high'];

// 三档只调「不换 shader 变体」的项：pixelRatio、Bloom 开关与工作分辩率（bloomScale 1 = 视口一半，0.5 = 四分之一）、
// 阴影贴图尺寸、投影体集合（ship.setQuality：低画质只让大件投影）、星点比例。
// 不再切阴影开关 / 点光数量 / 直渲 vs 后处理链：这三样都会换 shader defines，切一次 = 全场景重编 ~60 个程序、
// 冻结 1 s 以上（P-001 实测 1.32 s），而自动降档恰恰发生在机器已经卡的时候。点光数量由 lights.js / skills.js 固定为 9 盏。
// antialias 只在创建 WebGLRenderer 时读一次（创建后不可改），运行时切档不生效。
export const PRESETS = {
  high: { pixelRatio: 1.5, bloom: true, bloomScale: 1, shadowMap: 2048, stars: 1.0, antialias: true },
  medium: { pixelRatio: 1.0, bloom: true, bloomScale: 0.5, shadowMap: 1024, stars: 0.65, antialias: true },
  low: { pixelRatio: 1.0, bloom: false, bloomScale: 0.5, shadowMap: 512, stars: 0.5, antialias: false },
};

const GPU_CACHE_KEY = 'k3-3d-gpu', GPU_CACHE_TTL = 7 * 86400e3;
const classifyGPU = (renderer) => {
  const r = renderer.toLowerCase();
  const integrated = /intel|uhd|iris|hd graphics|mali|adreno|apple gpu|powervr|swiftshader|llvmpipe|mesa|radeon\(tm\) graphics|vega [0-9]/.test(r) && !/rtx|gtx|radeon rx|arc a/.test(r);
  const software = /swiftshader|llvmpipe|softpipe/.test(r);
  return { ok: true, renderer, integrated, software };
};

/** 用 WEBGL_debug_renderer_info 猜显卡。结果按 UA 存 localStorage 7 天：新建一个一次性 WebGL 上下文在浏览器刚启动时要 80–90 ms（P-004 剖面），双击离线包时浏览器往往就是刚启动的 */
export function detectGPU() {
  try {
    const c = JSON.parse(localStorage.getItem(GPU_CACHE_KEY));
    if (c && typeof c.renderer === 'string' && c.renderer && c.ua === navigator.userAgent && Date.now() - (c.t || 0) < GPU_CACHE_TTL) return classifyGPU(c.renderer);
  } catch (e) { /* 无 localStorage / 坏条目：照常探测 */ }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { ok: false, renderer: '', integrated: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); // 别让这个探测用的上下文占着名额等 GC
    try { localStorage.setItem(GPU_CACHE_KEY, JSON.stringify({ renderer, ua: navigator.userAgent, t: Date.now() })); } catch (e) { /* 忽略 */ }
    return classifyGPU(renderer);
  } catch (e) { return { ok: false, renderer: '', integrated: true }; }
}

export function defaultLevel(gpu) {
  const saved = (() => { try { return localStorage.getItem(STORAGE.quality); } catch (e) { return null; } })();
  if (saved && LEVELS.includes(saved)) return saved;
  if (gpu.software) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if (gpu.integrated || cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}

export function saveLevel(level) { try { localStorage.setItem(STORAGE.quality, level); } catch (e) { /* 忽略 */ } }

/** fps 守门：稳态下连续 lowSeconds 秒、窗口平均 fps < threshold → 回调一次（然后重新计时）。
 *  窗口在 acc >= 0.5 时结算：把这一窗的 acc 整段加入 lowAcc，再把 acc 清零。长于半秒的低帧不再只记 0.5 秒。
 *  场景暂停、切层/预热、失焦或隐藏不是稳态。setSteady(false) 清掉未完成的低帧并不再累计；
 *  回到稳态时重开窗口，并丢掉恢复后的第一帧（这一帧常常是整段间隔挤在一起）。
 *  稳态里连续低帧仍降档。单次恢复长间隔不记入。 */
export class FpsGuard {
  constructor({ threshold = 30, lowSeconds = 3, onLow } = {}) {
    this.threshold = threshold; this.lowSeconds = lowSeconds; this.onLow = onLow;
    this.frames = 0; this.acc = 0; this.fps = 60; this.lowAcc = 0; this.history = [];
    this.cooldown = 0;
    this.steady = true;
    this._skipFrame = false;
  }
  setSteady(steady) {
    steady = !!steady;
    if (steady === this.steady) return;
    this.steady = steady;
    this.frames = 0; this.acc = 0; this.lowAcc = 0;
    this._skipFrame = steady;
  }
  tick(dt) {
    if (!this.steady || this._skipFrame) { this._skipFrame = false; return; }
    this.frames++; this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.history.push(this.fps); if (this.history.length > 120) this.history.shift();
      const windowSec = this.acc;
      this.frames = 0; this.acc = 0;
      if (this.cooldown > 0) { this.cooldown = Math.max(0, this.cooldown - windowSec); return; }
      if (this.fps < this.threshold) { this.lowAcc += windowSec; if (this.lowAcc >= this.lowSeconds) { this.lowAcc = 0; this.cooldown = 8; this.onLow && this.onLow(this.fps); } }
      else this.lowAcc = 0;
    }
  }
}

// Recent rendered-frame intervals, independent of automatic quality policy.
// Fixed storage; one sort per published snapshot, never per frame. No upper
// clamp: a foreground stall is a real sample. Pause/reset drops only the first
// interval on resume, which otherwise includes time the scene was not running.
export class FrameIntervalWindow {
  constructor(capacity = 600) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new RangeError('frame capacity');
    this.capacity = capacity; this.values = new Float64Array(capacity); this.sorted = new Float64Array(capacity); this.reset();
  }
  reset() { this.count = 0; this.head = 0; this.sum = 0; this.slow = 0; this.elapsed = 0; this.armed = false; }
  tick(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) { this.reset(); return false; }
    if (!this.armed) { this.armed = true; return false; }
    const ms = seconds * 1000;
    if (!Number.isFinite(ms)) { this.reset(); return false; }
    if (this.count === this.capacity) { const old = this.values[this.head]; this.sum -= old; if (old > 50) this.slow--; }
    else this.count++;
    this.values[this.head] = ms; this.head = (this.head + 1) % this.capacity;
    this.sum += ms; if (ms > 50) this.slow++;
    this.elapsed += seconds;
    if (this.elapsed < 0.5) return false;
    this.elapsed = 0; return true;
  }
  snapshot() {
    if (!this.count) return null;
    const n = this.count, sorted = this.sorted.subarray(0, n);
    sorted.set(this.values.subarray(0, n)); sorted.sort();
    return { count: n, seconds: this.sum / 1000, p95: sorted[Math.ceil(n * .95) - 1], p99: sorted[Math.ceil(n * .99) - 1], max: sorted[n - 1], slow: this.slow };
  }
}

// Opt-in diagnostic costs. These are separate from RAF intervals and quality
// policy: synchronous CPU sections and asynchronous GPU work can overlap.
class RenderCostWindow {
  constructor(capacity) { this.values=new Float64Array(capacity);this.sorted=new Float64Array(capacity);this.reset(); }
  reset() { this.count=0;this.head=0; }
  push(ms) {
    if(!Number.isFinite(ms)||ms<0)return;
    this.values[this.head]=ms;this.head=(this.head+1)%this.values.length;
    this.count=Math.min(this.count+1,this.values.length);
  }
  snapshot() {
    if(!this.count)return null;
    const n=this.count,s=this.sorted.subarray(0,n);s.set(this.values.subarray(0,n));s.sort();
    return {count:n,p95:s[Math.ceil(n*.95)-1],p99:s[Math.ceil(n*.99)-1],max:s[n-1]};
  }
}

export class RenderCostProbe {
  constructor({getContext,clock=()=>performance.now(),capacity=120,maxQueries=6}={}) {
    if(typeof getContext!=='function'||!Number.isInteger(capacity)||capacity<1||capacity>600||!Number.isInteger(maxQueries)||maxQueries<1||maxQueries>8)throw new RangeError('render cost configuration');
    this.getContext=getContext;this.clock=clock;
    this.cpuUpdate=new RenderCostWindow(capacity);this.cpuDraw=new RenderCostWindow(capacity);this.gpu=new RenderCostWindow(capacity);
    this.slots=Array.from({length:maxQueries},()=>({query:null,pending:false}));
    this.gl=null;this.ext=null;this.gpuChecked=false;this.activeQuery=-1;
    this.enabled=false;this.frame=false;this.context='';this.elapsed=0;
    this.gpuState='idle';this.gpuSkipped=0;this.gpuDisjoint=0;
  }
  _clearQueries(lost=false) {
    const gl=this.gl;
    if(gl&&!lost){
      try {
        if(!gl.isContextLost()){
          if(this.activeQuery>=0)gl.endQuery(this.ext.TIME_ELAPSED_EXT);
          for(const slot of this.slots)if(slot.query)gl.deleteQuery(slot.query);
        }
      }catch(_){/* Diagnostics must never interrupt scene cleanup. */}
    }
    this.activeQuery=-1;
    for(const slot of this.slots){slot.query=null;slot.pending=false;}
  }
  reset({lost=false}={}) {
    this._clearQueries(lost);this.cpuUpdate.reset();this.cpuDraw.reset();this.gpu.reset();
    this.gl=null;this.ext=null;this.gpuChecked=false;this.enabled=false;this.frame=false;
    this.context='';this.elapsed=0;this.gpuState=lost?'lost':'idle';this.gpuSkipped=0;this.gpuDisjoint=0;
  }
  _failGPU(state='error') {
    this._clearQueries(state==='lost');this.ext=null;this.gpuChecked=true;this.gpu.reset();this.gpuState=state;
  }
  _prepareGPU() {
    this.skipGPUFrame=false;
    try {
      if(!this.gpuChecked){
        this.gpuChecked=true;this.gl=this.getContext();
        if(!this.gl||typeof this.gl.createQuery!=='function'){this.gpuState='unsupported';return;}
        if(this.gl.isContextLost()){this._failGPU('lost');return;}
        this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if(!this.ext||this.gl.getQuery(this.ext.TIME_ELAPSED_EXT,this.ext.QUERY_COUNTER_BITS_EXT)<=0){this.ext=null;this.gpuState='unsupported';return;}
        this.gpuState='pending';
      }
      if(!this.ext)return;
      const gl=this.gl;
      if(gl.isContextLost()){this._failGPU('lost');return;}
      if(gl.getParameter(this.ext.GPU_DISJOINT_EXT)){
        this._clearQueries();this.gpu.reset();this.gpuDisjoint++;this.gpuState='disjoint';this.skipGPUFrame=true;return;
      }
      // Only prior-frame queries can be pending here. Never request a result
      // before availability, spin, flush, or wait for the GPU.
      for(const slot of this.slots){
        if(!slot.pending||!gl.getQueryParameter(slot.query,gl.QUERY_RESULT_AVAILABLE))continue;
        const ns=gl.getQueryParameter(slot.query,gl.QUERY_RESULT);
        slot.pending=false;
        if(Number.isSafeInteger(ns)&&ns>=0){this.gpu.push(ns/1e6);this.gpuState='ready';}
        else {this.gpuSkipped++;this.gpuState='invalid';}
      }
    }catch(_){this._failGPU();}
  }
  beginFrame(enabled,context='') {
    if(!enabled){if(this.enabled)this.reset();return false;}
    const restarted=!this.enabled||context!==this.context;
    if(restarted){this.reset();this.enabled=true;this.context=context;}
    this._prepareGPU();this.frame=true;this.renderStarted=false;this.renderEnded=false;
    this.started=this.clock();return restarted;
  }
  beginRender() {
    if(!this.frame)return;
    this.renderStart=this.clock();this.updateMs=this.renderStart-this.started;this.renderStarted=true;
  }
  beginGPU() {
    if(!this.frame||!this.ext||this.skipGPUFrame||this.activeQuery>=0)return;
    try {
      const gl=this.gl;
      // Do not nest inside another profiler's query or end/delete its object.
      if(gl.getQuery(this.ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){this.gpuSkipped++;this.gpuState='busy';return;}
      const index=this.slots.findIndex(slot=>!slot.pending);
      if(index<0){this.gpuSkipped++;this.gpuState='pending';return;}
      const slot=this.slots[index];
      if(!slot.query)slot.query=gl.createQuery();
      if(!slot.query){this._failGPU();return;}
      gl.beginQuery(this.ext.TIME_ELAPSED_EXT,slot.query);this.activeQuery=index;
    }catch(_){this._failGPU();}
  }
  endGPU() {
    if(this.activeQuery<0)return;
    try {
      const index=this.activeQuery;
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.activeQuery=-1;this.slots[index].pending=true;
    }catch(_){this._failGPU();}
  }
  endRender() {
    if(!this.frame||!this.renderStarted)return;
    this.drawMs=this.clock()-this.renderStart;this.renderEnded=true;
  }
  finishFrame(seconds,context) {
    if(!this.frame)return null;
    this.frame=false;
    if(context!==this.context){this.reset();return null;}
    if(!this.renderEnded||!Number.isFinite(seconds)||seconds<=0)return null;
    this.cpuUpdate.push(this.updateMs);this.cpuDraw.push(this.drawMs);
    this.elapsed+=seconds;
    if(this.elapsed<.5)return null;
    this.elapsed=0;
    return {cpuUpdate:this.cpuUpdate.snapshot(),cpuDraw:this.cpuDraw.snapshot(),gpu:this.gpu.snapshot(),gpuState:this.gpuState,gpuSkipped:this.gpuSkipped,gpuDisjoint:this.gpuDisjoint};
  }
}


export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
