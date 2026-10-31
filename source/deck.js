import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {GradedOutputPass} from './src/world/grade.js';
import {Sky} from './src/world/sky.js';
import {Ship} from './src/world/ship.js';
import {buildShipDress} from './src/world/ship-dress.js';
import {buildShipProps} from './src/world/ship-props.js';
import {DeckDust} from './src/world/dust.js';
import {DeckCollider} from './deck-collider.js';
import {LightRig} from './src/world/lights.js';
import {createStarryLookdev} from './src/world/starry-lookdev.js';
import {loadSigil,BigSigil} from './src/world/sigil.js';
import {registerSvgAssets} from './src/world/svgraster.js';
import {loadDecals,buildShipDecals} from './src/world/decals.js';
import {Door} from './src/doors/door.js';
import {createWanderer} from './src/player/character.js';
import {Controller} from './src/player/controller.js';
import {CameraRig} from './src/player/camera.js';
import {Skills} from './src/player/skills.js';
import {Cat} from './src/player/cat.js';
import {Input} from './src/util/input.js';
import {assetsReady,getAsset} from './src/util/assets.js';
import {SHIP,CAMERA,PLAYER,COLORS} from './src/config.js';

const $=id=>document.getElementById(id);
const status=$('loading-text'), dialog=$('instructions');
const buttons=[...document.querySelectorAll('[data-action]')];
let ready=false,active=true,paused=false,failed=false,frameId=0,toastTimer;
let input,controller,camRig;
const nextFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600);}
function showHelp(){if(!ready)return;input.reset();paused=true;camRig.setInputLocked(true);dialog.showModal();}
function closeHelp(){dialog.close();input.reset();paused=false;camRig.setInputLocked(!active);}
$('help').onclick=showHelp;
$('continue').onclick=closeHelp;
dialog.querySelector('.close').onclick=closeHelp;
dialog.addEventListener('cancel',e=>{e.preventDefault();closeHelp();});
$('retry').onclick=()=>location.reload();
buttons.forEach(b=>b.disabled=true);
window.__deckQA={ready:false,scope:'starry-main-deck',allowed:['swing','dash','hex','rose','ult','form','jump'],blocked:['reader','levels','base','portal','rift','wings','dragon','helicopter']};
function showFailure(error,message='甲板暂时未能打开，请重新尝试。'){
 failed=true;ready=false;active=false;cancelAnimationFrame(frameId);
 input?.reset();camRig?.setInputLocked(true);buttons.forEach(b=>b.disabled=true);
 console.error(error);window.__deckQA.error=String(error);window.__deckQA.ready=false;
 $('scene').dataset.activity='error';$('scene').dataset.error=String(error);
 $('loading').hidden=false;$('loading').classList.remove('done');
 status.textContent=message;$('retry').hidden=false;
}

