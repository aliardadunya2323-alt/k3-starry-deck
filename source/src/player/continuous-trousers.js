import * as THREE from 'three';
import { loadGLB } from '../util/assets.js';
import { makeRestHinge } from './private-rest.js';
export const CONTINUOUS_TROUSERS_VERSION='continuous-trousers-binding-01';
const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
export function createContinuousTrouserBinding(rig,mesh){
 const g=mesh.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),blend=g.getAttribute('_k3_blend');
 if(!p||!n||!blend||p.count!==n.count||p.count!==blend.count)throw new Error('Continuous trousers lack complete bind attributes');
 const legs=[rig.legL,rig.legR],origins=[new THREE.Vector3(.12,-.08,0),new THREE.Vector3(-.12,-.08,0)];
 if(legs.some((leg,i)=>!leg||leg.position.distanceTo(origins[i])>1e-7))throw new Error('Existing leg anchors differ from authored trousers');
 const knee=-.38,restP=p.array.slice(),restN=n.array.slice(),weights=new Float64Array(p.count*3);
 g.setAttribute('k3RestPosition',new THREE.Float32BufferAttribute(restP,3));p.setUsage(THREE.DynamicDrawUsage);n.setUsage(THREE.DynamicDrawUsage);
 for(let i=0;i<p.count;i++){const a=blend.getX(i),b=blend.getY(i),c=blend.getZ(i);if(![a,b,c].every(Number.isFinite)||Math.min(a,b,c)<0||Math.abs(a+b+c-1)>2e-5)throw new Error('Invalid authored garment weights');weights.set([a,b,c],i*3);}
 if(!restP.every(Number.isFinite)||!restN.every(Number.isFinite))throw new Error('Invalid source garment vertices');
 const home=origins.map(o=>new THREE.Matrix4().makeTranslation(o.x,o.y,o.z)),last=[new THREE.Matrix4(),new THREE.Matrix4()],normal=[new THREE.Matrix3(),new THREE.Matrix3()];
 const position=new THREE.Vector3(),norm=new THREE.Vector3(),sumP=new THREE.Vector3(),sumN=new THREE.Vector3();
 const angles=[0,0],lastAngles=[Infinity,Infinity];let first=true,updates=0,exactRest=false;
 const legacy=[rig.hips.getObjectByName('TailoredPelvis'),legs[0].getObjectByName('TailoredTrousers'),legs[1].getObjectByName('TailoredTrousers')];
 const boots=legs.map(x=>x.getObjectByName('TailoredBoot'));
 if(legacy.some(x=>!x)||boots.some(x=>!x)||!rig.restHinges)throw new Error('Missing existing trouser/boot interfaces');
 const oldHinges=legs.map(x=>x.restHinge),oldVisible=legacy.map(x=>x.visible);
 if(oldHinges.some(x=>!x||x.angle!==0))throw new Error('Attach garment before active lounge deformation');
 const newHinges=boots.map(boot=>makeRestHinge([],[boot],knee));
 let status='active',failure=null;
 function restoreLegacy(error){
  if(status==='fallback')return;status='fallback';failure=String(error);mesh.visible=false;
  legacy.forEach((x,i)=>{x.visible=oldVisible[i];});
  legs.forEach((leg,i)=>{oldHinges[i].set(newHinges[i].angle);leg.restHinge=oldHinges[i];rig.restHinges[i]=oldHinges[i];});
  console.warn('Continuous trousers reverted to existing garment:',failure);
 }
 function update(){
  if(status!=='active')return false;
  try{
   for(let i=0;i<2;i++){legs[i].updateMatrix();angles[i]=legs[i].restHinge.angle;}
   if(!first&&legs[0].matrix.equals(last[0])&&legs[1].matrix.equals(last[1])&&angles[0]===lastAngles[0]&&angles[1]===lastAngles[1])return false;
   if(!Number.isFinite(angles[0])||!Number.isFinite(angles[1]))throw new Error('Non-finite knee input');
   exactRest=legs[0].matrix.equals(home[0])&&legs[1].matrix.equals(home[1])&&angles[0]===0&&angles[1]===0;
   if(exactRest){p.array.set(restP);n.array.set(restN);}
   else{
    for(let i=0;i<2;i++)normal[i].getNormalMatrix(legs[i].matrix);
    for(let i=0;i<p.count;i++){
     const k=i*3;sumP.set(restP[k],restP[k+1],restP[k+2]).multiplyScalar(weights[k]);sumN.set(restN[k],restN[k+1],restN[k+2]).multiplyScalar(weights[k]);
     for(let side=0;side<2;side++){
      const w=weights[k+side+1];if(w===0)continue;
      position.set(restP[k],restP[k+1],restP[k+2]).sub(origins[side]);norm.set(restN[k],restN[k+1],restN[k+2]);
      const turn=angles[side]*smooth((knee+.025-position.y)/.05),c=Math.cos(turn),s=Math.sin(turn),y=position.y-knee,z=position.z,ny=norm.y,nz=norm.z;
      position.y=knee+y*c-z*s;position.z=y*s+z*c;norm.y=ny*c-nz*s;norm.z=ny*s+nz*c;
      position.applyMatrix4(legs[side].matrix);norm.applyMatrix3(normal[side]).normalize();sumP.addScaledVector(position,w);sumN.addScaledVector(norm,w);
     }
     if(!Number.isFinite(sumP.lengthSq())||!Number.isFinite(sumN.lengthSq())||sumN.lengthSq()<1e-12)throw new Error('Invalid garment deformation');
     sumN.normalize();p.setXYZ(i,sumP.x,sumP.y,sumP.z);n.setXYZ(i,sumN.x,sumN.y,sumN.z);
    }
   }
   p.needsUpdate=true;n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();
   for(let i=0;i<2;i++){last[i].copy(legs[i].matrix);lastAngles[i]=angles[i];}first=false;updates++;return true;
  }catch(error){restoreLegacy(error);return false;}
 }
 legs.forEach((leg,i)=>{leg.restHinge=newHinges[i];rig.restHinges[i]=newHinges[i];});
 legacy.forEach(x=>{x.visible=false;});
 update();
 return {update,mesh,version:CONTINUOUS_TROUSERS_VERSION,audit:()=>({status,failure,updates,exactRest,vertices:p.count,triangles:g.index.count/3,finite:p.array.every(Number.isFinite)&&n.array.every(Number.isFinite),legacyHidden:legacy.every(x=>!x.visible),sourceVersion:mesh.userData.k3ContinuousTrousers})};
}
export async function attachContinuousTrousers(rig){
 if(!rig)return null;
 let mesh=null;
 try{
  const gltf=await loadGLB('traveler-trousers.glb');gltf.scene.updateMatrixWorld(true);
  mesh=gltf.scene.getObjectByName('K3ContinuousTrousers');
  if(!mesh?.isMesh||!String(mesh.userData.k3ContinuousTrousers||'').startsWith('continuous-trousers-'))throw new Error('Unexpected trouser asset identity');
  const identity=new THREE.Matrix4();if(!mesh.matrixWorld.equals(identity))throw new Error('Trouser asset must use authored hip-local coordinates');
  const pelvis=rig.hips.getObjectByName('TailoredPelvis');if(!pelvis?.material)throw new Error('No existing cloth material to preserve');
  const originalGeometry=mesh.geometry,originalMaterial=mesh.material;mesh.geometry=originalGeometry.clone();originalGeometry.dispose();
  const base=pelvis.material,cloth=base.clone(),compile=base.onBeforeCompile,cacheKey=base.customProgramCacheKey();
  cloth.name=base.name+'-Continuous';cloth.userData.k3RestWeave='pending';
  cloth.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);const token='k3GarmentPosition = position;';if(shader.vertexShader.includes(token)){shader.vertexShader='attribute vec3 k3RestPosition;'+String.fromCharCode(10)+shader.vertexShader.replace(token,'k3GarmentPosition = k3RestPosition;');this.userData.k3RestWeave=true;}else this.userData.k3RestWeave=false;};
  cloth.customProgramCacheKey=()=>cacheKey+'-continuous-rest-01';mesh.material=cloth;if(originalMaterial!==mesh.material)originalMaterial.dispose();
  mesh.castShadow=true;mesh.receiveShadow=pelvis.receiveShadow;rig.hips.add(mesh);
  rig.trousersBinding=createContinuousTrouserBinding(rig,mesh);rig.trousersStatus=rig.trousersBinding.audit().status;
  return rig.trousersBinding;
 }catch(error){
  if(mesh?.parent)mesh.parent.remove(mesh);rig.trousersStatus='legacy-fallback';rig.trousersLoadError=String(error);
  console.warn('Continuous trousers not loaded; existing playable garment retained:',error);return null;
 }
}
