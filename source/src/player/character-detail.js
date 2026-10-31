import * as THREE from 'three';
import { travelerBodySkinMaterial } from './character-shading.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { connectedAwakenedGrip } from './connected-grip.js';
export const CHARACTER_DETAIL_VERSION = 'traveler-detail-01';
export const DETAIL_CLOAK_COLS = 36, DETAIL_CLOAK_ROWS = 24;
const mix = (a,b,t) => a+(b-a)*t;
const vectors = points=>points.map(p=>new THREE.Vector3(...p));

// Closed smooth section sweeps. Six anatomical masses intersect inside the
// palm and share one draw call; this is not a rigged five-finger animation.
function sweep(points, widths, depths, sides=10, axis=new THREE.Vector3(1,0,0), backDepths=null, sectionTangent=null, sectionPower=1) {
  const pos=[], uv=[], idx=[];
  const tangent=new THREE.Vector3(), across=new THREE.Vector3(), normal=new THREE.Vector3();
  for(let r=0;r<points.length;r++) {
    if(sectionTangent)tangent.copy(sectionTangent);
    else tangent.subVectors(points[Math.min(points.length-1,r+1)],points[Math.max(0,r-1)]).normalize();
    across.copy(axis).addScaledVector(tangent,-axis.dot(tangent)).normalize();
    normal.crossVectors(tangent,across).normalize();
    for(let c=0;c<sides;c++) {
      const a=c/sides*Math.PI*2;
      const depth=backDepths&&Math.sin(a)<0?backDepths[r]:depths[r];
      const shape=v=>sectionPower===1?v:Math.sign(v)*Math.abs(v)**sectionPower;
      const p=points[r].clone().addScaledVector(across,shape(Math.cos(a))*widths[r]).addScaledVector(normal,shape(Math.sin(a))*depth);
      pos.push(p.x,p.y,p.z);uv.push(c/sides,r/(points.length-1));
      if(r<points.length-1) {const k=r*sides+c,n=r*sides+(c+1)%sides;idx.push(k,n,k+sides,n,n+sides,k+sides);}
    }
  }
  for(const end of [0,points.length-1]) {
    const p=points[end],center=pos.length/3;pos.push(p.x,p.y,p.z);uv.push(.5,end?1:0);
    for(let c=0;c<sides;c++) {const a=end*sides+c,b=end*sides+(c+1)%sides;if(end)idx.push(center,a,b);else idx.push(center,b,a);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function merged(parts,role) {
  const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();g.computeBoundingBox();g.computeBoundingSphere();
  g.userData={k3CharacterDetail:CHARACTER_DETAIL_VERSION,role};return g;
}

function addAwakenedGripDigits(parts) {
  const levels=[.024,.006,-.012,-.029],roots=[.014,-.001,-.017,-.030];
  for(let d=0;d<4;d++) {
    const points=[new THREE.Vector3(-.021,roots[d],.043+.002*d)],widths=[.009],depths=[.008],pads=[.008];
    for(let r=0;r<=14;r++) {
      const t=r/14,a=mix(3.91,.18,t),joint=Math.exp(-(((t-.30)/.09)**2))+.65*Math.exp(-(((t-.69)/.08)**2)),radius=.0265+.0028*joint;
      points.push(new THREE.Vector3(Math.cos(a)*radius,levels[d]-.0035*t,.08+Math.sin(a)*radius));
      const tip=t>.85?Math.sqrt(Math.max(.04,1-((t-.85)/.155)**2)):1;
      const pad=mix(d===3?.0079:.0086,.0068,t)*tip;
      widths.push(pad*(1+.10*joint));depths.push(pad*(1+.18*joint));pads.push(pad*.97);
    }
    parts.push(sweep(points,widths,depths,12,new THREE.Vector3(0,1,0),pads,null,.67));
  }
  parts.push(sweep(vectors([[.017,.012,.032],[.029,.010,.046],[.031,-.003,.061],[.023,-.019,.062],[.010,-.029,.056]]),
    [.013,.012,.010,.008,.003],[.012,.011,.009,.008,.003],12));
}

function sculptedAwakenedHand(grip) {
  if(grip)return connectedAwakenedGrip();
  const parts=[],sides=24;
  // The proximal ring is buried in the forearm; the palm thins gradually.
  const palmY=[.055,.038,.026,.014,.004,-.007,-.018,-.027,-.036,-.040];
  const palmZ=grip?[0,0,0,0,.022,.037,.046,.049,.050,.050]:[0,0,0,0,.003,.006,.008,.010,.011,.012];
  const controls=palmY.map((y,i)=>[grip?-.010*Math.max(0,i-3)/6:0,y,palmZ[i],
    [.030,.0315,.0315,.0295,.032,.035,.035,.032,.024,.015][i],
    [.030,.0327,.0327,.030,.024,.019,.016,.013,.010,.005][i],
    [.0275,.0302,.0302,.028,.022,.018,.015,.012,.009,.005][i]]);
  let rows=controls;
  if(grip){
    rows=controls.slice(0,4);
    const slope=(i,k)=>{const d0=controls[i][k]-controls[Math.max(0,i-1)][k],d1=controls[Math.min(9,i+1)][k]-controls[i][k];return d0*d1>0?2*d0*d1/(d0+d1):0;};
    for(let i=3;i<9;i++)for(let n=1;n<=4;n++){const t=n/4,t2=t*t,t3=t2*t;rows.push(controls[i].map((a,k)=>(2*t3-3*t2+1)*a+(t3-2*t2+t)*slope(i,k)+(-2*t3+3*t2)*controls[i+1][k]+(t3-t2)*slope(i+1,k)));}
  }
  parts.push(sweep(vectors(rows.map(r=>r.slice(0,3))),rows.map(r=>r[3]),rows.map(r=>r[4]),sides,new THREE.Vector3(1,0,0),rows.map(r=>r[5]),new THREE.Vector3(0,-1,0)));
  if(!grip) {
    const xs=[-.027,-.009,.010,.028],lengths=[.048,.059,.055,.041];
    for(let d=0;d<4;d++) {
      const points=[],widths=[],depths=[];
      for(let r=0;r<=12;r++) {
        const t=r/12,tip=t>.83?Math.sqrt(Math.max(.025,1-((t-.83)/.174)**2)):1;
        const radius=(d===3?.0078:.0089)*(1-.22*t)*tip;
        points.push(new THREE.Vector3(xs[d]*(1+.10*t),-.025-lengths[d]*t,.009+.023*t*t));
        widths.push(radius);depths.push(radius*.88);
      }
      parts.push(sweep(points,widths,depths,12));
    }
    parts.push(sweep(vectors([[-.024,.007,.006],[-.035,-.003,.013],[-.045,-.018,.022],[-.048,-.032,.032],[-.043,-.042,.037]]),
      [.013,.012,.010,.007,.002],[.012,.011,.009,.007,.002],12));
  } else {
    addAwakenedGripDigits(parts);
  }
  const palmVertices=parts[0].attributes.position.count;
  const g=merged(parts,grip?'shaft-contact-five-digit-hand':'relaxed-five-digit-hand');
  g.userData.digits=5;g.userData.handSculpt='awakened-wrist-palm-04';
  if(grip)g.userData.gripAxis={z:.08,radius:.018,pivotY:.01,palmVertices,palmSides:sides,cuffRings:4,cuffY:.014,blendEndY:-.027,wristPivot:[0,.014,0]};
  return g;
}

export function travelerHandGeometry(form,grip=false) {
  if(!['chibi','awakened'].includes(form))throw new RangeError('Unknown traveler form');
  if(form==='awakened')return sculptedAwakenedHand(grip);
  const parts=[];
  if(!grip) {
    parts.push(sweep(vectors([[0,.041,0],[0,.028,0],[0,.011,.001],[0,-.007,.003],[0,-.022,.005],[0,-.028,.007]]),[.017,.026,.034,.036,.032,.022],[.011,.015,.018,.018,.014,.009],12));
    const xs=[-.026,-.009,.009,.026],lengths=[.048,.059,.055,.043];
    for(let digit=0;digit<4;digit++) {
      const points=[],widths=[],depths=[];
      for(let r=0;r<=8;r++) {const t=r/8,base=digit===3?.008:.0092,rad=base*(1-.18*t)*(t>.87?Math.sqrt(1-Math.pow((t-.87)/.16,2)):1);
        points.push(new THREE.Vector3(xs[digit]*(1+.08*t),-.019-lengths[digit]*t,.006+.019*t*t));
        widths.push(rad);depths.push(rad*.86);}
      parts.push(sweep(points,widths,depths));
    }
    parts.push(sweep(vectors([[-.024,.014,.004],[-.036,.004,.010],[-.046,-.009,.019],[-.049,-.023,.027],[-.044,-.035,.031]]),[.012,.011,.009,.007,.002],[.011,.010,.008,.006,.002]));
    const g=merged(parts,'relaxed-five-digit-hand');if(form==='chibi')g.scale(.85,.80,.88);
    g.computeBoundingBox();g.computeBoundingSphere();g.userData.digits=5;return g;
  }
  // Existing anchors are z=.10 for the staff and .08 for the blade.
  const z=form==='chibi'?.10:.08,shaft=form==='chibi'?.030:.018,radius=shaft+.010,rootZ=z-radius-.015;
  parts.push(sweep(vectors([[0,.042,0],[-.003,.028,rootZ*.35],[-.009,.011,rootZ*.8],[-.015,-.010,rootZ],[-.020,-.027,rootZ+.009]]),[.016,.023,.027,.025,.013],[.010,.013,.014,.012,.008],12));
  for(let digit=0;digit<4;digit++) {
    const points=[new THREE.Vector3(-.019,.026-digit*.018,rootZ+.007)],widths=[.008],depths=[.008];
    for(let r=0;r<=9;r++) {const t=r/9,a=mix(3.87,.20,t);
      points.push(new THREE.Vector3(Math.cos(a)*radius,.026-digit*.018-.003*Math.sin(t*Math.PI),z+Math.sin(a)*radius));
      widths.push(r===9?.003:mix(.0086,.006,t));depths.push(r===9?.003:mix(.0086,.006,t));}
    parts.push(sweep(points,widths,depths,10,new THREE.Vector3(0,1,0)));
  }
  parts.push(sweep(vectors([[.010,.025,rootZ*.65],[.023,.015,rootZ+.004],[.028,-.002,z-shaft-.004],[.018,-.018,z-shaft-.006]]),[.012,.010,.008,.003],[.010,.009,.008,.003]));
  const palmVertices=parts[0].attributes.position.count;
  const g=merged(parts,'shaft-contact-five-digit-hand');g.userData.digits=5;g.userData.gripAxis={z,radius:shaft,pivotY:form==='chibi'?.03:.01,palmVertices};return g;
}

// The authored weapon tilts independently from the arm during locomotion.
// Keep the cuff ring fixed, but follow that rotation with the distal palm and
// fingers. This is a small procedural wrist blend, not a finger skeleton.
export function createTravelerGrip(geometry) {
  const axis=geometry.userData.gripAxis;
  if(!axis)throw new TypeError('Grip follower requires a gripping hand');
  const positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice();
  const weights=new Float32Array(geometry.attributes.position.count),shaftPivot=new THREE.Vector3(0,axis.pivotY,axis.z);
  const pivot=axis.wristPivot?new THREE.Vector3(...axis.wristPivot):shaftPivot;
  const offset=new THREE.Vector3();
  const explicit=geometry.getAttribute('gripWeight');
  if(explicit&&explicit.count!==weights.length)throw new TypeError('Grip weight count must match vertices');
  for(let i=0;i<weights.length;i++){
    if(explicit){const w=explicit.getX(i);if(!Number.isFinite(w)||w<0||w>1)throw new TypeError('Grip weight outside [0,1]');weights[i]=w;continue;}
    const cuff=i<(axis.palmSides??12)*(axis.cuffRings??1)||i===axis.palmVertices-2;
    const blend=axis.palmSides
      ?(axis.cuffY-positions[i*3+1]+(axis.wristPivot?0:axis.frontBias*positions[i*3+2]))/(axis.cuffY-axis.blendEndY)
      :(.042-positions[i*3+1])/.014;
    const u=cuff?0:i>=axis.palmVertices?1:Math.max(0,Math.min(1,blend));
    weights[i]=u*u*(3-2*u);
  }
  const point=new THREE.Vector3(),turn=new THREE.Quaternion(),last=new THREE.Quaternion();let active=false;
  const arc=axis.deformation==='integrated-wrist-arc-01';
  const length=axis.cuffY-axis.blendEndY;
  if(arc&&(!Number.isFinite(length)||length<=0))throw new TypeError('Positive wrist arc length required');
  const rotation=new THREE.Quaternion(),direction=new THREE.Vector3(),straight=new THREE.Vector3(0,-length,0);
  const parallel=new THREE.Vector3(),perpendicular=new THREE.Vector3(),cross=new THREE.Vector3();
  const center=new THREE.Vector3(),rigidShift=new THREE.Vector3();let angle=0;
  // Integrate the rotated centerline tangent. Unlike a weighted rotation
  // around one pivot, the wrist retains bend length instead of pinching.
  // Full-weight fingers remain rigid; the prop receives the same shift.
  function arcCenter(u,target){
    const a=angle*u,a2=a*a;
    const sine=angle<1e-4?u*(1-a2/6+a2*a2/120):Math.sin(a)/angle;
    const cosine=angle<1e-4?angle*u*u*(.5-a2/24+a2*a2/720):(1-Math.cos(a))/angle;
    return target.copy(pivot).addScaledVector(parallel,u).addScaledVector(perpendicular,sine).addScaledVector(cross,cosine);
  }
  const refresh=()=>{geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();};
  function reset(){offset.set(0,0,0);if(!active)return false;geometry.attributes.position.array.set(positions);geometry.attributes.normal.array.set(normals);active=false;last.identity();refresh();return true;}
  function update(quaternion,enabled=true){
    if(!enabled)return reset();
    if(![quaternion.x,quaternion.y,quaternion.z,quaternion.w].every(Number.isFinite))throw new TypeError('Finite grip rotation required');
    if(active&&last.equals(quaternion))return false;
    if(axis.wristPivot)offset.copy(shaftPivot).sub(pivot).applyQuaternion(quaternion).add(pivot).sub(shaftPivot);
    if(arc){
      rotation.copy(quaternion).normalize();
      if(rotation.w<0)rotation.set(-rotation.x,-rotation.y,-rotation.z,-rotation.w);
      const sineHalf=Math.hypot(rotation.x,rotation.y,rotation.z);angle=2*Math.atan2(sineHalf,rotation.w);
      direction.set(rotation.x,rotation.y,rotation.z);if(sineHalf>0)direction.multiplyScalar(1/sineHalf);else direction.set(1,0,0);
      parallel.copy(direction).multiplyScalar(direction.dot(straight));
      perpendicular.copy(straight).sub(parallel);cross.crossVectors(direction,perpendicular);
      arcCenter(1,rigidShift).sub(pivot);center.copy(straight).applyQuaternion(rotation);rigidShift.sub(center);
      offset.add(rigidShift);
    }
    const p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const j=i*3;point.set(positions[j],positions[j+1],positions[j+2]);
      if(weights[i]>0){
        const u=weights[i];
        if(arc&&u===1){
          point.sub(pivot).applyQuaternion(rotation).add(pivot).add(rigidShift);
        }else if(arc){
          turn.identity().slerp(rotation,u);
          point.sub(pivot).addScaledVector(straight,-u).applyQuaternion(turn);
          arcCenter(u,center);point.add(center);
        }else{turn.identity().slerp(quaternion,u);point.sub(pivot).applyQuaternion(turn).add(pivot);}
      }
      p.setXYZ(i,point.x,point.y,point.z);}
    geometry.computeVertexNormals();last.copy(quaternion);active=true;refresh();return true;
  }
  geometry.userData.gripFollower=arc?'integrated-wrist-arc-01':explicit?'connected-wrist-05':axis.wristPivot?'wrist-sections-03':axis.palmSides?'wrist-blend-02':'wrist-blend-01';
  return {update,reset,offset};
}

export function posteriorHairGeometry() {
  const rx=.137,ry=.146,rz=.148,parts=[];
  const point=(theta,phi,lift=0)=>{const nape=Math.max(0,(theta-1.45)/.9);return new THREE.Vector3(Math.sin(phi)*Math.sin(theta)*(rx+lift)*(1-.28*nape*nape),Math.cos(theta)*(ry+lift)+.002,-Math.cos(phi)*Math.sin(theta)*(rz+lift));};
  const rows=20,cols=30,pos=[],uv=[],idx=[];
  for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){
    const t=r/rows,phi=mix(-1.48,1.48,c/cols),theta=mix(.13,1.99+.045*Math.cos(phi*5),t),p=point(theta,phi);
    pos.push(p.x,p.y,p.z);uv.push(c/cols,1-t);
    if(r<rows&&c<cols){const a=r*(cols+1)+c,b=a+cols+1;idx.push(a,a+1,b,a+1,b+1,b);}
  }
  const cap=new THREE.BufferGeometry();cap.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  cap.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));cap.setIndex(idx);cap.computeVertexNormals();parts.push(cap);
  // Two staggered layers rooted on a continuous scalp; no alpha-card fringe.
  for(const layer of [0,1])for(let i=0;i<(layer?9:13);i++) {
    const count=layer?9:13,phi0=mix(-1.35,1.35,i/(count-1)),points=[],widths=[],depths=[];
    const theta0=layer?.25:.75,theta1=layer?1.47+.09*Math.sin(i*1.6):2.15+.13*Math.sin(i*2.1);
    for(let r=0;r<=12;r++) {
      const t=r/12,phi=phi0+.09*Math.sin(t*Math.PI)*Math.sin(i*1.7)+.035*t,theta=mix(theta0,theta1,t);
      points.push(point(theta,phi,(layer?.012:.005)+.005*Math.sin(t*Math.PI)));
      const taper=Math.max(.018,Math.pow(1-t,.7));
      widths.push((layer?.030:.025)*(.75+.25*Math.sin(t*Math.PI))*taper*Math.max(.35,Math.sin(theta)));
      depths.push(.0006+.0038*Math.sin(Math.PI*(.14+.86*t)));
    }
    const middle=points[6],radial=new THREE.Vector3(middle.x/rx,middle.y/ry,middle.z/rz).normalize();
    const tangent=points[7].clone().sub(points[5]).normalize();
    parts.push(sweep(points,widths,depths,8,new THREE.Vector3().crossVectors(radial,tangent).normalize()));
  }
  return merged(parts,'layered-posterior-hair');
}

