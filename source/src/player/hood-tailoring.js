import * as THREE from 'three';

export const HOOD_TAILORING_VERSION = 'sewn-hood-v02';

// A rounded opening, a soft crown and two gathered side panels. The section
// curve continues through the turned edge rather than stopping its tangent at
// every station. This avoids the concentric hard shelves of the earlier loft.
const profile = new THREE.CatmullRomCurve3([
  new THREE.Vector3(.230,.267,.112),
  new THREE.Vector3(.244,.284,.114),
  new THREE.Vector3(.258,.296,.055),
  new THREE.Vector3(.251,.284,-.070),
  new THREE.Vector3(.218,.245,-.187),
  new THREE.Vector3(.146,.174,-.267),
  new THREE.Vector3(.071,.084,-.294),
  new THREE.Vector3(0,0,-.286),
], false, 'centripetal');
const centerY = t => .190 - .218 * t * t;
const outerPoint = (t, a) => {
  const p = profile.getPoint(t), s = Math.sin(a), c = Math.cos(a);
  // Broad pressure folds run from the side of the face toward the nape.
  // They decay at the opening, crown and closed tail, keeping the silhouette
  // soft and leaving the existing head and hair clearance intact.
  const envelope = Math.sin(Math.PI*t)**1.25;
  const lower = Math.max(0, (1-c)*.5);
  const theta = Math.acos(c), seam = 1.20 + 1.0*t;
  const crease = Math.exp(-(((theta-seam)/.16)**2));
  const shoulder = Math.exp(-(((theta-seam-.24)/.24)**2));
  const fold = envelope*lower*(.016*shoulder-.029*crease);
  // Leave ease around the authored temple locks before gathering at the
  // throat. The locks extend beyond the cheek and must stay inside the cloth.
  const cheekEase=.028*Math.exp(-(((theta-2.10)/.42)**2))*Math.sin(Math.PI*t);
  const width = Math.max(0,p.x+fold+cheekEase);
  const height = Math.max(0,p.y+fold*.6);
  const gather = (1-t)**2;
  return [s*width*(1-.18*lower**4*gather),centerY(t)+c*height+.035*lower**2*gather,p.z];
};
function sectionFrame(t,a){
  const dt=new THREE.Vector3().fromArray(outerPoint(Math.min(1,t+.0001),a)).sub(new THREE.Vector3().fromArray(outerPoint(Math.max(0,t-.0001),a))).normalize();
  const da=new THREE.Vector3().fromArray(outerPoint(t,a+.0001)).sub(new THREE.Vector3().fromArray(outerPoint(t,a-.0001))).normalize();
  return {tangent:dt,normal:da.cross(dt).normalize()};
}
function ringPoint(t,a,lining){
  const p=new THREE.Vector3().fromArray(outerPoint(t,a));
  if(lining)p.addScaledVector(sectionFrame(t,a).normal,-.006);
  return p.toArray();
}

export function sewnHoodGeometry() {
  const rows=40,columns=48,stride=columns+1,positions=[],uv=[],indices=[];
  // Two cloth faces share one material and draw. At the lip a semicircular
  // turn connects them; at the tail they converge on a smooth sewn pole.
  const rings=[];
  for(let r=rows-1;r>=1;r--)rings.push({t:r/rows,lining:true});
  for(let r=0;r<=4;r++)rings.push({lip:r/4});
  for(let r=1;r<rows;r++)rings.push({t:r/rows,lining:false});
  for(let r=0;r<rings.length;r++)for(let j=0;j<=columns;j++){
    const a=(j===columns?0:j/columns)*Math.PI*2,ring=rings[r];let p;
    if(ring.lip!==undefined){
      const q=ring.lip*Math.PI,outer=new THREE.Vector3().fromArray(ringPoint(0,a,false)),inner=new THREE.Vector3().fromArray(ringPoint(0,a,true)),blend=(1+Math.cos(q))*.5;
      p=outer.lerp(inner,blend).addScaledVector(sectionFrame(0,a).tangent,-.003*Math.sin(q)).toArray();
    }else p=ringPoint(ring.t,a,ring.lining);
    positions.push(...p);uv.push(j/columns,r/(rings.length-1));
  }
  for(let r=0;r<rings.length-1;r++)for(let j=0;j<columns;j++){
    const a=r*stride+j,b=a+stride;indices.push(a,a+1,b,b,a+1,b+1);
  }
  for(const end of [0,rings.length-1]){
    const pole=positions.length/3;positions.push(0,centerY(1),profile.getPoint(1).z+(end===0?.006:0));uv.push(.5,end===0?0:1);
    for(let j=0;j<columns;j++){
      const a=end*stride+j;
      if(end===0)indices.push(pole,a+1,a);else indices.push(pole,a,a+1);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const n=g.attributes.normal,v=new THREE.Vector3();
  for(let r=0;r<rings.length;r++){
    const a=r*stride,b=a+columns;v.set(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);
  }
  g.computeBoundingBox();g.computeBoundingSphere();
  g.userData.k3HoodTailoring={version:HOOD_TAILORING_VERSION,liningThickness:.006,rows,columns,extraDraws:0};
  return g;
}
