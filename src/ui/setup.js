







import{h,clear}from'./dom.js';
import{button,screenHeader,notice,segmented,confirmSheet,icon,filePicker}from'./components.js';
import{t,fmtNum}from'../i18n/index.js';
import{fmtQuantity}from'../i18n/units.js';
import{createCornerPicker,snapshot,grayOf,overlayColour}from'./magnifier.js';
import{startMotion}from'./sensors.js';
import{tripodDiagram}from'./tripod-diagram.js';
import{classifyCameraError}from'./onboarding.js';
import{calibrate}from'../calib/ladder.js';
import{evaluate,cornerDrift,COMMON_LIMITS,meanLuma}from'../calib/checks.js';
import{ghostCorners,ghostDistance}from'../calib/ghost.js';
import{poseReport}from'../calib/report.js';
import{refineCorners}from'../calib/mat.js';
import{createGravityTracker,gravityPrior,orientationName}from'../calib/gravity.js';
import{framesBudget,predictedBallWidthPx,ballHeight}from'../calib/ballspot.js';
import{nominalF}from'../calib/pnp.js';
import{fLockFromSolves}from'../calib/preset.js';
import{SETUP_STEPS,STEP_ESTIMATE_S}from'../calib/timer.js';
import{nominalCamera,project}from'../geom/camera.js';
import{detectRestBall}from'../track/ball.js';
import{tripodPlacement}from'../session/bay.js';
import{saveSettings}from'../session/settings.js';
import{RC}from'../contract/reason-codes.js';

export const SETUP_UI_STEPS=Object.freeze(['tripod','level','corners','ball','address','done']);
const VIEWS=['face_on','dtl','high_behind'];
const LEVEL_HOLD_S=1;
const FLOCK_SOLVES=3;
const FLOCK_EVERY_MS=1000;
const SUN_LUMA=200;

function screenAngle(){
try{return orientationName(globalThis.screen?.orientation?.angle??globalThis.orientation??0);}catch(_){return'portrait';}
}


export function streamFocal(venue,preset,W,H){
const scale=(f,fw,fh)=>(Number.isFinite(f)?f*(Math.max(W,H)/(Number.isFinite(fw)?Math.max(fw,fh):Math.max(W,H))):null);
const fv=scale(venue?.f_locked,venue?.f_W,venue?.f_H);
if(fv)return{f:fv,locked:true};
const fp=scale(preset?.f_locked,preset?.W,preset?.H);
if(fp)return{f:fp,locked:true};
return{f:nominalF(W,H),locked:false};
}


export function cameraProblem(perm,errName,hasApi=true){
if(!hasApi)return'missing';
if(perm==='busy'||perm==='missing')return perm;
if(perm==='unsupported')return'missing';
if(perm==='denied'){const k=classifyCameraError(errName);return k==='unsupported'?'denied':k;}
return null;
}


const FIX_ORDER=['preset_view','corners_in_frame','rmse_px','edge_residual_px','f_format','min_D_m','abs_Y_m',
'abs_yaw_deg','rel_yaw_deg','abs_roll_deg','rel_roll_deg','abs_pitch_deg','rel_pitch_deg','rel_D_m','rel_h_m',
'rel_X_m','rel_Y_m','ghost_px','ball_width','ball_min_px','frames_budget'];







export function fixInstruction(evaluation){
const fails=evaluation?.failures??[];
if(!fails.length)return null;
const rank=(f)=>{const i=FIX_ORDER.indexOf(f.check);return(f.severity==='amber'?100:0)+(i<0?99:i);};
const f=[...fails].sort((a,b)=>rank(a)-rank(b))[0];
const v=Number(f.value);
const abs=Math.abs(v);
const out=(k,extra={})=>({check:f.check,code:`setup.fix.${k}`,...extra});
switch(f.check){
case'abs_yaw_deg':case'rel_yaw_deg':return out(v>0?'turn_right':'turn_left',{deg:abs});
case'abs_pitch_deg':case'rel_pitch_deg':return out(v>0?'tilt_down':'tilt_up',{deg:abs});
case'abs_roll_deg':case'rel_roll_deg':return out(v>0?'rotate_ccw':'rotate_cw',{deg:abs});
case'rel_D_m':return out(v>0?'move_closer':'move_back',{m:abs});
case'min_D_m':return out('move_back',{m:Math.max(0.01,Number(f.limit)-v)});
case'rel_h_m':return out(v>0?'lower':'raise',{m:abs});
case'rel_X_m':return out(v>0?'move_left':'move_right',{m:abs});
case'rel_Y_m':return out(v>0?'move_right':'move_left',{m:abs});
case'abs_Y_m':return out(v>0?'move_right':'move_left',{m:Math.max(0.01,abs-Number(f.limit))});
case'corners_in_frame':return out('frame_mat');
case'rmse_px':case'edge_residual_px':return out('retap');
case'f_format':return out('lens_1x');
case'ghost_px':return out('align_ghost');
case'ball_width':case'ball_min_px':return out('ball_again');
case'preset_view':return out('preset_view');
case'frames_budget':return out('frames_budget');
default:return out('generic');
}
}

