// Shared four-paw construction and planted-foot posing. Targets are in the cat root space.
// No skeleton or new shader variants: every limb uses the existing toon material.
import * as THREE from 'three';
import { clamp, lerp } from '../util/easing.js';

const UP = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), knee = new THREE.Vector3();
const direction = new THREE.Vector3(), bend = new THREE.Vector3(), world = new THREE.Vector3();
const inverse = new THREE.Matrix4();
const parentRotation = new THREE.Quaternion(), rootRotation = new THREE.Quaternion();

export function makeCatLeg(parent, { x, y, z, upper, lower, radius, pawRadius, material, hind = false }) {
  const leg = new THREE.Group(); leg.position.set(x, y, z); parent.add(leg);
  const segment = (r1, r2) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, 1, 10), material);
    m.castShadow = true; leg.add(m); return m;
  };
  const top = segment(radius * (hind ? 1.3 : 1), radius * .85);
  const bottom = segment(radius * .86, radius * .76);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(radius * .93, 10, 8), material);
  const paw = new THREE.Mesh(new THREE.SphereGeometry(pawRadius, 12, 8), material);
  paw.scale.set(1.04, .58, 1.3); paw.castShadow = joint.castShadow = true;
  leg.add(joint, paw);
  leg.userData.catLeg = { upper, lower, top, bottom, joint, paw, hind, pawHeight: pawRadius * .58, baseX: x, baseZ: z };
  return leg;
}

function placeSegment(mesh, from, to) {
  direction.subVectors(to, from);
  mesh.position.copy(from).add(to).multiplyScalar(.5);
  mesh.scale.y = direction.length();
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
}

export function placeCatPaw(root, leg, x, y, z) {
  const p = leg.userData.catLeg;
  // Remove every biped rotation, including residual rotations copied during a transformation.
  leg.rotation.set(0, 0, 0); leg.scale.set(1, 1, 1);
  world.set(x, y, z).applyMatrix4(root.matrixWorld);
  inverse.copy(leg.parent.matrixWorld).invert();
  b.copy(world).applyMatrix4(inverse).sub(leg.position);
  const distance = Math.max(.001, Math.min(b.length(), p.upper + p.lower - .0001));
  direction.copy(b).normalize();
  const along = (p.upper * p.upper + distance * distance - p.lower * p.lower) / (2 * distance);
  const height = Math.sqrt(Math.max(0, p.upper * p.upper - along * along));
  bend.set(0, -direction.z, direction.y).normalize().multiplyScalar(p.hind ? -1 : 1);
  knee.copy(direction).multiplyScalar(along).addScaledVector(bend, height);
  a.set(0, 0, 0);
  placeSegment(p.top, a, knee); placeSegment(p.bottom, knee, b);
  p.joint.position.copy(knee); p.paw.position.copy(b);
  // Keep the sole horizontal even when the chest rises during sitting.
  p.paw.quaternion.copy(leg.parent.getWorldQuaternion(parentRotation)).invert();
  p.paw.quaternion.multiply(root.getWorldQuaternion(rootRotation));
}

export function poseCatPaws(root, legs, { phase, speed, sit = 0, run = 0, jump = 0, swipe = 0, reach = 0, size = 1 }) {
  root.updateWorldMatrix(true, true);
  const motion = clamp(speed / (3 * size), 0, 1) * (1 - sit) * (1 - jump);
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i], p = leg.userData.catLeg, front = i < 2;
    const cycle = phase + ((i === 0 || i === 3) ? 0 : Math.PI);
    const swing = Math.max(0, Math.sin(cycle));
    const stride = (.09 + .05 * run) * size * motion;
    let x = p.baseX, y = p.pawHeight + swing * .052 * size * motion;
    let z = p.baseZ + .025 * size + Math.cos(cycle) * stride;
    z = lerp(z, front ? .31 * size : -.12 * size, sit);
    y += jump * (front ? .10 : .085) * size;
    z += jump * (front ? -.07 : .10) * size;
    if (i === 1) { y += (.14 * swipe + .13 * reach) * size; z += (.12 * swipe + .08 * reach) * size; }
    placeCatPaw(root, leg, x, y, z);
  }
}

// A continuous tapered tube follows the small pose chain. One draw call, no frame allocations.
export function makeCatTail(parent, material, start, { count = 6, step = .13, radius = .035 } = {}) {
  const joints=[];let p=parent;
  for(let i=0;i<count;i++){const j=new THREE.Group();j.position.copy(i?new THREE.Vector3(0,step,0):start);p.add(j);joints.push(j);p=j;}
  const rings=28,sides=10,positions=new Float32Array((rings+1)*sides*3),indices=[];
  for(let r=0;r<rings;r++)for(let j=0;j<sides;j++){const x=r*sides+j,n=r*sides+(j+1)%sides;indices.push(x,x+sides,n,n,x+sides,n+sides);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(indices);
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.frustumCulled=false;parent.add(mesh);
  const points=Array.from({length:count+1},()=>new THREE.Vector3());
  mesh.userData.catTail={joints,points,curve:new THREE.CatmullRomCurve3(points,false,'centripetal'),rings,sides,radius,step,inverse:new THREE.Matrix4(),point:new THREE.Vector3(),tangent:new THREE.Vector3(),normal:new THREE.Vector3(),binormal:new THREE.Vector3()};
  return {joints,mesh};
}

export function updateCatTail(mesh) {
  const d=mesh.userData.catTail;mesh.parent.updateWorldMatrix(true,true);d.inverse.copy(mesh.parent.matrixWorld).invert();
  d.joints.forEach((j,i)=>j.getWorldPosition(d.points[i]).applyMatrix4(d.inverse));
  d.points.at(-1).set(0,d.step,0).applyMatrix4(d.joints.at(-1).matrixWorld).applyMatrix4(d.inverse);
  const pos=mesh.geometry.attributes.position;
  for(let r=0;r<=d.rings;r++){
    const t=r/d.rings;d.curve.getPoint(t,d.point);d.curve.getTangent(t,d.tangent);
    d.normal.set(1,0,0).addScaledVector(d.tangent,-d.tangent.x).normalize();d.binormal.crossVectors(d.tangent,d.normal).normalize();
    const radius=d.radius*(1-.83*t)*Math.sqrt(Math.max(.06,Math.sin(Math.PI*(.07+.93*t))));
    for(let j=0;j<d.sides;j++){const angle=j/d.sides*Math.PI*2;world.copy(d.point).addScaledVector(d.normal,Math.cos(angle)*radius).addScaledVector(d.binormal,Math.sin(angle)*radius);pos.setXYZ(r*d.sides+j,world.x,world.y,world.z);}
  }
  pos.needsUpdate=true;mesh.geometry.computeVertexNormals();
}
