


































import{RC,REASON_CODES}from'../contract/reason-codes.js';
import{EVENTS,METRIC_IDS,METRIC_UNITS,VIEWS}from'../contract/enums.js';
import{metricNull,metricValue,downgrade}from'../contract/metric.js';
import{newShot,attributeWarnings}from'../contract/shot.js';
import{validateShot,ContractError,formatErrors}from'../contract/validate.js';
import{REGISTRY,cellFor}from'../metrics/registry.js';
import{computeMetrics}from'../metrics/compute.js';
import{worseValidity}from'../metrics/common.js';
import{detect}from'../events/detect.js';
import{FEATURE_VERSION}from'../events/features.js';
import{analyzeClip}from'../track/pipeline.js';
import{analyzeFaceOn,analyzeHighBehind}from'../physics/pipeline.js';
import{POSE_CLUB_MAX_FPS}from'../physics/clubspeed_pose.js';
import{SIDE_OFFSET_RED_M}from'../physics/clubpath.js';
import{startFromStaticBall}from'../physics/fit3d.js';
import{BALL_MIN_FPS}from'../physics/result.js';
import{ballPlausibility}from'../physics/plausibility.js';
import{readoutModel}from'../physics/shutter.js';
import{clubCategory}from'../physics/ballistics.js';
import{ballHeight,predictedBallWidthPx,framesBudget}from'../calib/ballspot.js';
import{project}from'../geom/camera.js';
import{nearestFrame,resolveTimestamps}from'./frames.js';
import{fpsAtLeast}from'../geom/constants.js';
import{sha256Hex}from'../physics/sha256.js';
import{deriveLaunchMonitor}from'../physics/lm/index.js';
import{mulberry32}from'../geom/rng.js';

export const ASSEMBLE_VERSION='assemble-1.0.0';

export const DOWNSWING_RANGE_S=Object.freeze([0.15,0.6]);

export const TIME_SCALED_IDS=Object.freeze(['backswing_s','downswing_s','club_speed_mps','ball_speed_mps','carry_m']);

const TEMPO_IDS=['backswing_s','downswing_s','tempo_ratio'];

const PHYSICS_IDS=['club_speed_mps','ball_speed_mps','launch_v_deg','launch_h_deg','carry_m','smash_factor'];

const HIGH_BEHIND_IDS=['club_path_deg','launch_h_deg'];

export const CLUB_LENGTH_M=Object.freeze({
driver:1.15,wood:1.07,hybrid:1.0,iron_long:0.98,iron_mid:0.94,iron_short:0.91,wedge:0.89,unknown:0.94,
});

export const ALGORITHM_VERSIONS=Object.freeze({
events:`rules-1.0.0+${FEATURE_VERSION}`,
ball:'track-ball-1.0.0',
fit3d:'fit3d-1.0.0',
carry:'carry-rk4-mc-1.0.0',
});

const BALL_ROW_IDS=METRIC_IDS.filter((id)=>REGISTRY[id].row>=14);
const uniq=(a)=>[...new Set(a.filter(Boolean))];
const defaultNow=()=>(typeof performance!=='undefined'&&performance.now?performance.now():0);

export{sha256Hex}from'../physics/sha256.js';



function plainCamera(cam,orientation,view){
const readout=cam.readout&&Number.isFinite(cam.readout.ms)
?{ms:cam.readout.ms,axis:cam.readout.axis,dir:cam.readout.dir}
:readoutModel({orientationType:orientation,view}).readout;
return{
W:cam.W,H:cam.H,f:cam.f,cx:cam.cx,cy:cam.cy,k1:cam.k1??0,
R:Array.from(cam.R),t:Array.from(cam.t),readout,
};
}

function plainCalibration(c,orientation,view){
const camera=plainCamera(c.camera,orientation,view);
return{
method:c.method,source:c.source,f_px:c.f_px,f_locked:Boolean(c.f_locked),pose:{...c.pose},
pose_sigma:{...c.pose_sigma},reproj_rmse_px:c.reproj_rmse_px??null,slope_deg:c.slope_deg??null,
preset_dev:c.preset_dev?{...c.preset_dev}:null,readout_ms:camera.readout.ms,
readout_source:c.readout_source??'assumed',camera,
};
}

