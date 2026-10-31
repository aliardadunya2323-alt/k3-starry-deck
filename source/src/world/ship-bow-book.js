// A closed, curved folio for the existing figurehead. Four merged meshes,
// two untextured materials; original placement and orientation stay in Ship.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const height = x => {
  const u = THREE.MathUtils.clamp((Math.abs(x) - .055) / 1.015, 0, 1);
  return -.183 + .366 * u + .07 * Math.sin(Math.PI * u);
};
const surface = (x, z, offset = 0) => [x, height(x) + offset, z];

function leaf(parts, side, {inner, outer, length, thickness, offset, color}) {
  const pos = [], colors = [], shade = new THREE.Color(color);
  const tri = (a, b, c, tint) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(shade.r*tint, shade.g*tint, shade.b*tint);
  };
  const face = (a,b,c,d,flip,tint=1) => {
    if (flip) {tri(a,c,b,tint);tri(a,d,c,tint);} else {tri(a,b,c,tint);tri(a,c,d,tint);}
  };
  const point = (u, z, dy=0) => surface(side*(inner+(outer-inner)*u), z, offset+dy);
  for (let i=0;i<24;i++) {
    const u=i/24, v=(i+1)/24, z=length/2;
    face(point(u,-z),point(v,-z),point(v,z),point(u,z),side>0);
    face(point(u,-z,-thickness),point(v,-z,-thickness),point(v,z,-thickness),point(u,z,-thickness),side<0,.84);
    for (const end of [-1,1]) face(point(u,end*z),point(v,end*z),point(v,end*z,-thickness),point(u,end*z,-thickness),side*end>0,.88);
  }
  for (const u of [0,1]) face(point(u,-length/2),point(u,length/2),point(u,length/2,-thickness),point(u,-length/2,-thickness),(side>0)!==(u===1),.88);
  const g = new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();parts.push(g);
}

