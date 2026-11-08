







import{percentile}from'../geom/stats.js';

export const THERMAL_LIMITS=Object.freeze({p95LimitS:12,dropLimit:0.10,window:20,minSamples:5});

export function createThermalGuard(opts={}){
const lim={...THERMAL_LIMITS,...opts};
let lat=[];
let drops=[];
let st={model:opts.model??'full',sampling:1,degraded:false,stopped:false};
const decision=(action,p95,dr)=>({action,p95_s:p95,dropped_frac:dr,...st});
return{
push(sample={}){
if(Number.isFinite(sample.latency_s))lat=[...lat,sample.latency_s].slice(-lim.window);
if(Number.isFinite(sample.dropped_frac))drops=[...drops,sample.dropped_frac].slice(-lim.window);
const p95=lat.length?percentile(lat,95):NaN;
const dr=drops.length?drops.reduce((a,b)=>a+b,0)/drops.length:NaN;
const enough=lat.length>=lim.minSamples||drops.length>=lim.minSamples;
const breach=enough&&((p95>lim.p95LimitS)||(dr>lim.dropLimit));
if(!breach||st.stopped)return decision('none',p95,dr);
lat=[];
drops=[];
if(!st.degraded){
st={...st,model:'lite',sampling:st.sampling*2,degraded:true};
return decision('degrade',p95,dr);
}
st={...st,stopped:true};
return decision('stop_live',p95,dr);
},
state:()=>({...st}),
reset(){lat=[];drops=[];st={model:opts.model??'full',sampling:1,degraded:false,stopped:false};},
};
}
