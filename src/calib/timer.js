


import{percentile}from'../geom/stats.js';

export const SETUP_STEPS=Object.freeze(['C0','C1','C2','C3','C4','C5','C6','C7','C8','C9','C10']);

export const STEP_ESTIMATE_S=Object.freeze({C0:45,C1:30,C2:20,C3:0,C4:75,C5:37.5,C6:0,C7:15,C8:10,C9:5,C10:70});

export const SETUP_LIMITS=Object.freeze({per_angle_p90_s:300,new_venue_s:600,min_n:10});






export function createSetupTimer(){
const ev=[];
return{
record(step,t_s){
if(step!=='start'&&!SETUP_STEPS.includes(step))throw new RangeError(`timer: unknown step '${step}'`);
if(!Number.isFinite(t_s))throw new TypeError('timer: t_s must be finite');
if(ev.length&&t_s<ev[ev.length-1].t_s)throw new RangeError('timer: time went backwards');
ev.push({step,t_s});
},
events(){return ev.map((e)=>({...e}));},
summary(){return summarizeSetup(ev);},
};
}





export function summarizeSetup(events){
const steps={};
let total=0;
for(let i=1;i<events.length;i++){
const d=events[i].t_s-events[i-1].t_s;
steps[events[i].step]=(steps[events[i].step]??0)+d;
total+=d;
}
const highspeed=events.some((e)=>e.step==='C10');
const est=SETUP_STEPS.filter((s)=>(highspeed?s!=='C5':s!=='C10')).reduce((a,s)=>a+STEP_ESTIMATE_S[s],0);
return{steps,total_s:total,mode:highspeed?'highspeed':'live',within_budget:total<=SETUP_LIMITS.per_angle_p90_s,estimate_s:est};
}


export function p90(values){
return percentile(values,90);
}


export function setupTimeGate(totals,{limit_s=SETUP_LIMITS.per_angle_p90_s,min_n=SETUP_LIMITS.min_n}={}){
const xs=totals.filter(Number.isFinite);
const p=xs.length?p90(xs):NaN;
if(xs.length<min_n)return{n:xs.length,p90_s:p,pass:false,reason:`need n ≥ ${min_n}`};
return{n:xs.length,p90_s:p,pass:p<=limit_s,reason:p<=limit_s?'ok':`P90 ${p.toFixed(0)} s > ${limit_s} s`};
}
