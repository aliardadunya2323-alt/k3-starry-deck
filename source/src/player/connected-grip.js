import * as THREE from 'three';

// Isolated grip study. Each finger replaces a palm patch and shares its
// boundary indices: this is one skin surface, not intersecting capped tubes.
export function connectedAwakenedGrip() {
  const positions=[], uv=[], weights=[], indices=[], contacts=[], digitRegions=[], soften=new Map();
  const sides=24, shaftZ=.08, shaftRadius=.018;
  const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const wristStation=y=>Math.max(0,Math.min(1,(.014-y)/.036));
  const add=(p,w,u=0,v=0)=>{const i=positions.length/3;positions.push(...p);weights.push(w);uv.push(u,v);return i;};
  const point=i=>new THREE.Vector3().fromArray(positions,i*3);
  const face=(a,b,c)=>indices.push(a,b,c);
  const bridge=(a,b)=>{for(let j=0;j<a.length;j++){const k=(j+1)%a.length;face(a[j],a[k],b[j]);face(a[k],b[k],b[j]);}};
  const rows=[
    [.055,0,.030,.030,.0275],[.038,0,.0315,.0327,.0302],
    [.026,0,.0315,.0327,.0302],[.014,0,.0295,.030,.028],
    // Preserve the attachment rings, but remove the intervening hourglass.
    // The carpal sections turn and expand continuously into the palm.
    [.010,.0005,.0294,.0298,.0278],[.006,.0015,.0295,.0296,.0275],
    [.002,.003,.0298,.0293,.0272],[-.001,.0045,.0302,.0288,.0268],
    [-.004,.0065,.0308,.0283,.026],[-.007,.009,.0315,.0278,.0249],
    [-.010,.012,.0325,.0275,.024],
    [-.014,.017,.033,.027,.0232],[-.018,.020,.0335,.027,.0225],
    [-.022,.023,.034,.0265,.022],[-.026,.026,.035,.026,.022],
    [-.030,.029,.0355,.0255,.0215],[-.034,.030,.0355,.025,.021],
    [-.038,.031,.035,.024,.0205],[-.042,.032,.034,.023,.020],
    [-.046,.033,.033,.0225,.0195],[-.050,.033,.032,.022,.019],
    [-.054,.033,.0315,.021,.0185],[-.058,.033,.031,.020,.018],
    [-.062,.0325,.030,.019,.0175],[-.066,.032,.028,.018,.0165],
    [-.070,.0315,.0255,.016,.0155],[-.074,.031,.022,.013,.014],
    [-.078,.030,.0155,.0085,.0115],[-.081,.030,.009,.005,.006],
    [-.083,.030,.0025,.002,.002],
  ];
  const holes=[...[11,15,19,23].map(r=>({r,c:6})),{r:14,c:0}];
  const inside=(r,c)=>holes.some(h=>r>h.r&&r<h.r+3&&c>h.c&&c<h.c+3);
  const removed=(r,c)=>holes.some(h=>r>=h.r&&r<h.r+3&&c>=h.c&&c<h.c+3);
  const grid=rows.map(([y,z,width,front,back],r)=>Array.from({length:sides},(_,c)=>{
    if(inside(r,c))return -1;const a=c/sides*Math.PI*2,s=Math.sin(a),co=Math.cos(a);
    if(r<4)return add([width*co,y,z+s*(s<0?back:front)],0,c/sides,r/(rows.length-1));
    const thenar=Math.exp(-(((y+.031)/.022)**2));
    const x=width*Math.sign(co)*Math.abs(co)**.92+.0025*thenar*Math.max(0,co)**2;
    // The old center-offset/back-radius combination made a transverse
    // trough even after removing the narrow waist. Design the dorsal
    // envelope directly, tangent to the cuff and the distal palm taper.
    const dorsalU=Math.max(0,Math.min(1,(.014-y)/.088));
    const dorsalEnvelope=-.028+.045*smooth(dorsalU);
    const backDepth=y>=-.074?z-dorsalEnvelope:back;
    const surface=Math.sign(s)*Math.abs(s)**(s<0?.82:.92)*(s<0?backDepth:front);
    // Evaluate the metacarpal fan on the visible dorsal (-Z) surface,
    // not on an almost edge-on -X strip. Large arch first, ridges second.
    const dorsalGate=Math.max(0,-s)**3;
    const palmT=Math.max(0,Math.min(1,(.007-y)/.09));
    const arch=.0022*Math.sin(Math.PI*palmT)**2;
    let metacarpal=0;
    for(const [ax,ay,bx,by] of [[.014,.004,-.02,-.017],[.006,.002,-.02,-.033],[-.003,0,-.02,-.049],[-.012,-.002,-.018,-.0645]]){
      const dx=bx-ax,dy=by-ay;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
      const distance=Math.hypot(x-ax-t*dx,y-ay-t*dy);
      metacarpal+=Math.exp(-((distance/.0055)**2))*Math.sin(Math.PI*t)**2;
    }
    const dorsal=dorsalGate*(arch+.0028*Math.min(1.4,metacarpal));
    // Keep a bounded thenar mound and central palmar hollow rather than
    // inflating the whole cross-section. Dorsal surface stays shallow.
    const mound=.0035*thenar*Math.max(0,co)*Math.max(0,s);
    const hollow=.0035*Math.exp(-(((y+.037)/.023)**2))*Math.max(0,s)**5;
    // A thumb opening needs more longitudinal room than a finger opening.
    // Redistribute the whole radial palm field, not just its boundary ring.
    const spread=.012*Math.tanh((y+.032)/.009)*smooth(1-Math.abs(y+.032)/.036)*Math.max(0,co)**4;
    return add([x,y+spread,z+surface+mound-hollow-dorsal],wristStation(y+spread),c/sides,r/(rows.length-1));
  }));
  for(let r=0;r<rows.length-1;r++)for(let c=0;c<sides;c++){
    if(removed(r,c))continue;const n=(c+1)%sides;face(grid[r][c],grid[r][n],grid[r+1][c]);face(grid[r][n],grid[r+1][n],grid[r+1][c]);
  }
  const top=add([0,rows[0][0],0],0,.5,0),bottom=add([0,-.084,.030],1,.5,1);
  for(let c=0;c<sides;c++){const n=(c+1)%sides;face(top,grid[0][n],grid[0][c]);face(bottom,grid.at(-1)[c],grid.at(-1)[n]);}
  const palmVertices=positions.length/3;
  const boundary=h=>{
    const a=[];for(let c=0;c<=3;c++)a.push(grid[h.r][h.c+c]);
    for(let r=1;r<=3;r++)a.push(grid[h.r+r][h.c+3]);
    for(let c=2;c>=0;c--)a.push(grid[h.r+3][h.c+c]);
    for(let r=2;r>=1;r--)a.push(grid[h.r+r][h.c]);return a;
  };
  const attach=(hole,centers,widths,depths,digit,axis)=>{
    const root=boundary(hole),rings=[],firstNewVertex=positions.length/3;let phase=0,previousTangent=null,previousAcross=null;
    for(let r=Math.max(4,hole.r-1);r<=hole.r+4;r++)for(let c=hole.c-1;c<=hole.c+4;c++){const i=grid[r]?.[(c+sides)%sides];if(i>=0)soften.set(i,Math.max(soften.get(i)||0,.15));}
    for(const i of root)soften.set(i,.38);
    for(let r=0;r<centers.length;r++){
      const tangent=centers[Math.min(r+1,centers.length-1)].clone().sub(centers[Math.max(0,r-1)]).normalize();
      const seed=previousAcross?previousAcross.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousTangent,tangent)):axis.clone();
      if(Math.abs(seed.dot(tangent))>.999)seed.set(0,1,0);
      const across=seed.addScaledVector(tangent,-seed.dot(tangent)).normalize();
      previousTangent=tangent.clone();previousAcross=across.clone();
      const normal=new THREE.Vector3().crossVectors(tangent,across).normalize();
      const ring=Array.from({length:12},(_,c)=>{const a=c/12*Math.PI*2,co=Math.cos(a),s=Math.sin(a);
        const lateral=Math.sign(co)*Math.abs(co)**.90;
        const profile=Math.sign(s)*Math.abs(s)**(s>0?.64:.94);
        return centers[r].clone().addScaledVector(across,lateral*widths[r]).addScaledVector(normal,profile*depths[r]);});
      if(r===0){let best=Infinity;for(let k=0;k<12;k++){const cost=root.reduce((s,i,j)=>s+point(i).distanceToSquared(ring[(j+k)%12]),0);if(cost<best){best=cost;phase=k;}}}
      rings.push(ring.map((_,j)=>ring[(j+phase)%12]));
    }
    // Co-design the palm opening with its proximal phalanx rather than
    // stretching a distant rectangular hole into a long webbed tube.
    {
      const direction=centers[1].clone().sub(centers[0]).normalize();
      for(let c=0;c<root.length;c++){
        const p=rings[0][c].clone().addScaledVector(direction,-.007);
        if(digit<4){
          // Broaden the dorsal/volar seat without widening the gaps along
          // the four-finger row or moving any distal contact-pad sample.
          const seat=p.clone().sub(centers[0]).addScaledVector(direction,.007);
          seat.y=0;
          p.addScaledVector(seat,.22);
        }
        positions.splice(root[c]*3,3,p.x,p.y,p.z);
        weights[root[c]]=wristStation(p.y);
      }
    }
    let previous=root,tipVertices=[];
    for(const t of [1/3,2/3]){
      const next=root.map((i,c)=>add(point(i).lerp(rings[0][c],t).toArray(),weights[i]+(1-weights[i])*smooth(t),c/12,t/8));bridge(previous,next);previous=next;for(const i of next)soften.set(i,t<.5?.32:.22);
    }
    for(let r=0;r<rings.length;r++){
      const next=rings[r].map((p,c)=>add(p.toArray(),1,c/12,(r+1)/rings.length));bridge(previous,next);previous=next;
      if(r<2)for(const i of next)soften.set(i,r===0?.16:.08);
      if(r>=rings.length-4)tipVertices.push(...next);
      if(digit<4&&r>=3&&r<=14){
        const closest=next.reduce((a,b)=>Math.hypot(positions[a*3],positions[a*3+2]-shaftZ)<Math.hypot(positions[b*3],positions[b*3+2]-shaftZ)?a:b);
        contacts.push({digit,index:closest,radius:Math.hypot(positions[closest*3],positions[closest*3+2]-shaftZ)});
      }
    }
    const tipDirection=centers.at(-1).clone().sub(centers.at(-2)).normalize();
    const tip=add(centers.at(-1).clone().addScaledVector(tipDirection,.00065).toArray(),1,.5,1);
    for(let c=0;c<12;c++)face(tip,previous[c],previous[(c+1)%12]);
    digitRegions.push({digit,rootIndices:root,firstNewVertex,lastNewVertex:tip,tipVertices:[...tipVertices,tip]});
  };
  // Distinct phalange directions, softly filleted at PIP/DIP rather than
  // four identical circular sweeps. This is an art candidate, not a rig.
  const levels=[-.017,-.033,-.049,-.0645];
  const phalanxPoint=(nodes,t)=>{
    const knots=[0,.34,.70,1],h=.065;
    for(let k=1;k<3;k++)if(Math.abs(t-knots[k])<h){
      const a=nodes[k].clone().lerp(nodes[k-1],h/(knots[k]-knots[k-1]));
      const b=nodes[k].clone().lerp(nodes[k+1],h/(knots[k+1]-knots[k]));
      const u=(t-knots[k]+h)/(2*h);
      return a.multiplyScalar((1-u)**2).addScaledVector(nodes[k],2*(1-u)*u).addScaledVector(b,u*u);
    }
    let k=0;while(k<2&&t>knots[k+1])k++;
    return nodes[k].clone().lerp(nodes[k+1],(t-knots[k])/(knots[k+1]-knots[k]));
  };
  for(let d=0;d<4;d++){
    const centers=[],widths=[],depths=[];
    const end=[.46,.30,.48,.79][d],scale=[1,1.025,.99,.945][d];
    const angles=[3.91,2.85,1.68,end],radii=[.0272,.0310,.0305,.0270];
    const nodes=angles.map((a,k)=>new THREE.Vector3(Math.cos(a)*radii[k]*scale,levels[d]+[0,-.0005,-.0018,-.0032][k]*(d===0?.7:1),shaftZ+Math.sin(a)*radii[k]*scale));
    for(let r=0;r<=18;r++){
      const t=Math.min(r,15)/18,joint=Math.exp(-(((t-.34)/.065)**2))+.8*Math.exp(-(((t-.70)/.055)**2));
      const cap=Math.max(0,r-15)/3*1.46,tip=Math.cos(cap);
      const width=[.0070,.0075,.0072,.0059][d],depth=[.0078,.0082,.0078,.0066][d];
      const center=phalanxPoint(nodes,t);
      if(r>15){const direction=phalanxPoint(nodes,t+.01).sub(phalanxPoint(nodes,t-.01)).normalize();center.addScaledVector(direction,width*(1-.17*t)*Math.sin(cap));}
      centers.push(center);
      widths.push(width*(1-.17*t)*(1+.08*joint)*tip);
      depths.push(depth*(1-.19*t)*(1+.11*joint)*tip);
    }
    attach(holes[d],centers,widths,depths,d,new THREE.Vector3(0,1,0));
  }
  const thumbPath=new THREE.CatmullRomCurve3([
    [.039,-.032,.037],[.052,-.024,.059],[.042,-.012,.087],
    [.0265,-.0118,.1086],[.0125,-.0158,.1086],
  ].map(p=>new THREE.Vector3(...p)));
  const thumbCenters=[],thumbWidths=[],thumbDepths=[];
  for(let r=0;r<=16;r++){const t=Math.min(r,12)/12*.86,cap=Math.max(0,r-12)/4*1.46,tip=Math.cos(cap);
    const knuckle=1+.13*Math.exp(-(((t-.61)/.08)**2));
    const center=thumbPath.getPoint(t);if(r>12)center.addScaledVector(thumbPath.getTangent(t).normalize(),.0075*Math.sin(cap));
    thumbCenters.push(center);thumbWidths.push((.0105*(1-t)+.0070*t)*knuckle*tip);thumbDepths.push((.0098*(1-t)+.0068*t)*knuckle*tip);}
  attach(holes[4],thumbCenters,thumbWidths,thumbDepths,4,new THREE.Vector3(0,1,0));
  // Local sculpt relaxation only at sewn roots; cuff and contact-pad samples
  // are hard constraints. It does not add faces or replace collision testing.
  const neighbors=Array.from({length:weights.length},()=>new Set());
  for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3];neighbors[a].add(b);neighbors[b].add(a);}
  for(let pass=0;pass<6;pass++){const next=positions.slice();for(const [i,factor] of soften){
    if(i<96||weights[i]===0)continue;const average=new THREE.Vector3();for(const j of neighbors[i])average.add(point(j));average.multiplyScalar(1/neighbors[i].size);
    const p=point(i),delta=average.sub(p).multiplyScalar(factor);if(delta.length()>.0012)delta.setLength(.0012);p.add(delta);next.splice(i*3,3,p.x,p.y,p.z);
  }positions.splice(0,positions.length,...next);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('gripWeight',new THREE.Float32BufferAttribute(weights,1));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  g.userData={k3CharacterDetail:'traveler-detail-01',role:'shaft-contact-five-digit-hand',digits:5,handSculpt:'anatomical-palm-23',
    topology:'continuous carpal and dorsal envelopes, metacarpal arch and proximal seats; inherited thumb retained after rejected root recess; not anatomical acceptance',
    gripAxis:{z:shaftZ,radius:shaftRadius,pivotY:.01,palmVertices,palmSides:sides,cuffRings:4,cuffY:.014,blendEndY:-.022,wristPivot:[0,.014,0],deformation:'integrated-wrist-arc-01',contactIndices:contacts.map(c=>c.index)},
    contactSamples:contacts,digitRegions};
  return g;
}