function rebuild(m,patch){
const next={...m,...patch};
if(next.value===null)return metricNull(next.validity,next.reason_codes,next.unit,next.value_origin);
return metricValue({
value:next.value,unit:next.unit,ci95:next.ci95,sigma:next.sigma,validity:next.validity,
value_origin:next.value_origin,reason_codes:next.reason_codes,
});
}


function appendCode(m,code){
if(m.value===null||m.reason_codes.includes(code))return m;
return rebuild(m,{reason_codes:[...m.reason_codes,code]});
}

function registryNull(id,code){
return metricNull(code===RC.DEPENDS_ON_NULL?'not_computed':'not_observable',[code],METRIC_UNITS[id],REGISTRY[id].value_origin);
}






export function registryFps(capture){
const eff=capture.effective_fps;
const nom=capture.nominal_fps;
if(Number.isFinite(nom)&&nom>0&&Number.isFinite(eff)&&Math.abs(eff-nom)<=0.01*nom)return Math.max(eff,nom);
return eff;
}

function poseRate(poseSeq){
const t=poseSeq?.t_s;
if(!t||t.length<2)return NaN;
const d=[];
for(let i=1;i<t.length;i++)if(t[i]>t[i-1])d.push(t[i]-t[i-1]);
if(!d.length)return NaN;
d.sort((a,b)=>a-b);
return 1/d[d.length>>1];
}

function meanVisibility(poseSeq){
const img=poseSeq?.img;
if(!img||!img.length)return null;
let s=0;
let n=0;
for(let q=3;q<img.length;q+=4)if(Number.isFinite(img[q])){s+=img[q];n++;}
return n?Math.min(1,Math.max(0,s/n)):null;
}


function normalizeEvents(ev,capTimes,fps,poseSeq){
const ok=Boolean(ev)&&EVENTS.every((e)=>ev[e]&&Number.isFinite(ev[e].t_s));
if(!ok){
const t0=capTimes&&capTimes.length?Math.max(0,capTimes[0]):0;
const shot={};
const metric={};
for(const e of EVENTS){
shot[e]={frame:0,t_s:t0,conf:0,source:'rules'};
metric[e]={frame:null,t_s:null,conf:0,source:'rules'};
}
return{ok:false,shot,metric,source:null};
}
const shot={};
const metric={};
for(const e of EVENTS){
const x=ev[e];
const t=x.t_s;
const conf=Number.isFinite(x.conf)?Math.min(1,Math.max(0,x.conf)):0;
const source=['rules','tcn','manual'].includes(x.source)?x.source:'rules';
const frame=capTimes&&capTimes.length?nearestFrame(capTimes,t):Math.max(0,Math.round(t*fps));
shot[e]={frame,t_s:Math.max(0,t),conf,source};
metric[e]={frame:poseSeq?.t_s?.length?nearestFrame(poseSeq.t_s,t):frame,t_s:t,conf,source};
}
return{ok:true,shot,metric,source:shot.impact.source};
}

function algorithmsBlock(poseSeq,calibration,eventsSource,overrides){
const versions={
pose:poseSeq?`mediapipe-pose-landmarker-${poseSeq.model??'unknown'}`:'none',
events:eventsSource==='tcn'?`tcn+${FEATURE_VERSION}`:eventsSource==='manual'?'manual':ALGORITHM_VERSIONS.events,
calib:`calib-1.0.0+${calibration.method}`,
ball:ALGORITHM_VERSIONS.ball,
fit3d:ALGORITHM_VERSIONS.fit3d,
carry:ALGORITHM_VERSIONS.carry,
};
const out={};
for(const k of Object.keys(versions)){
const o=overrides?.[k];
out[k]=o&&o.version&&/^[0-9a-f]{64}$/.test(o.sha256??'')
?{version:o.version,sha256:o.sha256}
:{version:versions[k],sha256:sha256Hex(`golf-swing-lab/${k}/${versions[k]}`)};
}
return out;
}

