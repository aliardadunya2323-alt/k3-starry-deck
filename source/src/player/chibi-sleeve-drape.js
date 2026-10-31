import * as THREE from 'three';
import { torsoSection } from './costume-surface.js';

const LAST_ROW = 16, END = .4, ROOT_Y = .355, ROOT_Z = .015;
const smooth = u => u*u*(3-2*u);
function rootX(side, angle) {
  const c=Math.cos(angle), y=ROOT_Y+side*Math.sin(angle)*.045;
  const z=ROOT_Z+c*(c>=0?.062:.058), body=torsoSection('chibi',y);
  const depth=z>=0?body.front:body.back;
  return side*(body.width*Math.sqrt(Math.max(0,1-(z/depth)**2))-.009);
}

// The root belongs to the torso; row16 belongs to the original arm/hinge.
// A cubic centerline and an orthonormal section frame keep intervening cloth
// from acquiring the lumpy elbow that partial rotation about one pivot caused.
function makeCurve(side) {
  let meanX=0;for(let c=0;c<24;c++)meanX+=rootX(side,c/24*Math.PI*2)/24;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),d=new THREE.Vector3();
  const startDirection=new THREE.Vector3(),endDirection=new THREE.Vector3();
  const startQ=new THREE.Quaternion(),endQ=new THREE.Quaternion(),guideQ=new THREE.Quaternion();
  const turn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),side*Math.PI/2);
  const translation=new THREE.Vector3(),scale=new THREE.Vector3(),bindQ=new THREE.Quaternion();
  const tangent=new THREE.Vector3(),x=new THREE.Vector3(),y=new THREE.Vector3(),z=new THREE.Vector3();
  const basis=new THREE.Matrix4();
  return {meanX,
    set(bind,current){
      bind.decompose(translation,bindQ,scale);current.decompose(translation,endQ,scale);
      a.set(meanX-side*.24,ROOT_Y-.38,ROOT_Z-.02).applyMatrix4(bind);
      d.set(0,-.3*END,0).applyMatrix4(current);
      startDirection.set(side,0,0).applyQuaternion(bindQ);
      endDirection.set(0,-1,0).applyQuaternion(endQ);
      const handle=THREE.MathUtils.clamp(a.distanceTo(d)*.48,.025,.08);
      b.copy(a).addScaledVector(startDirection,handle);
      c.copy(d).addScaledVector(endDirection,-handle);
      startQ.copy(bindQ).multiply(turn);
      return this;
    },
    frame(u,position,rotation){
      const v=1-u;
      position.copy(a).multiplyScalar(v*v*v).addScaledVector(b,3*v*v*u)
        .addScaledVector(c,3*v*u*u).addScaledVector(d,u*u*u);
      tangent.copy(b).sub(a).multiplyScalar(3*v*v);
      x.copy(c).sub(b);tangent.addScaledVector(x,6*v*u);
      x.copy(d).sub(c);tangent.addScaledVector(x,3*u*u).normalize();
      y.copy(tangent).negate();guideQ.copy(startQ).slerp(endQ,smooth(u));
      z.set(0,0,1).applyQuaternion(guideQ);z.addScaledVector(y,-z.dot(y));
      if(z.lengthSq()<1e-10){x.set(1,0,0).applyQuaternion(guideQ);x.addScaledVector(y,-x.dot(y)).normalize();z.crossVectors(x,y);}
      z.normalize();x.crossVectors(y,z).normalize();z.crossVectors(x,y).normalize();
      basis.makeBasis(x,y,z);rotation.setFromRotationMatrix(basis);
    }
  };
}

const neutral=new Map(),point=new THREE.Vector3(),center=new THREE.Vector3(),frameQ=new THREE.Quaternion();
function restCurve(side){
  if(!neutral.has(side)){
    const bind=new THREE.Matrix4().makeTranslation(side*.24,.38,.02);
    neutral.set(side,makeCurve(side).set(bind,bind));
  }
  return neutral.get(side);
}
export function chibiSleevePoint(t,angle,original,side){
  if(t>=END)return original;
  const curve=restCurve(side),u=t/END,fade=1-smooth(u),c=Math.cos(angle);
  curve.frame(u,center,frameQ);
  const radial=original[0]*(1+(.045/.053-1)*fade);
  const depth=original[2]+c*((c>=0?.062-.052:.058-.048))*fade;
  const axial=(rootX(side,angle)-curve.meanX)*side*fade;
  point.set(radial,-axial,depth).applyQuaternion(frameQ).add(center);
  return [point.x-side*.24,point.y-.38,point.z-.02];
}