export function buildBowBook(materials) {
  const group = new THREE.Group();group.name = 'ship-bow-book';
  const pages=[], cover=[], metal=[], ink=[];
  const add = (parts,g) => {if(g.attributes.uv)g.deleteAttribute('uv');parts.push(g);};
  const stroke = (parts,a,b,r=.005,segments=5) => {
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A);
    // Hairline engraving uses two-sided ribbons, not dozens of capped tubes.
    // The page-edge divisions lie on their actual exposed edge plane.
    if(r<.012) {
      const normal=Math.abs(A.z)>.735&&Math.abs(A.z-B.z)<1e-5?new THREE.Vector3(0,0,1):Math.abs(A.x)>1.071&&Math.abs(A.x-B.x)<1e-5?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
      const left=new THREE.Vector3().crossVectors(d,normal).normalize().multiplyScalar(r);
      const q=[A.clone().sub(left),A.clone().add(left),B.clone().add(left),B.clone().sub(left)];
      const vertices=[0,1,2,0,2,3,0,2,1,0,3,2].flatMap(i=>q[i].toArray());
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();add(parts,g);return;
    }
    const g=new THREE.CylinderGeometry(r,r,d.length(),segments);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));
    g.translate(...A.add(B).multiplyScalar(.5).toArray());add(parts,g);
  };
  const path = (parts,points,offset,r=.005) => {
    for(let i=1;i<points.length;i++)stroke(parts,surface(...points[i-1],offset),surface(...points[i],offset),r);
  };
  const across = (parts,x0,x1,z,offset,r=.005,steps=8) => path(parts,Array.from({length:steps+1},(_,i)=>[x0+(x1-x0)*i/steps,z]),offset,r);
  for(const side of [-1,1]) {
    leaf(pages,side,{inner:.055,outer:1.07,length:1.48,thickness:.065,offset:0,color:0xe7d5b2});
    leaf(cover,side,{inner:.025,outer:1.10,length:1.58,thickness:.034,offset:-.072,color:0x7b9391});
    // Three leaf divisions lie on the exposed page edges; no alpha texture.
    for(const dy of [-.018,-.036,-.054]) {
      for(const end of [-1,1]) across(ink,side*.065,side*1.065,end*.742,dy,.0018,12);
      stroke(ink,surface(side*1.072,-.735,dy),surface(side*1.072,.735,dy),.0018);
    }
    // A recessed leather panel, corner guards and a continuous fine border are
    // visible from the deck, which sees the back of the original tilted book.
    const inside=side*.16,outside=side*1.01;
    for(const z of [-.65,.65]) across(metal,inside,outside,z,-.112,.0055,10);
    for(const x of [inside,outside]) stroke(metal,surface(x,-.65,-.112),surface(x,.65,-.112),.0055);
    for(const end of [-1,1]) {
      across(metal,side*.92,side*1.085,end*.757,-.113,.017,3);
      stroke(metal,surface(side*1.083,end*.757,-.113),surface(side*1.083,end*.60,-.113),.017,6);
      const stud=new THREE.SphereGeometry(.021,6,4);stud.translate(...surface(side*1.053,end*.716,-.132));add(metal,stud);
    }
    // A restrained lozenge stamp on each cover, rather than another star sigil.
    path(metal,[[side*.59,-.23],[side*.77,0],[side*.59,.23],[side*.41,0],[side*.59,-.23]],-.112,.007);
  }
  const spine=new THREE.CylinderGeometry(.085,.085,1.61,16);spine.rotateX(Math.PI/2);spine.translate(0,-.20,0);
  // Cover leaf geometry already has vertex colours; give the spine the same
  // attribute before merging. No seam, cap or binding floats at the old height.
  const spineColors=new Float32Array(spine.attributes.position.count*3),spineColor=new THREE.Color(0x455c61);
  for(let i=0;i<spine.attributes.position.count;i++)spineColors.set(spineColor.toArray(),i*3);
  spine.setAttribute('color',new THREE.BufferAttribute(spineColors,3));add(cover,spine);
  for(const z of [-.67,-.34,0,.34,.67]) {
    const ring=new THREE.TorusGeometry(.087,.009,4,16);ring.translate(0,-.20,z);add(metal,ring);
  }
  // Original decorative figurehead, presented as an astronomical folio.
  // These are geometrical diagrams, not invented readable body copy.
  const circle=[];
  for(let i=0;i<=32;i++){const a=i*Math.PI*2/32;circle.push([-.58+Math.cos(a)*.29,Math.sin(a)*.29]);}
  path(ink,circle,.005,.0035);
  const stars=[[-.75,-.16],[-.54,-.21],[-.39,-.03],[-.55,.14],[-.77,.21]];
  path(ink,stars,.006,.004);
  for(const [x,z] of stars)path(metal,[[x,z-.025],[x+.018,z],[x,z+.025],[x-.018,z],[x,z-.025]],.008,.0035);
  for(let i=0;i<7;i++) {
    const z=-.39+i*.115,x1=i===3?.80:i===6?.73:.94;
    across(ink,.26,x1,z,.005,.003,10);
  }
  across(metal,.25,.95,-.51,.006,.008,10);
  across(metal,-.94,-.26,-.51,.006,.008,10);
  const paperMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.92});
  const coverMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.82,emissive:0x0f1d24,emissiveIntensity:.20});
  const batch=(parts,mat,name,shadow) => {
    const flat=parts.map(p=>{const n=p.index?p.toNonIndexed():p;return n;});
    const geometry=mergeGeometries(flat);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    for(const p of new Set([...parts,...flat]))p.dispose();
    const mesh=new THREE.Mesh(geometry,mat);mesh.name=name;mesh.castShadow=shadow;mesh.receiveShadow=true;
    if(!shadow)mesh.userData.noShadow=true;group.add(mesh);
  };
  batch(pages,paperMaterial,'bow-folio-paper',true);
  batch(cover,coverMaterial,'bow-folio-covers',true);
  batch(metal,materials.goldGlow,'bow-folio-binding',false);
  batch(ink,materials.iron,'bow-folio-diagrams',false);
  group.userData.ownsBinding=true;
  group.userData.craft={meshes:4,additionalMaterials:2,additionalTextures:0,additionalLights:0,curvedLeafDivisions:24,originalPosePreserved:true};
  return group;
}
