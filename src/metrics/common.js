


import{RC}from'../contract/reason-codes.js';
import{metricValue,metricNull}from'../contract/metric.js';
import{REGISTRY}from'./registry.js';

import{EVENT_CONF_MIN}from'../events/rules.js';


export{EVENT_CONF_MIN};






export const POSE_SIGMA=Object.freeze({
angle_deg:Object.freeze({valid:3,estimated:4.5,low_confidence:6}),
disp_rel:Object.freeze({valid:0.02,estimated:0.035,low_confidence:0.05}),
disp_abs_m:Object.freeze({valid:0.01,estimated:0.015,low_confidence:0.025}),
});

const RANK={valid:0,estimated:1,low_confidence:2};
const BY_RANK=['valid','estimated','low_confidence'];


export function worseValidity(a,b){
return BY_RANK[Math.max(RANK[a]??0,RANK[b]??0)];
}


export function rss(...xs){
let s=0;
for(const x of xs)if(Number.isFinite(x))s+=x*x;
return Math.sqrt(s);
}





export function valueMetric(id,r){
const reg=REGISTRY[id];
const sigma=r.sigma??null;
const ci95=r.ci95??(sigma!==null?[r.value-1.96*sigma,r.value+1.96*sigma]:null);
return metricValue({
value:r.value,unit:reg.unit,ci95,sigma,validity:r.validity,value_origin:r.origin??reg.value_origin,
reason_codes:r.codes??[],
});
}


export function nullMetric(id,validity,codes,origin){
const reg=REGISTRY[id];
return metricNull(validity,codes,reg.unit,origin??reg.value_origin);
}


export function eventOf(events,name){
const e=events?.[name];
if(!e||e.t_s===null||e.t_s===undefined||!Number.isFinite(e.t_s))return null;
return{frame:e.frame,t_s:e.t_s,conf:Number.isFinite(e.conf)?e.conf:1,source:e.source};
}


export function eventHalfWidth(fps,conf=1){
return 0.5/fps/Math.max(Math.min(conf,1),0.25);
}







export function tempoInterval(B,D,fps,conf={}){
const ha=eventHalfWidth(fps,conf.address??1);
const ht=eventHalfWidth(fps,conf.top??1);
const hi=eventHalfWidth(fps,conf.impact??1);
const dLo=D-ht-hi;
return{
backswing:[B-ha-ht,B+ha+ht],
downswing:[D-ht-hi,D+ht+hi],
ratio:[(B-ha-ht)/(D+ht+hi),dLo>0?(B+ha+ht)/dLo:Infinity],
};
}


export const TEMPO_LIMITS=Object.freeze({
backswing_hard:[0.3,3.0],downswing_hard:[0.08,1.2],downswing_soft:[0.15,0.6],
});


export function tempoMetrics(events,fps,cells){
const a=eventOf(events,'address');
const t=eventOf(events,'top');
const i=eventOf(events,'impact');
const ids=['backswing_s','downswing_s','tempo_ratio'];
if(!a||!t||!i){
return Object.fromEntries(ids.map((id)=>[id,nullMetric(id,'not_computed',[RC.EVENTS_UNCERTAIN])]));
}
const B=t.t_s-a.t_s;
const D=i.t_s-t.t_s;
const out={};
const hard=!(B>=TEMPO_LIMITS.backswing_hard[0]&&B<=TEMPO_LIMITS.backswing_hard[1]&&
D>=TEMPO_LIMITS.downswing_hard[0]&&D<=TEMPO_LIMITS.downswing_hard[1]);
const iv=tempoInterval(B,D,fps,{address:a.conf,top:t.conf,impact:i.conf});
if(hard||!Number.isFinite(iv.ratio[1])){
for(const id of ids)out[id]=nullMetric(id,'implausible',[RC.IMPLAUSIBLE_VALUE,RC.TIMEBASE_SUSPECT]);
return out;
}
const codes=[];
let cap='valid';
if(Math.min(a.conf,t.conf,i.conf)<EVENT_CONF_MIN){codes.push(RC.EVENTS_UNCERTAIN);cap='low_confidence';}
if(D<TEMPO_LIMITS.downswing_soft[0]||D>TEMPO_LIMITS.downswing_soft[1]){
codes.push(RC.TIMEBASE_SUSPECT);
cap='low_confidence';
}
const vals={backswing_s:[B,iv.backswing],downswing_s:[D,iv.downswing],tempo_ratio:[B/D,iv.ratio]};
for(const id of ids){
const[value,ci95]=vals[id];
out[id]=valueMetric(id,{
value,ci95,sigma:null,validity:worseValidity(cells[id],cap),codes,
origin:id==='tempo_ratio'?'derived':'pose',
});
}
return out;
}