export function mountSetup(root,app){
let raf=0;
let stopMotion=null;
let tracker=null;
let grav=null;
let gravSeen=false;
let levelOkAt=null;
let levelWait=0;
let ghost=null;
let result=null;
let ball=null;
let recorded=new Set();
let step=0;
let picking=false;
let flock=null;
let msgLine=null;
let addressTimer=0;
let unsub=null;
let offStream=null;
let levelWaitTimer=0;
let mounted=false;
let els={};

const ctx=()=>app.current??{venue:null,preset:null,view:app.store.get().view,mode:'live'};
const units=()=>app.units();

const dist=(m,digits)=>(units().body==='in'&&Math.abs(m)>=0.9?fmtQuantity(Math.abs(m),'height',{...units(),height:'ftin'}).text:fmtQuantity(m,'body',units(),digits===undefined?{}:{digits}).text);
const save=(patch)=>{const s=saveSettings(patch);app.updateSettings?.(s);return s;};
const say=(code,params={},kind='')=>{msgLine={code,params,kind};paintMsg();};

function rec(s){
if(recorded.has(s))return;
const tm=app.controller.setupTimer;
if(!tm)return;
const last=tm.events().at(-1)?.t_s??0;
try{tm.record(s,Math.max(last,performance.now()/1000));recorded.add(s);}catch(_){ }
}

function dims(){
const v=els.video;
return v&&v.videoWidth?{W:v.videoWidth,H:v.videoHeight}:null;
}

function computeGhost(){
const d=dims();
const{venue,preset,view}=ctx();
if(!d||!venue)return null;
const{f}=streamFocal(venue,preset,d.W,d.H);
try{
if(preset?.pose&&preset.view===view)return ghostCorners(preset,venue,{W:d.W,H:d.H,f}).corners;
const opts={W:d.W,H:d.H,f};
const p=tripodPlacement(venue,view);
if(view==='face_on')Object.assign(opts,{D:p.D_m,h:p.h_m,shift:p.side_m});
const pose=poseReport(nominalCamera(view,opts),view);
return ghostCorners({pose,view,f_locked:f,W:d.W,H:d.H},venue,{W:d.W,H:d.H,f}).corners;
}catch(_){
return null;
}
}


function attachStream(stream){
const m=app.controller.media();
const s=stream??m.stream;
if(els.video&&s&&els.video.srcObject!==s){
els.video.srcObject=s;
els.video.play?.().catch(()=>{});
}
if(s&&els.waiting)els.waiting.hidden=true;
}

function drawOverlay(){
raf=requestAnimationFrame(drawOverlay);
attachStream();
const c=els.overlay;
const d=dims();
if(!c||!d)return;
if(c.width!==d.W||c.height!==d.H){c.width=d.W;c.height=d.H;els.stage.style.aspectRatio=`${d.W} / ${d.H}`;els.stage.style.setProperty('--ar',String(d.W/d.H));ghost=computeGhost();}
const g=c.getContext('2d');
g.clearRect(0,0,c.width,c.height);
const s=Math.max(2,d.W/480);
const showGhost=SETUP_UI_STEPS[step]==='corners'||SETUP_UI_STEPS[step]==='tripod';
if(ghost&&showGhost){
g.save();
g.setLineDash([8*s,6*s]);
g.lineWidth=2*s;
g.strokeStyle='rgba(255,255,255,0.95)';
g.shadowColor='rgba(0,0,0,0.8)';
g.shadowBlur=2*s;
g.beginPath();
ghost.forEach((p,i)=>(i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1])));
g.closePath();
g.stroke();
for(const p of ghost){g.beginPath();g.arc(p[0],p[1],8*s,0,2*Math.PI);g.stroke();}
g.restore();
}
if(result?.corners){
g.fillStyle=overlayColour(result.evaluation.light==='green'?'--overlay-go':result.evaluation.light==='amber'?'--overlay-caution':'--overlay-stop','gray');
for(const p of result.corners){g.beginPath();g.arc(p[0],p[1],5*s,0,2*Math.PI);g.fill();}
}

g.strokeStyle='rgba(255,255,255,0.45)';
g.lineWidth=s;
g.setLineDash([]);
g.strokeRect(0.025*d.W,0.025*d.H,0.95*d.W,0.95*d.H);
}


function levelLimits(){
return ctx().view==='high_behind'?{pitch:1.0,roll:0.5,rel:true}:{pitch:1.0,roll:0.5,rel:false};
}

function levelState(){
if(!grav)return null;
const lim=levelLimits();
const preset=ctx().preset;
const pitch=lim.rel&&preset?.pose?grav.pitch_deg-preset.pose.pitch_deg:grav.pitch_deg;
const ok=Math.abs(pitch)<=lim.pitch&&Math.abs(grav.roll_deg)<=lim.roll;
return{pitch,roll:grav.roll_deg,ok,lim};
}

function onGravity(r){
grav=r;
gravSeen=true;
const ls=levelState();
if(ls?.ok){
rec('C3');
const now=performance.now()/1000;
if(levelOkAt===null)levelOkAt=now;
if(SETUP_UI_STEPS[step]==='level'&&now-levelOkAt>=LEVEL_HOLD_S){levelOkAt=null;goStep(step+1);return;}
}else levelOkAt=null;
if(SETUP_UI_STEPS[step]==='level')paintLevel();
}

