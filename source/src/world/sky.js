// 星海：12k 星点三层（一个 Points，自定义 shader 画软圆）+ 银河球（程序 fbm 纹理）+ 星云广告牌 + 流星 + 雾。
// 星点相对船向 +Z 漂 0.3 m/s（船在向 −Z 走）；prefers-reduced-motion 下停止漂移与自转。
import * as THREE from 'three';
import { COLORS } from '../config.js';
import { galaxy as galaxyTex, nebula as nebulaTex, nebulaSwirl as nebulaSwirlTex, planetTexture as planetTex, meteorStreak } from './textures.js';
import { rng, lerp, damp } from '../util/easing.js';

const STAR_COUNT = 12000;
const _dir = new THREE.Vector3(), _toCam = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(), _mtx = new THREE.Matrix4();
const LAYERS = [
  { count: 4600, radius: 80, box: true, drift: 0.3, size: [0.35, 1.3], band: 0.0 },
  { count: 3800, radius: 200, box: false, drift: 0.08, size: [0.9, 2.6], band: 0.45 },
  { count: 3600, radius: 600, box: false, drift: 0.0, size: [2.4, 7.0], band: 0.7 },
];
// 光谱色（O/B 蓝白 → M 橙红）+ 两种与主题一致的「魔法色」；权重偏暖白，少量蓝、更少量红巨星
const SPECTRA = [
  // D-075：按门户 hero-painting 偏冷——蓝白 / 白为主，暖色少量点缀
  { c: 0x9bb0ff, w: 0.2, boost: 1.15 },  // 蓝白
  { c: 0xcad7ff, w: 0.24, boost: 1.05 }, // 白
  { c: 0xfff4e8, w: 0.26, boost: 1.0 },  // 暖白
  { c: 0xffe4b8, w: 0.12, boost: 0.95 }, // 黄
  { c: 0xffc98a, w: 0.05, boost: 0.9 },  // 橙
  { c: 0xff9a6a, w: 0.02, boost: 0.85 }, // 红橙（红巨星）
  { c: 0x6fd6ff, w: 0.08, boost: 1.1 },  // 青蓝
  { c: 0xf6dfa4, w: 0.03, boost: 1.1 },  // 金
];
const GALAXY_TILT = 24 * Math.PI / 180;

const STAR_VERT = /* glsl */`
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aLayer;
  attribute float aTwinkle;
  uniform float uTime;
  uniform float uDrift;      // 累计漂移米数
  uniform float uBoost;      // 宇宙视角放大星点
  uniform float uInnerFade;  // 相机拉远时内层星点淡出（否则远看像一团包着船的星泡）
  uniform float uInsideFade; // X 收尾 09-09：人在地下三层时内层星盒淡掉（80 m 盒子穿过 y −40…−120，星点贴着相机成大白方块 = S 09-08 19:25 报的「雪花」）
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFlare;
  void main() {
    vec3 p = position;
    float layerFade = 1.0;
    if (aLayer < 0.5) {
      // 内层：在 z 方向回卷（盒子 ±90）
      p.z = mod(p.z + uDrift + 90.0, 180.0) - 90.0;
      layerFade = uInnerFade * uInsideFade;
    } else if (aLayer < 1.5) {
      p.z = mod(p.z + uDrift * 0.27 + 220.0, 440.0) - 220.0;
      layerFade = 0.5 + 0.5 * uInnerFade;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 0.75 + 0.25 * sin(uTime * (0.8 + aTwinkle * 1.7) + aTwinkle * 40.0);
    vAlpha = tw * layerFade;
    vColor = aColor;
    float dist = -mv.z;
    float s = aSize * uBoost * uPixelRatio * 220.0 / max(dist, 1.0);
    gl_PointSize = clamp(s, 1.0, 22.0 * uPixelRatio);
    vFlare = smoothstep(7.0 * uPixelRatio, 16.0 * uPixelRatio, gl_PointSize); // 只有大星有十字光芒
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFlare;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    core = pow(core, 1.8);
    float halo = smoothstep(1.0, 0.35, d) * 0.25;
    float cross = (pow(max(0.0, 1.0 - abs(uv.x) * 2.0), 10.0) + pow(max(0.0, 1.0 - abs(uv.y) * 2.0), 10.0)) * smoothstep(1.0, 0.2, d) * 0.35 * vFlare;
    float a = core + halo + cross;
    gl_FragColor = vec4(vColor * a, a * vAlpha);
  }`;

