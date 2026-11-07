














import{RC}from'../contract/reason-codes.js';
import{observationTimes}from'./shutter.js';
import{rayPlaneY}from'./fit2d.js';
import{center}from'../geom/camera.js';
import{fpsAtLeast}from'../geom/constants.js';

export const HEAD_DEPTH_OFFSET_M=0.025;
export const CLUB_DEPTH_SYS_FRAC=0.03;
export const CLUB_ARC_MEDIAN_FRAC=0.018;

export const CLUB_LOWFPS_PRE_MEDIAN_FRAC=0.06;


export const CLUB_BRACKET_MEDIAN_FRAC=0.15;
export const CLUB_LOWFPS_CI95_FRAC=0.25;
export const CLUB_MIN_FPS=30;
export const CLUB_WINDOW_FRAMES=2;
export const PRE_IMPACT_GUARD_FRAMES=0.15;

export const CLUB_PRE_ONLY_MIN_FPS=120;
export const CLUB_ESTIMATED_MIN_FPS=200;

export const CLUB_SIGMA_PX=1.5;

function nullClub(validity,codes,extra={}){
return{ok:false,club_speed_mps:null,sigma:null,validity,reason_codes:codes,value_origin:'club_track',...extra};
}








export function clubSpeed(o){
const fps=o.fps;
if(!fpsAtLeast(fps,CLUB_MIN_FPS))return nullClub('not_observable',[RC.FPS_TOO_LOW]);
if(!Number.isFinite(o.t_impact))return nullClub('not_computed',[RC.DEPENDS_ON_NULL]);
const cam=o.cam;
const minConf=o.min_conf??0;
const good=(o.obs??[]).filter((q)=>Number.isFinite(q.u)&&Number.isFinite(q.v)&&Number.isFinite(q.t_s)
&&!(q.conf<minConf));
const times=observationTimes(good,cam);
const y0=o.start.X[1]+(o.depth_offset_m??HEAD_DEPTH_OFFSET_M);
const dtF=1/fps;
const pts=[];
for(let i=0;i<good.length;i++){
const P=rayPlaneY(cam,good[i].u,good[i].v,y0);
if(P)pts.push({t:times[i]-o.t_impact,P,u:good[i].u,v:good[i].v});
}
pts.sort((a,b)=>a.t-b.t);



const W=(o.window_frames??CLUB_WINDOW_FRAMES)*dtF;
const guard=PRE_IMPACT_GUARD_FRAMES*dtF;
const pre=pts.filter((q)=>q.t<=-guard);
let sel=fpsAtLeast(fps,CLUB_PRE_ONLY_MIN_FPS)?pre.filter((q)=>q.t>=-W-guard-1e-9):[];
if(sel.length<2&&fpsAtLeast(fps,CLUB_PRE_ONLY_MIN_FPS))sel=pre.slice(-2);
if(sel.length<2){


const after=pts.filter((q)=>q.t>-guard).slice(0,1);
sel=[...pre.slice(-1),...after];
}
if(sel.length<2)return nullClub('not_computed',[RC.TRACK_TOO_SHORT],{n_used:sel.length});


let len=0;
const chordSpeeds=[];
for(let k=1;k<sel.length;k++){
const d=Math.hypot(sel[k].P[0]-sel[k-1].P[0],sel[k].P[1]-sel[k-1].P[1],sel[k].P[2]-sel[k-1].P[2]);
len+=d;
if(sel[k].t>sel[k-1].t)chordSpeeds.push(d/(sel[k].t-sel[k-1].t));
}
const first=sel[0];
const last=sel[sel.length-1];
const T=last.t-first.t;
if(!(T>0))return nullClub('not_computed',[RC.TRACK_TOO_SHORT],{n_used:sel.length});
const low=!fpsAtLeast(fps,CLUB_ESTIMATED_MIN_FPS);
const bracket=first.t<=-guard&&last.t>-guard;
const corr=bracket?CLUB_BRACKET_MEDIAN_FRAC:low?CLUB_LOWFPS_PRE_MEDIAN_FRAC:CLUB_ARC_MEDIAN_FRAC;
const speed=(len/T)*(1+corr);
const v=[0,1,2].map((k)=>(last.P[k]-first.P[k])/T);


const depth=Math.abs(y0-center(cam)[1]);
const sPos=(CLUB_SIGMA_PX*depth)/cam.f;
let sigma=(Math.SQRT2*sPos)/T;
if(chordSpeeds.length>=3){
const m=chordSpeeds.reduce((a,b)=>a+b,0)/chordSpeeds.length;
const sd=Math.sqrt(chordSpeeds.reduce((a,b)=>a+(b-m)**2,0)/(chordSpeeds.length-1));
sigma=Math.max(sigma,sd/Math.sqrt(chordSpeeds.length));
}
const pu={coef:[0,(last.u-first.u)/T]};
const pv={coef:[0,(last.v-first.v)/T]};
const ro=cam.readout;
const pxVel=ro&&ro.axis==='u'?pu.coef[1]/cam.W:pv.coef[1]/cam.H;
const readoutFracPerMs=ro&&ro.ms!==undefined?(-ro.dir*pxVel)/1000:0;
return{
ok:true,
club_speed_mps:speed,
sigma,
v_vec:v,
t_mid:0.5*(first.t+last.t),
n_used:sel.length,
validity:low?'low_confidence':'estimated',
chord:bracket?'bracket':'pre_impact',
bias_correction_frac:corr,
reason_codes:[],
value_origin:'club_track',
readout_frac_per_ms:readoutFracPerMs,
lowfps_ci95_frac:low?CLUB_LOWFPS_CI95_FRAC:0,
depth_sys_frac:CLUB_DEPTH_SYS_FRAC,
fps,
};
}
