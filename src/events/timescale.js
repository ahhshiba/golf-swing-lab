











import{detectEvents}from'./rules.js';
import{estimateFps}from'./signal.js';

export const SLOWMO=Object.freeze({
scales:Object.freeze([4,8]),
max_container_fps:60,
min_duration_s:4,
downswing_s:Object.freeze([0.15,0.6]),
typical_downswing_s:0.3,
typical_backswing_s:0.85,
});

export function scalePoseTime(poseSeq,k){
if(k===1)return poseSeq;
const t_s=new Float64Array(poseSeq.t_s.length);
for(let i=0;i<t_s.length;i++)t_s[i]=poseSeq.t_s[i]/k;
return{...poseSeq,t_s};
}

export function swingDurations(ev){
if(!ev||!ev.impact||!Number.isFinite(ev.impact.t_s)||!Number.isFinite(ev.top?.t_s)||!Number.isFinite(ev.address?.t_s))return null;
return{backswing_s:ev.top.t_s-ev.address.t_s,downswing_s:ev.impact.t_s-ev.top.t_s};
}

const plausible=(d)=>d!==null&&d.downswing_s>=SLOWMO.downswing_s[0]&&d.downswing_s<=SLOWMO.downswing_s[1];
const score=(d)=>Math.abs(Math.log(d.downswing_s/SLOWMO.typical_downswing_s))
+Math.abs(Math.log(Math.max(1e-3,d.backswing_s)/SLOWMO.typical_backswing_s));

function withMeta(ev,meta){
Object.defineProperty(ev,'meta',{value:meta,enumerable:false,configurable:true});
return ev;
}


function toMedia(ev,k){
if(k===1)return ev;
const out={};
for(const[name,e]of Object.entries(ev))out[name]=e&&Number.isFinite(e.t_s)?{...e,t_s:e.t_s*k}:e;
if(ev.diag)Object.defineProperty(out,'diag',{value:ev.diag,enumerable:false});
if(ev.fallback)Object.defineProperty(out,'fallback',{value:ev.fallback,enumerable:false});
return out;
}

export function detectTimeScaled(poseSeq,opts={},ctx={}){
const detect=ctx.detect??detectEvents;
const fps=Number.isFinite(ctx.container_fps)&&ctx.container_fps>0?ctx.container_fps:estimateFps(poseSeq.t_s);
const n=poseSeq.t_s.length;
const duration=Number.isFinite(ctx.duration_s)?ctx.duration_s:(n>1?poseSeq.t_s[n-1]-poseSeq.t_s[0]:0);
const native=detect(poseSeq,opts);
const dNative=swingDurations(native);
const tried=[{k:1,downswing_s:dNative?dNative.downswing_s:null}];
const meta=(k)=>({time_scale:k,effective_fps:Number.isFinite(fps)?fps*k:null,tried});
if(plausible(dNative)||!(fps<=SLOWMO.max_container_fps)||!(duration>=SLOWMO.min_duration_s)){
return withMeta(native,meta(1));
}

let scales=[...SLOWMO.scales];
const hint=ctx.captureFpsHint;
if(Number.isFinite(hint)&&hint>1.5*fps){
const kh=Math.round(hint/fps);
if(kh>=2&&kh<=16)scales=[kh,...scales.filter((k)=>k!==kh)];
}
let best=null;
for(const k of scales){
const ev=detect(scalePoseTime(poseSeq,k),opts);
const d=swingDurations(ev);
tried.push({k,downswing_s:d?d.downswing_s:null});
if(!plausible(d))continue;
const c={k,ev,s:score(d)};
if(k===scales[0]&&scales[0]!==SLOWMO.scales[0]&&Number.isFinite(hint)){best=c;break;}
if(!best||c.s<best.s)best=c;
}
if(!best)return withMeta(native,meta(1));
return withMeta(toMedia(best.ev,best.k),meta(best.k));
}