function startLevel(){
stopMotion?.();
tracker=createGravityTracker({orientation:screenAngle()});
stopMotion=startMotion(app,(acc,tt)=>{const r=tracker.push(acc,tt);if(r)onGravity(r);},()=>{grav=null;if(SETUP_UI_STEPS[step]==='level')renderStep();});
}

function retryMotion(){
const p=app.controller.retryMotion();
p.then((st)=>{if(st==='granted')startLevel();else say('setup.level.still_off',{},'bad');renderStep();});
}

function paintLevel(){
if(!els.level)return;
const ls=levelState();
if(!ls)return;
const x=Math.max(-1,Math.min(1,ls.roll/3));
const y=Math.max(-1,Math.min(1,ls.pitch/3));
els.bubble.style.transform=`translate(${(x*42).toFixed(1)}%, ${(-y*42).toFixed(1)}%)`;
els.bubble.classList.toggle('ok',ls.ok);
els.levelBox.classList.toggle('ok',ls.ok);
els.levelText.textContent=ls.ok?t('setup.level.ok'):t(Math.abs(ls.roll)/ls.lim.roll>Math.abs(ls.pitch)/ls.lim.pitch?(ls.roll>0?'setup.level.roll_pos':'setup.level.roll_neg'):(ls.pitch>0?'setup.level.pitch_pos':'setup.level.pitch_neg'));
if(els.levelNums)els.levelNums.textContent=t('setup.level.numbers',{pitch:fmtNum(ls.pitch,{digits:1}),roll:fmtNum(ls.roll,{digits:1})});
els.primary?.setReason(ls.ok?null:t('setup.level.reason'));
}


function solveWith(corners,{W,H,edge=null,source='live',quiet=false}){
const{venue,preset,view,mode}=ctx();
const foc=streamFocal(venue,preset,W,H);
const g=grav?gravityPrior(grav):null;
const visible={corners,club:null,ball:null,gravity:g};
let r;
try{
r=calibrate(visible,{
venue,view,W,H,f:foc.f,fLocked:foc.locked,preset:preset?.view===view?preset:null,
cornerSource:'manual',source,slope_deg:venue?.slope_deg??null,
});
}catch(e){r={ok:false};app.record?.('setup.solve_error',String(e?.message??e));}
if(!r.ok){if(!quiet)say('setup.corners.no_solve',{},'bad');return null;}
const cam=r.calibration.camera;
const ghostPx=preset?.pose&&preset.view===view&&ghost?ghostDistance(corners,ghost).max_px:undefined;
let budget;
if(mode==='highspeed'&&view==='face_on'){
try{budget=framesBudget(cam,view,70,12,undefined,{fps:240}).frames;}catch(_){budget=undefined;}
}
const evaluation=evaluate({
view,report:r.calibration.pose,rmse_px:r.calibration.reproj_rmse_px,edge_residual_px:edge??undefined,
f_free_px:r.solve?.fFormat?.f_free,f_locked_px:foc.locked?r.solve?.f:undefined,corner_source:'manual',
preset:preset?.view===view?preset:null,ghost_px:ghostPx,corners,W,H,
gravity_available:Boolean(grav),frames_budget:budget,
ball:ball&&!ball.missing?{w_px:ball.w_px,predicted_w_px:ball.predicted_w_px}:undefined,
});
result={calibration:r.calibration,solve:r.solve,evaluation,corners,W,H,source};
app.record?.('setup.light',evaluation.light);
if(!foc.locked)collectF(r.calibration.f_px,W,H,corners,edge,source);
rec('C4');
rec('C5');
rec('C6');
return result;
}


function collectF(f,W,H,corners,edge,source){
const cur=ctx();
const fs=[...(cur.fSolves??[]),f];
app.current={...cur,fSolves:fs};
const lock=fLockFromSolves(fs);
if(lock.ok&&cur.venue){
const venue={...cur.venue,f_locked:lock.f_locked,f_W:W,f_H:H,f_sd_pct:lock.sd_pct,f_solves:fs,f_view:cur.view};
app.current={...app.current,venue,fSolves:[]};
app.repo?.venues.put(venue).catch(()=>{});
app.record?.('calibration.f_lock',{f_locked:lock.f_locked,sd_pct:lock.sd_pct,n:lock.n});
stopFlock();
solveWith(corners,{W,H,edge,source,quiet:true});
}
}

function fLocked(){return Number.isFinite(ctx().venue?.f_locked);}


function startFlock(){
stopFlock();
if(fLocked()||!result)return;
flock={n:1,timer:0};
const tick=()=>{
if(!flock||fLocked()||!result){stopFlock();renderStep();return;}
const v=els.video;
if(v?.videoWidth){
try{
const fr=snapshot(v,v.videoWidth,v.videoHeight);
const ref=refineCorners(grayOf(fr),result.corners);
if(ref?.ok)solveWith(ref.corners,{W:fr.width,H:fr.height,edge:ref.max_edge_residual_px,source:'live',quiet:true});
}catch(_){ }
}
if(!flock){renderStep();return;}
flock.n+=1;
if(flock.n>=FLOCK_SOLVES||fLocked()){stopFlock();renderStep();return;}
flock.timer=setTimeout(tick,FLOCK_EVERY_MS);
renderStep();
};
flock.timer=setTimeout(tick,FLOCK_EVERY_MS);
}
function stopFlock(){if(flock)clearTimeout(flock.timer);flock=null;}

