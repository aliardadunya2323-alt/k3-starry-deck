// GPU morphs only: no per-frame geometry edits, timers, listeners or new lights.
export const FACE_PERFORMANCE_VERSION = 'private-face-attention-01';
export const FACE_EXPRESSIONS = Object.freeze({
  neutral: [0,0,0,0,0], smile: [1,0,0,0,0], focus: [0,1,0,0,0], blink: [0,0,1,0,0],
  curious: [.14,.18,0,.16,.20], relaxed: [.32,0,.18,0,-.08],
  determined: [.12,.78,.06,0,0], thoughtful: [.06,.28,.12,-.18,-.24],
});
const IDLE_ATTENTION = [[0,0,2.6],[-.8,.18,.8],[0,0,1.9],[.6,-.10,1.1],[0,.06,2.3],[.1,.5,.7]];
const LOOK_ATTENTION = [[-.8,0,.65],[0,.18,.55],[.85,.05,.8],[0,0,1.0]];
const CHANNELS = ['blinkLeft', 'blinkRight', 'blinkLeftCurve', 'blinkRightCurve',
  'blinkLeftCover', 'blinkRightCover',
  'smile', 'focus', 'gazeLeft', 'gazeRight', 'gazeUp', 'gazeDown'];
const INTERVALS = [3.9, 5.2, 4.3, 6.1];
const LID_VISIBILITY_THRESHOLD = .0001;
const clamp = v => Math.max(0, Math.min(1, v));
const ease = v => { const t = clamp(v); return t * t * (3 - 2 * t); };