function clubBlock(club,lieHint){
const type=club?.type?String(club.type):'unknown';
const cat=clubCategory(type);
let lie=club?.lie;
if(lie!=='mat'&&lie!=='tee')lie=lieHint??(cat==='driver'?'tee':'mat');
const src=club?.tee_lift_source??(Number.isFinite(club?.tee_lift_m)?'measured':'assumed');
const hgt=ballHeight(lie,club?.tee_lift_m??null,src);
const L=Number.isFinite(club?.length_m)?club.length_m:CLUB_LENGTH_M[cat??'unknown'];
return{
club:{type,length_m:Math.min(1.5,Math.max(0.5,L)),lie,tee_lift_m:hgt.tee_lift_m,tee_lift_source:hgt.tee_lift_source},
height:hgt,
};
}







export function assembleShot(input){
const now=input.now??defaultNow;
const T0=now();
const timings={events:0,metrics:0,track:0,physics:0,total:0};
const cap=input.capture;
if(!cap||!VIEWS.includes(cap.view))throw new RangeError(`assembleShot: capture.view must be one of ${VIEWS.join('|')}`);
if(!input.calibration||!input.calibration.camera)throw new TypeError('assembleShot: a Calibration with camera is required');
const view=cap.view;
const handedness=input.handedness==='left'?'left':'right';
const fps=cap.effective_fps;
const regFps=registryFps(cap);
const orientation=cap.orientation??'unknown';
const calibration=plainCalibration(input.calibration,orientation,view);
const cam=calibration.camera;
const poseSeq=input.poseSeq&&input.poseSeq.t_s&&input.poseSeq.t_s.length?input.poseSeq:null;
const debug={view,fps,registry_fps:regFps};


let tsKind=cap.timestamps==='nominal'?'nominal':'container';
let capTimes=null;
if(Array.isArray(cap.timestamps)||ArrayBuffer.isView(cap.timestamps)){
const r=resolveTimestamps(cap.timestamps,cap.timestamps.length,cap.nominal_fps);
tsKind=r.kind;
capTimes=r.times;
}
const tsCodes=tsKind==='nominal'?[RC.TIMESTAMPS_NOMINAL]:[];


let t=now();
let rawEvents=input.events??null;
if(!rawEvents&&poseSeq)rawEvents=detect(poseSeq,{view,handedness,audioOnset_t:input.audioOnset_t});
const ev=normalizeEvents(rawEvents,capTimes,fps,poseSeq);
timings.events=now()-t;
debug.events_ok=ev.ok;


t=now();
const pr=poseRate(poseSeq);
const metricsFps=Number.isFinite(pr)?Math.min(regFps,pr):regFps;
const{club:clubOut0,height:height0}=clubBlock(input.club,null);
const metrics=computeMetrics({
view,fps:metricsFps,poseSeq,events:ev.metric,calibration,handedness,venue:input.venue,
club:clubOut0,clubObs:input.clubObs,
});
timings.metrics=now()-t;
debug.metrics_fps=metricsFps;


const cells={};
for(const id of BALL_ROW_IDS){
const cell=cellFor(id,view,regFps);
cells[id]=cell;
if(cell.validity===null)metrics[id]=registryNull(id,cell.code);
else if(id==='club_speed_mps'&&view==='face_on'&&!fpsAtLeast(fps,POSE_CLUB_MAX_FPS)){

const m=metrics[id];
metrics[id]=m.value===null?m:rebuild(m,{validity:worseValidity(m.validity,cell.validity)});
}else metrics[id]=metricNull('not_computed',[RC.TRACK_TOO_SHORT],METRIC_UNITS[id],REGISTRY[id].value_origin);
}

let clubOut=clubOut0;
const lm={fit:null,club:null,start:null,trk:null};
let height=height0;
let trackResult=null;
const warnings=[];
const bf=input.ballFrames;
const haveFrames=Boolean(bf&&bf.frames&&bf.frames.length>=3);
if(view==='high_behind'&&fpsAtLeast(fps,BALL_MIN_FPS)&&(haveFrames||input.track)){
t=now();
const origin=bf?.origin??{u:0,v:0};
const X0=[0,0,height.z_m];
let rb=input.restBall;
if(!rb||!Number.isFinite(rb.u)||!Number.isFinite(rb.v)){
const p=project(cam,X0);
rb={u:p.u,v:p.v,w_px:predictedBallWidthPx(cam,X0)};
}
const p0=project(cam,X0);
const p1=project(cam,[0.3,0,height.z_m+0.1]);
const dl=Math.hypot(p1.u-p0.u,p1.v-p0.v)||1;
const impactGuessT=ev.ok?ev.metric.impact.t_s:undefined;
const trk=input.track??analyzeClip({
frames:bf.frames,times:bf.times,W:bf.W,H:bf.H,roi:bf.roi??null,
restBall:{u:rb.u-origin.u,v:rb.v-origin.v,w_px:rb.w_px>0?rb.w_px:predictedBallWidthPx(cam,X0),lie:clubOut.lie},
impactFrameGuess:Number.isFinite(impactGuessT)?nearestFrame(bf.times,impactGuessT):undefined,
opts:{origin,expectedDir:[(p1.u-p0.u)/dl,(p1.v-p0.v)/dl],now},
});
trackResult=trk;
timings.track=now()-t;
t=now();
const rest=trk.restBall;
const start=rest?startFromStaticBall(cam,rest.u,rest.v,{lift_m:height.tee_lift_m,sigma_px:rest.refined?0.3:1.5}):null;
let tGuess=impactGuessT;
const dep=trk.info?.departure;
const times=bf?.times;
if(times&&Number.isInteger(dep)&&dep>0&&dep<times.length)tGuess=0.5*(times[dep-1]+times[dep]);
lm.trk=trk;
lm.start=start?.X??null;
if(start){
const hb=analyzeHighBehind({
cam,ballObs:trk.ballTrack?.obs??[],clubObs:trk.clubTrack??[],start,fps,club:clubOut,t_impact_guess:tGuess,
calibration,venue:input.venue,handedness,seed:input.seed??1,nMC:input.nPathMC??600,extra_codes:tsCodes,
});
for(const id of HIGH_BEHIND_IDS){
const cell=cells[id];
if(cell.validity===null)continue;
const m=hb.metrics[id];
metrics[id]=m.value===null?m:rebuild(m,{validity:worseValidity(m.validity,cell.validity)});
}
debug.high_behind={
path:hb.path.ok?{value:hb.path.club_path_deg,sigma:hb.path.sigma,n_used:hb.path.n_used,side_offset_m:hb.path.side_offset_m}:{codes:hb.path.reason_codes,n_used:hb.path.n_used??0},
launch:hb.launch.ok?{value:hb.launch.launch_h_deg,sigma:hb.launch.sigma,terms:hb.launch.terms,speed:hb.launch.fit.ball_speed_mps,launch_v:hb.launch.fit.launch_v_deg}:{codes:hb.launch.reason_codes},
};
}else{
for(const id of HIGH_BEHIND_IDS){
if(cells[id].validity!==null)metrics[id]=metricNull('not_computed',[RC.OUT_OF_FRAME],METRIC_UNITS[id],REGISTRY[id].value_origin);
}
}
timings.physics=now()-t;
debug.track={n:trk.ballTrack?.n??0,club_obs:trk.clubTrack?.length??0,reason_codes:trk.reason_codes??[]};
}
if(view==='high_behind'&&Number.isFinite(calibration.pose?.Y_m)&&Math.abs(calibration.pose.Y_m)>SIDE_OFFSET_RED_M){


warnings.push(RC.SETUP_UNVERIFIED);
}
if(view==='face_on'&&fpsAtLeast(fps,BALL_MIN_FPS)&&haveFrames){
t=now();
const origin=bf.origin??{u:0,v:0};

const X0=[0,0,height.z_m];
let rb=input.restBall;
if(!rb||!Number.isFinite(rb.u)||!Number.isFinite(rb.v)){
const p=project(cam,X0);
rb={u:p.u,v:p.v,w_px:predictedBallWidthPx(cam,X0)};
}
const p0=project(cam,X0);
const p1=project(cam,[0.3,0,height.z_m+0.1]);
const dl=Math.hypot(p1.u-p0.u,p1.v-p0.v)||1;
const impactGuessT=ev.ok?ev.metric.impact.t_s:undefined;


const trk=input.track??analyzeClip({
frames:bf.frames,times:bf.times,W:bf.W,H:bf.H,roi:bf.roi??null,
restBall:{u:rb.u-origin.u,v:rb.v-origin.v,w_px:rb.w_px>0?rb.w_px:predictedBallWidthPx(cam,X0),lie:clubOut.lie},
impactFrameGuess:Number.isFinite(impactGuessT)?nearestFrame(bf.times,impactGuessT):undefined,
opts:{origin,expectedDir:[(p1.u-p0.u)/dl,(p1.v-p0.v)/dl],now},
});
trackResult=trk;
timings.track=now()-t;

if(input.club?.lie!=='mat'&&input.club?.lie!=='tee'&&trk.restBall&&trk.restBall.lie_conf>=0.6){
({club:clubOut,height}=clubBlock({...input.club,lie:trk.restBall.lie},null));
}
t=now();
const rest=trk.restBall;
const start=rest?startFromStaticBall(cam,rest.u,rest.v,{lift_m:height.tee_lift_m,sigma_px:rest.refined?0.3:1.5}):null;

let tGuess=impactGuessT;
const dep=trk.info?.departure;
if(Number.isInteger(dep)&&dep>0&&dep<bf.times.length)tGuess=0.5*(bf.times[dep-1]+bf.times[dep]);
let phys=null;
lm.trk=trk;
lm.start=start?.X??null;
if(start){
phys=analyzeFaceOn({
cam,ballObs:trk.ballTrack.obs,clubObs:trk.clubTrack.length?trk.clubTrack:undefined,start,fps,
club:clubOut,t_impact_guess:tGuess,view,readout_source:calibration.readout_source,calibration,
seed:input.seed??1,nMC:input.nMC??2000,nCarry:input.nCarry??500,extra_codes:tsCodes,
});
lm.fit=phys.fit;
lm.club=phys.club;
for(const id of PHYSICS_IDS){
const cell=cells[id];
if(cell.validity===null)continue;
const m=phys.metrics[id];
metrics[id]=m.value===null?m:rebuild(m,{validity:worseValidity(m.validity,cell.validity)});
}
if(phys.fit?.ok){
const fb=framesBudget(cam,view,phys.fit.ball_speed_mps,phys.fit.launch_v_deg,undefined,{fps,z0_m:height.z_m});
warnings.push(...fb.reason_codes);
}
}else{
for(const id of PHYSICS_IDS){
if(cells[id].validity!==null)metrics[id]=metricNull('not_computed',[RC.OUT_OF_FRAME],METRIC_UNITS[id],REGISTRY[id].value_origin);
}
}
timings.physics=now()-t;
debug.track={
n:trk.ballTrack.n,gaps:trk.ballTrack.gaps,reason_codes:trk.reason_codes,departure:trk.info?.departure??null,
rest:rest?{u:rest.u,v:rest.v,w_px:rest.w_px,lie:rest.lie,lie_conf:rest.lie_conf,refined:rest.refined}:null,
club_obs:trk.clubTrack.length,timings_ms:trk.timings_ms,
};
debug.t_impact_guess=tGuess??null;
if(phys){
const f=phys.fit;
const pl=f?.ok?ballPlausibility(f,tGuess??null):null;
debug.fit=f?{
ok:f.ok,plausible:pl?pl.ok:null,implausible_checks:pl?pl.failed:[],ball_speed_mps:f.ball_speed_mps??null,launch_v_deg:f.launch_v_deg??null,psi_deg:f.launch_h_deg??null,
t0:f.t0??null,n_used:f.n_used??null,residual_rmse_px:f.residual_rmse_px??null,flags:f.flags??[],
}:null;
const b=phys.fit2d;
debug.fit2d=b?{ok:b.ok,ball_speed_mps:b.ball_speed_mps??null,launch_v_deg:b.launch_v_deg??null}:null;
debug.start=start?{X:start.X,sigma:start.sigma}:null;
}
}


for(const code of tsCodes){
warnings.push(code);
for(const id of TEMPO_IDS)metrics[id]=appendCode(metrics[id],code);
}
if(ev.ok){
const D=ev.shot.impact.t_s-ev.shot.top.t_s;
debug.downswing_s=D;
if(!(D>=DOWNSWING_RANGE_S[0]&&D<=DOWNSWING_RANGE_S[1])){
warnings.push(RC.TIMEBASE_SUSPECT);
for(const id of TIME_SCALED_IDS)metrics[id]=downgrade(metrics[id],RC.TIMEBASE_SUSPECT);
}
}else warnings.push(RC.EVENTS_UNCERTAIN);


t=now();
const lmr=deriveLaunchMonitor({
view,fps:regFps,club:clubOut,metrics,fit:lm.fit,calibration,handedness,rng:mulberry32((input.seed??1)+7919),
clubTrack:{obs:lm.trk?.clubTrack??[],club:lm.club},ballTrack:{obs:lm.trk?.ballTrack?.obs??[],times:capTimes},
settings:{ground:input.lm?.ground},start:lm.start??undefined,
});
for(const[id,m]of Object.entries(lmr.metrics)){
metrics[id]=warnings.includes(RC.TIMEBASE_SUSPECT)&&TIME_SCALED_IDS.includes(id)?downgrade(m,RC.TIMEBASE_SUSPECT):m;
}
timings.lm=now()-t;


for(const c of input.warnings??[]){
if(typeof c!=='string'||!Object.prototype.hasOwnProperty.call(REASON_CODES,c))throw new RangeError(`assembleShot: unknown warning code ${String(c)}`);
warnings.push(c);
}


const ballTimes=bf?.times?.length?bf.times:null;
let trim=cap.trim_s??null;
if(!trim&&ballTimes&&ballTimes[0]>=0&&ballTimes[ballTimes.length-1]>ballTimes[0])trim=[ballTimes[0],ballTimes[ballTimes.length-1]];
const ids=input.ids??{};
const capture={
mode:cap.mode,view,source:cap.source,orientation,width:cap.width,height:cap.height,
nominal_fps:cap.nominal_fps,effective_fps:cap.effective_fps,vfr:Boolean(cap.vfr),timestamps:tsKind,
clip_ref:cap.clip_ref??null,trim_s:trim,
};
const audio=Number.isFinite(input.audioOnset_t)&&input.audioOnset_t>=0?input.audioOnset_t:null;
let shot=newShot({
shot_id:ids.shot_id,session_id:ids.session_id,venue_id:ids.venue_id??null,preset_id:ids.preset_id??null,
created_at:ids.created_at,app_version:ids.app_version,
algorithms:{...algorithmsBlock(poseSeq,calibration,ev.source,input.algorithms),lm:lmr.algorithm},
capture,calibration,club:clubOut,handedness,events:ev.shot,metrics,flight:lmr.flight,tracks:lmr.tracks,
quality:{
pose_mean_vis:meanVisibility(poseSeq),
frames_analyzed:(poseSeq?poseSeq.t_s.length:0)+(bf?.frames?.length??0),
frames_dropped:Number.isInteger(input.quality?.frames_dropped)?input.quality.frames_dropped:0,
audio_onset:audio,
touches:Number.isInteger(input.quality?.touches)?input.quality.touches:0,
warnings:uniq(warnings),
},
});
shot=attributeWarnings(shot);
const v=validateShot(shot);
timings.total=now()-T0;
if(!v.ok)throw new ContractError(`assembleShot: shot violates golf-shot/2. ${formatErrors(v.errors)}`,v.errors);
return{shot,timings_ms:timings,debug,track:trackResult};
}
