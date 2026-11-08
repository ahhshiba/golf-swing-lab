






































import{createLiveDetector}from'../events/live.js';
import{RC}from'../contract/reason-codes.js';
import{createThermalGuard}from'../session/thermal.js';
import{diagRecord}from'../workers/diag.js';

const LOG_MAX=64;
const POSE_HZ_MAX=60;
const r3=(x)=>(Number.isFinite(x)?Math.round(x*1000)/1000:null);
const L_WRIST=15;
const R_WRIST=16;

export function percentile95(xs){
const a=xs.filter(Number.isFinite).sort((p,q)=>p-q);
if(!a.length)return NaN;
const r=0.95*(a.length-1);
const lo=Math.floor(r);
const hi=Math.ceil(r);
return a[lo]+(a[hi]-a[lo])*(r-lo);
}

export function wristSample(img,world,opts={}){
const cam=opts.calibration&&opts.calibration.camera;
const vis=Math.min(img[4*L_WRIST+3],img[4*R_WRIST+3]);
if(cam&&cam.f>0){
const u=0.5*(img[4*L_WRIST]+img[4*R_WRIST])*cam.W;
const v=0.5*(img[4*L_WRIST+1]+img[4*R_WRIST+1])*cam.H;
if(!Number.isFinite(u)||!Number.isFinite(v))return null;

const D=opts.calibration.pose&&opts.calibration.pose.D_m>0?opts.calibration.pose.D_m:2.7;
const s=D/cam.f;
return{type:'wrist',x_m:(u-cam.cx)*s,y_m:-(v-cam.cy)*s,vis:Number.isFinite(vis)?vis:0};
}
if(world){
const x=0.5*(world[3*L_WRIST]+world[3*R_WRIST]);
const y=0.5*(world[3*L_WRIST+1]+world[3*R_WRIST+1]);
if(!Number.isFinite(x)||!Number.isFinite(y))return null;
return{type:'wrist',x_m:x,y_m:-y,vis:Number.isFinite(vis)?vis:0};
}
return null;
}

