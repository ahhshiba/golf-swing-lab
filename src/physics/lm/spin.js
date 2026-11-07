





import{BALL_R}from'../../geom/constants.js';
import{clubCategory}from'../ballistics.js';
import{LM_PARAMS}from'./params.js';

const D=Math.PI/180;
const RAD_S_TO_RPM=60/(2*Math.PI);


export function lmCategory(club){
const type=club&&typeof club==='object'?club.type:club;
return clubCategory(type)??'unknown';
}


export function clubParams(club){
return LM_PARAMS.clubs[lmCategory(club)];
}


export function spinCoefSigma(club,spinLoftDeg=0){
const P=LM_PARAMS.spin;
const base=lmCategory(club)==='unknown'?P.a_sigma_frac_unknown:P.a_sigma_frac;
return spinLoftDeg>P.sl_max_deg?Math.hypot(base,P.sl_over_sigma_frac):base;
}


export function spinFromLoft(clubSpeed,spinLoftDeg,club,aFactor=1){
const sl=Math.min(Math.max(spinLoftDeg,0),LM_PARAMS.spin.sl_max_deg);
return(clubParams(club).a_spin*aFactor*clubSpeed*Math.sin(sl*D)/BALL_R)*RAD_S_TO_RPM;
}





export function mergeSpin(phys,prior){
const sq=Math.max(prior.sigma_rpm,LM_PARAMS.spin.prior_sigma_floor_frac*prior.mean_rpm);
const wp=1/(phys.sigma*phys.sigma),wq=1/(sq*sq);
return{value:(phys.value*wp+prior.mean_rpm*wq)/(wp+wq),sigma:Math.sqrt(1/(wp+wq)),w:wp/(wp+wq)};
}