export function createFacePerformance(root) {
  const slots = new Map(CHANNELS.map(name => [name, []]));
  const lids = [];
  root.traverse(mesh => {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    for (const name of CHANNELS) {
      const index = mesh.morphTargetDictionary[name];
      if (Number.isInteger(index)) slots.get(name).push([mesh, index]);
    }
    if (mesh.userData?.surfaceRole === 'lidSkin')
      lids.push({ mesh, count: mesh.geometry?.drawRange.count ?? Infinity });
  });
  if (![...slots.values()].some(list => list.length)) return null;
  const values = Object.fromEntries(CHANNELS.map(name => [name, 0]));
  let time = 0, wait = 3.2, blinkTime = -1, cycle = 0, request = null;
  let gazeRequest = null, gazeState = '', gazeTime = 0, gazeIndex = 0;
  const attention = { state:'idle', phase:0, targetX:0, targetY:0, explicit:false };
  const set = (name, value) => {
    values[name] = clamp(value);
    for (const [mesh, index] of slots.get(name)) mesh.morphTargetInfluences[index] = values[name];
  };
  const showLids = visible => {
    for (const { mesh, count } of lids) {
      // Keep visible for the existing traverseVisible shader warm-up. Zero draw
      // count hides open lids without recompilation or position-buffer uploads.
      if (mesh.geometry?.setDrawRange) {
        mesh.visible = true;
        mesh.geometry.setDrawRange(0, visible ? count : 0);
      } else mesh.visible = visible;
    }
  };
  const reset = () => {
    for (const name of CHANNELS) set(name, 0);
    showLids(false);
    time = 0; wait = 3.2; blinkTime = -1; cycle = 0; request = null;
    gazeRequest=null;gazeState='';gazeTime=0;gazeIndex=0;
    Object.assign(attention,{state:'idle',phase:0,targetX:0,targetY:0,explicit:false});
  };
  reset();
  return {
    version: FACE_PERFORMANCE_VERSION,
    expressions: Object.keys(FACE_EXPRESSIONS), attention,
    channels: CHANNELS.filter(name => slots.get(name).length),
    values, reset,
    setExpression(name, strength = .5, seconds = 2) {
      if (!Object.prototype.hasOwnProperty.call(FACE_EXPRESSIONS,name) ||
          !Number.isFinite(strength) || !Number.isFinite(seconds) || seconds <= 0) return false;
      request = { name, strength: clamp(strength), remaining: Math.min(30, seconds) };
      return true;
    },
    // Normalized direction; an ellipse caps the existing authored eye movement.
    setGaze(x,y,seconds=2) {
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(seconds)||seconds<=0)return false;
      x=Math.max(-1,Math.min(1,x));y=Math.max(-1,Math.min(1,y));const length=Math.hypot(x,y);
      if(length>1){x/=length;y/=length;}
      gazeRequest={x:x*.55,y:y*.30,remaining:Math.min(30,seconds)};return true;
    },
    update(dt, state = 'idle', reducedMotion = false) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(.1, dt);
      time += dt;
      if (request) { request.remaining -= dt; if (request.remaining <= 0) request = null; }
      if(gazeRequest){gazeRequest.remaining-=dt;if(gazeRequest.remaining<=0)gazeRequest=null;}
      const expression=request&&request.name!=='blink'?FACE_EXPRESSIONS[request.name]:null;
      let blink = 0;
      if (reducedMotion) { blinkTime = -1; wait = 3.2; }
      else {
        wait -= dt;
        if (wait <= 0 && blinkTime < 0) blinkTime = 0;
        if (blinkTime >= 0) {
          blinkTime += dt;
          blink = blinkTime < .06 ? ease(blinkTime / .06) : 1 - ease((blinkTime - .06) / .14);
          if (blinkTime >= .2) { blinkTime = -1; wait = INTERVALS[cycle++ % INTERVALS.length]; }
        }
      }
      if (request?.name === 'blink') blink = request.strength;
      else if(expression)blink=Math.max(blink,expression[2]*request.strength);
      set('blinkLeft', blink); set('blinkRight', blink);
      set('blinkLeftCurve', 4 * blink * (1 - blink));
      set('blinkRightCurve', 4 * blink * (1 - blink));
      // Contact correction flattens the authored iris relief onto the globe.
      // Open-eye geometry stays untouched; sclera and iris then retract together.
      // Finish contact seating before drawing the first visible lid strip.
      set('blinkLeftCover', ease(blink / LID_VISIBILITY_THRESHOLD));
      set('blinkRightCover', ease(blink / LID_VISIBILITY_THRESHOLD));
      showLids(blink > LID_VISIBILITY_THRESHOLD);
      let smile = state === 'sit' ? .28 : state === 'interact' ? .35 : .04;
      let focus = state === 'run' || state === 'jump' ? .3 : state === 'look' ? .1 : 0;
      if (request && request.name !== 'blink') {
        smile = expression[0]*request.strength;
        focus = expression[1]*request.strength;
      }
      const blend = 1 - Math.exp(-10 * dt);
      set('smile', values.smile + (smile - values.smile) * blend);
      set('focus', values.focus + (focus - values.focus) * blend);
      if(state!==gazeState||reducedMotion){gazeState=state;gazeTime=0;gazeIndex=0;}
      let gx=0,gy=0;
      if(state==='idle'||state==='sit'||state==='look'){
        const sequence=state==='look'?LOOK_ATTENTION:IDLE_ATTENTION;
        if(!reducedMotion)gazeTime+=dt;
        while(gazeTime>=sequence[gazeIndex][2]){gazeTime-=sequence[gazeIndex][2];gazeIndex=(gazeIndex+1)%sequence.length;}
        const pose=sequence[gazeIndex];
        gx=pose[0]*(state==='look'?.55:state==='sit'?.18:.24);
        gy=pose[1]*(state==='look'?.30:state==='sit'?.10:.13);
      }else if(state==='interact')gy=-.08;
      // Locomotion looks ahead. Timed explicit directions override automation,
      // but reduced motion still suppresses eye travel exactly as before.
      if(expression){gx=expression[3]*request.strength*.55;gy=expression[4]*request.strength*.30;}
      if(gazeRequest){gx=gazeRequest.x;gy=gazeRequest.y;}
      gx*=1-blink;gy*=1-blink;
      attention.state=state;attention.phase=gazeIndex;attention.targetX=reducedMotion?0:gx;attention.targetY=reducedMotion?0:gy;attention.explicit=!!gazeRequest;
      const gazeBlend=1-Math.exp(-24*dt);
      set('gazeLeft',reducedMotion?0:values.gazeLeft+(Math.max(0,gx)-values.gazeLeft)*gazeBlend);
      set('gazeRight',reducedMotion?0:values.gazeRight+(Math.max(0,-gx)-values.gazeRight)*gazeBlend);
      set('gazeUp',reducedMotion?0:values.gazeUp+(Math.max(0,gy)-values.gazeUp)*gazeBlend);
      set('gazeDown',reducedMotion?0:values.gazeDown+(Math.max(0,-gy)-values.gazeDown)*gazeBlend);
    },
  };
}
