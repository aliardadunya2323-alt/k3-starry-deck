import * as THREE from 'three';
// Local CPU neck blend, not a complete skeletal rig. Face vertices are immutable.
export function createNeckCollarBinding(head,torso){
 const spec=head?.userData.k3NeckBinding;if(!spec)return null;
 const g=head.geometry,p=g.attributes.position,n=g.attributes.normal;
 const {firstVertex:start,rings,sides}=spec;
 if(spec.version!==1||![start,rings,sides].every(Number.isInteger)||start<0||rings<3||sides<8||start+rings*sides!==p.count||n.count!==p.count)throw new Error('Invalid neck binding metadata');
 const restP=p.array.slice(),restN=n.array.slice(),indices=Array.from(g.index.array).filter(i=>i>=start);
 if(indices.length!==(rings-1)*sides*6)throw new Error('Invalid neck topology');
 torso.updateWorldMatrix(true,true);head.updateWorldMatrix(true,false);
 const bind=new THREE.Matrix4().copy(torso.matrixWorld).invert().multiply(head.matrixWorld);
 const follow=new THREE.Matrix4(),v=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
 const identity=new THREE.Matrix4(),previous=new THREE.Matrix4();let dirty=false;
 const equal=(x,y)=>x.elements.every((v,i)=>Math.abs(v-y.elements[i])<1e-12);
 function refresh(){p.needsUpdate=true;n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();}
 function restore(){if(!dirty)return;p.array.set(restP.subarray(start*3),start*3);n.array.set(restN.subarray(start*3),start*3);dirty=false;previous.identity();refresh();}
 function update(){
  torso.updateWorldMatrix(true,true);head.updateWorldMatrix(true,false);
  follow.copy(head.matrixWorld).invert().multiply(torso.matrixWorld).multiply(bind);
  if(equal(follow,identity)){restore();return;}if(equal(follow,previous))return;
  for(let ring=0;ring<rings;ring++){
   const t=THREE.MathUtils.clamp((ring/(rings-1)-.10)/.75,0,1),weight=t*t*(3-2*t);
   for(let side=0;side<sides;side++){const i=(start+ring*sides+side)*3;v.fromArray(restP,i).applyMatrix4(follow);for(let k=0;k<3;k++)p.array[i+k]=v.getComponent(k)*(1-weight)+restP[i+k]*weight;}
  }
  n.array.fill(0,start*3);
  for(let j=0;j<indices.length;j+=3){
   const ia=indices[j]*3,ib=indices[j+1]*3,ic=indices[j+2]*3;
   a.fromArray(p.array,ia);b.fromArray(p.array,ib);c.fromArray(p.array,ic);ab.subVectors(b,a);ac.subVectors(c,a);ab.cross(ac);
   for(const i of [ia,ib,ic]){n.array[i]+=ab.x;n.array[i+1]+=ab.y;n.array[i+2]+=ab.z;}
  }
  for(let i=start*3;i<n.array.length;i+=3){v.fromArray(n.array,i).normalize().toArray(n.array,i);}
  previous.copy(follow);dirty=true;refresh();
 }
 function audit(){
  let baseError=0,topError=0;const actual=new THREE.Vector3(),expected=new THREE.Vector3();
  for(let side=0;side<sides;side++){
   let i=(start+side)*3;actual.fromArray(p.array,i).applyMatrix4(head.matrixWorld);expected.fromArray(restP,i).applyMatrix4(bind).applyMatrix4(torso.matrixWorld);baseError=Math.max(baseError,actual.distanceTo(expected));
   i=(start+(rings-1)*sides+side)*3;for(let k=0;k<3;k++)topError=Math.max(topError,Math.abs(p.array[i+k]-restP[i+k]));
  }
  return {prefixPositionsUnchanged:restP.subarray(0,start*3).every((x,i)=>x===p.array[i]),prefixNormalsUnchanged:restN.subarray(0,start*3).every((x,i)=>x===n.array[i]),finite:p.array.every(Number.isFinite)&&n.array.every(Number.isFinite),baseError,topError,dirty,vertexCount:rings*sides};
 }
 return {update,restore,audit};
}
