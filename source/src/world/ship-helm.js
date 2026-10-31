// Original ship helm: crafted timber and restrained metal, using the ship's materials.
// Five meshes, no added lights/textures/materials. Wheel pivot and handles keep the old envelope.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP } from '../config.js';

export function buildShipHelm(materials) {
  const group = new THREE.Group(); group.name = 'ship-helm';
  const wheel = new THREE.Group(); wheel.name = 'ship-helm-wheel';
  const { x, z } = SHIP.wheel, deck = SHIP.poop.height;
  wheel.position.set(x, deck + 1.35, z - 0.25);
  const stand = [], timber = [], brass = [], fittings = [], panes = [];
  const addBox = (list,w,h,d,px,py,pz) => {
    const g=new THREE.BoxGeometry(w,h,d);g.translate(px,py,pz);list.push(g);return g;
  };
  const cylinder = (list,r0,r1,h,px,py,pz,{segments=12,axis='y'}={}) => {
    const g=new THREE.CylinderGeometry(r0,r1,h,segments);
    if(axis==='z')g.rotateX(Math.PI/2);
    g.translate(px,py,pz);list.push(g);return g;
  };
  const ring = (list,r,t,px,py,pz,{segments=32,axis='z'}={}) => {
    const g=new THREE.TorusGeometry(r,t,4,segments);if(axis==='y')g.rotateX(Math.PI/2);
    g.translate(px,py,pz);list.push(g);return g;
  };
  const woodLathe = (profile,segments=12) => {
    const g=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),segments);
    const p=g.attributes.position,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++)uv.setXY(i,.08+uv.getX(i)*.075,p.getY(i)/2.4);
    return g;
  };
  const bearing = (list,inner,outer,depth,px,py,pz,segments) => {
    const points=[[inner,-depth/2],[outer,-depth/2],[outer,depth/2],[inner,depth/2],[inner,-depth/2]];
    const g=new THREE.LatheGeometry(points.map(([r,z])=>new THREE.Vector2(r,z)),segments);
    g.rotateX(Math.PI/2);g.translate(px,py,pz);list.push(g);return g;
  };
  // A braced two-cheek standard reaches the axle. The old stand stopped below it.
  // Its 0.50 x 0.30 m footprint stays inside the old pedestal footprint.
  addBox(stand,.50,.11,.30,x,deck+.055,z);
  addBox(stand,.44,.08,.26,x,deck+.15,z);
  for(const side of [-1,1]){
    const profile=[[.105,0],[.105,.06],[.077,.11],[.062,.30],[.072,.72],[.084,.83],[.084,.89]];
    const g=woodLathe(profile,8);g.translate(x+side*.135,deck+.19,z);stand.push(g);
  }
  addBox(stand,.43,.13,.28,x,deck+1.13,z);
  // Rounded crown embraces the shaft rather than leaving the wheel floating.
  bearing(stand,.158,.22,.26,x,deck+1.35,z,16);
  cylinder(fittings,.085,.085,.50,x,deck+1.35,z-.13,{axis:'z'});
  bearing(fittings,.108,.145,.04,x,deck+1.35,z+.146,12);
  for(const side of [-1,1])cylinder(fittings,.036,.036,.022,x+side*.15,deck+1.13,z+.151,{axis:'z',segments:6});

  // A closed bevelled timber rim; an eight-spoke silhouette stays legible at walking distance.
  const rimProfile=[[.465,-.028],[.475,-.052],[.55,-.052],[.578,-.026],[.578,.026],[.55,.052],[.475,.052],[.465,.028],[.465,-.028]];
  const rim=new THREE.LatheGeometry(rimProfile.map(([r,a])=>new THREE.Vector2(r,a)),32);
  const ruv=rim.attributes.uv,rpos=rim.attributes.position;
  for(let i=0;i<rpos.count;i++)ruv.setXY(i,.08+rpos.getY(i)/2.4,ruv.getX(i)*Math.PI*1.1/2.4);
  rim.rotateX(Math.PI/2);timber.push(rim);
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4;
    const profile=[[.030,.115],[.043,.14],[.031,.21],[.027,.37],[.039,.45],[.039,.50],[.027,.54],[.027,.595],[.046,.635],[.043,.69],[.030,.725],[.009,.741],[0,.746]];
    const spoke=woodLathe(profile,8);spoke.rotateZ(-angle);timber.push(spoke);
    // Small ferrules at the rim join and the handle neck, instead of bright full spokes.
    for(const r of [.475,.59]){
      const g=new THREE.CylinderGeometry(.040,.040,.027,8);g.translate(0,r,0);g.rotateZ(-angle);brass.push(g);
    }
    const g=new THREE.CylinderGeometry(.018,.018,.025,6);g.rotateX(Math.PI/2);
    g.translate(Math.sin(angle)*.127,Math.cos(angle)*.127,.107);brass.push(g);
  }
  ring(brass,.54,.009,0,0,.056);
  ring(brass,.54,.009,0,0,-.056);
  cylinder(timber,.15,.17,.145,0,0,0,{axis:'z',segments:16});
  cylinder(brass,.158,.158,.035,0,0,.079,{axis:'z',segments:16});
  cylinder(brass,.088,.104,.052,0,0,.115,{axis:'z',segments:8});
  ring(brass,.102,.011,0,0,.14,{segments:16});

  // Existing lamp position, with a real hood, glazing frame and guarded base.
  // All horizontal detail is above the standing character's head; no new obstacle.
  const lampZ=z+1.2, lampY=deck+2.2;
  cylinder(fittings,.04,.05,2.2,x,deck+1.1,lampZ,{segments:8});
  cylinder(fittings,.052,.052,.13,x,deck+.065,lampZ,{segments:8});
  cylinder(fittings,.172,.145,.055,x,lampY-.17,lampZ,{segments:8});
  cylinder(panes,.135,.135,.28,x,lampY,lampZ,{segments:8});
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    cylinder(fittings,.012,.012,.30,x+Math.sin(a)*.15,lampY,lampZ+Math.cos(a)*.15,{segments:4});
  }
  cylinder(fittings,.11,.19,.10,x,lampY+.19,lampZ,{segments:8});
  cylinder(fittings,.055,.11,.048,x,lampY+.262,lampZ,{segments:8});
  ring(fittings,.061,.012,x,lampY+.313,lampZ,{segments:10});

  const mesh=(parts,material,name,parent,shadow=false)=>{
    const ready=parts.map(p=>p.index?p.toNonIndexed():p),g=mergeGeometries(ready,false);
    for(const p of new Set([...parts,...ready]))p.dispose();
    g.computeBoundingBox();g.computeBoundingSphere();
    const m=new THREE.Mesh(g,material);m.name='ship-helm-'+name;m.receiveShadow=true;m.castShadow=shadow;
    parent.add(m);return m;
  };
  mesh(stand,materials.dark,'stand',group,true);
  // Hull timber already carries the ship's warm midtone; dark spars remain the stand.
  mesh(timber,materials.hull,'timber',wheel);
  mesh(brass,materials.trim,'brass',wheel);
  mesh(fittings,materials.iron,'fittings',group);
  mesh(panes,materials.glass,'glass',group);
  group.add(wheel);
  group.userData.helm={version:1,meshBudget:5,addedLights:0,addedTextures:0,addedMaterials:0,wheelPivot:[x,deck+1.35,z-.25],wheelRadius:.75,pedestalFootprint:[.5,.3]};
  return { group, wheel };
}
