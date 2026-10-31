import * as THREE from 'three';
import {travelerHandGeometry} from './character-detail.js';

export const PIANO_POSE_VERSION = 'piano-use-01';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=v=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
const parts=['group','hips','torso','legL','legR','armL','armR','headGroup','staff'];

// Two-bone arms follow the actual moving ivory surfaces. The existing elbow
// deformation and sleeve/collar/trouser bindings remain the final pose owners.
export function createPianoPose(rigs) {
  let active=false,blend=0,form=null,rig=null,offset=new THREE.Vector3(),heading=0,propStart=null,seat=null,tick=null;
  const saved=new Map(),hands=[],targets=[new THREE.Vector3(),new THREE.Vector3()];
  const pressures=[0,0],V=new THREE.Vector3(),D=new THREE.Vector3(),E=new THREE.Vector3();
  const pole=new THREE.Vector3(),upper=new THREE.Vector3(),lower=new THREE.Vector3();
  const X=new THREE.Vector3(),Y=new THREE.Vector3(),Z=new THREE.Vector3();
  const M=new THREE.Matrix4(),inverse=new THREE.Matrix4(),Q=new THREE.Quaternion(),localQ=new THREE.Quaternion();
  const flatQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0));
  flatQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
  const rootQ=new THREE.Quaternion(),handInverseQ=new THREE.Quaternion(),wristQ=new THREE.Quaternion(),weightedQ=new THREE.Quaternion(),stroke=new THREE.Vector3();
  const savedGeometry=new Map();
  function remember(o) {if(o&&!saved.has(o))saved.set(o,{parent:o.parent,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});}
  function begin(options) {
    if(active||!['chibi','awakened'].includes(options.form))return false;
    form=options.form;rig=rigs[form];blend=0;offset.fromArray(options.offset);heading=options.heading;seat=options.seat;tick=options.tick;
    for(const key of parts)remember(rig[key]);
    rig.group.attach(rig.staff);
    propStart={p:rig.staff.position.clone(),q:rig.staff.quaternion.clone()};
    for(const [i,side]of ['L','R'].entries()){
      const mesh=rig['arm'+side].getObjectByName(i===0?'RelaxedHand':'GrippingHand');remember(mesh);
      const geometry=travelerHandGeometry(form,false);
      // Pronation is a proper rotation. Mirror the left source once with its
      // winding, then rotate both palms down without reflecting a live mesh.
      if(i===0){geometry.scale(-1,1,1);const a=geometry.index.array;for(let j=0;j<a.length;j+=3){const t=a[j+1];a[j+1]=a[j+2];a[j+2]=t;}geometry.computeVertexNormals();}
      savedGeometry.set(mesh,mesh.geometry);mesh.geometry=geometry;
      const original=geometry.attributes.position.array.slice();
      const palmCount=form==='chibi'?74:242,digitCount=form==='chibi'?92:158;
      const fingerStart=palmCount+digitCount,fingerEnd=fingerStart+digitCount;
      // A resting middle-finger pad is lifted 12 mm; its 18 mm stroke follows the
      // depressed key, while the other fingers remain softly curved above it.
      let low=Infinity;for(let j=fingerStart;j<fingerEnd;j++)low=Math.min(low,-original[j*3+2]);
      const padX=(i===0?-1:1)*(form==='chibi'?.009*.85*1.08:.009*1.10);
      hands.push({mesh,original,fingerStart,fingerEnd,low,palmCount,digitCount,padX});
    }
    active=true;return true;
  }
  function reset() {
    if(!active)return false;
    for(const h of rig.restHinges)h.reset();
    for(const [o,s]of saved){if(o.parent!==s.parent)s.parent.add(o);o.position.copy(s.p);o.quaternion.copy(s.q);o.scale.copy(s.s);}
    for(const [mesh,geometry]of savedGeometry){mesh.geometry.dispose();mesh.geometry=geometry;}
    saved.clear();savedGeometry.clear();hands.length=0;active=false;blend=0;rig=null;tick=null;return true;
  }
  function turn(o,x,y=0,z=0,k=blend) {localQ.setFromEuler(new THREE.Euler(x,y,z));o.quaternion.copy(saved.get(o).q).slerp(localQ,k);}
  function armTo(side,index,target,k) {
    const arm=rig['arm'+side],small=form==='chibi',L1=small?.16:.30,L2=small?.17:.33;
    rig.torso.updateWorldMatrix(true,false);inverse.copy(rig.torso.matrixWorld).invert();
    V.copy(target);rig.group.parent.localToWorld(V);V.applyMatrix4(inverse);
    D.copy(V).sub(arm.position);const reach=clamp(D.length(),Math.abs(L1-L2)+.015,L1+L2-.006);D.normalize();
    const a=(L1*L1-L2*L2+reach*reach)/(2*reach),b=Math.sqrt(Math.max(0,L1*L1-a*a));
    pole.set(index===0?.22:-.22,-1,-.05).addScaledVector(D,-pole.dot(D)).normalize();
    E.copy(D).multiplyScalar(a).addScaledVector(pole,b);
    upper.copy(E).normalize();lower.copy(D).multiplyScalar(reach).sub(E).normalize();
    Y.copy(upper).negate();Z.copy(lower).addScaledVector(upper,-lower.dot(upper)).normalize();X.crossVectors(Y,Z).normalize();
    M.makeBasis(X,Y,Z);Q.setFromRotationMatrix(M);arm.quaternion.copy(saved.get(arm).q).slerp(Q,k);
    rig.restHinges[index+2].set(-Math.acos(clamp((reach*reach-L1*L1-L2*L2)/(2*L1*L2),-1,1))*k);
  }
  function apply(current,currentForm) {
    if(!active||current!==rig||currentForm!==form)return;
    const small=form==='chibi',clear=smooth(blend/.16),sit=smooth((blend-.16)/.18),along=smooth((blend-.34)/.16),across=smooth((blend-.50)/.18),reach=smooth((blend-.84)/.16);
    rig.group.position.set(THREE.MathUtils.lerp(offset.x,-.8,clear)*(1-across),(small?.10:0)*smooth((blend-.42)/.08)*(1-smooth((blend-.68)/.08)),THREE.MathUtils.lerp(offset.z,small?-.065:0,along)*(1-smooth((blend-.76)/.08)));
    rig.group.rotation.set(0,heading*(1-clear),0);
    const hip=small?.645:.695;
    rig.hips.position.copy(saved.get(rig.hips).p).lerp(V.set(0,hip,0),sit);
    turn(rig.torso,small?.29:.10,0,0,sit);turn(rig.headGroup,small?-.04:.14,0,0,reach);
    const kneeY=small?-.21:-.38,boot=rig.legL.getObjectByName('TailoredBoot');boot.geometry.computeBoundingBox();
    const lowerLength=(small?-.46:-.82)-kneeY+boot.geometry.boundingBox.min.y;
    const thigh=small?1.48:Math.acos(clamp((hip-.08+lowerLength-.008)/-kneeY,-.2,.7));
    for(const [i,side]of ['L','R'].entries()){
      rig['leg'+side].position.y=saved.get(rig['leg'+side]).p.y+(small?.055:0)*sit;
      turn(rig['leg'+side],-thigh,0,0,sit);rig.restHinges[i].set(thigh*sit);
      const hand=hands[i],target=targets[i];
      const keyY=target.y,keyZ=target.z;
      // The index fingertip lies ahead of the wrist in the +Z direction.
      const length=small?.0624:.084;
      const final=new THREE.Vector3(target.x-hand.padX,keyY+.012-hand.low,keyZ-length);
      // Lift and pronate over the lap before crossing the keyboard edge.
      rig.torso.updateWorldMatrix(true,false);rig.group.parent.updateWorldMatrix(true,false);
      const arm=rig['arm'+side],start=saved.get(hand.mesh).p.clone().applyQuaternion(saved.get(arm).q).add(arm.position);
      start.applyMatrix4(rig.torso.matrixWorld).applyMatrix4(inverse.copy(rig.group.parent.matrixWorld).invert());
      const lift=smooth(reach/.55),forward=smooth((reach-.55)/.45);
      V.copy(start);V.y=THREE.MathUtils.lerp(start.y,Math.max(final.y+.05,start.y),lift);V.lerp(final,forward);
      armTo(side,i,V,smooth(reach/.08));
    }
    // Park the real prop at the bench side, retaining its existing light.
    const park=smooth(blend/.18);
    rig.group.updateMatrix();V.set(.65,small?.57:.13,-.16).applyMatrix4(inverse.copy(rig.group.matrix).invert());
    rig.staff.position.copy(propStart.p).lerp(V,park);localQ.setFromEuler(new THREE.Euler(0,0,-.05));rig.staff.quaternion.copy(propStart.q).slerp(localQ,park);
    rig.staff.position.y+=.75*Math.sin(Math.PI*park);
    rig.group.updateWorldMatrix(true,true);
    rig.group.parent.getWorldQuaternion(rootQ);
    for(const [i,h]of hands.entries()){
      const p=h.mesh.geometry.attributes.position;
      h.mesh.getWorldQuaternion(handInverseQ).invert();wristQ.copy(handInverseQ).multiply(rootQ).multiply(flatQ);
      stroke.set(0,-.018*pressures[i]*reach,0).applyQuaternion(rootQ).applyQuaternion(handInverseQ);
      for(let j=0;j<p.count;j++){
        const n=j*3,ox=h.original[n],oy=h.original[n+1],oz=h.original[n+2];
        // Every digit follows the palm rigidly. Weighting the thumb by its
        // vertex height twists its root differently from its tip.
        const distal=j>=h.palmCount?1:smooth((.018-oy)/.045),finger=j>=h.fingerStart&&j<h.fingerEnd;
        weightedQ.identity().slerp(wristQ,smooth(reach/.55)*distal);V.set(ox,oy,oz).applyQuaternion(weightedQ);
        if(finger)V.addScaledVector(stroke,smooth((-.014-oy)/.035));
        p.setXYZ(j,V.x,V.y,V.z);
      }
      p.needsUpdate=true;h.mesh.geometry.computeVertexNormals();h.mesh.geometry.computeBoundingBox();h.mesh.geometry.computeBoundingSphere();
    }
    // Gather the existing cape behind the stool rather than through its seat.
    if(rig.cloak){
      const g=rig.cloak.geometry,p=g.attributes.position;rig.cloak.updateWorldMatrix(true,false);
      const toRoot=new THREE.Matrix4().multiplyMatrices(rig.group.parent.matrixWorld.clone().invert(),rig.cloak.matrixWorld),back=toRoot.clone().invert();
      for(let i=0;i<p.count;i++){
        V.fromBufferAttribute(p,i).applyMatrix4(toRoot);const fold=smooth((.92-V.y)/.32)*sit;
        V.z=THREE.MathUtils.lerp(V.z,Math.min(V.z,small?-.32:-.23),fold);V.y=Math.max(.045,V.y);V.applyMatrix4(back);p.setXYZ(i,V.x,V.y,V.z);
      }p.needsUpdate=true;g.computeVertexNormals();
    }
  }
  function finishCloth(){
    const mesh=rig?.trousersBinding?.mesh;if(!active||!seat||!mesh||blend<.5)return;
    const p=mesh.geometry.attributes.position;mesh.updateWorldMatrix(true,false);
    M.multiplyMatrices(rig.group.parent.matrixWorld.clone().invert(),mesh.matrixWorld);inverse.copy(M).invert();
    let changed=false;
    for(let i=0;i<p.count;i++){
      V.fromBufferAttribute(p,i).applyMatrix4(M);
      const dx=Math.max(seat.min[0]-V.x,0,V.x-seat.max[0]),dz=Math.max(seat.min[2]-V.z,0,V.z-seat.max[2]);
      const weight=1-smooth((Math.max(dx,dz)-.025)/.035),top=seat.max[1]+.006;
      if(weight>0&&V.y<top){V.y=THREE.MathUtils.lerp(V.y,top,weight);V.applyMatrix4(inverse);p.setXYZ(i,V.x,V.y,V.z);changed=true;}
    }
    if(changed){p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
  }
  return {version:PIANO_POSE_VERSION,begin,reset,apply,finishCloth,advance(){if(active)tick?.();},get active(){return active;},get blend(){return blend;},get form(){return form;},
    setBlend(v){blend=clamp(v,0,1);},setKeys(keys){keys.forEach((k,i)=>{targets[i].fromArray(k.position);pressures[i]=k.press;});}};
}
