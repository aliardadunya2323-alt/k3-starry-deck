// Original low-relief geometry derived from R8-B compass-multiview-v01.png.
// Decorative only: does not change collision, hotspots or sailing bearings.
import * as THREE from 'three';

export const DECK_COMPASS = Object.freeze({ x: 0, z: -19.1, radius: 2.149, maxRelief: .021 });

function geometry(points, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(points.flatMap(p => [p[0] / 4.3, p[2] / 4.3]), 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

// Two shallow sloping faces, not a chunky torus floating above the deck.
function rim(radius, halfWidth, segments = 64) {
  const points = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = i * Math.PI * 2 / segments;
    for (const [r,y] of [[radius-halfWidth,.010],[radius,.021],[radius+halfWidth,.010]])
      points.push([Math.sin(a)*r,y,Math.cos(a)*r]);
  }
  for (let i = 0; i < segments; i++) for(let j=0;j<2;j++){
    const a=i*3+j,b=a+3;indices.push(a,a+1,b,b,a+1,b+1);
  }
  return geometry(points, indices);
}

function facet(angle, length, width, side) {
  const local = side < 0 ? [[0,.30],[-width,.63],[0,length]] : [[0,.30],[0,length],[width,.63]];
  const points=local.map(([x,z],i)=>[x*Math.cos(angle)+z*Math.sin(angle),i===0?.018:i===1&&side<0?.010:i===2&&side>0?.010:.018,z*Math.cos(angle)-x*Math.sin(angle)]);
  return geometry(points,[0,1,2]);
}

export function createDeckCompassParts() {
  const brass=[], bronze=[], enamel=[];
  brass.push(rim(2.135,.014),rim(1.925,.011),rim(.44,.013,48),rim(.325,.009,32));
  const band=new THREE.RingGeometry(1.925,2.135,96);band.rotateX(-Math.PI/2);band.translate(0,.006,0);enamel.push(band);
  for(let i=0;i<16;i++){
    const angle=i*Math.PI/8,major=i%2===0;
    brass.push(facet(angle,major?1.83:1.38,major?.18:.10,-1));
    bronze.push(facet(angle,major?1.83:1.38,major?.18:.10,1));
  }
  // Narrow calibrations remain readable without text or texture requests.
  for(let i=0;i<96;i++){
    const angle=i*Math.PI/48,major=i%12===0,medium=i%4===0;
    const tick=new THREE.PlaneGeometry(major?.024:.012,major?.125:medium?.085:.042);
    tick.rotateX(-Math.PI/2);tick.translate(0,.013,2.09-(major?.125:medium?.085:.042)/2);tick.rotateY(angle);brass.push(tick);
  }
  // Small eight-point astrolabe inside the center ring.
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4,points=[[0,.11],[-.037,.18],[0,i%2?.27:.305],[.037,.18]];
    const p=points.map(([x,z])=>[x*Math.cos(a)+z*Math.sin(a),.016,z*Math.cos(a)-x*Math.sin(a)]);
    brass.push(geometry(p,[0,1,2,0,2,3]));
  }
  for(const list of [brass,bronze,enamel])for(const g of list)g.translate(DECK_COMPASS.x,0,DECK_COMPASS.z);
  return {brass,bronze,enamel};
}
