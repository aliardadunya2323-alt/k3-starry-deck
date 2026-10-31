import * as THREE from 'three';
import {travelerHandGeometry} from './character-detail.js';

export const MEMORIAL_POSE_VERSION='memorial-hold-01';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ease=n=>{const t=clamp(n,0,1);return t*t*(3-2*t);};
const parts=['group','hips','torso','legL','legR','armL','armR','headGroup','staff'];

// The existing body, articulated sleeves and trousers remain the only actor.
// A temporary copy of the left hand supplies a flat paper pinch, then its exact
// original geometry and all hierarchy transforms are restored on release.
export function createMemorialPose(rigs){
  let active=false,rig=null,form=null,options=null,time=0,hand=null,baseHand=null,handSource=null;
  const saved=new Map(),V=new THREE.Vector3(),D=new THREE.Vector3(),E=new THREE.Vector3(),pole=new THREE.Vector3();
  const upper=new THREE.Vector3(),lower=new THREE.Vector3(),X=new THREE.Vector3(),Y=new THREE.Vector3(),Z=new THREE.Vector3();
  const M=new THREE.Matrix4(),inv=new THREE.Matrix4(),toCard=new THREE.Matrix4(),fromCard=new THREE.Matrix4(),Q=new THREE.Quaternion(),q=new THREE.Quaternion();
  const handQ=new THREE.Quaternion(),worldQ=new THREE.Quaternion(),weighted=new THREE.Quaternion();
  const pinchQ=new THREE.Quaternion();
  const target=new THREE.Vector3(),cardQ=new THREE.Quaternion(),cardPoint=new THREE.Vector3();
  function remember(o){if(o&&!saved.has(o))saved.set(o,{parent:o.parent,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});}
  function begin(o){
    if(active||!['chibi','awakened'].includes(o.form)||!o.card)return false;
    form=o.form;rig=rigs[form];options=o;time=0;
    for(const key of parts)remember(rig[key]);
    for(const side of ['L','R'])remember(rig['leg'+side].getObjectByName('TailoredBoot'));
    rig.group.attach(rig.staff);options.propStart={p:rig.staff.position.clone(),q:rig.staff.quaternion.clone()};
    hand=rig.armL.getObjectByName('RelaxedHand');remember(hand);baseHand=hand.geometry;
    const geometry=travelerHandGeometry(form,false);
    // Left-handed copy with matching triangle winding.
    geometry.scale(-1,1,1);const index=geometry.index.array;
    for(let i=0;i<index.length;i+=3){const a=index[i+1];index[i+1]=index[i+2];index[i+2]=a;}
    hand.geometry=geometry;handSource=geometry.attributes.position.array.slice();
    active=true;return true;
  }
  function reset(){
    if(!active)return false;
    for(const h of rig.restHinges)h.reset();
    for(const [o,s]of saved){if(o.parent!==s.parent)s.parent.add(o);o.position.copy(s.p);o.quaternion.copy(s.q);o.scale.copy(s.s);}
    hand.geometry.dispose();hand.geometry=baseHand;
    saved.clear();active=false;rig=null;form=null;options=null;hand=null;handSource=null;return true;
  }
  function turn(o,x,y,z,k){q.setFromEuler(new THREE.Euler(x,y,z));o.quaternion.copy(saved.get(o).q).slerp(q,k);}
  function armTo(side,index,p,k){
    const arm=rig['arm'+side],small=form==='chibi',L1=small?.16:.30,L2=small?.17:.33;
    if(k===0){arm.quaternion.copy(saved.get(arm).q);rig.restHinges[index+2].set(0);return;}
    rig.torso.updateWorldMatrix(true,false);inv.copy(rig.torso.matrixWorld).invert();V.copy(p).applyMatrix4(inv);
    // Interpolate the wrist path before solving the two bones. Blending the
    // shoulder and elbow rotations independently made the hand dip through
    // the paper between two otherwise clear endpoint poses.
    E.copy(saved.get(hand).p).applyQuaternion(saved.get(arm).q).add(arm.position);V.lerpVectors(E,V,k);
    D.copy(V).sub(arm.position);const reach=clamp(D.length(),Math.abs(L1-L2)+.015,L1+L2-.005);D.normalize();
    const a=(L1*L1-L2*L2+reach*reach)/(2*reach),b=Math.sqrt(Math.max(0,L1*L1-a*a));
    pole.set(index===0?.25:-.25,-1,-.1).addScaledVector(D,-pole.dot(D)).normalize();
    E.copy(D).multiplyScalar(a).addScaledVector(pole,b);upper.copy(E).normalize();lower.copy(D).multiplyScalar(reach).sub(E).normalize();
    Y.copy(upper).negate();Z.copy(lower).addScaledVector(upper,-lower.dot(upper)).normalize();X.crossVectors(Y,Z).normalize();
    M.makeBasis(X,Y,Z);Q.setFromRotationMatrix(M);arm.quaternion.copy(Q);
    rig.restHinges[index+2].set(-Math.acos(clamp((reach*reach-L1*L1-L2*L2)/(2*L1*L2),-1,1)),2.4);
  }
  function apply(current,currentForm){
    if(!active||current!==rig||currentForm!==form)return;
    const small=form==='chibi',arrive=ease(time/.65),kneel=ease((time-.45)/.95),reach=ease((time-1.25)/.95),grip=ease((time-1.25)/.45),lift=ease((time-2.2)/1.4);
    const crouch=small?.318:.478,lean=THREE.MathUtils.lerp(small?1.48:1.35,.26,lift);
    rig.group.position.fromArray(options.offset).multiplyScalar(1-arrive);rig.group.rotation.set(0,options.heading*(1-arrive),0);
    rig.hips.position.copy(saved.get(rig.hips).p);rig.hips.position.y=THREE.MathUtils.lerp(saved.get(rig.hips).p.y,crouch,kneel);
    turn(rig.torso,lean,0,0,kneel);turn(rig.headGroup,THREE.MathUtils.lerp(small?-1.25:-.90,.25,lift),0,0,kneel);
    for(const [i,side]of ['L','R'].entries()){
      turn(rig['leg'+side],.40,0,0,kneel);rig.restHinges[i].set(1.65*kneel);
      const boot=rig['leg'+side].getObjectByName('TailoredBoot');q.setFromAxisAngle(X.set(1,0,0),.80*kneel);boot.quaternion.copy(saved.get(boot).q).multiply(q);
    }
    // Fit the existing sole surfaces rather than an imagined ankle height.
    // A slight backward thigh angle lets the knees descend while the toes stay
    // supported. The absolute solve is idempotent in static-motion mode.
    rig.group.updateWorldMatrix(true,true);inv.copy(rig.group.parent.matrixWorld).invert();let floor=Infinity;
    for(const side of ['L','R']){const boot=rig['leg'+side].getObjectByName('TailoredBoot'),p=boot.geometry.attributes.position;M.multiplyMatrices(inv,boot.matrixWorld);for(let i=0;i<p.count;i++){V.fromBufferAttribute(p,i).applyMatrix4(M);floor=Math.min(floor,V.y);}}
    rig.hips.position.y+=(.006-floor)*(floor<.006?1:kneel);
    // The hand first reaches the original edge. Only after contact does the
    // original card travel upward; the inverse timeline puts it back.
    const card=options.card;card.position.copy(options.cardPosition).lerp(options.heldPosition,lift);card.quaternion.copy(options.cardQuaternion).slerp(options.heldQuaternion,lift);
    card.updateWorldMatrix(true,true);card.getWorldQuaternion(cardQ);
    // Approach from above the upper edge, then lower the prepared pinch. This
    // avoids passing the open palm through the paper on the way to contact.
    cardPoint.set(.030,.075+.40*(1-reach),.001);card.localToWorld(cardPoint);armTo('L',0,cardPoint,grip);
    // Keep the free arm relaxed beside the body, away from the keepsake.
    turn(rig.armR,-.10,0,-.12,kneel);rig.restHinges[3].set(-.30*kneel);
    const park=ease(time/.55);rig.staff.position.copy(saved.get(rig.staff).p);
    // Rig-relative parking keeps the prop away from the vase, card and face.
    rig.group.updateMatrix();V.set(-.50,small?.57:.13,-.28).applyMatrix4(inv.copy(rig.group.matrix).invert());
    const initial=options.propStart;rig.staff.position.copy(initial.p).lerp(V,park);q.setFromEuler(new THREE.Euler(0,0,.04));rig.staff.quaternion.copy(initial.q).slerp(q,park);
    rig.group.updateWorldMatrix(true,true);hand.getWorldQuaternion(handQ).invert();worldQ.copy(handQ).multiply(cardQ).multiply(pinchQ);
    toCard.multiplyMatrices(card.matrixWorld.clone().invert(),hand.matrixWorld);fromCard.copy(toCard).invert();
    const p=hand.geometry.attributes.position,palmCount=small?74:242,digitCount=small?92:158,thumbStart=palmCount+4*digitCount;
    for(let i=0;i<p.count;i++){
      const j=i*3,ox=handSource[j],oy=handSource[j+1],oz=handSource[j+2];
      const distal=i>=palmCount?1:ease((.024-oy)/.045);
      // Paper is 4 mm thick. Fingers stay behind it; the thumb closes across
      // the front edge. Cuff vertices retain their original sleeve connection.
      let z=oz;
      if(i>=palmCount&&i<thumbStart)z=THREE.MathUtils.lerp(oz,-.003-oz*.05,grip);
      else if(i>=thumbStart)z=THREE.MathUtils.lerp(oz,.001+oz*.05,grip);
      else z=THREE.MathUtils.lerp(oz,oz-.014*distal,grip);
      weighted.identity().slerp(worldQ,grip*distal);V.set(ox,oy,z).applyQuaternion(weighted);
      // Keep each connected surface on its own side of the paper. Checking
      // only individual vertices inside the card rectangle misses triangles
      // whose edges cross that rectangle, especially the broad palm surface.
      V.applyMatrix4(toCard);const clearance=i>=thumbStart?Math.max(V.z,.0032):Math.min(V.z,-.0032);
      V.z=THREE.MathUtils.lerp(V.z,clearance,grip);V.applyMatrix4(fromCard);
      p.setXYZ(i,V.x,V.y,V.z);
    }
    p.needsUpdate=true;hand.geometry.computeVertexNormals();hand.geometry.computeBoundingBox();hand.geometry.computeBoundingSphere();
    if(rig.cloak){
      const g=rig.cloak.geometry,a=g.attributes.position;rig.cloak.updateWorldMatrix(true,false);M.multiplyMatrices(rig.group.parent.matrixWorld.clone().invert(),rig.cloak.matrixWorld);inv.copy(M).invert();
      for(let i=0;i<a.count;i++){
        V.fromBufferAttribute(a,i).applyMatrix4(M);const row=1-g.attributes.uv.getY(i),drape=kneel*(1-lift)*ease((row-.08)/.55);
        V.y=THREE.MathUtils.lerp(V.y,Math.max(.055,rig.hips.position.y+.1-.55*row),drape);
        V.z=THREE.MathUtils.lerp(V.z,Math.min(V.z,-.18-.30*row),drape);V.y=Math.max(.035,V.y);
        V.z=THREE.MathUtils.lerp(V.z,Math.min(V.z,-.14),kneel*ease((.55-V.y)/.35));V.applyMatrix4(inv);a.setXYZ(i,V.x,V.y,V.z);
      }a.needsUpdate=true;g.computeVertexNormals();
    }
  }
  function finishCloth(){
    if(!active)return;
    const meshes=form==='chibi'?['L','R'].map(side=>rig['leg'+side].getObjectByName('TailoredTrousers')):[rig.trousersBinding?.mesh];
    rig.group.parent.updateWorldMatrix(true,true);inv.copy(rig.group.parent.matrixWorld).invert();
    for(const mesh of meshes){if(!mesh)continue;mesh.updateWorldMatrix(true,false);M.multiplyMatrices(inv,mesh.matrixWorld);fromCard.copy(M).invert();const g=mesh.geometry,p=g.attributes.position;let changed=false;
      for(let i=0;i<p.count;i++){V.fromBufferAttribute(p,i).applyMatrix4(M);if(V.y<.008){V.y=.008;V.applyMatrix4(fromCard);p.setXYZ(i,V.x,V.y,V.z);changed=true;}}
      if(changed){p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();}
    }
  }
  return {version:MEMORIAL_POSE_VERSION,begin,reset,apply,finishCloth,abort(error){options?.onError?.(error);},advance(){if(active)options.tick?.();},setTime(v){if(!Number.isFinite(v))throw Error('Finite memorial time required');time=clamp(v,0,3.6);},get active(){return active;},get time(){return time;},get form(){return form;}};
}
