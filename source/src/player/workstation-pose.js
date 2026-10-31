import * as THREE from 'three';
import {travelerHandGeometry} from './character-detail.js';

export const WORKSTATION_POSE_VERSION = 'workstation-use-01';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=v=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
const parts=['group','hips','torso','legL','legR','armL','armR','headGroup','staff'];

// Two-bone arms follow the original F/J key surfaces and their measured travel. The existing elbow
// deformation and sleeve/collar/trouser bindings remain the final pose owners.
export function createWorkstationPose(rigs) {
  let onError=null,active=false,blend=0,form=null,rig=null,offset=new THREE.Vector3(),heading=0,propStart=null,seat=null,tick=null,route=null,desk=null;
  const saved=new Map(),hands=[],targets=[new THREE.Vector3(),new THREE.Vector3()];
  const pressures=[0,0],V=new THREE.Vector3(),D=new THREE.Vector3(),E=new THREE.Vector3();
  const pole=new THREE.Vector3(),upper=new THREE.Vector3(),lower=new THREE.Vector3();
  const X=new THREE.Vector3(),Y=new THREE.Vector3(),Z=new THREE.Vector3();
  const M=new THREE.Matrix4(),inverse=new THREE.Matrix4(),Q=new THREE.Quaternion(),localQ=new THREE.Quaternion();
  const flatQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0));
  flatQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
  const rootQ=new THREE.Quaternion(),handInverseQ=new THREE.Quaternion(),wristQ=new THREE.Quaternion(),weightedQ=new THREE.Quaternion(),stroke=new THREE.Vector3();
  const savedGeometry=new Map(),clothFrames=new Map(),originalCloth=new Map();
  function remember(o) {if(o&&!saved.has(o))saved.set(o,{parent:o.parent,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});}
  function begin(options) {
    if(active||!options||!['chibi','awakened'].includes(options.form))return false;
    const next=rigs[options.form];
    if(!next||parts.some(key=>!next[key])||next.restHinges?.length!==4||!next.armL.getObjectByName('RelaxedHand')?.geometry||!next.armR.getObjectByName('GrippingHand')?.geometry)return false;
    if(!Array.isArray(options.offset)||options.offset.length!==3||!options.offset.every(Number.isFinite)||!Number.isFinite(options.heading))return false;
    form=options.form;rig=rigs[form];blend=0;offset.fromArray(options.offset);heading=options.heading;seat=options.seat;tick=options.tick;onError=options.onError;route=options.route;desk=options.desk;
    for(const key of parts)remember(rig[key]);
    active=true;
    try {
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
      // A resting middle-finger pad is lifted 6.7 mm; its 6 mm stroke follows the
      // depressed key, retaining a small skin clearance at full travel.
      let low=Infinity;for(let j=fingerStart;j<fingerEnd;j++)low=Math.min(low,-original[j*3+2]);
      const padX=(i===0?-1:1)*(form==='chibi'?.009*.85*1.08:.009*1.10);
      hands.push({mesh,original,fingerStart,fingerEnd,low,palmCount,digitCount,padX});
    }
    const garments=[rig.torso.getObjectByName('TailoredTorso'),...(rig.trousersBinding?[rig.trousersBinding.mesh]:['L','R'].map(side=>rig['leg'+side].getObjectByName('TailoredTrousers')))];
    for(const mesh of garments)if(mesh){const geometry=mesh.geometry;originalCloth.set(mesh,{geometry,p:geometry.attributes.position.array.slice(),n:geometry.attributes.normal.array.slice()});}
    return true;
    } catch(error) { reset(); throw error; }
  }
  function reset() {
    if(!active)return false;
    for(const [mesh,frame]of clothFrames){const p=mesh.geometry.attributes.position;if(mesh.geometry===originalCloth.get(mesh)?.geometry&&frame.applied&&p.array.every((v,i)=>v===frame.applied[i])){p.array.set(frame.base);p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}}
    clothFrames.clear();
    for(const h of rig.restHinges)h.reset();
    for(const [mesh,source]of originalCloth)if(mesh.geometry===source.geometry){const g=mesh.geometry;g.attributes.position.array.set(source.p);g.attributes.normal.array.set(source.n);g.attributes.position.needsUpdate=g.attributes.normal.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();}
    originalCloth.clear();
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
    M.makeBasis(X,Y,Z);Q.setFromRotationMatrix(M);arm.quaternion.slerp(Q,k);
    const hinge=rig.restHinges[index+2];hinge.set(THREE.MathUtils.lerp(hinge.angle,-Math.acos(clamp((reach*reach-L1*L1-L2*L2)/(2*L1*L2),-1,1)),k),2.4);
  }
  function apply(current,currentForm) {
    if(!active||current!==rig||currentForm!==form)return;
    const small=form==='chibi',retreat=smooth(blend/.10),clear=smooth((blend-.10)/.12),along=smooth((blend-.30)/.14),across=smooth((blend-.44)/.12),sit=smooth((blend-.56)/.20),roll=smooth((blend-.76)/.14),reach=smooth((blend-.90)/.10);
    const backZ=Math.min(offset.z,-1),frontZ=route?.frontZ||0,seatedZ=route?.seatedZ||0,side=route?.side||.75;
    let z=THREE.MathUtils.lerp(offset.z,backZ,retreat);z=THREE.MathUtils.lerp(z,frontZ,along);z=THREE.MathUtils.lerp(z,seatedZ,sit);z=THREE.MathUtils.lerp(z,0,roll);
    rig.group.position.set(THREE.MathUtils.lerp(offset.x,side,clear)*(1-across),0,z);
    rig.group.rotation.set(0,heading*(1-clear),0);
    const hip=small?.675:.69;
    rig.hips.position.copy(saved.get(rig.hips).p).lerp(V.set(0,hip,0),small?smooth((blend-.44)/.12):sit);
    turn(rig.torso,small?.43:.20,0,0,sit);turn(rig.headGroup,small?-.30:.14,0,0,reach);
    const kneeY=small?-.21:-.38,boot=rig.legL.getObjectByName('TailoredBoot');boot.geometry.computeBoundingBox();
    const lowerLength=(small?-.46:-.82)-kneeY+boot.geometry.boundingBox.min.y;
    const thigh=small?.95:Math.acos(clamp((hip-.08+lowerLength-.025)/-kneeY,-.2,.7));
    for(const [i,side]of ['L','R'].entries()){
      rig['leg'+side].position.copy(saved.get(rig['leg'+side]).p);
      rig.restHinges[i].reset();
      turn(rig['leg'+side],-thigh,0,0,sit);rig.restHinges[i].set(thigh*sit);
    }
    // Fit the actual boot vertices before solving the arms. Interpolating hip
    // height and knee rotation independently otherwise sinks the adult feet.
    rig.group.updateWorldMatrix(true,true);inverse.copy(rig.group.parent.matrixWorld).invert();let foot=Infinity;
    for(const side of ['L','R']){const boot=rig['leg'+side].getObjectByName('TailoredBoot');M.multiplyMatrices(inverse,boot.matrixWorld);for(let i=0;i<boot.geometry.attributes.position.count;i++){boot.getVertexPosition(i,V);V.applyMatrix4(M);foot=Math.min(foot,V.y);}}
    if(foot<.002)rig.hips.position.y+=.002-foot;
    for(const [i,side]of ['L','R'].entries()){
      const ready=smooth((blend-.30)/.14);turn(rig['arm'+side],-.30,0,0,ready);rig.restHinges[i+2].set(-1.5*ready,2.4);
      const hand=hands[i],target=targets[i];
      const keyY=target.y,keyZ=target.z;
      // The index fingertip lies ahead of the wrist in the +Z direction.
      const length=small?.0624:.084;
      const final=new THREE.Vector3(target.x-hand.padX,keyY+.0067-hand.low,keyZ-length);
      // Lift and pronate over the lap before crossing the keyboard edge.
      rig.torso.updateWorldMatrix(true,false);rig.group.parent.updateWorldMatrix(true,false);
      const arm=rig['arm'+side],start=hand.mesh.position.clone().applyQuaternion(arm.quaternion).add(arm.position);
      start.applyMatrix4(rig.torso.matrixWorld).applyMatrix4(inverse.copy(rig.group.parent.matrixWorld).invert());
      const lift=smooth(reach/.55),forward=smooth((reach-.55)/.45);
      V.copy(start);V.y=THREE.MathUtils.lerp(start.y,Math.max(final.y+.05,start.y),lift);V.lerp(final,forward);
      armTo(side,i,V,smooth(reach/.08));
    }
    // Park the real prop at the seat side, retaining its existing light.
    const park=smooth(blend/.18);
    rig.group.updateMatrix();V.set(-.52,small?.57:.13,-.28).applyMatrix4(inverse.copy(rig.group.matrix).invert());
    rig.staff.position.copy(propStart.p).lerp(V,park);localQ.setFromEuler(new THREE.Euler(0,0,-.05));rig.staff.quaternion.copy(propStart.q).slerp(localQ,park);
    rig.staff.position.y+=.75*Math.sin(Math.PI*park);
    rig.group.updateWorldMatrix(true,true);
    rig.group.parent.getWorldQuaternion(rootQ);
    for(const [i,h]of hands.entries()){
      const p=h.mesh.geometry.attributes.position;
      h.mesh.getWorldQuaternion(handInverseQ).invert();wristQ.copy(handInverseQ).multiply(rootQ).multiply(flatQ);
      stroke.set(0,-.006*pressures[i]*reach,0).applyQuaternion(rootQ).applyQuaternion(handInverseQ);
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
    // Gather the lower cape before crossing the seat. Fold it in the space
    // between the back and the torso, above the cushion and inside armrests.
    if(rig.cloak){
      const g=rig.cloak.geometry,p=g.attributes.position;rig.cloak.updateWorldMatrix(true,false);
      const toRoot=new THREE.Matrix4().multiplyMatrices(rig.group.parent.matrixWorld.clone().invert(),rig.cloak.matrixWorld),back=toRoot.clone().invert();
      const center=rig.hips.getWorldPosition(new THREE.Vector3());rig.group.parent.worldToLocal(center);const gather=smooth((blend-.18)/.24),uv=g.attributes.uv;
      for(let i=0;i<p.count;i++){
        V.fromBufferAttribute(p,i).applyMatrix4(toRoot);const row=uv?1-uv.getY(i):Math.floor(i/37)/24,fold=gather*smooth((row-.08)/.22),pleat=Math.sin(row*Math.PI*6);
        V.x=THREE.MathUtils.lerp(V.x,center.x+clamp(V.x-center.x,-.214,.214),fold);
        V.y=THREE.MathUtils.lerp(V.y,Math.max(V.y,center.y-.10+.018*pleat),fold);
        V.z=THREE.MathUtils.lerp(V.z,center.z-.215-.022*pleat,fold);V.y=Math.max(.045,V.y);V.applyMatrix4(back);p.setXYZ(i,V.x,V.y,V.z);
      }p.needsUpdate=true;g.computeVertexNormals();
    }
  }
  function finishCloth(){
    if(!active||!seat||blend<.5)return;
    const torso=rig.torso.getObjectByName('TailoredTorso'),meshes=rig.trousersBinding?[rig.trousersBinding.mesh]:['L','R'].map(side=>rig['leg'+side].getObjectByName('TailoredTrousers'));if(torso)meshes.push(torso);
    for(const mesh of meshes){if(!mesh)continue;
    const p=mesh.geometry.attributes.position;mesh.updateWorldMatrix(true,false);
    if(mesh.geometry!==originalCloth.get(mesh)?.geometry)throw Error('Garment geometry owner changed');
    const normal=mesh.geometry.attributes.normal;let frame=clothFrames.get(mesh);if(!frame){frame={base:p.array.slice(),baseNormal:normal.array.slice(),applied:null};clothFrames.set(mesh,frame);}else if(frame.applied&&p.array.every((v,i)=>v===frame.applied[i])){p.array.set(frame.base);normal.array.set(frame.baseNormal);p.needsUpdate=normal.needsUpdate=true;}else{frame.base.set(p.array);frame.baseNormal.set(normal.array);}
    M.multiplyMatrices(rig.group.parent.matrixWorld.clone().invert(),mesh.matrixWorld);inverse.copy(M).invert();
    let changed=false;
    for(let i=0;i<p.count;i++){
      V.fromBufferAttribute(p,i).applyMatrix4(M);
      if(mesh===torso){if(desk){const edge=desk.front-.018+Math.max(0,V.y-desk.top+.005)*3;if(V.z>edge&&V.y<desk.top+.065){V.z=edge;V.applyMatrix4(inverse);p.setXYZ(i,V.x,V.y,V.z);changed=true;}}continue;}
      const dx=Math.max(seat.min[0]-V.x,0,V.x-seat.max[0]),dz=Math.max(seat.min[2]-V.z,0,V.z-seat.max[2]);
      const weight=1-smooth((Math.max(dx,dz)-.04)/.035),top=seat.max[1]+.009;
      if(weight>0&&V.y<top){V.y=THREE.MathUtils.lerp(V.y,top,weight);V.applyMatrix4(inverse);p.setXYZ(i,V.x,V.y,V.z);changed=true;}
    }
    if(changed){p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
    if(!frame.applied)frame.applied=p.array.slice();else frame.applied.set(p.array);
    }
  }
  return {version:WORKSTATION_POSE_VERSION,begin,reset,apply,finishCloth,advance(){if(active)tick?.();},abort(e){onError?.(e);},get active(){return active;},get blend(){return blend;},get form(){return form;},
    setBlend(v){blend=clamp(v,0,1);},setKeys(keys){keys.forEach((k,i)=>{targets[i].fromArray(k.position);pressures[i]=k.press;});}};
}