function openPicker(frameCanvas=null){
const v=els.video;
const fr=frameCanvas??(v?.videoWidth?snapshot(v,v.videoWidth,v.videoHeight):null);
if(!fr){say('setup.corners.no_frame',{},'bad');return;}
els.picker.setFrame(fr);
els.picker.setGhost(frameCanvas?null:ghost);
els.picker.reset();
picking=true;
els.pickerBox.hidden=false;
els.stage.hidden=true;
renderStep();
els.pickerBox.querySelector('canvas')?.focus?.({preventScroll:true});
}

function closePicker(){
picking=false;
els.pickerBox.hidden=true;
els.stage.hidden=false;
els.pickerDone=null;
}

function finishPicker(){
const corners=els.picker.corners();
if(!corners)return;
const ref=els.picker.refine();
const edge=ref?.ok?ref.max_edge_residual_px:null;
const f=els.picker.frame();
closePicker();
msgLine=null;
if(solveWith(els.picker.corners(),{W:f.width,H:f.height,edge}))startFlock();
renderStep();
}


function checkBall(){
if(!result)return;
const v=els.video;
const cam=result.calibration.camera;
const{venue}=ctx();
const lie=app.settings().lie??'mat';
const z=ballHeight(lie,venue?.tee_lift_m??null,Number.isFinite(venue?.tee_lift_m)?'measured':'assumed').z_m;
const X=[0,0,z];
const pr=project(cam,X);
if(!(pr&&pr.z>0)||!v?.videoWidth){say('setup.ball.no_predict',{},'bad');return;}
const predicted=predictedBallWidthPx(cam,X);
let det=null;
try{det=detectRestBall(grayOf(snapshot(v,v.videoWidth,v.videoHeight)),{x:0,y:0,w:v.videoWidth,h:v.videoHeight},{u:pr.u,v:pr.v,w_px:predicted},{polarity:'auto'});}catch(_){det=null;}
if(!det){say('setup.ball.not_found',{},'bad');return;}
ball={w_px:det.w_px,predicted_w_px:predicted,lie:det.lie};
rec('C7');
solveWith(result.corners,{W:result.W,H:result.H,edge:null,source:result.source,quiet:true});
say(det.lie==='tee'?'setup.ball.found_tee':'setup.ball.found',{},'ok');
renderStep();
}


function sceneLuma(){
const v=els.video;
try{
if(!v||!(v.videoWidth>0))return NaN;
const w=160;
const hh=Math.max(1,Math.round((w*v.videoHeight)/v.videoWidth));
return meanLuma(grayOf(snapshot(v,w,hh)),{stride:2});
}catch(_){return NaN;}
}

async function doLock(forced){
if(!result)return;
const{venue,preset,view,mode}=ctx();
if(forced){
const ok=await confirmSheet({title:t('setup.done.force_title'),consequence:t('setup.done.force_body'),confirmLabel:t('setup.done.force_confirm'),testid:'setup-force'});
if(!ok)return;
}
try{
const p=await app.controller.lock({calibration:result.calibration,evaluation:result.evaluation,forced,venue,view,W:result.W,H:result.H,preset,corners:result.corners,luma:sceneLuma()});
app.current={...ctx(),preset:p,calibration:result.calibration,lie:ball?.lie??app.settings().lie,setupCorners:result.corners};
if(forced)app.toast.info(t('setup.done.forced_toast'));
app.nav.go(mode==='highspeed'?'import':'live');
}catch(e){
app.errors.report(e,{where:'setup.lock'});
}
}


async function calibClip(file){
const dec=app.deps.decode;
if(!dec?.decodeFile){say('setup.clip.no_decoder',{},'bad');return;}
const frames=[];
try{
await dec.decodeFile(file,{
to_s:2.0,
onFrame:(frame,t_s)=>{
const W=frame.displayWidth??frame.width;
const H=frame.displayHeight??frame.height;
if(frames.length===0||t_s>1.5){
const c=snapshot(frame,W,H);
if(frames.length<2)frames.push(c);else frames[1]=c;
}
frame.close?.();
},
});
}catch(e){
app.errors.report(e,{where:'setup.clip',silent:true});
say('setup.clip.decode_failed',{},'bad');
return;
}
if(frames.length<2){say('setup.clip.too_short',{},'bad');return;}
openPicker(frames[0]);
els.pickerDone=()=>{
const taps=els.picker.corners();
if(!taps)return;
try{
const a=refineCorners(grayOf(frames[0]),taps);
const b=refineCorners(grayOf(frames[1]),taps);
if(!a.ok||!b.ok){say('setup.clip.refine_failed',{},'bad');return;}
const drift=cornerDrift(a.corners,b.corners);
closePicker();
if(!(drift.max_px<=COMMON_LIMITS.clip_drift_px)){say('setup.clip.drift',{px:fmtNum(drift.max_px,{digits:1})},'bad');renderStep();return;}
solveWith(a.corners,{W:frames[0].width,H:frames[0].height,edge:Math.max(a.max_edge_residual_px,b.max_edge_residual_px),source:'clip'});
rec('C10');
say('setup.clip.ok',{px:fmtNum(drift.max_px,{digits:2})},'ok');
renderStep();
}catch(e){
app.errors.report(e,{where:'setup.clip'});
}
};
renderStep();
}


