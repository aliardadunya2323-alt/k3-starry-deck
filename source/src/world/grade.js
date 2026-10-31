// 08-F.1（V-001）：画面调色 + 常驻极淡晕影，写进 three 自带 OutputPass 那一道本来就有的全屏 shader 里。
// 不加 pass、不加 DOM 层、程序数不变（OutputPass 那一个程序只是多了几行源码）。
//
// 像素顺序：读色 → [晕影：线性空间乘椭圆衰减] → 色调映射（ACES，three 原样）→ sRGB OETF（原样）
//          → [分离调色 + S 曲线 + 饱和，在 sRGB 显示空间做，偏色量以 /255 计，极轻]
// strength = 0 时所有分支都 mix 回原值，逐像素与未打补丁的 OutputPass 一致（?grade=0 做 A/B 对照）。
//
// 主人可在控制台试数：__k3.grade.set({ vig: 0.4, split: 1.5 })；__k3.grade.get() 看当前；__k3.grade.reset()。
import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const GRADE_DEFAULTS = Object.freeze({
  strength: 1,       // 总强度 0–1（0 = 完全关闭）
  vig: 0.14,         // 晕影：角落线性亮度最多衰减到 1 − vig
  vigStart: 0.55,    // 晕影从归一化半径 r 起（屏中心 0、上下边中点 1.0、角落 ≈ 1.36）
  vigEnd: 1.45,
  vigShape: [1.85, 2.0], // 横向略宽的椭圆（16:9 下角落 r ≈ 1.36）
  split: 1,          // 分离调色强度
  // 乘法偏色（黑保持黑，偏色量随亮度缩放，全暗场景不会泛蓝）：各通道乘 1 + split × (shadow × (1−l)⁶ + high × smoothstep(0.06, 0.6, l))
  // (1−l)⁶ 只咬住真正的暗部（夜空 / 阴影，l < 0.15）。高光只微暖，绿通道为 0，纸白 / 石色不再被抬绿、压蓝
  shadow: [-0.14, 0.02, 0.18],    // 暗部往 A0 夜空 / 海军蓝方向：红 −14%、蓝 +18%（夜空 #070a13 → 约 #06 0a 16）
  high: [0.022, 0.0, -0.01],      // 中高光：红 +4%、绿 0、蓝 −2.5%。暖一点，但不把中性白和石色染成黄绿
  contrast: 0.035,    // S 曲线混合量（暗部再沉一点、亮部再亮一点，中间调不动）
  sat: 1.015,         // 饱和度
});

const UNIFORM_DECLS = /* glsl */`
		uniform float uGrade;
		uniform float uVig;
		uniform vec2 uVigRange;
		uniform vec2 uVigShape;
		uniform float uSplit;
		uniform vec3 uShadow;
		uniform vec3 uHigh;
		uniform float uContrast;
		uniform float uSat;
`;

// 色调映射前、线性空间：像镜头边缘失光，暗角自然滚落而不是压黑
const VIGNETTE_BLOCK = /* glsl */`
			{
				vec2 q = ( vUv - 0.5 ) * uVigShape;
				float v = 1.0 - uVig * smoothstep( uVigRange.x, uVigRange.y, length( q ) );
				gl_FragColor.rgb *= mix( 1.0, v, uGrade );
			}
`;

// sRGB 之后、显示空间 0–1：阴影偏冷 / 中高光偏暖（乘法，黑保持黑）→ S 曲线 → 饱和
const GRADE_BLOCK = /* glsl */`
			{
				vec3 c = clamp( gl_FragColor.rgb, 0.0, 1.0 );
				float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
				float ws = ( 1.0 - l ) * ( 1.0 - l ); ws = ws * ws * ws;
				float wh = smoothstep( 0.06, 0.6, l );
				vec3 g = c * ( 1.0 + uSplit * ( uShadow * ws + uHigh * wh ) );
				g = clamp( g, 0.0, 1.0 );
				g = mix( g, g * g * ( 3.0 - 2.0 * g ), uContrast );
				float lg = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
				g = clamp( mix( vec3( lg ), g, uSat ), 0.0, 1.0 );
				gl_FragColor.rgb = mix( gl_FragColor.rgb, g, uGrade );
			}
`;

function patchFragment(src) {
  const readMarker = 'gl_FragColor = texture2D( tDiffuse, vUv );';
  const declMarker = 'uniform sampler2D tDiffuse;';
  if (!src.includes(readMarker) || !src.includes(declMarker) || !/\}\s*$/.test(src)) return null;
  return src
    .replace(declMarker, declMarker + UNIFORM_DECLS)
    .replace(readMarker, readMarker + VIGNETTE_BLOCK)
    .replace(/\}\s*$/, GRADE_BLOCK + '\n\t\t}');
}

export class GradedOutputPass extends OutputPass {
  constructor(opts = {}) {
    super();
    this.isGradedOutputPass = true;
    const u = this.uniforms;
    u.uGrade = { value: 1 };
    u.uVig = { value: 0 };
    u.uVigRange = { value: new THREE.Vector2() };
    u.uVigShape = { value: new THREE.Vector2() };
    u.uSplit = { value: 0 };
    u.uShadow = { value: new THREE.Vector3() };
    u.uHigh = { value: new THREE.Vector3() };
    u.uContrast = { value: 0 };
    u.uSat = { value: 1 };
    const patched = patchFragment(this.material.fragmentShader);
    this.patched = !!patched;
    if (patched) this.material.fragmentShader = patched;
    else console.warn('grade.js：OutputShader 源码与预期不同，调色 / 晕影未生效（画面与原来一致）');
    this.params = { ...GRADE_DEFAULTS };
    this.set(opts);
  }

  /** 局部改参数：set({ vig: 0.4 })；数字非法的键忽略 */
  set(p = {}) {
    const P = this.params;
    for (const k of Object.keys(GRADE_DEFAULTS)) {
      if (p[k] === undefined || p[k] === null) continue;
      if (Array.isArray(GRADE_DEFAULTS[k])) { if (Array.isArray(p[k]) && p[k].length === GRADE_DEFAULTS[k].length && p[k].every(Number.isFinite)) P[k] = p[k].slice(); }
      else if (Number.isFinite(+p[k])) P[k] = +p[k];
    }
    const u = this.uniforms;
    u.uGrade.value = THREE.MathUtils.clamp(P.strength, 0, 1);
    u.uVig.value = THREE.MathUtils.clamp(P.vig, 0, 0.95);
    u.uVigRange.value.set(P.vigStart, Math.max(P.vigEnd, P.vigStart + 1e-3));
    u.uVigShape.value.fromArray(P.vigShape);
    u.uSplit.value = P.split;
    u.uShadow.value.fromArray(P.shadow);
    u.uHigh.value.fromArray(P.high);
    u.uContrast.value = THREE.MathUtils.clamp(P.contrast, 0, 1);
    u.uSat.value = Math.max(0, P.sat);
    return this.get();
  }

  get() { return JSON.parse(JSON.stringify(this.params)); }
  reset() { return this.set(GRADE_DEFAULTS); }

  /** 给 main.js 挂到 __k3.grade 的小句柄（不暴露 pass 本身） */
  get handle() {
    return { set: (p) => this.set(p), get: () => this.get(), reset: () => this.reset(), defaults: GRADE_DEFAULTS, patched: this.patched };
  }
}