async function boot(){
 await assetsReady;
 const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const mobile=matchMedia('(pointer:coarse)').matches;
 const quality=mobile?'low':'medium';
 const renderer=new THREE.WebGLRenderer({antialias:!mobile,powerPreference:'high-performance',stencil:false});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,mobile?1:1.35));
 renderer.setSize(innerWidth,innerHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.05;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
 renderer.info.autoReset=false;
 const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','星空甲板：WASD 移动，鼠标拖动环顾，数字键释放技能');$('scene').appendChild(canvas);
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();showFailure(Error('WebGL context lost'),'画面连接已中断，请重新进入甲板。');});
 const scene=new THREE.Scene();
 const camera=new THREE.PerspectiveCamera(CAMERA.fov,innerWidth/innerHeight,CAMERA.near,CAMERA.far);
 const composer=new EffectComposer(renderer);
 composer.addPass(new RenderPass(scene,camera));
 const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.55,.4,.85);bloom.enabled=!mobile;composer.addPass(bloom);composer.addPass(new GradedOutputPass({}));
 status.textContent='铺开星海与船帆…';await nextFrame();
 const sky=new Sky(scene,{reducedMotion:still});sky.setStarFraction(mobile?.38:.7);sky.setPixelRatio(renderer.getPixelRatio());
 await registerSvgAssets(['sigil.svg','frame.svg','pattern.svg','divider.svg','sigil-mini.svg','g3-sail-rune-1.svg','g3-sail-rune-2.svg','g3-sail-rune-3.svg','g3-cloak-chibi.svg','g3-cloak-awakened.svg']);
 const ship=new Ship({quality,reducedMotion:still});scene.add(ship.group);
 const dress=buildShipDress(ship);
 const dust=new DeckDust(ship.group,{count:120,quality,reducedMotion:still});
 await buildShipProps(ship);
 // Keep both walking and dash on the main deck, including while airborne.
 const collider=new DeckCollider();
 const lights=new LightRig(scene,ship.group,{quality});
 const starry=createStarryLookdev({sky,ship});await starry.ready;
 if(starry.state.error)throw Error('星空贴图未能加载，请重新尝试。');
 const factory=await loadSigil(null,await getAsset('sigil.svg','text'));
 const bigSigil=new BigSigil(factory,{reducedMotion:still});bigSigil.setStarryPresentation(true);scene.add(bigSigil.group);
 const bow=factory.make({diameter:1.4,color:COLORS.bright,dotColor:COLORS.magic,opacity:.9,glow:1.3,strokeMul:3});bow.group.position.set(0,3.4,SHIP.bowZ-.4);bow.spinSpeed=still?0:.25;ship.group.add(bow.group);
 const decals=await loadDecals();ship.group.add(buildShipDecals(factory,decals));
 // Decorative closed doors only: no DoorSystem, hall, reader, or transition handlers.
 const labels={create(){return {el:document.createElement('span'),obj:new THREE.Group(),show(){},hide(){},setState(){},setNudge(){},setNear(){},setReady(){}};}};
 const gapLight=new THREE.PointLight(COLORS.lantern,0,5,2),hallLight=new THREE.PointLight(COLORS.lantern,0,7,2);ship.group.add(gapLight,hallLight);
 const doors=[['sources',4.2,0x87bbae],['models',0,0xe0bd7c],['actions',-4.2,0xf6dfa4]].map(([id,x,color])=>new Door({id,title:'',plate:'',label:'',target:'',x,z:SHIP.poop.wallZ,normal:[0,0,-1],sigilColor:color,sigilDot:COLORS.bright,lampColor:COLORS.lantern,hallBuilder:()=>new THREE.Group()}, {sigilFactory:factory,labels,parent:ship.group,gapLight,hallLight,reducedMotion:still,emblems:decals.emblems}));
 status.textContent='唤醒旅人与白猫…';await nextFrame();
 const wanderer=await createWanderer({reducedMotion:still});ship.group.add(wanderer.root);
 controller=new Controller(wanderer,collider);
 controller.teleport(SHIP.spawn.x,SHIP.spawn.z,SHIP.spawn.facing);
 const cat=new Cat({collider,reducedMotion:still});ship.group.add(cat.root);
 input=new Input(canvas);camRig=new CameraRig(camera,canvas,{occluders:ship.occluders,reducedMotion:still});
 const magic=new THREE.Group();scene.add(magic);
 const skills=new Skills({scene:magic,shipGroup:ship.group,wanderer,controller,collider,camera,camRig,sigilFactory:factory,reducedMotion:still});
 skills.cat=cat;skills.teleportOnComplete=false;skills.setCooldownScale(.5);
 skills.on('ult-cancel',()=>camRig.exitUniverse());
 const counts={};
 function perform(action){
  if(!ready||paused||!active)return false;
  let ok=false;
  if(action==='jump')ok=controller.jump();
  else if(action==='form'){if(!controller.locked&&!controller._scripted)ok=wanderer.toggleForm();}
  else if(action==='swing')ok=skills.swing();
  else if(action==='dash')ok=skills.dash();
  else if(action==='hex')ok=skills.hex();
  else if(action==='rose')ok=skills.toggleRose();
  else if(action==='ult')ok=skills.ultimate();
  if(ok){counts[action]=(counts[action]||0)+1;}
  return ok;
 }
 input.on('jump',()=>perform('jump')).on('swing',()=>perform('swing')).on('skill',perform);
 input.on('help',showHelp).on('menu',()=>dialog.open?closeHelp():showHelp());
 // E/M/Enter/6/7/8 have no destination, traversal, or transport handlers.
 buttons.forEach(b=>b.onclick=()=>{canvas.focus({preventScroll:true});regainFocus();perform(b.dataset.action);});
 input.on('joystick',j=>{const el=$('joystick');el.hidden=!j.active;if(j.active){el.style.left=(j.cx-44)+'px';el.style.top=(j.cy-44)+'px';el.firstElementChild.style.transform=`translate(${j.x*25/60}px,${j.y*25/60}px)`;}});
 const head=new THREE.Vector3();
 const headWorld=()=>wanderer.root.localToWorld(head.set(0,wanderer.eyeHeight||PLAYER.eye,0));
 ship.group.updateMatrixWorld(true);camRig.update(.016,{look:{x:0,y:0},zoom:0},headWorld());
 starry.update(true,0);
 status.textContent='准备魔法与光影…';await nextFrame();
 // Build expensive magic a phase at a time rather than stalling the first cast.
 let warmStep=0;
 while(!failed&&!skills.prebuildStep().done){status.textContent=`准备魔法与光影… ${++warmStep}`;await nextFrame();}
 if(failed)return;
 status.textContent='展开甲板…';
 ready=true;window.__deckQA.ready=true;buttons.forEach(b=>b.disabled=false);
 $('loading').classList.add('done');setTimeout(()=>{if(!failed)$('loading').hidden=true;},650);
 toast('欢迎登船 · 试试 3 点亮玫瑰，或 5 切换形态');
 let previous=performance.now(),time=0,frames=0,suspended=false;
 const empty={move:{x:0,y:0},run:false,look:{x:0,y:0},zoom:0};
 function frame(now){
  if(failed||suspended)return;
  try{tick(now);}catch(error){showFailure(error,'画面运行遇到问题，请重新进入甲板。');return;}
  frameId=requestAnimationFrame(frame);
 }
 function tick(now){
  const delta=Math.max(0,Math.min((now-previous)/1000,.05));previous=now;
  if(document.hidden)return;
  // Pausing motion must not stop presenting the WebGL canvas. Some browser
  // compositors discard the default framebuffer after a focus/surface change.
  // Redraw the frozen scene while visible instead of leaving a cleared canvas.
  if(!active||paused){renderer.info.reset();composer.render();return;}
  const dt=delta,timeStep=still?0:dt;time+=timeStep;
  const inp=input.poll();
  controller.tickScripted(dt);
  if(!controller._scripted)controller.update(dt,inp,camRig.yaw);
  skills.update(dt,headWorld());
  // Final clamp also covers dash and form-change jump frames.
  controller.pos.z=Math.min(controller.pos.z,SHIP.poop.wallZ-PLAYER.radius-.1);
  if(!Number.isFinite(controller.pos.x)||!Number.isFinite(controller.pos.y)||!Number.isFinite(controller.pos.z))throw Error('Invalid character position');
  wanderer.update(dt,{speed:controller.speed,running:inp.run,airborne:controller.airborne});
  cat.update(dt,{pos:controller.pos,heading:wanderer.heading,speed:controller.speed,inHall:false,goal:null});
  ship.update(timeStep);dress.update(time);dust.update(timeStep,camRig.universeBlend);
  ship.group.updateMatrixWorld(true);magic.position.copy(ship.group.position);magic.quaternion.copy(ship.group.quaternion);
  camRig.updateDolly(dt);camRig.lookScale=wanderer.form==='cat'?.3:1;
  camRig.update(dt,camRig.mode==='deck'?inp:{...empty,zoom:inp.zoom},headWorld());
  sky.update(timeStep,camera);sky.setUniverseBlend(camRig.universeBlend,camera.position.distanceTo(ship.group.position));sky.setInside(false,dt);
  lights.setUniverseBlend(camRig.universeBlend);lights.update(dt,controller.pos);lights.hemi.intensity=Math.max(lights.hemi.intensity,1.38);
  starry.update(true,timeStep);bigSigil.setUniverseBlend(camRig.universeBlend);bigSigil.update(timeStep,camera);bow.update(timeStep);
  for(const door of doors)door.sigil.update(timeStep);
  renderer.info.reset();composer.render();frames++;
  if(frames%5===0){
   for(const b of buttons)b.style.setProperty('--cool',skills.cooldownFraction(b.dataset.action)||0);
   window.__deckQA.snapshot={position:controller.pos.toArray(),airborne:controller.airborne,form:wanderer.form,mode:camRig.mode,counts:{...counts},teleportOnComplete:skills.teleportOnComplete,starry:starry.state.active,frames,drawCalls:renderer.info.render.calls};
   $('scene').dataset.check=JSON.stringify(window.__deckQA.snapshot);
  }
 }
 function focusState(){if(failed)return;active=!document.hidden&&document.hasFocus();input.reset();camRig.setInputLocked(!active||paused);previous=performance.now();$('scene').dataset.activity=active?'active':'paused';}
 function regainFocus(){if(document.hidden||failed||active)return;active=true;input.reset();camRig.setInputLocked(paused);previous=performance.now();$('scene').dataset.activity='active';}
 addEventListener('blur',focusState);
 addEventListener('focus',()=>queueMicrotask(focusState));
 canvas.addEventListener('focus',regainFocus);
 canvas.addEventListener('pointerdown',regainFocus,{capture:true});
 document.addEventListener('visibilitychange',focusState);
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);});
 addEventListener('pagehide',event=>{suspended=true;active=false;input.reset();cancelAnimationFrame(frameId);if(!event.persisted){camRig.controls.dispose();composer.dispose();renderer.dispose();}});
 addEventListener('pageshow',event=>{if(event.persisted&&!failed){suspended=false;focusState();frameId=requestAnimationFrame(frame);}});
 focusState();frameId=requestAnimationFrame(frame);
}
boot().catch(error=>showFailure(error));
