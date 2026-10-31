import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const esbuild=process.env.K3_DEMO_MODULES?require(path.join(process.env.K3_DEMO_MODULES,'esbuild')):require('esbuild');
const code=`
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {DeckCollider} from './source/deck-collider.js';
import {Controller} from './source/src/player/controller.js';
import {SHIP,PLAYER} from './source/src/config.js';
const make=(x=SHIP.spawn.x,z=SHIP.spawn.z,form='chibi')=>{
 const w={root:new THREE.Group(),form,heading:0};
 const c=new Controller(w,new DeckCollider());c.teleport(x,z,0);return c;
};
const idle={move:{x:0,y:0},run:false};
for(const form of ['chibi','awakened','cat']){
 const c=make(2.2,-6,form);assert.equal(c.jump(),true);
 for(let i=0;i<180;i++){
  c.update(1/60,idle,Math.PI);
  assert.ok(c.pos.toArray().every(Number.isFinite),'jump/landing produced non-finite position: '+form+' frame '+i);
 }
 assert.equal(c.airborne,false);assert.equal(c.pos.y,0);
}
for(const x of [-5.8,0,5.8]){
 const c=make(x,12);
 for(let i=0;i<600;i++){
  if(i%75===0)c.jump();
  c.update(1/60,{move:{x:0,y:1},run:true},Math.PI);
  assert.ok(c.pos.toArray().every(Number.isFinite));
  assert.ok(c.pos.z<=SHIP.poop.wallZ-PLAYER.radius-.1+1e-9,'crossed rear boundary');
 }
 assert.equal(c.airborne,false);assert.equal(c.pos.y,0);
}
// Dash probes and the telescope's raised platform must preserve ground height.
const col=new DeckCollider();
for(const [x,z,ground] of [[2.2,-6,0],[0,-24,.25],[5.8,20,0]]){
 const p=new THREE.Vector3(x,0,z),g=col.resolve(p,PLAYER.radius);
 assert.equal(g,ground);assert.equal(p.y,ground);assert.ok(p.toArray().every(Number.isFinite));
}
console.log('PASS: all 3 forms jump/land; 3 rear approaches with repeated jumps; dash ground and raised platform.');
`;
const result=await esbuild.build({stdin:{contents:code,resolveDir:root,sourcefile:'motion-regression.js'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'three',setup(b){b.onResolve({filter:/^three(?:\/|$)/},a=>({path:path.join(root,'source/vendor/three',a.path==='three'?'three.module.min.js':a.path.slice(6))}));}}]});
try{
 await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