export function createChibiSleeveBinding(mesh,torso,side){
  if(side!==-1&&side!==1)throw Error('Invalid chibi sleeve side');
  const arm=mesh.parent,g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal;
  const {rows,columns}=g.userData.loft||{},stride=columns+1,cap=(rows+1)*stride;
  if(arm.parent!==torso||rows!==40||columns!==24||p.count!==cap+2*stride)throw Error('Unexpected chibi sleeve topology');
  const restP=p.array.slice(),restN=n.array.slice(),edited=[],flags=new Uint8Array(p.count);
  for(let i=0;i<LAST_ROW*stride;i++){edited.push(i);flags[i]=1;}
  for(let i=cap;i<cap+stride;i++){edited.push(i);flags[i]=1;}
  const nf=new Uint8Array(p.count),idx=g.index.array,triangles=[];
  for(let j=0;j<idx.length;j+=3)if(flags[idx[j]]||flags[idx[j+1]]||flags[idx[j+2]])nf[idx[j]]=nf[idx[j+1]]=nf[idx[j+2]]=1;
  const normals=[];for(let i=0;i<nf.length;i++)if(nf[i])normals.push(i);
  for(let j=0;j<idx.length;j+=3)if(nf[idx[j]]||nf[idx[j+1]]||nf[idx[j+2]])triangles.push(idx[j],idx[j+1],idx[j+2]);
  const accum=new Float64Array(p.count*3),v=new THREE.Vector3(),position=new THREE.Vector3(),rotation=new THREE.Quaternion();
  const inverseQ=new THREE.Quaternion(),coefficients=new Float64Array(LAST_ROW*stride*3);
  arm.updateMatrix();mesh.updateMatrix();
  const bind=new THREE.Matrix4().multiplyMatrices(arm.matrix,mesh.matrix),current=new THREE.Matrix4();
  const inverse=new THREE.Matrix4(),follow=new THREE.Matrix4(),previous=new THREE.Matrix4(),curve=makeCurve(side).set(bind,bind);
  for(let r=0;r<LAST_ROW;r++){
    curve.frame(r/LAST_ROW,position,rotation);inverseQ.copy(rotation).invert();
    for(let c=0;c<stride;c++){const i=r*stride+c;v.fromArray(restP,i*3).applyMatrix4(bind).sub(position).applyQuaternion(inverseQ);v.toArray(coefficients,i*3);}
  }
  let dirty=false,pVersion=p.version,nVersion=n.version,updates=0;
  p.setUsage(THREE.DynamicDrawUsage);n.setUsage(THREE.DynamicDrawUsage);
  const equal=(a,b)=>a.elements.every((x,i)=>Math.abs(x-b.elements[i])<1e-12);
  const local=()=>{arm.updateMatrix();mesh.updateMatrix();current.multiplyMatrices(arm.matrix,mesh.matrix);};
  function refresh(){p.needsUpdate=true;n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();pVersion=p.version;nVersion=n.version;}
  function restore(){
    if(dirty){for(const i of edited)for(let c=0;c<3;c++)p.array[i*3+c]=restP[i*3+c];for(const i of normals)for(let c=0;c<3;c++)n.array[i*3+c]=restN[i*3+c];refresh();}
    dirty=false;previous.copy(bind);pVersion=p.version;nVersion=n.version;
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
    for(let r=0;r<=rows;r++){const a=r*stride,b=a+columns;if(!nf[a])continue;v.set(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);}
  }
  function update(){
    if(mesh.parent!==arm||arm.parent!==torso)throw Error('Chibi sleeve hierarchy changed');
    local();if(equal(current,bind)){restore();return false;}
    if(equal(current,previous)&&pVersion===p.version&&nVersion===n.version)return false;
    inverse.copy(current).invert();curve.set(bind,current);
    for(let r=0;r<LAST_ROW;r++){
      curve.frame(r/LAST_ROW,position,rotation);
      for(let c=0;c<stride;c++){const i=r*stride+c;v.fromArray(coefficients,i*3).applyQuaternion(rotation).add(position).applyMatrix4(inverse);p.setXYZ(i,v.x,v.y,v.z);}
    }
    follow.copy(inverse).multiply(bind);
    for(let i=cap;i<cap+stride;i++){v.fromArray(restP,i*3).applyMatrix4(follow);p.setXYZ(i,v.x,v.y,v.z);}
    updateNormals();previous.copy(current);dirty=true;updates++;refresh();return true;
  }
  function audit(){
    local();let capError=0,normalError=0;
    const actual=new THREE.Vector3(),expected=new THREE.Vector3();
    for(let i=cap;i<cap+stride;i++){actual.fromArray(p.array,i*3).applyMatrix4(current);expected.fromArray(restP,i*3).applyMatrix4(bind);capError=Math.max(capError,actual.distanceTo(expected));}
    for(const i of normals)normalError=Math.max(normalError,Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1));
    return {version:'chibi-curved-sleeve-v04',finite:p.array.every(Number.isFinite)&&n.array.every(Number.isFinite),capError,normalError,dirty,updates,affectedVertices:edited.length,affectedNormals:normals.length,firstProtectedPositionRow:16,firstProtectedNormalRow:17};
  }
  return {update,restore,audit};
}