export class Sky {
  constructor(scene, { reducedMotion = false } = {}) {
    this.scene = scene;
    this.reducedMotion = reducedMotion;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.drift = 0;
    this.time = 0;
    this.meteors = [];
    this.nextMeteor = 6;
    scene.add(this.group);
    scene.fog = new THREE.FogExp2(COLORS.night, 0.0035);
    scene.background = new THREE.Color(COLORS.deep);
    this._buildStars();
    this._buildGalaxy();
    this._buildNebulae();
    this._buildPlanets();
    this._buildMeteorPool();
  }

  /**
   * D-075 · H-2 彩色星球：三颗低面数球（程序条带贴图）+ 大气边缘壳 + 一颗带环；放在 560–640 m（宇宙相机最远 520 m 之外、
   * 星空球 700 m 之内），fog:false 所以甲板上抬头也看得见；太阳方向光给出明暗界线，暗面靠自发光不死黑。颜色贴着基准图：冰蓝、靛青、暖金。
   */
  _buildPlanets() {
    this.planets = [];
    const defs = [
      // 冰蓝气态巨行星 + 环（左上，最大最显眼）
      { pos: [-470, 260, -220], r: 34, seed: 3, bands: 11, storm: 0.9, palette: [[16, 36, 92], [78, 130, 200], [190, 215, 245], [240, 246, 255]], ring: { inner: 1.35, outer: 2.2, tilt: 0.42, color: [170, 200, 240] }, atmo: 0x7fb4ff, spin: 0.02 },
      // 靛青条带巨行星（右后，中）
      { pos: [420, 120, 480], r: 24, seed: 5, bands: 8, storm: 0, palette: [[10, 30, 60], [30, 100, 130], [100, 190, 200], [200, 240, 240]], atmo: 0x5ad0d8, spin: -0.015 },
      // 暖金赭红岩石小行星（正前上方偏右，画里那一点暖色）
      { pos: [160, 300, -520], r: 13, seed: 8, bands: 6, storm: 0.5, palette: [[60, 30, 16], [150, 90, 40], [220, 170, 100], [250, 220, 160]], atmo: 0xe0b070, spin: 0.03 },
    ];
    for (const d of defs) {
      const g = new THREE.Group();
      g.position.set(...d.pos);
      const pmap = planetTex({ seed: d.seed, palette: d.palette, bands: d.bands, storm: d.storm });
      // 暗面用同一张贴图当自发光（乘 0.55），条带在阴影里也看得见；亮面由太阳方向光打出明暗界线
      const mat = new THREE.MeshStandardMaterial({ map: pmap, emissiveMap: pmap, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.55, roughness: 1, metalness: 0, fog: false });
      const body = new THREE.Mesh(new THREE.SphereGeometry(d.r, 40, 26), mat);
      body.rotation.z = 0.3;
      g.add(body);
      // 大气：略大的背面壳，加法混合，边缘亮中心透明的效果用 onBeforeCompile 按视线夹角算
      const atmoMat = new THREE.MeshBasicMaterial({ color: d.atmo, transparent: true, opacity: 0.35, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(d.r * 1.06, 32, 20), atmoMat);
      g.add(atmo);
      if (d.ring) {
        const rg = new THREE.RingGeometry(d.r * d.ring.inner, d.r * d.ring.outer, 96, 6);
        // 环的透明度按半径分几道
        const pos = rg.attributes.position, col = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const rr = Math.hypot(pos.getX(i), pos.getY(i)) / d.r;
          const k = (rr - d.ring.inner) / (d.ring.outer - d.ring.inner);
          const a = (0.5 + 0.5 * Math.sin(k * Math.PI * 7)) * (0.55 + 0.45 * Math.sin(k * Math.PI)) ;
          col[i * 3] = d.ring.color[0] / 255 * a; col[i * 3 + 1] = d.ring.color[1] / 255 * a; col[i * 3 + 2] = d.ring.color[2] / 255 * a;
        }
        rg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        ring.rotation.x = Math.PI / 2 + d.ring.tilt; ring.rotation.y = 0.3;
        g.add(ring);
      }
      this.group.add(g);
      this.planets.push({ g, body, spin: d.spin });
    }
  }

  _pickSpectrum(R) {
    let t = R();
    for (const s of SPECTRA) { t -= s.w; if (t <= 0) return s; }
    return SPECTRA[2];
  }