function goStep(i){
clearTimeout(addressTimer);
if(picking)closePicker();
msgLine=null;
step=Math.max(0,Math.min(SETUP_UI_STEPS.length-1,i));
app.record?.('setup.step',SETUP_UI_STEPS[step]);
renderStep();
els.stepTitle?.focus?.({preventScroll:true});
}

function paintMsg(){
if(!els.msg)return;
els.msg.textContent=msgLine?t(msgLine.code,msgLine.params):'';
els.msg.className=`step-msg ${msgLine?.kind??''}`;
els.msg.hidden=!msgLine;
}

function lightPill(e){
const fix=fixInstruction(e);
const fixText=fix?t(fix.code,{deg:fmtNum(fix.deg??0,{digits:1}),dist:dist(fix.m??0,0)}):null;
return h('div.light-summary',{},
h('div',{class:`light ${e.light}`,role:'status'},h('span.light-glyph',{'aria-hidden':'true'},e.light==='green'?'✓':e.light==='amber'?'!':'✕'),h('span',t(`setup.light.${e.light}`))),
fixText&&e.light!=='green'?h('p.fix-line',{'data-testid':'setup-fix'},fixText):null);
}

function devBlock(){
if(!app.settings().dev)return null;
const tm=app.controller.setupTimer;
const sum=tm?.summary?.()??{steps:{}};
const ev=tm?.events?.()??[];
const total=ev.length?performance.now()/1000-ev[0].t_s:0;
const highspeed=ctx().mode==='highspeed';
const steps=SETUP_STEPS.filter((st)=>(highspeed?st!=='C5':st!=='C10'));
const p=result?.calibration?.pose;
return h('details.dev-block',{'data-spec-overlay':''},
h('summary',t('setup.dev.title')),
h('p.mono',t('setup.dev.timer',{s:fmtNum(total)})),
h('ol.mono',{},steps.map((st)=>h('li',`${st} ${sum.steps[st]!==undefined?`${Math.round(sum.steps[st])}s`:`~${STEP_ESTIMATE_S[st]}s`}`))),
p?h('p.mono',`yaw ${fmtNum(p.yaw_deg,{digits:2})}° pitch ${fmtNum(p.pitch_deg,{digits:2})}° roll ${fmtNum(p.roll_deg,{digits:2})}° D ${fmtNum(p.D_m,{digits:3})} h ${fmtNum(p.h_m,{digits:3})} rmse ${fmtNum(result.calibration.reproj_rmse_px,{digits:2})}px`):null,
result?h('ul.mono',{},result.evaluation.failures.map((f)=>h('li',`${f.check}: ${typeof f.value==='number'?fmtNum(f.value,{digits:3}):f.value} / ${f.limit}`))):null,
button({label:t('setup.dev.light_check'),size:'md',onClick:()=>{const l=sceneLuma();const r=Number.isFinite(l)?app.controller.checkScene?.({luma:l}):null;const b=r?.checks?.brightness;say(!b||b.skipped?'setup.dev.light_none':b.changed?'setup.dev.light_changed':'setup.dev.light_ok',{pct:fmtNum(100*(b?.rel??0))});}}));
}

function viewPicker(){
const{view}=ctx();
return h('div.field',{},
h('span.field-label',{id:'setup-view-label'},t('setup.view.label')),
segmented({label:t('setup.view.label'),testid:'setup-view',options:VIEWS.map((v)=>[v,t(`view.${v}`)]),value:view,onChange:(v)=>changeAngle(v)}));
}

async function changeAngle(v){
let p=null;
try{
if(app.repo&&ctx().venue){
const list=(await app.repo.presets.list({index:'venue_id',query:ctx().venue.venue_id})).filter((x)=>x.view===v);
p=list.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0]??null;
}
}catch(_){p=null;}
try{app.controller.changeAngle(v,p);}catch(e){app.errors.report(e,{where:'setup.angle',silent:true});}
app.current={...ctx(),view:v,preset:p};
result=null;
ball=null;
ghost=null;
if(els.overlay)els.overlay.width=0;
recorded=new Set();
stopFlock();
renderShell();
goStep(0);
app.toast.info(t('setup.view.changed',{view:t(`view.${v}`),orient:t(v==='dtl'?'setup.tripod.portrait':'setup.tripod.landscape')}));
}

