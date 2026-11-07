





















import{DEG,RAD2DEG}from'../geom/constants.js';
import{RC}from'../contract/reason-codes.js';
import{fit3d,FIT3D_DEFAULTS}from'./fit3d.js';
import{MIN_TRACK_OBS}from'./fit2d.js';
import{observationTimes}from'./shutter.js';
import{ballPlausibility}from'./plausibility.js';
import{BALL_MIN_FPS}from'./result.js';
import{groundCalibSigmas}from'./ground.js';
import{fpsAtLeast}from'../geom/constants.js';

export const INIT_SPEEDS_MPS=Object.freeze([35,55,75]);
export const INIT_LAUNCH_V_DEG=Object.freeze([10,20,30]);
export const LAUNCH_H_MODEL_SIGMA_DEG=0.15;
export const LAUNCH_H_MAX_ABS_DEG=30;

function nullLaunch(validity,codes,extra={}){
return{ok:false,launch_h_deg:null,sigma:null,ci95:null,validity,reason_codes:codes,value_origin:'ball_fit3d',...extra};
}

function psiOf(v,mirror){
const vy=mirror?-v[1]:v[1];
return Math.atan2(-vy,v[0])*RAD2DEG;
}

function cost(fit){
const r=fit?.lm?.reducedChi2;
return Number.isFinite(r)?r:Infinity;
}







export function launchHighBehind(o){
if(!fpsAtLeast(o.fps,BALL_MIN_FPS))return nullLaunch('not_observable',[RC.FPS_TOO_LOW]);
const cam=o.cam;
const obs=(o.obs??[]).filter((q)=>Number.isFinite(q.u)&&Number.isFinite(q.v)&&Number.isFinite(q.t_s));
if(obs.length<MIN_TRACK_OBS||!o.start)return nullLaunch('not_computed',[RC.TRACK_TOO_SHORT],{n_obs:obs.length});
const mirror=o.handedness==='left';
const times=observationTimes(obs,cam);
const tFirst=Math.min(...times);
const t0g=Number.isFinite(o.t_impact_guess)&&o.t_impact_guess<tFirst?o.t_impact_guess:tFirst-0.5/o.fps;
const base={cam,obs,start:o.start,t_impact_guess:o.t_impact_guess,fps:o.fps,club:o.club??null,sensitivities:false};
let best=null;
for(const s of INIT_SPEEDS_MPS){
for(const lv of INIT_LAUNCH_V_DEG){
const v0=[s*Math.cos(lv*DEG),0,s*Math.sin(lv*DEG)];
const f=fit3d({...base,init:{v0,t0:t0g}});
if(f.ok&&(best===null||cost(f)<cost(best)))best=f;
}
}
if(!best)return nullLaunch('not_computed',[RC.TRACK_TOO_SHORT],{n_obs:obs.length});
const fit=best;
if(!ballPlausibility(fit,o.t_impact_guess??null).ok)return nullLaunch('implausible',[RC.IMPLAUSIBLE_VALUE],{fit});
const value=psiOf(fit.v_vec,mirror);
if(!(Math.abs(value)<=LAUNCH_H_MAX_ABS_DEG))return nullLaunch('implausible',[RC.IMPLAUSIBLE_VALUE],{fit});


const[vx,vy]=fit.v_vec;
const h2=vx*vx+vy*vy;
const g=[vy/h2,-vx/h2];
let sFit=NaN;
if(fit.cov){
const C=fit.cov;
const q=g[0]*g[0]*C[4][4]+2*g[0]*g[1]*C[4][5]+g[1]*g[1]*C[5][5];
sFit=Math.sqrt(Math.max(q,0))*RAD2DEG*(fit.t_factor??1);
}
if(!Number.isFinite(sFit))sFit=2;
const cs=groundCalibSigmas(cam,o.calibration,o.venue);
const terms={fit:sFit,calib:cs.yaw_deg,model:LAUNCH_H_MODEL_SIGMA_DEG};
const sigma=Math.hypot(terms.fit,terms.calib,terms.model);
const codes=[];
if((o.calibration?.readout_source??'assumed')!=='measured')codes.push(RC.ROLLING_SHUTTER_ASSUMED);
if(fit.residual_rmse_px>FIT3D_DEFAULTS.depthDriftRmsePx)codes.push(RC.DEPTH_DRIFT_SUSPECT);
return{
ok:true,
launch_h_deg:value,
sigma,
ci95:[value-1.959964*sigma,value+1.959964*sigma],
validity:'low_confidence',
reason_codes:codes,
value_origin:'ball_fit3d',
fit,
terms,
};
}
