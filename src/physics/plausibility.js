



import{RC}from'../contract/reason-codes.js';

export const GATES=Object.freeze({
ball_speed_mps:Object.freeze([10,90]),
launch_v_deg:Object.freeze([-5,45]),
club_speed_mps:Object.freeze([10,65]),
smash_factor:Object.freeze([0.9,1.6]),
});


export const FIT_GATES=Object.freeze({
cd:Object.freeze([0.05,0.8]),
cl:Object.freeze([-0.3,0.9]),

start_mahalanobis_max:6,

t0_guess_max_s:0.05,
});


export function isPlausible(id,value){
if(value===null||value===undefined)return true;
if(!Number.isFinite(value))return false;
const g=GATES[id];
return!g||(value>=g[0]&&value<=g[1]);
}


export function fitChecks(fit,t_impact_guess=null){
if(!fit||!fit.ok)return[];
const bad=[];
if(!(fit.cd>=FIT_GATES.cd[0]&&fit.cd<=FIT_GATES.cd[1]))bad.push('cd');
if(!(fit.cl>=FIT_GATES.cl[0]&&fit.cl<=FIT_GATES.cl[1]))bad.push('cl');
const W=fit.start?.whiten;
if(W&&fit.p0){
const d=fit.p0.map((x,k)=>x-fit.start.X[k]);
const m=Math.hypot(...W.map((row)=>row[0]*d[0]+row[1]*d[1]+row[2]*d[2]));
if(!(m<=FIT_GATES.start_mahalanobis_max))bad.push('start');
}
if(Number.isFinite(t_impact_guess)&&!(Math.abs(fit.t0-t_impact_guess)<=FIT_GATES.t0_guess_max_s))bad.push('t0');
return bad;
}


export function ballPlausibility(fit,t_impact_guess=null){
if(!fit||!fit.ok)return{ok:true,failed:[]};
const failed=[];
if(!isPlausible('ball_speed_mps',fit.ball_speed_mps))failed.push('ball_speed_mps');
if(!isPlausible('launch_v_deg',fit.launch_v_deg))failed.push('launch_v_deg');
failed.push(...fitChecks(fit,t_impact_guess));
return{ok:failed.length===0,failed,reason_codes:failed.length?[RC.IMPLAUSIBLE_VALUE]:[]};
}