  // 高斯随机（Box–Muller）
  _gauss(R) { const u = Math.max(1e-6, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  _buildStars() {
    const R = rng(2026);
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const layer = new Float32Array(STAR_COUNT);
    const twinkle = new Float32Array(STAR_COUNT);
    const tmp = new THREE.Color();
    let i = 0;
    for (let L = 0; L < LAYERS.length; L++) {
      const cfg = LAYERS[L];
      for (let k = 0; k < cfg.count && i < STAR_COUNT; k++, i++) {
        let x, y, z, inBand = false;
        if (cfg.box) {
          // 盒子分布，避开船体附近
          do { x = (R() * 2 - 1) * 90; y = (R() * 2 - 1) * 90; z = (R() * 2 - 1) * 90; }
          while (Math.abs(x) < 12 && y > -6 && y < 30 && Math.abs(z) < 40);
        } else {
          const phi = R() * Math.PI * 2;
          let lat;
          if (R() < cfg.band) {
            // 银河带：中心线是绕天球的一条斜带（与银河球纹理同样 24° 倾角），带内高斯散布 → 远看是一条密集的光带
            inBand = true;
            lat = Math.sin(phi) * GALAXY_TILT * 1.2 + this._gauss(R) * 0.11;
          } else {
            lat = Math.asin(R() * 2 - 1);
          }
          const r = cfg.radius * (0.85 + R() * 0.3);
          x = r * Math.cos(lat) * Math.cos(phi); y = r * Math.sin(lat); z = r * Math.cos(lat) * Math.sin(phi);
        }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        // 颜色：按光谱权重抽；带内更偏蓝白（年轻恒星）
        let s = this._pickSpectrum(R);
        if (inBand && R() < 0.3) s = SPECTRA[R() < 0.5 ? 0 : 1];
        tmp.set(s.c);
        // 亮度：多数暗、少数亮；2% 是「主星」——更大更亮
        const hero = R() < 0.02;
        const b = (hero ? 1.35 : 0.5 + Math.pow(R(), 1.6) * 0.6) * s.boost;
        col[i * 3] = tmp.r * b; col[i * 3 + 1] = tmp.g * b; col[i * 3 + 2] = tmp.b * b;
        // 大小：重尾分布（少数大星），主星 ×2.4
        const sz = lerp(cfg.size[0], cfg.size[1], Math.pow(R(), 2.6));
        size[i] = hero ? sz * 2.4 + cfg.size[1] * 0.5 : sz;
        layer[i] = L;
        twinkle[i] = R();
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));
    this.starUniforms = {
      uTime: { value: 0 }, uDrift: { value: 0 }, uBoost: { value: 1 }, uInnerFade: { value: 1 }, uInsideFade: { value: 1 }, uPixelRatio: { value: Math.min(devicePixelRatio || 1, 1.5) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    this.group.add(this.stars);
    this.fullStarCount = STAR_COUNT;
    this.starMat = mat;
    this._buildSpiralGalaxy(R);
  }

  /** 远处一座螺旋银河：对数螺旋双主臂 + 两条弱臂 + 球状核心，约 8000 点，斜着挂在天球上 */
  _buildSpiralGalaxy(R) {
    const N = 8000, ARMS = 4;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), layer = new Float32Array(N), tw = new Float32Array(N);
    const core = new THREE.Color(0xffe6b8), coreHot = new THREE.Color(0xfff6e0), arm = new THREE.Color(0xa9c4ff), armWhite = new THREE.Color(0xe8eeff);
    const pink = new THREE.Color(0xd58dbf), teal = new THREE.Color(0x87bbae), gold = new THREE.Color(0xf6dfa4);
    const tmp = new THREE.Color();
    const RAD = 150; // 半径（米）
    for (let i = 0; i < N; i++) {
      let x, y, z, c, b, s;
      if (i < N * 0.16) {
        // 核球：三维高斯
        const r = Math.abs(this._gauss(R)) * RAD * 0.09;
        const a = R() * Math.PI * 2, e = (R() * 2 - 1) * 0.55;
        x = r * Math.cos(a); z = r * Math.sin(a); y = r * e * 0.6;
        c = tmp.copy(core).lerp(coreHot, Math.max(0, 1 - r / (RAD * 0.08))); b = 0.7 + R() * 0.6; s = 3 + R() * 6;
      } else {
        // 旋臂：对数螺旋 r = a·e^{bθ}，臂宽随半径增大；主臂 0/2 亮、副臂 1/3 稀
        const k = i % ARMS;
        const major = k % 2 === 0;
        if (!major && R() < 0.55) { i--; continue; }
        const t = 0.08 + 0.92 * Math.pow(R(), 0.85);     // 0 核 → 1 边缘（臂从核外一点开始，留出暗隙）
        const theta = t * Math.PI * 2.6 + k * Math.PI / 2;
        const r = RAD * (0.06 + 0.94 * t);
        const spread = (0.028 + 0.075 * t) * RAD;
        const off = this._gauss(R) * spread;
        const ang = theta + off / Math.max(r, 1) * 0.5;
        const rr = r + this._gauss(R) * spread * 0.6;
        x = rr * Math.cos(ang); z = rr * Math.sin(ang);
        y = this._gauss(R) * (2 + 4 * t);
        const q = R();
        if (q < 0.08) c = tmp.copy(pink);
        else if (q < 0.13) c = tmp.copy(teal);
        else if (q < 0.17) c = tmp.copy(gold);
        else c = tmp.copy(arm).lerp(armWhite, R());
        c.lerp(core, Math.max(0, 0.6 - t) * 1.2); // 靠核心处偏暖
        b = 0.35 + Math.pow(R(), 1.8) * 0.75; s = 2.2 + Math.pow(R(), 2.5) * 7;
        if (R() < 0.015) { b *= 1.6; s *= 1.8; } // 亮星团
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
      size[i] = s; layer[i] = 3; tw[i] = R();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(tw, 1));
    this.spiral = new THREE.Points(geo, this.starMat);
    this.spiral.frustumCulled = false;
    this.spiral.renderOrder = -12;
    // 挂在天球右前上方（默认宇宙机位正对的那片天）；父节点负责倾斜，子节点绕自己的盘面法线慢转
    const pivot = new THREE.Group();
    pivot.position.set(400, 170, 360);
    pivot.rotation.set(-1.2, 0.5, 0.35);
    pivot.add(this.spiral);
    this.group.add(pivot);
    // 核心光晕（一张软噪声广告牌）
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebulaTex({ seed: 9, tint: [255, 214, 160], hot: [255, 240, 210], size: 128 }), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.4 }));
    glow.position.copy(pivot.position);
    glow.scale.setScalar(RAD * 0.5);
    glow.renderOrder = -13;
    this.group.add(glow);
    this.spiralGlow = glow;
  }

  _buildGalaxy() {
    const { map } = galaxyTex();
    const geo = new THREE.SphereGeometry(700, 64, 40);
    const mat = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, depthWrite: false });
    this.galaxy = new THREE.Mesh(geo, mat);
    this.galaxy.renderOrder = -20;
    this.galaxy.rotation.z = 0.25;
    this.group.add(this.galaxy);
  }

  _buildNebulae() {
    // D-075：按门户 hero-painting 重排——两团巨大的蓝色丝缕旋涡（左前上、右后上）+ 几团靛蓝 / 青蓝软云 + 一小团暗金尘（银河核附近）
    const defs = [
      { swirl: true, seed: 21, tint: [8, 18, 58], hot: [120, 190, 250], pos: [-430, 170, 60], size: 520, spin: 0.0025 },
      { swirl: true, seed: 22, tint: [6, 14, 46], hot: [100, 170, 245], pos: [300, 230, -400], size: 400, spin: -0.002, sw: 2.2 },
      { swirl: true, seed: 23, tint: [10, 16, 50], hot: [80, 150, 230], pos: [380, -60, 420], size: 300, spin: 0.003, sw: 3.2 },
      { seed: 1, tint: [8, 16, 50], hot: [70, 120, 200], pos: [-260, 120, -420], size: 260, spin: 0.004 },
      { seed: 3, tint: [6, 26, 50], hot: [80, 150, 180], pos: [-420, -60, -200], size: 200, spin: 0.005 },
      { seed: 5, tint: [64, 48, 26], hot: [224, 189, 124], pos: [60, 260, 460], size: 150, spin: 0.003 },
    ];
    this.nebulae = [];
    for (const d of defs) {
      const map = d.swirl ? nebulaSwirlTex({ seed: d.seed, tint: d.tint, hot: d.hot, swirl: d.sw || 2.6 }) : nebulaTex({ seed: d.seed, tint: d.tint, hot: d.hot });
      // 深空要保持"深"：软云只做底色（0.45），旋涡稍亮（0.72）但底色本身很暗，只有丝缕是亮的
      const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: d.swirl ? 0.72 : 0.45 });
      const sp = new THREE.Sprite(mat);
      sp.position.set(d.pos[0], d.pos[1], d.pos[2]);
      sp.scale.setScalar(d.size);
      sp.renderOrder = -15;
      sp.userData = { spin: d.spin, base: d.size, phase: d.seed * 1.7 };
      this.group.add(sp);
      this.nebulae.push(sp);
    }
  }

  _buildMeteorPool() {
    const tex = meteorStreak();
    const geo = new THREE.PlaneGeometry(1, 1);
    this.meteorMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, this.meteorMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.meteors.push({ mesh: m, t: 0, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 1 });
    }
    this._R = rng(99);
  }

  _spawnMeteor() {
    const slot = this.meteors.find((m) => !m.active);
    if (!slot) return;
    const R = this._R;
    const r = 420 + R() * 120;
    const lat = (R() * 0.9 + 0.1) * Math.PI / 2 * (R() < 0.8 ? 1 : -0.4);
    const lon = R() * Math.PI * 2;
    const c = new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
    const dir = new THREE.Vector3(R() - 0.5, -(0.3 + R() * 0.6), R() - 0.5).normalize();
    const len = 60 + R() * 80;
    slot.from.copy(c).addScaledVector(dir, -len / 2);
    slot.to.copy(c).addScaledVector(dir, len / 2);
    slot.dur = 0.8 + R() * 0.5;
    slot.t = 0; slot.active = true;
    slot.mesh.visible = true;
    slot.mesh.scale.set(len * 0.5, 1.6 + R() * 1.2, 1);
  }

  setStarFraction(f) {
    const n = Math.max(1000, Math.floor(this.fullStarCount * f));
    this.stars.geometry.setDrawRange(0, n);
  }

  setPixelRatio(pr) { this.starUniforms.uPixelRatio.value = pr; }

  /**
   * X 收尾（09-09）：人在地下层（levelSystem.inside）时把 80 m 近场星盒淡到 0——它穿过 y −40 / −80 / −120 三层，星点贴着相机成「大白方块」
   *（S 09-08 19:25 报的「天上雪花」，D-α 未处理；N 在 home 是整个藏 sky.group）。只动内层（aLayer 0），中层 / 远层照旧——星轨舱玻璃开顶还要看星。
   * 阻尼 4/s：进出层约 0.6 s 淡进淡出，不跳。
   */
  setInside(inside, dt = 0.016) {
    const u = this.starUniforms.uInsideFade;
    u.value = lerp(u.value, inside ? 0 : 1, damp(4, dt));
  }

  /** t: 0（甲板）→ 1（宇宙视角）；camDist: 相机到船中心的距离 */
  setUniverseBlend(t, camDist = 0) {
    this.starUniforms.uBoost.value = lerp(1.0, 1.9, t);
    // 相机离船 > 60 m 开始淡出内层星点，250 m 时只剩 15%
    const f = 1 - Math.min(1, Math.max(0, (camDist - 60) / 190));
    this.starUniforms.uInnerFade.value = 0.15 + 0.85 * f;
    if (this.scene.fog) this.scene.fog.density = lerp(0.0035, 0.0006, t);
  }

  update(dt, camera) {
    this.time += dt;
    this.starUniforms.uTime.value = this.time;
    if (!this.reducedMotion) {
      this.drift += dt * 0.3;
      this.starUniforms.uDrift.value = this.drift;
      this.galaxy.rotation.y += dt * (Math.PI * 2 / 240);
      if (this.spiral) this.spiral.rotation.y += dt * (Math.PI * 2 / 900);
      for (const sp of this.nebulae) {
        sp.material.rotation += sp.userData.spin * dt;
        sp.scale.setScalar(sp.userData.base * (1 + 0.03 * Math.sin(this.time * 0.15 + sp.userData.phase)));
      }
      for (const p of this.planets) p.body.rotation.y += p.spin * dt;
    }
    // 流星
    this.nextMeteor -= dt;
    if (this.nextMeteor <= 0 && !this.reducedMotion) { this._spawnMeteor(); this.nextMeteor = 8 + this._R() * 12; }
    for (const m of this.meteors) {
      if (!m.active) continue;
      m.t += dt / m.dur;
      if (m.t >= 1) { m.active = false; m.mesh.visible = false; continue; }
      m.mesh.position.lerpVectors(m.from, m.to, m.t);
      // 朝向：面向相机且沿运动方向（复用临时向量）
      _dir.subVectors(m.to, m.from).normalize();
      _toCam.copy(camera.position); m.mesh.parent.worldToLocal(_toCam);
      _toCam.sub(m.mesh.position).normalize();
      _side.crossVectors(_dir, _toCam).normalize();
      _up.crossVectors(_dir, _side);
      _mtx.makeBasis(_dir, _side, _up);
      m.mesh.quaternion.setFromRotationMatrix(_mtx);
      m.mesh.material.opacity = Math.sin(m.t * Math.PI);
    }
  }
}
