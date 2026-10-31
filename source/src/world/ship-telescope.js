// The original bow observation point: a seated optical assembly on a braced
// timber tripod. Five merged meshes; two untextured materials, no new lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP } from '../config.js';

export function buildShipTelescope(materials) {
  const group = new THREE.Group(); group.name = 'ship-telescope';
  group.position.set(SHIP.telescope.x, 0, SHIP.telescope.z);
  const deck = [], wood = [], brass = [], iron = [], glass = [];
  const up = new THREE.Vector3(0, 1, 0);
  const pivot = new THREE.Vector3(0, 1.73, -.03);
  const axis = new THREE.Vector3(0, Math.sin(.70), -Math.cos(.70));
  const optical = new THREE.Matrix4().compose(pivot,
    new THREE.Quaternion().setFromUnitVectors(up, axis), new THREE.Vector3(1, 1, 1));
  const lathe = (profile, segments = 24) => new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const add = (parts, geometry, matrix) => {
    if (matrix) geometry.applyMatrix4(matrix);
    parts.push(geometry); return geometry;
  };
  const cylinder = (parts, r, height, x, y, z, axisName = 'y', segments = 12) => {
    const g = new THREE.CylinderGeometry(r, r, height, segments);
    if (axisName === 'x') g.rotateZ(-Math.PI / 2);
    if (axisName === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z); return add(parts, g);
  };
  const beam = (parts, a, b, width, depth) => {
    const direction = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.BoxGeometry(width, direction.length(), depth);
    const p = g.attributes.position, uv = g.attributes.uv;
    // Grain runs along each actual leg, without an entire plank sheet squeezed
    // across its narrow face. Reuse the existing dark timber texture unchanged.
    for (let i = 0; i < p.count; i++) uv.setXY(i, 1 / 12 + p.getX(i) / 2.4, p.getY(i) / 2.4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return add(parts, g);
  };
  const ring = (parts, radius, thickness, y, segments = 48) => {
    const g = new THREE.TorusGeometry(radius, thickness, 4, segments);
    g.rotateX(Math.PI / 2); g.translate(0, y, 0); return add(parts, g);
  };

  // Keep the existing 1.30 m outer radius and .25 m top: collision and the
  // original sigil decal at y=.257 continue to share precisely the same datum.
  const dais = lathe([[0, 0], [1.24, 0], [1.30, .04], [1.30, .075],
    [1.235, .11], [1.235, .20], [1.20, .25], [0, .25]], 48);
  const dp = dais.attributes.position, dn = dais.attributes.normal, duv = dais.attributes.uv;
  for (let i = 0; i < dp.count; i++) {
    if (Math.abs(dn.getY(i)) > .65) duv.setXY(i, dp.getX(i) / 2.4, dp.getZ(i) / 2.4);
    else duv.setXY(i, dp.getY(i) / 2.4 + 1 / 12,
      Math.atan2(dp.getX(i), dp.getZ(i)) * 1.235 / 2.4);
  }
  add(deck, dais);
  ring(brass, 1.11, .018, .253);
  ring(brass, 1.236, .012, .132);
  // Four discreet index marks frame the existing star, not a second emblem.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const g = new THREE.BoxGeometry(.027, .006, .085);
    g.translate(0, .254, 1.15); g.rotateY(a); add(brass, g);
  }

  const feet = [], joints = [];
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const foot = new THREE.Vector3(Math.sin(angle) * .78, .265, Math.cos(angle) * .78);
    const joint = new THREE.Vector3(Math.sin(angle) * .12, 1.43, Math.cos(angle) * .12);
    feet.push(foot.toArray()); joints.push(joint.toArray());
    beam(wood, foot, joint, .105, .075);
    // Ferrules cover the ends of each sloped leg and meet the wood, rather
    // than detached ornaments. All feet are seated on the existing platform.
    const low = foot.clone().lerp(joint, .085), high = foot.clone().lerp(joint, .90);
    beam(iron, foot, low, .115, .085); beam(brass, high, joint, .114, .084);
    cylinder(iron, .080, .030, foot.x, .265, foot.z, 'y', 8);
    // A triangular spreader reaches each leg at one common height.
    const braceEnd = foot.clone().lerp(joint, .40);
    const braceStart = new THREE.Vector3(0, braceEnd.y, 0);
    beam(brass, braceStart, braceEnd, .027, .031);
  }
  add(wood, lathe([[0, 1.365], [.17, 1.365], [.185, 1.40], [.185, 1.455],
    [.135, 1.49], [0, 1.49]], 16));
  cylinder(brass, .14, .036, 0, 1.49, 0, 'y', 20);
  cylinder(iron, .087, .10, 0, 1.555, 0, 'y', 16);
  const saddle = new THREE.BoxGeometry(.43, .055, .17).translate(0, 1.60, -.03);
  add(brass, saddle);
  for (const side of [-1, 1]) {
    // Two fork cheeks touch the axle at the optical centre of gravity.
    add(brass, new THREE.BoxGeometry(.045, .14, .10).translate(side * .186, 1.665, -.03));
    cylinder(brass, .069, .049, side * .186, pivot.y, pivot.z, 'x', 16);
    cylinder(iron, .046, .032, side * .221, pivot.y, pivot.z, 'x', 12);
    cylinder(brass, .083, .028, side * .248, pivot.y, pivot.z, 'x', 20);
    cylinder(iron, .019, .008, side * .266, pivot.y, pivot.z, 'x', 6);
  }
  cylinder(iron, .046, .40, 0, pivot.y, pivot.z, 'x', 16);

  // All optical parts use ONE transform. The old independent sin/cos lens
  // placement and unsupported tube were visibly offset in the side view.
  add(brass, lathe([[.061, -.48], [.081, -.46], [.104, -.39], [.123, -.34],
    [.123, .39], [.136, .43], [.136, .47], [.117, .47], [.102, -.34], [.061, -.40], [.061, -.48]]), optical);
  for (const y of [-.29, .27]) {
    add(brass, lathe([[.123, y - .025], [.132, y - .020], [.132, y + .020],
      [.123, y + .025], [.123, y - .025]]), optical);
  }
  // Dark saddle band visibly connects the barrel to the transverse axle.
  add(iron, lathe([[.121, -.052], [.143, -.052], [.149, -.036],
    [.149, .036], [.143, .052], [.121, .052], [.121, -.052]]), optical);
  // A hollow, bevelled dew hood surrounds a recessed convex blue objective.
  add(brass, lathe([[.130, .425], [.152, .425], [.166, .465], [.166, .663],
    [.153, .686], [.139, .686], [.139, .620], [.130, .425]], 32), optical);
  add(iron, lathe([[.137, .601], [.145, .601], [.145, .648],
    [.137, .648], [.137, .601]], 24), optical);
  const objective = new THREE.SphereGeometry(1, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  objective.scale(.139, .013, .139); objective.translate(0, .645, 0); add(glass, objective, optical);
  // Drawtube, eyecup and paired focus knobs, all aligned with the same axis.
  add(brass, lathe([[.048, -.685], [.059, -.685], [.063, -.64],
    [.063, -.42], [.048, -.42], [.048, -.685]], 20), optical);
  add(iron, lathe([[.039, -.755], [.066, -.755], [.072, -.731], [.065, -.691],
    [.048, -.680], [.039, -.680], [.039, -.755]], 20), optical);
  const eyepane = new THREE.CircleGeometry(.040, 16);
  eyepane.rotateX(Math.PI / 2); eyepane.translate(0, -.743, 0); add(glass, eyepane, optical);
  for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(.047, .047, .035, 16);
    g.rotateZ(Math.PI / 2); g.translate(side * .087, -.494, 0); add(brass, g, optical);
    const cap = new THREE.CylinderGeometry(.020, .020, .037, 8);
    cap.rotateZ(Math.PI / 2); cap.translate(side * .087, -.494, 0); add(iron, cap, optical);
  }

  const brassMat = new THREE.MeshStandardMaterial({color: 0xdcc18a, metalness: .28, roughness: .38});
  const glassMat = new THREE.MeshStandardMaterial({color: 0x285767, metalness: .28,
    roughness: .20, emissive: 0x18303c, emissiveIntensity: .10});
  const mesh = (parts, material, name, shadow) => {
    const ready = parts.map(g => g.index ? g.toNonIndexed() : g);
    const geometry = mergeGeometries(ready, false);
    for (const g of new Set([...parts, ...ready])) g.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const m = new THREE.Mesh(geometry, material); m.name = 'ship-telescope-' + name;
    m.receiveShadow = true; m.castShadow = shadow; group.add(m);
  };
  mesh(deck, materials.deck, 'platform', true);
  mesh(wood, materials.dark, 'timber', true);
  mesh(brass, brassMat, 'brass', false);
  mesh(iron, materials.iron, 'fittings', false);
  mesh(glass, glassMat, 'optics', false);
  group.userData.craft = {version: 'telescope-87', platformRadius: 1.30, platformTop: .25,
    originalInteraction: {...SHIP.telescope}, pivot: pivot.toArray(), axis: axis.toArray(),
    footContacts: feet, legJoints: joints, meshBudget: 5, addedLights: 0, addedTextures: 0, addedMaterials: 2};
  return group;
}
