// Private lounge pose: reuses the shipped meshes, materials and light anchor.
// No timer, extra render pass, GLB, texture, or scene light is created here.
import * as THREE from 'three';
import {placeCatPaw,updateCatTail} from './cat-poses.js';
export const PRIVATE_REST_VERSION = 'private-lounge-contact-01';
export const LOUNGE_POSES = Object.freeze({
  // Fit the actual Lounge_Fabric back (20 degrees), not an imagined recliner.
  // The previous 33-degree lean put the authored cushion in front of the neck.
  chibi: Object.freeze({ hips: .707, hipZ: -.015, lean: -.20, thigh: -1.65, knee: .25, arm: .02, elbow: -.25, head: .05, propY: .57, armRoll:.08 }),
  awakened: Object.freeze({ hips: .718, hipZ: -.01, lean: -.30, thigh: -1.60, knee: .265, arm: .05, elbow: -.50, head: .10, propY: .13, armRoll:.20 }),
});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };

/** A local X hinge with a small soft joint band. Neutral positions and normals
 * are restored exactly. Meshes must be untranslated apart from their Y offset.
 * The existing outline shells share the same geometry, so no duplicate draw. */
export function makeRestHinge(meshes, tips, jointY) {
  const sources = meshes.map(mesh => ({ mesh, positions: mesh.geometry.attributes.position.array.slice(), normals: mesh.geometry.attributes.normal.array.slice() }));
  const ends = tips.map(object => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone() }));
  const axis = new THREE.Vector3(1, 0, 0), turn = new THREE.Quaternion();
  let current = 0;
  function set(angle, limit = 1.65) {
    if (!Number.isFinite(angle)) throw new TypeError('Rest hinge angle must be finite');
    // Existing poses keep their authored limit. A close hand action may opt
    // into a deeper elbow bend without changing any other pose's range.
    if (!Number.isFinite(limit)) throw new TypeError('Rest hinge limit must be finite');
    limit = clamp(limit, 0, 2.4);
    angle = clamp(angle, -limit, limit);
    if (angle === current) return;
    current = angle;
    for (const { mesh, positions, normals } of sources) {
      const geometry = mesh.geometry, p = geometry.attributes.position, n = geometry.attributes.normal;
      if (angle === 0) { p.array.set(positions); n.array.set(normals); }
      else for (let i = 0; i < p.count; i++) {
        const k = i * 3, y = positions[k + 1] + mesh.position.y, z = positions[k + 2];
        const a = angle * smooth((jointY + .025 - y) / .05), c = Math.cos(a), s = Math.sin(a);
        p.setXYZ(i, positions[k], jointY + (y - jointY) * c - z * s - mesh.position.y, (y - jointY) * s + z * c);
        n.setXYZ(i, normals[k], normals[k + 1] * c - normals[k + 2] * s, normals[k + 1] * s + normals[k + 2] * c);
      }
      p.needsUpdate = true; n.needsUpdate = true;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
    turn.setFromAxisAngle(axis, angle);
    for (const { object, position, quaternion } of ends) {
      if (angle === 0) {
        object.position.copy(position); object.quaternion.copy(quaternion);
        continue;
      }
      object.position.copy(position); object.position.y -= jointY;
      object.position.applyQuaternion(turn); object.position.y += jointY;
      object.quaternion.copy(turn).multiply(quaternion);
    }
  }
  return { set, reset: () => set(0), get angle() { return current; } };
}