export function createLiveLoop(o){
const now=o.now??(()=>(globalThis.performance?globalThis.performance.now():Date.now()));
const mediaClock=o.mediaClock??(()=>null);
const thermal=o.thermal??createThermalGuard({model:o.clipOptions?.pose_model??'full'});
const det=createLiveDetector({audioAvailable:o.audioAvailable!==false});
const handedness=o.handedness??o.clipOptions?.handedness??'right';
const calibration=o.calibration??o.clipOptions?.calibration??null;
let idleHz=o.idle_hz??10;
const impactMinDb=o.impact_min_db??20;
let swingHz=o.swing_hz??30;
let poseModel=o.livePoseModel??'lite';
let poseHz=Math.min(POSE_HZ_MAX,o.clipOptions?.pose_hz??POSE_HZ_MAX);
let degraded=false;
let lastCutAt=now();
const queueLimit=Number.isInteger(o.queueLimit)&&o.queueLimit>=1?o.queueLimit:2;
const idleCutMs=Number.isFinite(o.idleCutMs)&&o.idleCutMs>0?o.idleCutMs:8000;
const waiting=[];
let running=null;
let drainWaiters=[];
const durations=[];
const st={soft_onsets:0,frames:0,wrist:0,detections:0,shots:0,practice:0,analysed:0,failed:0,touches:0,latencies:[],dropped:0,queue_max:0,idle_cuts:0};




const pendingAudio=[];
const shotLog=[];
const onsetLog=[];
const jobLog=[];
const pushLog=(arr,x,path)=>{arr.push(x);if(arr.length>LOG_MAX)arr.shift();diagRecord(path,arr.slice());};
let lastFrameT=-Infinity;

const quickTap=()=>(typeof o.quick==='function'?o.quick():o.quick)??null;
const flushAudio=(upTo)=>{
while(pendingAudio.length&&pendingAudio[0]<=upTo)onEvents(det.feed({type:'audio',t_s:pendingAudio.shift()}));
};

const emit=(ev)=>{try{o.onEvent?.(ev);}catch{ }};

function cutDiscard(reason){
const t=now();
if(t-lastCutAt<3000)return;
lastCutAt=t;
Promise.resolve().then(()=>o.recorder.cut()).catch((e)=>o.onError?.(e));
emit({type:'segment_cut',reason});
}

const avgMs=()=>(durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:6000);
function queueEvent(extra={}){
const ev={
queued:waiting.length,started:running?1:0,done:st.analysed,failed:st.failed,dropped:st.dropped,
eta_s:Math.round(((waiting.length+(running?0.5:0))*avgMs())/100)/10,...extra,
};
st.queue_max=Math.max(st.queue_max,waiting.length);
diagRecord('live.queue',ev);
diagRecord('live.retained_blobs',waiting.length+(running?1:0));
try{o.onQueue?.(ev);}catch{ }
}

function drained(){
if(running||waiting.length)return;
const w=drainWaiters;
drainWaiters=[];
for(const r of w)r();
}

async function runJob(job){
const{ev,segP,detectedAt,lag_s,quick}=job;
let blob;
try{blob=await segP;}catch(e){st.failed+=1;o.onError?.(e);return;}
const t0=Number.isFinite(blob&&blob.t_media_start_s)?blob.t_media_start_s:0;
const rel=(t)=>Math.max(0,t-t0);
const warnings=[...(o.clipOptions?.warnings??[]),...(ev.reason_codes??[])];
if(degraded&&!warnings.includes(RC.THERMAL_DEGRADED))warnings.push(RC.THERMAL_DEGRADED);
const ids=typeof o.newIds==='function'?o.newIds():o.clipOptions?.ids;
const startS=rel(ev.t_address-0.5);
const endAbs=Number.isFinite(ev.t_impact)?ev.t_impact+1.2:ev.t_finish+0.3;
const club=typeof o.getClub==='function'?o.getClub():null;
const options={
...o.clipOptions,ids,mode:'live',source:'camera',pose_model:poseModel,pose_hz:poseHz,warnings,
...(club?{club:{...(o.clipOptions?.club??{}),...club}}:{}),
trim_s:[startS,Math.max(startS+0.1,rel(endAbs))],
audioOnset_t:ev.impact_source==='audio'?rel(ev.t_impact):undefined,
live_event:{...ev,t_offset_s:t0},
};
if(club)diagRecord('live.job_club',{type:club.type??null});
const a0=now();
const logJob=(ok,code)=>pushLog(jobLog,{ms:Math.round(now()-a0),latency_s:r3(lag_s+(now()-detectedAt)/1000),ok,code:code??null,queued:waiting.length},'live.jobs');
try{
const res=await o.analyzeSegment(blob,options);
durations.push(now()-a0);
if(durations.length>5)durations.shift();
logJob(true);
const latency_s=lag_s+(now()-detectedAt)/1000;
st.analysed+=1;
st.latencies.push(latency_s);
const p95=percentile95(st.latencies);
diagRecord('live.latency_p95_s',p95);
diagRecord('live.latency_last_s',latency_s);
diagRecord('live.touches_per_shot',st.touches/Math.max(1,st.shots));
const fs=typeof o.frameStats==='function'?o.frameStats():null;
const dropped_frac=fs&&Number.isFinite(fs.dropped_pct)?fs.dropped_pct/100:undefined;
if(fs)diagRecord('live.frames_dropped_pct',fs.dropped_pct);
const decision=thermal.push({latency_s,dropped_frac});
if(decision&&decision.action==='degrade')api.degrade(decision);
else if(decision&&decision.action==='stop_live'){diagRecord('thermal.stop_live',true);o.onStopLive?.(decision);}
if(quick)quickTap()?.compare(quick,res.shot);
o.onShot?.({shot:res.shot,timings_ms:res.timings_ms,latency_s,kind:ev.kind,event:ev,segment:blob,quick:quick??null});
}catch(e){
durations.push(now()-a0);
if(durations.length>5)durations.shift();
logJob(false,e&&typeof e.code==='string'?e.code:'INTERNAL');
st.failed+=1;
o.onError?.(e);
}
}

function pump(){
if(running||!waiting.length){drained();return;}
const job=waiting.pop();
running=job;
queueEvent({started_shot:job.n});
runJob(job).finally(()=>{
running=null;
queueEvent();
pump();
});
}

function analyse(ev,detectedAt,lag_s,quick){
const segP=Promise.resolve().then(()=>o.recorder.cut());
segP.catch(()=>{});
lastCutAt=now();
waiting.push({ev,segP,detectedAt,lag_s,n:st.shots,quick});
while(waiting.length>queueLimit){
waiting.shift();
st.dropped+=1;
diagRecord('live.analysis_dropped',st.dropped);
}
queueEvent();
pump();
}

function onEvents(events){
for(const ev of events){
emit(ev);
if(ev.type==='state'){
if(ev.to==='ADDRESS'&&ev.from==='IDLE')cutDiscard('address');
if(ev.to==='SWING'){o.setFps?.(swingHz);o.recorder.hold?.(true);}
if(ev.to==='IDLE'||ev.to==='ADDRESS'){o.setFps?.(idleHz);o.recorder.hold?.(false);}
}else if(ev.type==='impact'){
quickTap()?.impact(ev);
}else if(ev.type==='shot'){
st.detections+=1;
const quick=quickTap()?.shot(ev,o.analyzePractice)??null;
pushLog(shotLog,{kind:ev.kind,t_impact:r3(ev.t_impact),t_peak:r3(ev.t_peak),t_finish:r3(ev.t_finish),impact_source:ev.impact_source??null},'live.shot_log');
if(ev.kind==='practice')st.practice+=1;
else st.shots+=1;

diagRecord('live.detections',st.shots);
diagRecord('live.practice',st.practice);
if(ev.kind!=='practice')diagRecord('live.touches_per_shot',st.touches/Math.max(1,st.shots));
if(ev.kind==='swing'||o.analyzePractice){
const m=mediaClock();
const lag=Number.isFinite(m)&&Number.isFinite(ev.t_finish)?Math.max(0,m-ev.t_finish):0;
analyse(ev,now(),lag,quick);
}else{
cutDiscard('practice');
}
o.setFps?.(idleHz);
}
}
}

const api={
async handleFrame(bitmap,t_s,meta={}){
st.frames+=1;
if(Number.isFinite(t_s)&&t_s>lastFrameT)lastFrameT=t_s;
const crop=meta.roi?{roi:meta.roi,W:meta.W,H:meta.H}:null;
let row;
try{
row=await o.pose(bitmap,t_s,'lite',{crop});
}catch(e){
o.onError?.(e);
return;
}
flushAudio(t_s);
const s=wristSample(row.img,row.world,{calibration,handedness});
if(s){
st.wrist+=1;
onEvents(det.feed({...s,t_s}));
quickTap()?.sample({...s,t_s},row);
}

if(det.state()==='IDLE'&&now()-lastCutAt>=idleCutMs){st.idle_cuts+=1;cutDiscard('idle');}
},
handleOnset(t_s,level_db){
if(!Number.isFinite(t_s))return;


if(Number.isFinite(level_db)&&level_db<impactMinDb){st.soft_onsets+=1;diagRecord('audio.soft_onsets',st.soft_onsets);return;}
pushLog(onsetLog,[r3(t_s),Number.isFinite(level_db)?Math.round(level_db*10)/10:null],'live.onset_log');
let i=pendingAudio.length;
while(i>0&&pendingAudio[i-1]>t_s)i--;
pendingAudio.splice(i,0,t_s);

if(t_s<=lastFrameT-1)flushAudio(t_s);
},
touch(){st.touches+=1;diagRecord('live.touches_per_shot',st.touches/Math.max(1,st.shots));},
state:()=>det.state(),
stats:()=>({...st,latencies:st.latencies.slice(),latency_p95_s:percentile95(st.latencies),degraded,pose_model:poseModel,pose_hz:poseHz,idle_hz:idleHz,queued:waiting.length,running:Boolean(running)}),
degrade(decision){
if(degraded)return;
degraded=true;
poseModel='lite';
poseHz=Math.max(15,Math.round(poseHz/2));
idleHz=Math.max(2,idleHz/2);
swingHz=Math.max(5,swingHz/2);
o.setFps?.(idleHz);
diagRecord('thermal.degraded',true);
o.onDegrade?.(decision??{action:'degrade'});
},
idle:()=>(running||waiting.length?new Promise((r)=>drainWaiters.push(r)):Promise.resolve()),
};
return api;
}
