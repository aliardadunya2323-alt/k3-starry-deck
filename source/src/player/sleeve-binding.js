import * as THREE from 'three';
// Local sleeve connection, not a replacement skeleton. Existing hinge owns elbow.
export function createSleeveBinding(mesh, torso) {
  const arm=mesh.parent,g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal;
  const {rows,columns}=g.userData.loft||{};
  const stride=columns+1,cap=(rows+1)*stride;
  if(arm.parent!==torso||rows!==40||columns!==24||p.count!==cap+2*stride)throw Error('Unexpected sleeve topology or hierarchy');
  const restP=p.array.slice(),restN=n.array.slice(),weights=new Float64Array(rows+1);
  for(let r=0;r<=rows;r++){const t=Math.min(1,r/rows/.40);weights[r]=1-t*t*(3-2*t);}
  const edited=[],flags=new Uint8Array(p.count);
  for(let r=0;r<=rows;r++)if(weights[r]>0)for(let c=0;c<stride;c++){edited.push(r*stride+c);flags[r*stride+c]=1;}
  for(let i=cap;i<cap+stride;i++){edited.push(i);flags[i]=1;}
  const nf=new Uint8Array(p.count),idx=g.index.array,triangles=[];
  for(let j=0;j<idx.length;j+=3)if(flags[idx[j]]||flags[idx[j+1]]||flags[idx[j+2]]){nf[idx[j]]=nf[idx[j+1]]=nf[idx[j+2]]=1;}
  const normals=[];for(let i=0;i<nf.length;i++)if(nf[i])normals.push(i);
  for(let j=0;j<idx.length;j+=3)if(nf[idx[j]]||nf[idx[j+1]]||nf[idx[j+2]])triangles.push(idx[j],idx[j+1],idx[j+2]);
  const accum=new Float64Array(p.count*3),v=new THREE.Vector3();
  arm.updateMatrix();mesh.updateMatrix();
  const bind=new THREE.Matrix4().multiplyMatrices(arm.matrix,mesh.matrix);
  const current=new THREE.Matrix4(),follow=new THREE.Matrix4(),previous=new THREE.Matrix4();
  const identity=new THREE.Matrix4(),translation=new THREE.Vector3(),scale=new THREE.Vector3();
  const rotation=new THREE.Quaternion(),q=new THREE.Quaternion(),s=new THREE.Vector3(),offset=new THREE.Vector3();
  const ringMatrices=Array.from({length:rows+1},()=>new THREE.Matrix4());
  let dirty=false,pVersion=p.version,nVersion=n.version,updates=0;
  p.setUsage(THREE.DynamicDrawUsage);n.setUsage(THREE.DynamicDrawUsage);
  const equal=(a,b)=>a.elements.every((x,i)=>Math.abs(x-b.elements[i])<1e-12);
  const local=()=>{arm.updateMatrix();mesh.updateMatrix();current.multiplyMatrices(arm.matrix,mesh.matrix);};
  function refresh(){
    p.needsUpdate=true;n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();
    pVersion=p.version;nVersion=n.version;
  }
  function restore(){
    if(dirty){
      for(const i of edited)for(let c=0;c<3;c++)p.array[i*3+c]=restP[i*3+c];
      for(const i of normals)for(let c=0;c<3;c++)n.array[i*3+c]=restN[i*3+c];
      refresh();
    }
    dirty=false;previous.identity();pVersion=p.version;nVersion=n.version;
  }
  function updateNormals(){
    for(const i of normals)accum.fill(0,i*3,i*3+3);
    for(let j=0;j<triangles.length;j+=3){
      const a=triangles[j]*3,b=triangles[j+1]*3,c=triangles[j+2]*3;
      const bx=p.array[b]-p.array[a],by=p.array[b+1]-p.array[a+1],bz=p.array[b+2]-p.array[a+2];
      const cx=p.array[c]-p.array[a],cy=p.array[c+1]-p.array[a+1],cz=p.array[c+2]-p.array[a+2];
      const x=by*cz-bz*cy,y=bz*cx-bx*cz,z=bx*cy-by*cx;
      for(let k=0;k<3;k++){const i=triangles[j+k];if(nf[i]){accum[i*3]+=x;accum[i*3+1]+=y;accum[i*3+2]+=z;}}
    }
    for(const i of normals){const a=i*3,len=Math.hypot(accum[a],accum[a+1],accum[a+2])||1;n.setXYZ(i,accum[a]/len,accum[a+1]/len,accum[a+2]/len);}
    for(let r=0;r<=rows;r++){const a=r*stride,b=a+columns;if(!nf[a])continue;
      v.set(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();
      n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);
    }
  }
  function update(){
    if(mesh.parent!==arm||arm.parent!==torso)throw Error('Sleeve hierarchy changed');
    local();follow.copy(current).invert().multiply(bind);
    if(equal(follow,identity)){restore();return false;}
    if(equal(follow,previous)&&pVersion===p.version&&nVersion===n.version)return false;
    follow.decompose(translation,rotation,scale);
    for(let r=0;r<=rows;r++)if(weights[r]>0){const w=weights[r];
      q.identity().slerp(rotation,w);offset.copy(translation).multiplyScalar(w);
      s.set(1+(scale.x-1)*w,1+(scale.y-1)*w,1+(scale.z-1)*w);
      ringMatrices[r].compose(offset,q,s);
    }
    for(const i of edited){const r=i>=cap?0:Math.floor(i/stride);
      v.fromArray(restP,i*3).applyMatrix4(ringMatrices[r]);p.setXYZ(i,v.x,v.y,v.z);
    }
    updateNormals();previous.copy(follow);dirty=true;updates++;refresh();return true;
  }
  function audit(){
    local();let capError=0,normalError=0;
    const actual=new THREE.Vector3(),expected=new THREE.Vector3();
    for(let i=cap;i<cap+stride;i++){
      actual.fromArray(p.array,i*3).applyMatrix4(current);
      expected.fromArray(restP,i*3).applyMatrix4(bind);
      capError=Math.max(capError,actual.distanceTo(expected));
    }
    for(const i of normals)normalError=Math.max(normalError,Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1));
    return {finite:p.array.every(Number.isFinite)&&n.array.every(Number.isFinite),capError,normalError,
      dirty,updates,affectedVertices:edited.length,affectedNormals:normals.length,
      firstProtectedPositionRow:16,firstProtectedNormalRow:17};
  }
  return {update,restore,audit};
}