const capture = o => ({ object: o, parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
function restore(item) {
  if (item.object.parent !== item.parent) item.parent.add(item.object);
  item.object.position.copy(item.p); item.object.quaternion.copy(item.q); item.object.scale.copy(item.s);
}

export function createPrivateRest(rigs) {
  let active = false, snapshots = [], byObject = new Map(), blend = 1, lookYaw = 0, lookPitch = 0;
  const clothPoint = new THREE.Vector3();
  const blendPosition = new THREE.Vector3(), blendQuaternion = new THREE.Quaternion();
  const start=new THREE.Vector3(),matrix=new THREE.Matrix4(),inverse=new THREE.Matrix4(),rootInverse=new THREE.Matrix4(),point=new THREE.Vector3();
  const propFrom=new Map(),cloth=[],cells=new Map();let startHeading=0;
  function indexSupports(meshes){
    cells.clear();const root=rigs.chibi.group.parent;root.updateWorldMatrix(true,true);rootInverse.copy(root.matrixWorld).invert();
    for(const mesh of meshes||[]){
      if(!mesh.name.includes('Lounge'))continue;mesh.updateWorldMatrix(true,true);matrix.multiplyMatrices(rootInverse,mesh.matrixWorld);
      const p=mesh.geometry.attributes.position,idx=mesh.geometry.index,vertices=[];
      for(let i=0;i<p.count;i++){mesh.getVertexPosition(i,point);vertices.push(point.clone().applyMatrix4(matrix));}
      for(let i=0;i<(idx?idx.count:p.count);i+=3){
        const [a,b,c]=[0,1,2].map(j=>vertices[idx?idx.getX(i+j):i+j]),den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-12)continue;
        const tri={a,b,c,den};
        for(let x=Math.floor(Math.min(a.x,b.x,c.x)*10);x<=Math.floor(Math.max(a.x,b.x,c.x)*10);x++)for(let y=Math.floor(Math.min(a.y,b.y,c.y)*10);y<=Math.floor(Math.max(a.y,b.y,c.y)*10);y++){const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(tri);}
      }
    }
  }
  function depth(x,y,front){
    let z=front?-Infinity:Infinity;
    for(const {a,b,c,den}of cells.get(Math.floor(x*10)+','+Math.floor(y*10))||[]){const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7){const d=u*a.z+v*b.z+(1-u-v)*c.z;z=front?Math.max(z,d):Math.min(z,d);}}
    return z;
  }
  function reset() {
    for (const rig of Object.values(rigs)) for (const hinge of rig.restHinges || []) hinge.reset();
    for (const item of snapshots) restore(item);
    for(const {g,p,n}of cloth){g.attributes.position.array.set(p);g.attributes.normal.array.set(n);g.attributes.position.needsUpdate=g.attributes.normal.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();}
    for(const rig of Object.values(rigs))if(rig.tailMesh)updateCatTail(rig.tailMesh);
    cloth.length=0;propFrom.clear();cells.clear();
    snapshots = []; byObject.clear(); active = false; blend = 1; lookYaw = lookPitch = 0;
  }
  function begin(options={}) {
    if (active) return false;
    snapshots = []; byObject.clear(); blend = 0;
    for (const rig of Object.values(rigs)) {
      for (const key of ['group', 'hips', 'torso', 'legL', 'legR', 'armL', 'armR', 'headGroup', 'staff']) if (rig[key]) { const item = capture(rig[key]); snapshots.push(item); byObject.set(item.object, item); }
      // Move the existing prop, including its light anchor. Never hide a light
      // ancestor, because changing the active light count compiles new shaders.
      for(const o of rig.tail||[]){const item=capture(o);snapshots.push(item);byObject.set(o,item);}
      for(const o of [rig.cloak,rig.headGroup?.getObjectByName('SewnTravelerHood')])if(o){const g=o.geometry;cloth.push({g,p:g.attributes.position.array.slice(),n:g.attributes.normal.array.slice()});}
      if (rig.restHinges) {rig.group.attach(rig.staff);propFrom.set(rig.staff,{p:rig.staff.position.clone(),q:rig.staff.quaternion.clone()});}
    }
    start.fromArray(options.offset||[0,0,-.6]);startHeading=Math.atan2(Math.sin(options.heading||0),Math.cos(options.heading||0));indexSupports(options.support);
    active = true; return true;
  }
  function blendObject(object) {
    const item = byObject.get(object);
    if (!item || blend >= .999) return;
    blendPosition.copy(object.position); object.position.lerpVectors(item.p, blendPosition, blend);
    blendQuaternion.copy(item.q); blendQuaternion.slerp(object.quaternion, blend); object.quaternion.copy(blendQuaternion);
  }
  function apply(rig, form, time, reducedMotion) {
    if (!active) return;
    const clear=smooth(blend/.18),along=smooth((blend-.18)/.20),sit=smooth((blend-.38)/.62),pose=smooth((blend-.28)/.35);
    rig.group.position.set(THREE.MathUtils.lerp(start.x,.82,clear)*(1-sit),.32*Math.sin(Math.PI*sit),THREE.MathUtils.lerp(start.z,.02,along)*(1-sit));
    rig.group.rotation.set(0,startHeading*(1-clear),0);
    if (form === 'cat') {
      rig.group.position.y=.564*sit+.72*Math.sin(Math.PI*sit);rig.group.position.z+=.20*sit;
      rig.group.updateWorldMatrix(true,true);
      rig.catLegs.forEach((leg,i)=>{const p=leg.userData.catLeg;placeCatPaw(rig.group,leg,p.baseX,p.pawHeight,i<2?THREE.MathUtils.lerp(.31,.07,sit):-.12);});
      for(let i=0;i<rig.tail.length;i++){const o=rig.tail[i];blendQuaternion.setFromEuler(new THREE.Euler(i?.65:0,0,i?0:-Math.PI/2));o.quaternion.copy(byObject.get(o).q).slerp(blendQuaternion,clear);}
      updateCatTail(rig.tailMesh);return;
    }
    const p = LOUNGE_POSES[form];
    if (!p) return;
    const breath = reducedMotion ? 0 : .003 * Math.sin(time * 1.1);
    rig.hips.position.set(0, p.hips, p.hipZ);
    rig.torso.rotation.set(p.lean + breath, 0, 0);
    rig.headGroup.rotation.set(p.head - breath * .4 + lookPitch, lookYaw, 0);
    for (const [index, side] of ['L', 'R'].entries()) {
      const sign = side === 'L' ? 1 : -1;
      rig['leg' + side].rotation.set(p.thigh, 0, sign * .055);
      rig['leg' + side].position.y=byObject.get(rig['leg'+side]).p.y+(form==='chibi'?.01:0);
      rig['arm' + side].rotation.set(p.arm, 0, sign * p.armRoll);
      rig.restHinges[index].set(p.knee * pose);
      rig.restHinges[index + 2].set(p.elbow * pose);
    }
    // The held prop retains its world transform on entry, then rests outside
    // the actual armrest, keeping its existing light anchor alive.
    const prop=propFrom.get(rig.staff),put=smooth((blend-.28)/.10);
    rig.group.updateMatrix();point.set(.61,p.propY,.38).applyMatrix4(inverse.copy(rig.group.matrix).invert());
    rig.staff.position.copy(prop.p).lerp(point,put);
    rig.staff.quaternion.copy(prop.q).slerp(blendQuaternion.setFromEuler(new THREE.Euler(0,0,-.04)),put);
    const phase=blend;blend=pose;for (const key of ['hips', 'torso', 'legL', 'legR', 'armL', 'armR', 'headGroup']) if (rig[key]) blendObject(rig[key]);blend=phase;
    const root=rig.group.parent;root.updateWorldMatrix(true,true);rootInverse.copy(root.matrixWorld).invert();
    for(const o of [rig.cloak,rig.headGroup.getObjectByName('SewnTravelerHood')])if(o){
      const isHood=o!==rig.cloak,g=o.geometry,p=g.attributes.position,original=cloth.find(c=>c.g===g);
      if(isHood)p.array.set(original.p);
      if(isHood&&sit===0){p.needsUpdate=true;g.computeVertexNormals();continue;}
      matrix.multiplyMatrices(rootInverse,o.matrixWorld);inverse.copy(matrix).invert();
      for(let i=0;i<p.count;i++){
        clothPoint.fromBufferAttribute(p,i).applyMatrix4(matrix);
        if(!isHood){
          // Keep the shoulder seam attached and gather the long hem on the
          // cushion behind the pelvis. The cape lies between body and back.
          const v=1-g.attributes.uv.getY(i),gather=smooth((v-.12)/.62)*sit;
          clothPoint.x=THREE.MathUtils.lerp(clothPoint.x,THREE.MathUtils.clamp(clothPoint.x,-.275,.275),gather);
          clothPoint.y=Math.max(clothPoint.y,THREE.MathUtils.lerp(.055,.574+.005*Math.sin(g.attributes.uv.getX(i)*Math.PI*8+v*10)**2,gather));
          clothPoint.z=THREE.MathUtils.lerp(clothPoint.z,-.16+.015*Math.sin(v*14),gather);
          if(sit>0&&Math.abs(clothPoint.x)<.47&&clothPoint.z>-.6&&clothPoint.z<.42)clothPoint.y=Math.max(clothPoint.y,.576+.004*Math.sin(v*14)**2);
          if(sit>0&&Math.abs(clothPoint.x)>.29&&Math.abs(clothPoint.x)<.51&&clothPoint.z>-.31&&clothPoint.z<.28)clothPoint.y=Math.max(clothPoint.y,.715);
        }
        const {x,y}=clothPoint;
        const sampleY=isHood?y:Math.max(y,.605);let d=depth(x,sampleY,true);
        if(sit>0)for(const dx of [-.04,0,.04])for(const dy of [-.035,0,.035])d=Math.max(d,depth(x+dx,sampleY+dy,true));
        if(sit>0&&Number.isFinite(d))clothPoint.z=Math.max(clothPoint.z,d+.015);
        if(!isHood)clothPoint.y=Math.max(.055,clothPoint.y);
        clothPoint.applyMatrix4(inverse);p.setXYZ(i,clothPoint.x,clothPoint.y,clothPoint.z);
      }p.needsUpdate=true;g.computeVertexNormals();
    }
  }
  return { version: PRIVATE_REST_VERSION, get active() { return active; }, get blend() { return blend; }, setBlend(value) { if (!Number.isFinite(value)) throw new TypeError('Rest blend must be finite'); blend = Math.min(1, Math.max(0, value)); }, setLook(yaw = 0, pitch = 0) { if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new TypeError('Rest look must be finite'); lookYaw = clamp(yaw, -.80, .80); lookPitch = clamp(pitch, -.12, .38); }, begin, reset, apply };
}