function tripodContent(){
const{venue,view}=ctx();
const p=tripodPlacement(venue??{},view);
const dm=(m)=>dist(m,0);
const diagram=tripodDiagram(p,venue??{},{labels:{distance:dm(p.from_edge_m),target:t('setup.tripod.target'),you:t('setup.tripod.you'),title:t('setup.tripod.diagram',{view:t(`view.${view}`)})}});
const rows=[
['ruler',t('setup.tripod.distance'),dm(p.from_edge_m),t('setup.tripod.distance_hint',{n:fmtNum(p.drivers,{digits:p.drivers%1?1:0})})],
['tripod',t('setup.tripod.height'),dm(p.h_m),t('setup.tripod.height_hint')],
['target',t(p.side_dir==='target'?'setup.tripod.side_target':'setup.tripod.side_golfer'),dm(p.side_m),null],
[p.orientation==='landscape'?'phone-landscape':'phone-portrait',t('setup.tripod.orient'),t(`setup.tripod.${p.orientation}`),t('setup.tripod.lens')],
];
return h('div.tripod',{'data-testid':'setup-tripod','data-from-edge-m':String(p.from_edge_m),'data-height-m':String(p.h_m)},
h('div.tripod-figure',{},diagram),
h('ul.tripod-facts',{},rows.map(([ic,label,value,hint])=>h('li',{},h('span.lr-icon',{},icon(ic)),h('span.tf-text',{},h('span.tf-label',label),hint?h('span.tf-hint',hint):null),h('span.tf-value',value)))),
p.verdict&&p.verdict!=='ideal'?notice({variant:p.verdict==='not_guaranteed'?'caution':'info',title:t(`bay.verdict.${p.verdict}`),body:t(`bay.short.${p.verdict}`)}):null,
p.source==='nominal'&&view==='face_on'?h('p.hint',t('setup.tripod.no_bay')):null,
viewPicker());
}

function levelContent(){
const perm=app.store.get().permissions?.motion;
if(perm==='denied'||perm==='unavailable'||(!grav&&levelWait>=3)){
const denied=perm==='denied';
return h('div',{},notice({variant:'caution',title:t(denied?'setup.level.denied_title':'setup.level.none_title'),body:t(denied?'setup.level.denied_body':'setup.level.none_body')}),
denied?button({label:t('setup.level.enable'),variant:'tinted',size:'lg',block:true,icon:'level',testid:'setup-enable-level',onClick:retryMotion}):null);
}
const bubble=h('div.bubble',{});
const box=h('div.level-big',{role:'img','aria-label':t('setup.level.aria')},h('div.level-ring'),h('div.level-target'),bubble);
const txt=h('p.level-text',{'aria-live':'polite'},grav?'':t('setup.level.waiting'));
const nums=h('p.level-nums');
els.bubble=bubble;
els.levelBox=box;
els.levelText=txt;
els.levelNums=nums;
els.level=box;
return h('div.level-wrap',{},box,txt,nums);
}

function cornersContent(){
const{mode}=ctx();
const kids=[];
if(result)kids.push(lightPill(result.evaluation));
if(!fLocked()&&result){
const n=(ctx().fSolves??[]).length;
kids.push(h('p.hint',{'aria-live':'polite'},flock?t('setup.corners.flock_running',{n:flock.n,total:FLOCK_SOLVES}):t('setup.corners.flock_failed',{n})));
}else if(result&&fLocked())kids.push(h('p.hint',t('setup.corners.flock_ok')));
if(mode==='highspeed'){
kids.push(h('details.clip-card',{},
h('summary',t('setup.clip.title')),
h('ol.plain-steps',{},h('li',t('setup.clip.s1')),h('li',t('setup.clip.s2')),h('li',t('setup.clip.s3'))),
button({label:t('setup.clip.release'),size:'md',icon:'camera-off',onClick:()=>app.controller.releaseCamera()}),
filePicker({accept:'video/*',label:t('setup.clip.choose'),testid:'setup-clip-input',onFiles:(fs)=>calibClip(fs[0])})));
}
return h('div',{},...kids);
}

function ballContent(){
const kids=[];
if(ball&&!ball.missing)kids.push(h('p.check.ok',t('setup.ball.width',{w:fmtNum(ball.w_px,{digits:1}),p:fmtNum(ball.predicted_w_px,{digits:1})})));
return h('div',{},...kids);
}

function doneContent(){
if(!result)return notice({variant:'caution',title:t('setup.done.no_calib_title'),body:t('setup.done.no_calib_body')});
const e=result.evaluation;
const kids=[lightPill(e)];
if(e.light==='amber'){
const warn=[];
if(e.reason_codes.includes(RC.NO_GRAVITY_REF)||!grav)warn.push(t('setup.done.warn_no_level'));
if(e.failures.some((f)=>f.check==='frames_budget'))warn.push(t('setup.fix.frames_budget'));
if(warn.length)kids.push(notice({variant:'caution',title:t('setup.done.amber_title'),items:warn}));
}
if(e.light==='green')kids.push(h('p.step-body',t('setup.done.green_body')));
const fails=e.failures.filter((f)=>f.severity==='red'||f.severity==='amber');
if(fails.length)kids.push(h('details.all-checks',{},h('summary',t('setup.done.all_checks',{n:fails.length})),h('ul.plain-steps',{},fails.map((f)=>h("li",t(`calib.check.${f.check}`,{limit:typeof f.limit==="number"?dist(f.limit,0):""}))))));
const l=sceneLuma();
const st=app.settings();
if(Number.isFinite(l)&&l>SUN_LUMA&&!st.sunSuggested&&st.theme!=='sun'){
kids.push(h('div.notice.notice-info.sun-suggest',{},
h('div.notice-head',{},icon('sun'),h('span.notice-title',t('setup.sun.title'))),
h('div.notice-content',{},h('p.notice-body',t('setup.sun.body')),
h('div.row',{},
button({label:t('setup.sun.use'),variant:'tinted',size:'md',testid:'setup-sun-use',onClick:()=>{save({theme:'sun',sunSuggested:true});app.applyTheme?.('sun');renderStep();}}),
button({label:t('setup.sun.no'),variant:'plain',size:'md',onClick:()=>{save({sunSuggested:true});renderStep();}})))));
}
return h('div',{},...kids);
}

