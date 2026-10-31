// Shared benches use the current body, knee hinges and costume bindings.
// Keep the prop in the gripping hand; no new meshes, lights or assets.
import * as THREE from 'three';
import { poseCatPaws, updateCatTail } from './cat-poses.js';
export const BENCH_REST_VERSION = 'bench-contact-02';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const keys = ['hips', 'torso', 'legL', 'legR', 'armL', 'armR', 'headGroup', 'staff'];

export function createBenchRest(rigs) {
  let active = false, blend = 0, top = .48, back = .93, floor = 0, rear = -.285, front = null, supportCat = false, pinCollar = false;
  const saved = new Map(), bootSoles = new Map(), cloth = [], point = new THREE.Vector3(), target = new THREE.Quaternion();
  const euler = new THREE.Euler();
  function reset() {
    if (!active) return false;
    for (const rig of Object.values(rigs)) for (const hinge of rig.restHinges || []) hinge.reset();
    for (const [object, s] of saved) { object.position.copy(s.p); object.quaternion.copy(s.q); }
    for (const s of cloth) {
      s.geometry.attributes.position.array.set(s.p); s.geometry.attributes.normal.array.set(s.n);
      s.geometry.attributes.position.needsUpdate = true; s.geometry.attributes.normal.needsUpdate = true;
      s.geometry.computeBoundingBox(); s.geometry.computeBoundingSphere();
    }
    saved.clear(); bootSoles.clear(); cloth.length = 0; active = false; blend = 0; return true;
  }
  function begin(options = {}) {
    if (active) return false;
    top = Number.isFinite(options.top) ? clamp(options.top, .25, .75) : .48;
    back = Number.isFinite(options.back) ? clamp(options.back, top, 1.2) : .93;
    floor = Number.isFinite(options.floor) ? clamp(options.floor, -.3, .1) : 0;
    rear = Number.isFinite(options.rear) ? clamp(options.rear, -.5, -.25) : -.285;
    supportCat = options.supportCat === true;
    pinCollar = options.pinCollar === true;
    front = Number.isFinite(options.front) ? clamp(options.front, .15, .6) : null;
    for (const rig of Object.values(rigs)) {
      const boot = rig.legL?.getObjectByName('TailoredBoot');
      if (boot) { boot.geometry.computeBoundingBox(); bootSoles.set(rig, boot.geometry.boundingBox.min.y); }
      for (const key of keys) if (rig[key]) saved.set(rig[key], { p: rig[key].position.clone(), q: rig[key].quaternion.clone() });
      if (rig.cloak) { const g = rig.cloak.geometry; cloth.push({ geometry: g, p: g.attributes.position.array.slice(), n: g.attributes.normal.array.slice() }); }
    }
    active = true; blend = 0; return true;
  }
  function turn(object, x, y = 0, z = 0) {
    const s = saved.get(object); if (!s) return;
    target.setFromEuler(euler.set(x, y, z)); object.quaternion.copy(s.q).slerp(target, blend);
  }
  function hipHeight(form) { return top + (form === 'chibi' ? .145 : .16); }
  function apply(rig, form) {
    if (!active) return;
    if (form === 'cat') {
      if (!supportCat || !rig.catLegs) return;
      // Solve the original four paws on their neutral plane, then move the
      // whole quadruped onto the seat. Turning along the board keeps all paws
      // supported even on the shallow garden bench. Reset yaw before solving
      // every frame so still/reduced-motion updates never accumulate a turn.
      rig.hips.quaternion.copy(saved.get(rig.hips).q);
      rig.hips.position.set(0, rig.hips.position.y + (.262 - rig.hips.position.y) * blend, 0);
      rig.torso.rotation.x += (-.30 - rig.torso.rotation.x) * blend;
      rig.headGroup.rotation.x += (.20 - rig.headGroup.rotation.x) * blend;
      poseCatPaws(rig.group, rig.catLegs, { phase: 0, speed: 0, sit: blend });
      for (let i = 0; i < rig.tail.length; i++) {
        const j = rig.tail[i];
        j.rotation.x += (-1.15 + i * .42 - j.rotation.x) * blend;
        j.rotation.z += (.10 * i - j.rotation.z) * blend;
      }
      updateCatTail(rig.tailMesh);
      rig.hips.position.y += top * blend;
      rig.hips.position.z = .02 * blend;
      turn(rig.hips, 0, Math.PI / 2);
      return;
    }
    if (!rig.restHinges) return;
    const small = form === 'chibi', hip = hipHeight(form);
    const kneeY = small ? -.21 : -.38;
    // Keep the adult boot soles level on the ground. The shorter child's legs
    // hang naturally below the bench rather than stretching its proportions.
    const bootHomeY = small ? -.46 : -.82;
    const straightLower = bootHomeY - kneeY + bootSoles.get(rig);
    const cosine = (hip - .08 + straightLower - floor - .005) / -kneeY;
    const thigh = small ? 1.49 : Math.acos(clamp(cosine, -.2, .7));
    // Include the knee bend and current garment's underside in board clearance.
    // Both forms sit toward the front edge while the pelvis remains supported.
    const hipZ = front === null ? .045 : Math.max(.045, small ? front + kneeY * Math.sin(thigh) + .125 : front - .10);
    const s = saved.get(rig.hips);
    rig.hips.position.copy(s.p).lerp(point.set(0, hip, hipZ), blend);
    turn(rig.torso, .015); turn(rig.headGroup, -.055);
    for (const [i, side] of ['L', 'R'].entries()) {
      turn(rig['leg' + side], -thigh);
      rig.restHinges[i].set(thigh * blend);
      turn(rig['arm' + side], i === 0 ? (small ? -.10 : -.28) : -.025, 0, i === 0 ? -.14 : -.11);
      rig.restHinges[i + 2].set(i === 0 ? (small ? -.12 : -.50) * blend : 0);
    }
    turn(rig.staff, .015, 0, -.02);
    if (!rig.cloak) return;
    const geometry = rig.cloak.geometry, p = geometry.attributes.position;
    const c = Math.cos(rig.torso.rotation.x), sLean = Math.sin(rig.torso.rotation.x);
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i);
      const oldY = point.y, oldZ = point.z;
      let y = hip + c * oldY - sLean * oldZ, z = hipZ + sLean * oldY + c * oldZ;
      // The shoulder seam stays attached while the cloth below it folds over
      // the backrest. A tall back must not pull the entire collar backwards.
      const collar = pinCollar && rig.cloakDims ? smooth((rig.cloakDims.yTop - oldY) / .07) : 1;
      const fold = smooth((back + .19 - y) / .20) * collar;
      z = Math.min(z, z * (1 - fold) + Math.min(z, rear) * fold);
      y = Math.max(.055, y);
      const dy = y - hip, dz = z - hipZ;
      p.setXYZ(i, point.x, oldY + (c * dy + sLean * dz - oldY) * blend, oldZ + (-sLean * dy + c * dz - oldZ) * blend);
    }
    p.needsUpdate = true; geometry.computeVertexNormals();
  }
  return { version: BENCH_REST_VERSION, get active() { return active; }, get blend() { return blend; },
    get seatTop() { return top; }, begin, reset, apply,
    setBlend(value) { if (!Number.isFinite(value)) throw new TypeError('Finite bench blend required'); blend = clamp(value, 0, 1); },
    lookDrop(rig, form) { return form === 'cat' ? (rig.sitDrop ?? .3) : Math.max(0, rig.hipsY - hipHeight(form)) * blend; } };
}
