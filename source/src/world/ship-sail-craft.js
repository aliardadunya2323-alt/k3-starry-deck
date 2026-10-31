// Shared cloth finish and tensioned sail surface. Original sigil/emissive atlas stays intact.
// Seven sails share one 512px height map; no added meshes, lights or runtime texture work.
import * as THREE from 'three';

export function finishSailCloth(material, { bumpMap = null } = {}) {
  const source = material.map.image;
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d'), n = canvas.width;
  ctx.drawImage(source, 0, 0);
  const line = (x0, y0, x1, y1, color, width, dashed = false) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dashed ? [n * .0025, n * .0045] : []);
    ctx.beginPath(); ctx.moveTo(x0 * n, y0 * n); ctx.lineTo(x1 * n, y1 * n); ctx.stroke();
  };
  // Broadcloth is sewn in vertical widths. Paired stitches follow each lap seam;
  // low contrast keeps the original star chart legible from a moving deck camera.
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(233,218,187,.035)' : 'rgba(56,46,32,.025)';
    ctx.fillRect(i * n / 7, 0, n / 7, n);
    if (!i) continue;
    const u = i / 7;
    line(u, .018, u, .982, 'rgba(66,53,36,.27)', n * .003);
    for (const d of [-.0038, .0038]) line(u + d, .022, u + d, .978, 'rgba(239,222,185,.50)', n * .0011, true);
  }
  // Folded hems and modest corner doublers are painted onto the existing map,
  // not luminous trim. Clone the canvas so the texture seed cache remains immutable.
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(70,53,33,.28)'; ctx.lineWidth = n * .021;
  ctx.strokeRect(n * .014, n * .014, n * .972, n * .972);
  for (const flipX of [false, true]) for (const flipY of [false, true]) {
    ctx.save(); ctx.translate(flipX ? n : 0, flipY ? n : 0); ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.fillStyle = 'rgba(198,174,132,.30)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(n * .115, 0); ctx.lineTo(0, n * .15); ctx.closePath(); ctx.fill();
    line(.012, .135, .104, .012, 'rgba(69,52,31,.38)', n * .0018, true); ctx.restore();
  }
  for (const q of [.025, .034, .966, .975]) {
    line(q, .023, q, .977, 'rgba(240,218,178,.55)', n * .0012, true);
    line(.023, q, .977, q, 'rgba(240,218,178,.55)', n * .0012, true);
  }
  material.map.image = canvas; material.map.needsUpdate = true;
  material.color.setHex(0xf5e5cb);
  // Height is linear data. The broad seam reads near the mast while the weave
  // disappears naturally into mipmaps in the original wide galaxy view.
  if (bumpMap) { material.bumpMap = bumpMap; material.bumpScale = .065; return material; }
  const height = document.createElement('canvas'); height.width = height.height = 512;
  const hc = height.getContext('2d'); hc.fillStyle = '#808080'; hc.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 4) {
    hc.fillStyle = '#838383'; hc.fillRect(i, 0, 1, 512); hc.fillRect(0, i, 512, 1);
  }
  hc.fillStyle = '#9b9b9b';
  for (let i = 1; i < 7; i++) hc.fillRect(Math.round(i * 512 / 7) - 1, 0, 2, 512);
  hc.strokeStyle = '#a4a4a4'; hc.lineWidth = 4; hc.strokeRect(9, 9, 494, 494);
  material.bumpMap = new THREE.CanvasTexture(height);
  material.bumpMap.wrapS = material.bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  material.bumpMap.anisotropy = 2; material.bumpScale = .065;
  return material;
}

export function createSailGeometry(width, height) {
  const geometry = new THREE.PlaneGeometry(width, height, 28, 16);
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  // Animation can move outside the original flat plane; retain a conservative
  // bound for frustum/shadow culling rather than recomputing it every frame.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -width * .075), Math.hypot(width / 2, height / 2, width * .2));
  return geometry;
}

export function deformSail(sail, time) {
  const pos = sail.geometry.attributes.position;
  const { base, w, h, phase } = sail.userData;
  for (let i = 0; i < pos.count; i++) {
    const x0 = base[i * 3], y0 = base[i * 3 + 1];
    const u = Math.max(0, Math.min(1, x0 / w + .5));
    const v = Math.max(0, Math.min(1, .5 - y0 / h));
    const cross = 4 * u * (1 - u), down = Math.sin(Math.PI * v);
    // Head fixed at the existing yard (sail origin z=-.5, yard z=-.3).
    // Both original lower clews stay put so the existing rigging still meets them.
    const x = x0 * (1 - .035 * down);
    const y = y0 + h * .075 * cross * Math.pow(v, 4);
    const belly = w * cross * (.105 * down + .045 * Math.sin(Math.PI * v / 2));
    const pleat = w * .009 * Math.sin(u * Math.PI * 14 + v * .65) * down * cross * (.25 + .75 * v);
    const flutter = .045 * Math.sin(time * 1.3 + phase + u * 4 + v * 2) * down * cross;
    pos.setXYZ(i, x, y, .2 * (1 - v) - belly - pleat - flutter);
  }
  pos.needsUpdate = true;
  sail.geometry.computeVertexNormals();
}