export function dressPosteriorHair(hair,form) {
  // Do not add hidden strands under chibi's authored hood.
  if(form!=='awakened'||!hair||hair.userData.k3PosteriorHair)return null;
  const original=hair.geometry,source=original.index;if(!source)throw new Error('Rebuilt hair must remain indexed');
  const p=original.attributes.position,kept=[];let removed=0;
  const radial=i=>Math.hypot(p.getX(i)/.137,p.getY(i)/.146,p.getZ(i)/.148);
  for(let i=0;i<source.count;i+=3){const a=source.getX(i),b=source.getX(i+1),c=source.getX(i+2);
    // Retain the original swept silhouette tips, only replace the inner cap.
    if(p.getZ(a)<-.027&&p.getZ(b)<-.027&&p.getZ(c)<-.027&&Math.max(radial(a),radial(b),radial(c))<1.10){removed++;continue;}kept.push(a,b,c);}
  // Keep front/bang positions and normals byte-for-byte; never mutate loaded
  // assets, skin, eyes, lashes or their morph targets.
  const cropped=original.clone();cropped.setIndex(kept);hair.geometry=cropped;
  const back=new THREE.Mesh(posteriorHairGeometry(),hair.material);
  back.name='LayeredPosteriorHair';back.castShadow=true;back.userData.surfaceRole='hairDetail';hair.add(back);
  hair.userData.k3PosteriorHair={version:CHARACTER_DETAIL_VERSION,removedTriangles:removed,keptTriangles:kept.length/3};return back;
}

