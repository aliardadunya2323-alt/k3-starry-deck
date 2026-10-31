import * as THREE from 'three';
import {placeCatPaw,updateCatTail} from './cat-poses.js';
export const BED_REST_VERSION = 'visible-bed-01';
const keys=['group','hips','torso','legL','legR','armL','armR','headGroup','staff'];
const clamp=x=>Math.min(1,Math.max(0,x));
const ease=x=>{const k=clamp(x);return k*k*(3-2*k);};

// The existing lower bunk is two metres long. Keep the current body and its
// costume bindings; the left sleeping lane is clear of the narrow upper bunk.
export function createBedRest(rigs){
 let active=false,blend=0;const saved=new Map(),propFrom=new Map(),point=new THREE.Vector3(),q=new THREE.Quaternion(),e=new THREE.Euler();
 const cloth=[],start=new THREE.Vector3();let startHeading=0;
 const origin=new THREE.Vector3(),supportMatrix=new THREE.Matrix4();
 const supportCells=new Map(),clothMatrix=new THREE.Matrix4(),clothInverse=new THREE.Matrix4(),rootInverse=new THREE.Matrix4();
 const rootPoint=new THREE.Vector3(),propPoint=new THREE.Vector3(),propRotation=new THREE.Quaternion(),groupRotation=new THREE.Quaternion();
 const headingRotation=new THREE.Quaternion(),axisY=new THREE.Vector3(0,1,0),surfaces=[];
 let bedRoot=null,catSoles=null,supportReady=false;
 function buildSupport(){
  // Index the actual lower-bunk triangles once in bed-local X/Z. Looking up
  // their plane heights avoids approximate grid gaps at folds and thousands
  // of fresh ray/triangle traversals during the climb.
  for(const mesh of surfaces){
   const geometry=mesh.geometry,p=geometry.attributes.position,index=geometry.index,vertices=[];
   supportMatrix.multiplyMatrices(rootInverse,mesh.matrixWorld);
   for(let i=0;i<p.count;i++){mesh.getVertexPosition(i,origin);vertices.push(origin.clone().applyMatrix4(supportMatrix));}
   const n=index?index.count:p.count;
   for(let i=0;i<n;i+=3){
    const a=vertices[index?index.getX(i):i],b=vertices[index?index.getX(i+1):i+1],c=vertices[index?index.getX(i+2):i+2];
    const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(den)<1e-12)continue;
    const triangle={a,b,c,den};
    for(let x=Math.floor(Math.min(a.x,b.x,c.x)*10);x<=Math.floor(Math.max(a.x,b.x,c.x)*10);x++){
     let column=supportCells.get(x);if(!column){column=new Map();supportCells.set(x,column);}
     for(let z=Math.floor(Math.min(a.z,b.z,c.z)*10);z<=Math.floor(Math.max(a.z,b.z,c.z)*10);z++){
      let cell=column.get(z);if(!cell){cell=[];column.set(z,cell);}cell.push(triangle);
     }
    }
   }
  }
  supportReady=true;
 }
 function sampleSupport(x,z){
  if(!surfaces.length)return .65;
  const cell=supportCells.get(Math.floor(x*10))?.get(Math.floor(z*10));let height=0;if(!cell)return height;
  for(const {a,b,c,den}of cell){
   const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
   if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)height=Math.max(height,u*a.y+v*b.y+(1-u-v)*c.y);
  }
  return height;
 }
 function begin(options={}){
  if(active)return false;
  for(const rig of Object.values(rigs)){
   for(const key of keys){const o=rig[key];if(o)saved.set(o,{parent:o.parent,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});}
   for(const o of rig.tail||[])saved.set(o,{parent:o.parent,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});
   if(rig.cloak){const g=rig.cloak.geometry;cloth.push({g,p:g.attributes.position.array.slice(),n:g.attributes.normal.array.slice()});}
   if(rig.restHinges){rig.group.attach(rig.staff);propFrom.set(rig.staff,{p:rig.staff.position.clone(),q:rig.staff.quaternion.clone()});}
  }
  start.fromArray(options.offset||[0,0,1.35]);startHeading=Number.isFinite(options.heading)?Math.atan2(Math.sin(options.heading),Math.cos(options.heading)):0;
  bedRoot=rigs.chibi.group.parent;bedRoot.updateWorldMatrix(true,true);rootInverse.copy(bedRoot.matrixWorld).invert();
  surfaces.length=0;supportCells.clear();supportReady=false;catSoles=null;
  options.support?.updateWorldMatrix(true,true);
  options.support?.traverse(o=>{if(o.isMesh&&new THREE.Box3().setFromObject(o).min.y<bedRoot.getWorldPosition(origin).y+1)surfaces.push(o);});
  active=true;blend=0;return true;
 }
 function reset(){
  if(!active)return false;
  for(const rig of Object.values(rigs)){for(const h of rig.restHinges||[])h.reset();rig.facePerformance?.reset();}
  for(const [o,s]of saved){if(o.parent!==s.parent)s.parent.add(o);o.position.copy(s.p);o.quaternion.copy(s.q);o.scale.copy(s.s);}
  for(const rig of Object.values(rigs))if(rig.tailMesh)updateCatTail(rig.tailMesh);
  for(const {g,p,n}of cloth){g.attributes.position.array.set(p);g.attributes.normal.array.set(n);g.attributes.position.needsUpdate=true;g.attributes.normal.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();}
  saved.clear();propFrom.clear();cloth.length=0;surfaces.length=0;supportCells.clear();supportReady=false;catSoles=null;active=false;blend=0;return true;
 }
 function turn(o,x,y=0,z=0,k=blend){const s=propFrom.get(o)||saved.get(o);if(!s)return;q.setFromEuler(e.set(x,y,z));o.quaternion.copy(s.q).slerp(q,k);}
 function move(o,x,y,z,k=blend){const s=propFrom.get(o)||saved.get(o);if(s)o.position.copy(s.p).lerp(point.set(x,y,z),k);}
 function apply(rig,form){
  if(!active)return;
  // Controller.teleport updates its position first; the visible root reaches
  // the bed on the next character frame. Read that actual transform here.
  bedRoot.updateWorldMatrix(true,true);rootInverse.copy(bedRoot.matrixWorld).invert();
  if(!supportReady)buildSupport();
  if(form==='cat'){
   const clear=ease(blend/.12),align=ease((blend-.12)/.12),jump=ease((blend-.24)/.64),travel=ease((jump-.16)/.84),outside=Math.max(start.z,1.85);
   rig.group.position.set(start.x*(1-align),.625*jump+.62*Math.sin(Math.PI*jump),THREE.MathUtils.lerp(THREE.MathUtils.lerp(start.z,outside,clear),.04,travel));
   turn(rig.group,0,startHeading*(1-align),0,1);
   const settle=ease((blend-.70)/.30);
   rig.hips.position.y=THREE.MathUtils.lerp(.262,.225,settle);rig.torso.rotation.x=-.30*(1-settle);
   rig.headGroup.rotation.set(.20,0,0);
   if(!catSoles)catSoles=rig.catLegs.map((leg,i)=>{
    const p=leg.userData.catLeg,paw=p.paw,vertices=paw.geometry.attributes.position,z=(i<2?.31:-.12)+.04;let y=0;
    for(let j=0;j<vertices.count;j++)y=Math.max(y,sampleSupport(p.baseX+vertices.getX(j)*paw.scale.x,z+vertices.getZ(j)*paw.scale.z)-vertices.getY(j)*paw.scale.y);
    return y+.004-.625;
   });
   rig.group.updateWorldMatrix(true,true);
   rig.catLegs.forEach((leg,i)=>{const p=leg.userData.catLeg;placeCatPaw(rig.group,leg,p.baseX,THREE.MathUtils.lerp(p.pawHeight,catSoles[i],ease((jump-.65)/.35)),i<2?.31:-.12);});
   // Keep the long tail curled in the horizontal plane beside the body while
   // passing the bed posts; the walking tail is restored when rest ends.
   for(let i=0;i<rig.tail.length;i++){q.setFromEuler(e.set(i?.60:0,0,i?0:-Math.PI/2));rig.tail[i].quaternion.slerp(q,ease(blend/.06));}
   updateCatTail(rig.tailMesh);
   return;
  }
  const small=form==='chibi',height=small?.827:.774,shift=small?.45:.89;
  // Align outside the foot rail, sit on the edge, then recline while drawing
  // the heels onto the mattress. Early reversal follows this same path.
  const clear=ease(blend/.08),align=ease((blend-.08)/.16),sit=ease((blend-.24)/.22),lie=ease((blend-.46)/.54);
  const outside=THREE.MathUtils.lerp(start.z,Math.max(start.z,1.95),clear);
  const tilt=-Math.PI/2*lie,hipY=rig.hipsY+(.80-rig.hipsY)*sit+(height-.80)*lie+(small?.19:.14)*Math.sin(Math.PI*lie);
  const hipZ=outside+(.85-outside)*sit+(shift-rig.hipsY-.85)*Math.pow(lie,small?4:1);
  turn(rig.group,tilt,startHeading*(1-align),0,1);
  const tuck=ease((blend-.16)/.16)*(1-ease((lie-.45)/.35));
  rig.group.position.set(start.x*(1-align)-.05*tuck,hipY-Math.cos(tilt)*rig.hipsY,hipZ-Math.sin(tilt)*rig.hipsY);
  move(rig.hips,0,rig.hipsY,0,1);turn(rig.torso,(small?.42:.06)*lie,0,0,1);turn(rig.headGroup,(small?-.42:-.06)*lie,0,0,1);
  for(const [i,side]of ['L','R'].entries()){
   const finalLeg=small?(i===0?.242:.29):(i===0?.099:.100);
   turn(rig['leg'+side],-1.5*sit*(1-lie)+finalLeg*lie,0,0,1);
   const arm=rig['arm'+side],sign=i===0?1:-1,armX=small?(i===0?.40:.63):(i===0?.10:.14),base=saved.get(arm);
   arm.position.copy(base.p);arm.position.x-=sign*.035*tuck;
   turn(arm,THREE.MathUtils.lerp(armX*blend,-1.35,tuck),0,sign*THREE.MathUtils.lerp(-.025*blend,-.60,tuck),1);
   rig.restHinges[i].set(1.5*sit*(1-lie)+(small?-.02:0)*lie);rig.restHinges[i+2].set(THREE.MathUtils.lerp((small?.4:.18)*blend,-.5,tuck));
  }
  // Set the current prop down beside the rail before reclining. Its path is
  // in bed space, so rotating the body cannot sweep the shaft through cloth.
  const prop=propFrom.get(rig.staff),aside=ease(blend/.16),put=ease((blend-.16)/.18);
  headingRotation.setFromAxisAngle(axisY,startHeading);
  propPoint.copy(prop.p).applyQuaternion(headingRotation).add(start);
  propPoint.x=THREE.MathUtils.lerp(propPoint.x,-.68,aside);
  propPoint.y=THREE.MathUtils.lerp(propPoint.y,.084,put);
  propPoint.z=THREE.MathUtils.lerp(propPoint.z,shift-.54,put);
  rig.group.updateMatrix();rig.staff.position.copy(propPoint).applyMatrix4(clothInverse.copy(rig.group.matrix).invert());
  propRotation.copy(headingRotation).multiply(prop.q).slerp(q.setFromEuler(e.set(-Math.PI/2,0,0)),put);
  rig.staff.quaternion.copy(groupRotation.copy(rig.group.quaternion).invert()).multiply(propRotation);
  if(rig.cloak){
   const g=rig.cloak.geometry,p=g.attributes.position,uv=g.attributes.uv;
   rig.group.updateWorldMatrix(true,true);clothMatrix.multiplyMatrices(rootInverse,rig.cloak.matrixWorld);clothInverse.copy(clothMatrix).invert();
   for(let i=0;i<p.count;i++){
    rootPoint.fromBufferAttribute(p,i).applyMatrix4(clothMatrix);
    const v=1-uv.getY(i),fall=ease(v/.30)*lie;
    rootPoint.x=THREE.MathUtils.lerp(rootPoint.x,Math.max(-.295,rootPoint.x),fall);
    // Gather the cape between the two front posts while climbing past them.
    // These are the existing lower-lane posts, relative to the authored seat.
    const between=ease((rootPoint.z-.62)/.12)*ease((1.04-rootPoint.z)/.12);
    rootPoint.x=THREE.MathUtils.lerp(rootPoint.x,THREE.MathUtils.clamp(rootPoint.x,-.275,.23),between);
    // Give the cloth a three-millimetre footprint at the duvet's sharp edge.
    const x=rootPoint.x,z=rootPoint.z,surface=Math.max(sampleSupport(x,z),sampleSupport(x-.003,z),sampleSupport(x+.003,z),sampleSupport(x,z-.003),sampleSupport(x,z+.003)),fold=.005+.005*Math.sin(uv.getX(i)*Math.PI*12+v*4)**2;
    rootPoint.y=Math.max(surface+.009,THREE.MathUtils.lerp(rootPoint.y,surface+fold,fall));
    if(rootPoint.x>-.43&&rootPoint.x<1.27&&rootPoint.z>-1.17&&rootPoint.z<.93)rootPoint.y=Math.max(rootPoint.y,.37);
    if(rootPoint.z>.74&&rootPoint.z<.96)rootPoint.y=Math.max(rootPoint.y,.49);
    rootPoint.applyMatrix4(clothInverse);p.setXYZ(i,rootPoint.x,rootPoint.y,rootPoint.z);
   }
   p.needsUpdate=true;g.computeVertexNormals();
  }
  rig.facePerformance?.setExpression('blink',ease((blend-.68)/.28),.15);
 }
 return{version:BED_REST_VERSION,begin,reset,apply,get active(){return active;},get blend(){return blend;},setBlend(k){if(!Number.isFinite(k))throw TypeError('Finite bed blend required');blend=clamp(k);}};
}
