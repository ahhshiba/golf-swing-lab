
























import{RC}from'../contract/reason-codes.js';
import{fpsAtLeast}from'../geom/constants.js';

export const POSE_CLUB_K=1.9;
export const POSE_CLUB_K_SIGMA_REL=0.12;
export const ARM_PRIOR_M=0.58;
export const ARM_PRIOR_SIGMA_M=0.05;
export const ARM_RANGE_M=Object.freeze([0.42,0.75]);
export const WRIST_TO_HEAD_SIGMA_M=0.05;
export const POSE_CLUB_WINDOW_S=Object.freeze([-0.12,0.02]);
export const POSE_CLUB_MIN_FPS=30;
export const POSE_CLUB_MAX_FPS=200;
export const CI95_MIN_FRAC=0.25;

export const CHORD_BIAS_BY_FPS=Object.freeze([
Object.freeze([30,0.97,0.08]),
Object.freeze([60,0.87,0.05]),
]);

function nullPose(validity,codes,extra={}){
return{ok:false,club_speed_mps:null,sigma:null,ci95:null,validity,reason_codes:codes,value_origin:'pose',...extra};
}


export function chordBias(fps){
const T=CHORD_BIAS_BY_FPS;
if(fps<=T[0][0])return{k:T[0][1],s:T[0][2]};
if(fps>=T[T.length-1][0])return{k:T[T.length-1][1],s:T[T.length-1][2]};
for(let i=1;i<T.length;i++){
if(fps<=T[i][0]){
const a=1/T[i-1][0],b=1/T[i][0],x=1/fps;
const w=(x-a)/(b-a);
return{k:T[i-1][1]+w*(T[i][1]-T[i-1][1]),s:T[i-1][2]+w*(T[i][2]-T[i-1][2])};
}
}
return{k:1,s:0.06};
}







export function clubSpeedFromPose(o){
const fps=o.fps;
if(!fpsAtLeast(fps,POSE_CLUB_MIN_FPS))return nullPose('not_observable',[RC.FPS_TOO_LOW]);
if(!Number.isFinite(o.t_impact))return nullPose('not_computed',[RC.EVENTS_UNCERTAIN]);
const t=o.t;
const W=o.wrist;
const[w0,w1]=POSE_CLUB_WINDOW_S;
const maxDt=2.5/fps;
let best=null;
let nChord=0;
let prev=-1;
for(let i=0;i<t.length;i++){
const tau=t[i]-o.t_impact;
if(tau<w0-maxDt||tau>w1+maxDt)continue;
if(!W[i])continue;
if(prev>=0){
const dt=t[i]-t[prev];
const mid=0.5*(t[i]+t[prev])-o.t_impact;
if(dt>0&&dt<=maxDt&&mid>=w0&&mid<=w1){
const a=W[prev],b=W[i];
const sp=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])/dt;
nChord++;
if(!best||sp>best.sp)best={sp,dt};
}
}
prev=i;
}
if(!best||nChord<2)return nullPose('not_computed',[RC.POSE_LOW_VISIBILITY],{n_chords:nChord});
const cb=chordBias(fps);
const vHand=best.sp*cb.k;
let r=o.arm_length_m;
let sR=0.02;
if(!(Number.isFinite(r)&&r>=ARM_RANGE_M[0]&&r<=ARM_RANGE_M[1])){r=ARM_PRIOR_M;sR=ARM_PRIOR_SIGMA_M;}
const L=Number.isFinite(o.club_length_m)?o.club_length_m:0.94;
const lever=(r+L)/r;
const value=vHand*POSE_CLUB_K*lever;

const dLever=Math.hypot((L/(r*(r+L)))*sR,WRIST_TO_HEAD_SIGMA_M/(r+L));
const noise=(Math.SQRT2*(o.pos_sigma_m??0.006))/(best.sp*best.dt);
const terms={k:POSE_CLUB_K_SIGMA_REL,chord:cb.s,noise,lever:dLever};
const sRel=Math.hypot(terms.k,terms.chord,terms.noise,terms.lever);
const half=Math.max(CI95_MIN_FRAC,1.959964*sRel);
return{
ok:true,
club_speed_mps:value,
sigma:value*sRel,
ci95:[value*(1-half),value*(1+half)],
validity:'low_confidence',
reason_codes:[],
value_origin:'pose',
hand_peak_mps:vHand,
lever,
arm_length_m:r,
terms,
};
}
