





















import{diagRecord}from'../workers/diag.js';

export const RECORDER_CANDIDATES=Object.freeze([
'video/mp4;codecs=avc1.640028,mp4a.40.2',
'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
'video/mp4;codecs=avc1',
'video/mp4',
'video/webm;codecs=vp9,opus',
'video/webm;codecs=vp8,opus',
'video/webm',
]);

function safeSupported(isTypeSupported,t){
try{return!!isTypeSupported(t);}catch{return false;}
}

export function supportedTypes(isTypeSupported){
if(typeof isTypeSupported!=='function')return[];
return RECORDER_CANDIDATES.filter((t)=>safeSupported(isTypeSupported,t));
}

export function pickMimeType(isTypeSupported){
return supportedTypes(isTypeSupported)[0]??'';
}

export function createSegmentRecorder(stream,opts={}){
const env=opts.env??globalThis;
const MR=env.MediaRecorder;
if(typeof MR!=='function')throw new Error('MediaRecorder is not available');
const isTS=typeof MR.isTypeSupported==='function'?(t)=>MR.isTypeSupported(t):null;
const types=supportedTypes(isTS);
diagRecord('media_recorder.types',types);
const mimeType=opts.mimeType??pickMimeType(isTS);
diagRecord('media_recorder.chosen',mimeType||'default');
const clock=typeof opts.mediaClock==='function'?opts.mediaClock:()=>null;
const startClock=typeof opts.startClock==='function'?opts.startClock:clock;
const wall=typeof opts.now==='function'?opts.now:()=>(env.performance?env.performance.now():Date.now());
const maxMs=Number.isFinite(opts.maxSegmentMs)&&opts.maxSegmentMs>0?opts.maxSegmentMs:12000;
const setT=(env.setTimeout??globalThis.setTimeout).bind(env.setTimeout?env:globalThis);
const clearT=(env.clearTimeout??globalThis.clearTimeout).bind(env.clearTimeout?env:globalThis);
let rec=null;
let chunks=[];
let tStart=null;
let wallStart=0;
let timer=null;
let held=false;
const stats={segments:0,auto_rolls:0,max_s:0,last_s:0};

function noteSegment(ms){
const s=Math.round(ms)/1000;
stats.segments+=1;
stats.last_s=s;
stats.max_s=Math.max(stats.max_s,s);
diagRecord('recorder.segments',{...stats});
}

function arm(){
if(timer)clearT(timer);
timer=setT(onCap,Math.max(0,wallStart+maxMs-100-wall()));
}

function onCap(){
timer=null;
if(!rec||rec.state==='inactive')return;
if(held){timer=setT(onCap,250);return;}
stats.auto_rolls+=1;
const r=rec;
const c=chunks;
const t0=tStart;
const age=wall()-wallStart;
begin();
noteSegment(age);
finish(r,c,t0).catch(()=>{});
}

function begin(){
const o={};
if(mimeType)o.mimeType=mimeType;
if(opts.videoBitsPerSecond)o.videoBitsPerSecond=opts.videoBitsPerSecond;
const r=new MR(stream,o);
const myChunks=[];
r.ondataavailable=(ev)=>{if(ev.data&&ev.data.size>0)myChunks.push(ev.data);};
chunks=myChunks;
let s0=null;
try{s0=startClock();}catch{s0=clock();}
tStart=s0&&typeof s0.then==='function'?s0.then((v)=>v,()=>null):s0;
wallStart=wall();
r.start();
rec=r;
arm();
return r;
}

function finish(r,myChunks,t0){
return new Promise((resolve,reject)=>{
if(!r||r.state==='inactive'){resolve(null);return;}
r.onstop=()=>{
const type=r.mimeType||mimeType||(myChunks[0]&&myChunks[0].type)||'';
const blob=new env.Blob(myChunks,type?{type}:undefined);
blob.t_media_end_s=clock();
blob.mimeType=type;
Promise.resolve(t0).then((v)=>{blob.t_media_start_s=Number.isFinite(v)?v:null;resolve(blob);});
};
r.onerror=(ev)=>reject(ev&&ev.error?ev.error:new Error('MediaRecorder error'));
try{r.stop();}catch(e){reject(e);}
});
}

return{
mimeType,
recording:()=>!!rec&&rec.state==='recording',
start(){if(!rec||rec.state==='inactive')begin();},
hold(on){held=Boolean(on);},
segmentAgeMs:()=>(rec?wall()-wallStart:0),
stats:()=>({...stats,open_s:rec?Math.round(wall()-wallStart)/1000:0}),
cut(){
const r=rec;
const c=chunks;
const t0=tStart;
const age=wall()-wallStart;
const done=finish(r,c,t0);
begin();
if(r)noteSegment(age);
return done.then((b)=>b??new env.Blob([],mimeType?{type:mimeType}:undefined));
},
stop(){
const r=rec;
rec=null;
if(timer){clearT(timer);timer=null;}
if(r)noteSegment(wall()-wallStart);
return finish(r,chunks,tStart);
},
};
}
