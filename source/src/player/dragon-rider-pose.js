// A transport-local pose, not a new character or a change to collision/scale.
// Reuse the existing soft knee/elbow hinges and restore their authored neutral
// geometry on exit. The ordinary chair and private lounge poses stay separate.
import * as THREE from 'three';
export const DRAGON_RIDER_POSE_VERSION = 'dragon-rider-01';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const capture = object => ({ object, p: object.position.clone(), q: object.quaternion.clone() });

// Bound a rigid head part over its authored idle rotation, including extrema
// between the endpoints. This visits box corners, never every vertex per frame.
function rotateBounds(box, axis, low, high = low) {
  if (box.isEmpty()) return box;
  const result = new THREE.Box3(), point = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    const v = [i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z];
    const a = axis === 0 ? 1 : axis === 1 ? 2 : 0, b = (a + 1) % 3;
    const angles = [low, high];
    for (const t of [Math.atan2(-v[b], v[a]), Math.atan2(v[a], v[b])]) {
      for (let k = Math.ceil((low - t) / Math.PI); t + k * Math.PI <= high; k++) angles.push(t + k * Math.PI);
    }
    for (const angle of angles) {
      const values = [...v], c = Math.cos(angle), s = Math.sin(angle);
      values[a] = v[a] * c - v[b] * s; values[b] = v[a] * s + v[b] * c;
      result.expandByPoint(point.fromArray(values));
    }
  }
  return box.copy(result);
}

function seatedHeadHeight(rig, form) {
  const matrix = new THREE.Matrix4();
  const transform = (box, node, rotation, position = node.position) => {
    if (!rotation) return box.applyMatrix4(matrix.compose(position, node.quaternion, node.scale));
    box.applyMatrix4(matrix.makeScale(node.scale.x, node.scale.y, node.scale.z));
    // Euler XYZ applies Z, then Y, then X to a point.
    for (const axis of [2, 1, 0]) rotateBounds(box, axis, ...rotation[axis]);
    return box.translate(position);
  };
  const visit = node => {
    const box = new THREE.Box3();
    if (!node.visible) return box;
    if (node.isMesh && node.geometry?.attributes.position) {
      // Native head morph bounds include the authored facial expression range.
      // The current heads/hood/ears are rigid meshes, not skinned body geometry.
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box.copy(node.geometry.boundingBox);
    }
    for (const child of node.children) box.union(visit(child));
    let rotation;
    if (node === rig.headGroup) return box;
    if (form === 'cat' && [rig.earL, rig.earR, rig.earInL, rig.earInR].includes(node)) {
      rotation = [[-.30, 0], [node.rotation.y], [node.rotation.z]];
    } else if (form === 'awakened' && node === (rig.hairSway || rig.hair)) {
      rotation = [[node.rotation.x], [node.rotation.y], [-.04, .04]];
    }
    return transform(box, node, rotation);
  };
  const head = rig.headGroup, box = visit(head), yaw = Math.max(.025, Math.abs(head.rotation.y));
  box.applyMatrix4(matrix.makeScale(head.scale.x, head.scale.y, head.scale.z));
  rotateBounds(box, 2, form === 'cat' ? 0 : head.rotation.z);
  rotateBounds(box, 1, -yaw, yaw);
  // Combine fixed torso/head rotations before projecting the bound. Reboxing
  // after each opposing rotation would waste usable space above a small rider.
  const unit = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion(), x = new THREE.Vector3(1, 0, 0);
  const pose = new THREE.Matrix4().compose(rig.group.position, rig.group.quaternion, rig.group.scale);
  pose.multiply(matrix.compose(new THREE.Vector3(0, form === 'cat' ? .262 : rig.hipsY - (rig.sitDrop ?? .3), 0), rig.hips.quaternion, rig.hips.scale));
  pose.multiply(matrix.compose(rig.torso.position, q.setFromAxisAngle(x, form === 'cat' ? -.30 : .04), rig.torso.scale));
  pose.multiply(matrix.compose(head.position, q.setFromAxisAngle(x, form === 'cat' ? .20 : -.04), unit));
  box.applyMatrix4(pose);
  return box.isEmpty() ? rig.eyeHeight : Math.max(0, box.max.y);
}