function stepPrimary(name){
const{mode}=ctx();
const P=(label,onClick,extra={})=>button({label,variant:'primary',size:'lg',block:true,testid:'setup-primary',onClick,...extra});
const S=(label,onClick,extra={})=>button({label,variant:'plain',size:'lg',block:true,onClick,...extra});
switch(name){
case'tripod':return[P(t('setup.tripod.cta'),()=>{rec('C0');rec('C1');goStep(step+1);},{icon:'check'})];
case'level':{
const perm=app.store.get().permissions?.motion;
const blocked=perm==='denied'||perm==='unavailable'||(!grav&&levelWait>=3);
const ls=levelState();
return[P(t(blocked?'setup.level.skip_cta':'common.next'),()=>goStep(step+1),{reason:blocked||ls?.ok?null:t(grav?'setup.level.reason':'setup.level.waiting')}),
blocked?null:S(t('setup.level.skip'),()=>goStep(step+1),{testid:'setup-skip-level'})];
}
case'corners':
if(picking){
const done=P(t('setup.corners.done'),()=>(els.pickerDone?els.pickerDone():finishPicker()),{reason:els.picker?.corners()?null:t('setup.corners.need_four')});
els.pickerPrimary=done;
return[done,S(t('setup.corners.cancel'),()=>{closePicker();renderStep();})];
}
if(!result)return[P(t(mode==='highspeed'?'setup.corners.tap_check':'setup.corners.tap'),()=>openPicker(),{icon:'target'})];
return[P(t('common.next'),()=>goStep(step+1)),S(t('setup.corners.again'),()=>openPicker(),{icon:'undo'})];
case'ball':
if(ball&&!ball.missing)return[P(t('common.next'),()=>goStep(step+1))];
return[P(t('setup.ball.detect'),checkBall,{icon:'target'}),S(t('setup.ball.skip'),()=>{ball={missing:true};goStep(step+1);},{testid:'setup-skip-ball'})];
case'address':
return[P(t('setup.address.cta'),()=>{
els.primary?.setReason(t('setup.address.hold'));
say('setup.address.hold',{},'');
clearTimeout(addressTimer);
addressTimer=setTimeout(()=>{rec('C8');goStep(step+1);},2000);
},{icon:'check'})];
case'done':{
if(!result)return[P(t('setup.done.back_corners'),()=>goStep(2))];
const e=result.evaluation;
const go=t(mode==='highspeed'?'setup.done.start_import':'setup.done.start');
if(e.light==='red')return[P(t('setup.done.realign'),()=>goStep(2),{icon:'undo'}),S(t('setup.done.anyway'),()=>doLock(true),{testid:'setup-anyway'})];
return[P(go,()=>doLock(false),{icon:'play'})];
}
default:return[];
}
}

function renderStep(){
if(!els.rail)return;
const name=SETUP_UI_STEPS[step];
const content={tripod:tripodContent,level:levelContent,corners:cornersContent,ball:ballContent,address:()=>null,done:doneContent}[name]();
const[primary,secondary]=stepPrimary(name);
els.primary=primary;
const title=h('h2.step-title',{tabindex:'-1'},t(`setup.${name}.title`));
els.stepTitle=title;
els.msg=h('p.step-msg',{role:'status','aria-live':'polite',hidden:true});
const perms=app.store.get().permissions??{};
const micOff=perms.microphone==='denied'&&perms.camera==='granted';
els.media.dataset.step=name;
clear(els.railBody,
h('p.step-count',t('setup.step_count',{n:step+1,total:SETUP_UI_STEPS.length})),
h('div.setup-step',{'data-testid':'setup-step','data-step':String(step+1),'data-name':name},
title,
h('p.step-body',t(picking&&name==='corners'?'setup.corners.picking_body':`setup.${name}.body`)),
content,
els.msg),
micOff?notice({variant:'caution',title:t('setup.mic_off.title'),body:t('setup.mic_off.body'),testid:'setup-mic-off'}):null,
devBlock(),

globalThis.__GSL_E2E__?h('button.e2e-skip',{type:'button','data-testid':'btn-skip-setup',onclick:()=>app.nav.go(ctx().mode==='highspeed'?'import':'live')},t('setup.e2e_skip')):null);
clear(els.cta,secondary??null,primary);
paintMsg();
if(name==='level')paintLevel();
if(picking&&els.pickerPrimary){
els.picker.onChangeHook=()=>els.pickerPrimary?.setReason(els.picker.corners()?null:t('setup.corners.need_four'));
}
}