export function cloakSurfacePoint(d,u,v,t,flare,flutter,out) {
  const a=mix(-Math.PI*.62,Math.PI*.62,u),fl=flare*d.flareScale;
  const radius=mix(d.r0,d.r1,Math.pow(v,1.25))+fl*.25*v;
  const fold=Math.sin(v*Math.PI*.91)*(.010+.009*v)*(Math.sin(a*5.5+.30)*.72+Math.sin(a*9.5-.25)*.28);
  const ripple=(Math.sin(t*1.6+v*4+a*2.5)*d.wave*v+Math.sin(t*2.6+a*5)*d.wave*.35*v)*flutter;
  const rr=radius+fold+ripple,back=-fl*v*v-.02*v*v;
  out.set(Math.sin(a)*rr,mix(d.yTop,d.yHem,v)+Math.abs(Math.sin(a))*.04*v+fl*.12*v*v+.009*Math.cos(a*5.5+.3)*v*v*v,-Math.cos(a)*rr*.92+back-.03);return out;
}

export function travelerClothMaterial(options={},floor=false) {
  const mat=new THREE.MeshStandardMaterial({roughness:.92,metalness:0,...options});
  mat.userData.k3CharacterDetail=CHARACTER_DETAIL_VERSION;
  mat.onBeforeCompile=shader=>{
    const LF=String.fromCharCode(10);
    shader.vertexShader='varying vec2 k3ClothUV; varying vec3 k3ClothWorldNormal;'+LF+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>'+LF+'k3ClothUV=uv;');
    shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>'+LF+'k3ClothWorldNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader='varying vec2 k3ClothUV; varying vec3 k3ClothWorldNormal;'+LF+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',[
      '#include <map_fragment>',floor?'diffuseColor.rgb=max(diffuseColor.rgb,vec3(.075,.060,.105));':'',
      'vec2 k3Fiber=k3ClothUV*vec2(120.,170.);',
      'float k3Visible=1.-smoothstep(.18,.90,max(fwidth(k3Fiber.x),fwidth(k3Fiber.y)));',
      'diffuseColor.rgb*=1.+.018*k3Visible*sin(k3Fiber.x*6.2831853)*sin(k3Fiber.y*6.2831853);'
    ].join(LF));
    // Restrained stylized sky fill, not an additional scene light or claimed
    // physical GI. A world-space normal keeps the fill stable as camera moves.
    shader.fragmentShader=shader.fragmentShader.replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
      'float k3Wrap=.35+.65*max(dot(normalize(k3ClothWorldNormal),normalize(vec3(.30,.80,-.50))),0.);'+LF+
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance + diffuseColor.rgb*vec3(.11,.12,.15)*k3Wrap;');
  };
  mat.customProgramCacheKey=()=>CHARACTER_DETAIL_VERSION+'-cloth-'+Number(floor);return mat;
}

export function travelerSkinMaterial(color) {
  return travelerBodySkinMaterial(color);
}
