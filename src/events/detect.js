


import{EVENTS}from'../contract/enums.js';
import{computeFeatures,FEATURE_HZ}from'./features.js';
import{detectEvents}from'./rules.js';
import{nearestIndex}from'./signal.js';


export const BACKGROUND_CLASS=8;







export function decodeOrdered(probs,C=9,eps=1e-9){
const flat=!(Array.isArray(probs)&&Array.isArray(probs[0]))&&!(Array.isArray(probs)&&ArrayBuffer.isView(probs[0]));
const T=flat?Math.floor(probs.length/C):probs.length;
const E=EVENTS.length;
if(T<1)throw new RangeError('decodeOrdered: no frames');
const p=(t,e)=>(flat?probs[t*C+e]:probs[t][e]);
const score=new Float64Array(T);
const back=Array.from({length:E},()=>new Int32Array(T));
let prev=new Float64Array(T);
for(let t=0;t<T;t++)prev[t]=Math.log(Math.max(0,p(t,0))+eps);
for(let e=1;e<E;e++){
let bestV=-Infinity;
let bestT=0;
for(let t=0;t<T;t++){
if(prev[t]>bestV){bestV=prev[t];bestT=t;}
score[t]=bestV+Math.log(Math.max(0,p(t,e))+eps);
back[e][t]=bestT;
}
prev=Float64Array.from(score);
}
let tEnd=0;
for(let t=1;t<T;t++)if(prev[t]>prev[tEnd])tEnd=t;
const frames=new Int32Array(E);
frames[E-1]=tEnd;
for(let e=E-1;e>0;e--)frames[e-1]=back[e][frames[e]];
const pe=new Float64Array(E);
for(let e=0;e<E;e++)pe[e]=p(frames[e],e);
return{frames,probs:pe,score:prev[tEnd]};
}

function validProbs(probs,T){
if(!probs)return false;
if(Array.isArray(probs)&&probs.length===T&&Array.isArray(probs[0])){
return probs.every((r)=>r.length>=9&&r.every((x)=>Number.isFinite(x)));
}
if((Array.isArray(probs)||ArrayBuffer.isView(probs))&&probs.length===T*9){
for(let i=0;i<probs.length;i++)if(!Number.isFinite(probs[i]))return false;
return true;
}
return false;
}








export function detect(poseSeq,opts={}){
const handedness=opts.handedness??'right';
if(!(opts.useTcn&&opts.tcn&&typeof opts.tcn.predict==='function')){
return detectEvents(poseSeq,opts);
}
const feat=computeFeatures(poseSeq,{handedness,hz:FEATURE_HZ});
const probs=opts.tcn.predict(feat);
if(!validProbs(probs,feat.K)){
const ev=detectEvents(poseSeq,opts);
Object.defineProperty(ev,'fallback',{value:'tcn_output_invalid',enumerable:false});
return ev;
}
const dec=decodeOrdered(probs,9);
const out={};
const ts=poseSeq.t_s;
let prevT=-Infinity;
EVENTS.forEach((e,i)=>{
let tk=feat.t_s[dec.frames[i]];
let conf=Math.max(0,Math.min(1,dec.probs[i]));
if(e==='impact'&&typeof opts.audioOnset_t==='number'&&Number.isFinite(opts.audioOnset_t)){
const tTop=feat.t_s[dec.frames[3]];
const tFin=feat.t_s[dec.frames[7]];
if(opts.audioOnset_t>tTop&&opts.audioOnset_t<tFin){tk=opts.audioOnset_t;conf=0.95;}
}
tk=Math.min(ts[ts.length-1],Math.max(ts[0],tk));
if(tk<prevT)tk=prevT;
prevT=tk;
out[e]={frame:nearestIndex(ts,tk),t_s:tk,conf:Math.round(conf*1000)/1000,source:'tcn'};
});
return out;
}