function renderCameraOff(kind){
const ios=/iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent??'');
clear(root,
h('div.camera-off',{'data-testid':'camera-off','data-kind':kind},
screenHeader({title:t(`camera.${kind}.title`),back:true,onBack:()=>app.nav.go('home'),backLabel:t('screen.home.title')}),
h('div.co-icon',{},icon('camera-off')),
h('p.co-body',t(`camera.${kind}.body`)),
kind==='denied'?h('div.co-path',{},h('p.co-path-title',t('camera.denied.how')),h('ol.plain-steps',{},[1,2,3].map((i)=>h('li',t(`camera.denied.${ios?'ios':'other'}${i}`))))):null,
h('div.co-actions',{},
button({label:t('camera.retry'),variant:'primary',size:'lg',block:true,icon:'camera',testid:'camera-retry',onClick:()=>retryCamera()}),
button({label:t('camera.import_instead'),variant:'tinted',size:'lg',block:true,icon:'film',testid:'camera-import-instead',onClick:()=>importInstead()}))));
els={cameraOff:kind};
root.querySelector('h1')?.focus?.({preventScroll:true});
}

function retryCamera(){

const p=app.controller.reopenCamera();
Promise.resolve(p).then((ok)=>{app.record?.('setup.camera_retry',Boolean(ok));refreshCamera(true);},()=>refreshCamera(true));
}

function importInstead(){
save({mode:'highspeed'});
Promise.resolve(app.controller.endSession?.()).catch(()=>{}).finally(()=>app.updater?.sessionEnded?.());
app.nav.go('import');
}

function problemNow(){
const s=app.store.get();
const err=app.localDiag?.gum?.error??null;
return cameraProblem(s.permissions?.camera,err,Boolean(globalThis.navigator?.mediaDevices?.getUserMedia));
}

function refreshCamera(force=false){
const kind=problemNow();
if(kind){if(force||els.cameraOff!==kind)renderCameraOff(kind);return;}
if(els.cameraOff||force){renderShell();renderStep();}
}

function renderShell(){
const{view}=ctx();
const video=h('video.preview',{playsinline:true,muted:true,autoplay:true,'aria-label':t('setup.preview_label')});
const overlay=h('canvas.overlay',{'aria-hidden':'true'});
const waiting=h('div.stage-wait',{role:'status'},icon('camera'),h('span',t('setup.opening_camera')));
const stage=h('div.stage',{},video,overlay,waiting);
const picker=createCornerPicker({onChange:()=>els.picker?.onChangeHook?.()});
const pickerBox=h('div.picker-box',{hidden:true},picker.el);
const media=h('div.setup-media',{},stage,pickerBox);
const railBody=h('div.rail-body');
const cta=h('div.rail-cta');
const rail=h('div.setup-rail',{},railBody,cta);
const floatBack=h('button.setup-float-back',{type:'button','aria-label':t('common.back'),onclick:()=>app.nav.go('home')},icon('chevron-left'));
els={video,overlay,stage,waiting,picker,pickerBox,media,rail,railBody,cta};
clear(root,
screenHeader({title:t('setup.title',{view:t(`view.${view}`)}),back:true,onBack:()=>app.nav.go('home'),backLabel:t('screen.home.title')}),
h('div.setup-layout',{},media,rail),
floatBack);
attachStream();
}

return{
attachStream,
show(){
if(mounted){

if(els.cameraOff){renderCameraOff(els.cameraOff);return;}
const hd=root.querySelector(':scope > header.screen-header');
hd?.replaceWith(screenHeader({title:t('setup.title',{view:t(`view.${ctx().view}`)}),back:true,onBack:()=>app.nav.go('home'),backLabel:t('screen.home.title')}));
els.video?.setAttribute('aria-label',t('setup.preview_label'));
renderStep();
return;
}
mounted=true;
result=null;
ball=null;
picking=false;
step=0;
levelOkAt=null;
levelWait=0;
gravSeen=false;
msgLine=null;
recorded=new Set(Object.keys(app.controller.setupTimer?.summary?.().steps??{}));
renderShell();
const kind=problemNow();
if(kind)renderCameraOff(kind);else renderStep();
if(app.store.get().permissions?.motion!=='denied')startLevel();
cancelAnimationFrame(raf);
raf=requestAnimationFrame(drawOverlay);
unsub?.();
unsub=app.store.subscribe((s,prev)=>{
if(s.permissions!==prev.permissions||s.cameraInterrupted!==prev.cameraInterrupted)refreshCamera();
});
offStream?.();
offStream=typeof app.controller.onStreamChange==='function'?app.controller.onStreamChange((stream)=>attachStream(stream)):null;
clearInterval(levelWaitTimer);
levelWaitTimer=setInterval(()=>{if(!gravSeen&&levelWait<3){levelWait+=1;if(levelWait===3&&SETUP_UI_STEPS[step]==='level')renderStep();}},1000);
},
hide(){
mounted=false;
cancelAnimationFrame(raf);
clearTimeout(addressTimer);
clearInterval(levelWaitTimer);
stopFlock();
stopMotion?.();
stopMotion=null;
unsub?.();
unsub=null;
offStream?.();
offStream=null;
},
};
}