export function createDragonRiderPose(rigs) {
  let active = false, scale = .32, snapshots = [], cloth = [];
  // Open-sea bank/pitch of the dragon, mirrored at the pelvis so the rider
  // leans with the saddle. Zero everywhere else; reset() restores the pose.
  const lean = { roll: 0, pitch: 0 }, leanEuler = new THREE.Euler(), leanQ = new THREE.Quaternion(), authored = new Map();
  function setLean(roll = 0, pitch = 0) { lean.roll = Number.isFinite(roll) ? clamp(roll, -.6, .6) : 0; lean.pitch = Number.isFinite(pitch) ? clamp(pitch, -.4, .4) : 0; }
  function applyLean(rig) {
    const base = authored.get(rig.hips); if (!base) return;
    leanQ.setFromEuler(leanEuler.set(lean.pitch, 0, lean.roll));
    rig.hips.quaternion.copy(base).multiply(leanQ);
  }
  // Calibrate against the actual existing body mesh in its authored seated
  // quadruped pose. Pelvis height is NOT the underside/contact height. This
  // temporary ray target shares resources, never enters a scene or renderer.
  const body = new THREE.Mesh(rigs.cat.body.geometry, rigs.cat.body.material);
  body.scale.copy(rigs.cat.body.scale); body.position.y = .262; body.rotation.x = -.30; body.updateMatrixWorld(true);
  const catSeat = new THREE.Raycaster(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)).intersectObject(body, false)[0].point.y;
  function begin(value) {
    scale = Number.isFinite(value) ? clamp(value, .18, 1.35) : .32;
    if (active) return false;
    for (const rig of Object.values(rigs)) {
      for (const key of ['hips', 'torso', 'legL', 'legR', 'armL', 'armR', 'headGroup', 'staff']) {
        if (rig[key]) snapshots.push(capture(rig[key]));
      }
      if (rig.hips) authored.set(rig.hips, rig.hips.quaternion.clone());
      if (rig.cloak) {
        const g = rig.cloak.geometry;
        cloth.push({ geometry: g, positions: g.attributes.position.array.slice(), normals: g.attributes.normal.array.slice() });
      }
    }
    active = true; return true;
  }
  function reset() {
    if (!active) return false;
    for (const rig of Object.values(rigs)) for (const hinge of rig.restHinges || []) hinge.reset();
    for (const s of snapshots) { s.object.position.copy(s.p); s.object.quaternion.copy(s.q); }
    for (const rig of Object.values(rigs)) rig.gripFollower?.update(rig.staff.quaternion, rig.staff.parent === rig.armR);
    for (const s of cloth) {
      const { position, normal } = s.geometry.attributes;
      position.array.set(s.positions); normal.array.set(s.normals);
      position.needsUpdate = true; normal.needsUpdate = true;
      s.geometry.computeBoundingBox(); s.geometry.computeBoundingSphere();
    }
    snapshots = []; cloth = []; authored.clear(); setLean(0, 0); active = false; return true;
  }
  function seatHeight(rig, form) {
    const hip = form === 'cat' ? catSeat : rig.hipsY - (rig.sitDrop ?? .3);
    return Math.max(0, hip * rig.group.scale.y + rig.group.position.y);
  }
  function apply(rig, form) {
    if (!active) return;
    if (form === 'cat') {
      // A form swap runs after the ordinary cat animation. Seat its new rig on
      // that same frame, rather than showing one frame of the previous torso.
      rig.hips.position.set(0, .262, 0); rig.torso.rotation.set(-.30, 0, 0);
      rig.headGroup.rotation.x = .20; rig.headGroup.rotation.z = 0;
      applyLean(rig);
      return;
    }
    if (!rig.restHinges) return;
    const compact = 1 - clamp((scale - .32) / (.82 - .32), 0, 1);
    const hip = rig.hipsY - (rig.sitDrop ?? .3);
    // Astride rather than both straight boots projecting into the dragon's head.
    // Keep the same saddle/pelvis anchor and the player's global proportions.
    rig.hips.position.set(0, hip, 0);
    applyLean(rig);
    rig.torso.rotation.set(.04, 0, 0);
    rig.headGroup.rotation.x = -.04;
    for (const [index, side] of ['L', 'R'].entries()) {
      const sign = side === 'L' ? 1 : -1;
      rig['leg' + side].rotation.set(-.72 - .12 * compact, 0, sign * (.36 - .08 * compact));
      rig.restHinges[index].set(1.03 + .12 * compact);
      rig['arm' + side].rotation.set(-.20, 0, sign * .17);
      // Right hand still grips the original arm-parented prop: bending only
      // that hand would detach it from the shaft. Keep its elbow neutral.
      rig.restHinges[index + 2].set(index === 1 ? 0 : -.38);
    }
    // The held prop/light remains attached to the original hand.
    rig.gripFollower?.update(rig.staff.quaternion, rig.staff.parent === rig.armR);
    if (!rig.cloak) return;
    const g = rig.cloak.geometry, p = g.attributes.position;
    const bottom = form === 'awakened' ? -.25 : -.22;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y >= -.08) continue;
      const fold = clamp((-.08 - y) / .28, 0, 1);
      // Gather only the lower fabric behind the pelvis, clear of the wing
      // roots and companion. Input is rebuilt each frame by Wanderer.
      p.setXYZ(i, p.getX(i) * (1 - .32 * fold), Math.max(bottom, y),
        p.getZ(i) * (1 - .32 * fold) - .025 * fold);
    }
    p.needsUpdate = true; g.computeVertexNormals();
  }
  return { version: DRAGON_RIDER_POSE_VERSION, get active() { return active; }, get scale() { return scale; }, get lean() { return { ...lean }; }, begin, reset, seatHeight, headHeight: seatedHeadHeight, apply, setLean };
}
