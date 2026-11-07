





















import{RAD2DEG,TEE_LIFT_PRIOR_SIGMA_M}from'../geom/constants.js';
import{cholesky}from'../geom/linalg.js';
import{gauss,uniform}from'../geom/rng.js';
import{percentile,std}from'../geom/stats.js';
import{RC}from'../contract/reason-codes.js';
import{READOUT_ASSUMED_HALFWIDTH_MS,READOUT_MEASURED_SIGMA_MS}from'./shutter.js';

export const SYSTEMATICS_DEFAULTS=Object.freeze({

calib_scale_sigma:0.003,

mat_scale_halfwidth:0.002,



distortion_corner_sigma:0.01,

distortion_sigma:0.004,


roll_sigma_deg:0.15,

readout_source:'assumed',
readout_halfwidth_ms:READOUT_ASSUMED_HALFWIDTH_MS,
readout_sigma_ms:READOUT_MEASURED_SIGMA_MS,

lie:'mat',
tee_lift_source:'measured',
tee_measured_halfwidth_m:0.005,
tee_assumed_sigma_m:TEE_LIFT_PRIOR_SIGMA_M,

depth_drift_inflate:2,
});






export function systematicsFrom({calibration=null,club=null,overrides=null}={}){
const s={...SYSTEMATICS_DEFAULTS};
if(calibration){
if(calibration.readout_source)s.readout_source=calibration.readout_source;
const D=calibration.pose?.D_m;
const sD=calibration.pose_sigma?.D_m;
if(Number.isFinite(D)&&D>0&&Number.isFinite(sD)&&sD>=0)s.calib_scale_sigma=sD/D;
const sRoll=calibration.pose_sigma?.roll_deg;
if(Number.isFinite(sRoll)&&sRoll>=0)s.roll_sigma_deg=sRoll;
}
if(club){
if(club.lie)s.lie=club.lie;
if(club.tee_lift_source)s.tee_lift_source=club.tee_lift_source;
}
return overrides?{...s,...overrides}:s;
}

function summary(value,draws){
if(value==null||!Number.isFinite(value))return null;
const lo=Math.min(percentile(draws,2.5),value);
const hi=Math.max(percentile(draws,97.5),value);
return{value,ci95:[lo,hi],sigma:std(draws)};
}

function cholOrDiag(C){
const L=cholesky(C);
if(L)return L.map((r)=>Array.from(r));
return C.map((r,i)=>r.map((_,j)=>(i===j?Math.sqrt(Math.max(C[i][i],0)):0)));
}








export function propagate(o){
const fit=o.fit;
if(!fit||!fit.ok||!fit.v_vec)return null;
const rng=o.rng;
if(typeof rng!=='function')throw new TypeError('propagate: rng (seeded, geom/rng.js) is required');
const S={...SYSTEMATICS_DEFAULTS,...(o.systematics??{})};
const n=o.n??2000;
const v0=fit.v_vec;
const infl=(fit.flags?.includes(RC.DEPTH_DRIFT_SUSPECT)?S.depth_drift_inflate:1)*(fit.t_factor??1);
let Cv=[[0,0,0],[0,0,0],[0,0,0]];
if(fit.cov)Cv=[4,5,6].map((a)=>[4,5,6].map((b)=>fit.cov[a][b]*infl*infl));
const L=cholOrDiag(Cv);
const sens=fit.sens??{lift:{speed:0,launch_deg:0},readout:{speed:0,launch_deg:0}};
const sDist=sens.distortion&&Number.isFinite(sens.distortion.speed)?sens.distortion:null;
const sRoll=sens.roll&&Number.isFinite(sens.roll.launch_deg)?sens.roll:null;
const distRel=sDist?sDist.speed/fit.ball_speed_mps:0;
const club=o.club&&o.club.ok?o.club:null;
const bs=new Float64Array(n);
const la=new Float64Array(n);
const cs=club?new Float64Array(n):null;
const sm=club?new Float64Array(n):null;
const teed=S.lie==='tee';
const liftMeasured=S.tee_lift_source==='measured';
const roAssumed=S.readout_source!=='measured';
const lowSigma=club?club.lowfps_ci95_frac/1.959964:0;
for(let i=0;i<n;i++){
const z0=gauss(rng),z1=gauss(rng),z2=gauss(rng);
const vx=v0[0]+L[0][0]*z0;
const vy=v0[1]+L[1][0]*z0+L[1][1]*z1;
const vz=v0[2]+L[2][0]*z0+L[2][1]*z1+L[2][2]*z2;
const sp=Math.sqrt(vx*vx+vy*vy+vz*vz);
const ang=Math.atan2(vz,Math.hypot(vx,vy))*RAD2DEG;

const zd=gauss(rng);
const scale=(1+gauss(rng,0,S.calib_scale_sigma))*(1+uniform(rng,-S.mat_scale_halfwidth,S.mat_scale_halfwidth))
*(sDist?1:1+zd*S.distortion_sigma);
const dd=zd*S.distortion_corner_sigma;
const droll=gauss(rng,0,S.roll_sigma_deg);
const dms=roAssumed?uniform(rng,-S.readout_halfwidth_ms,S.readout_halfwidth_ms):gauss(rng,0,S.readout_sigma_ms);
let dlift=0;
if(teed)dlift=liftMeasured?uniform(rng,-S.tee_measured_halfwidth_m,S.tee_measured_halfwidth_m):gauss(rng,0,S.tee_assumed_sigma_m);
let b=sp+sens.readout.speed*dms+sens.lift.speed*dlift;
let a=ang+sens.readout.launch_deg*dms+sens.lift.launch_deg*dlift;
if(sDist){b+=sDist.speed*dd;a+=sDist.launch_deg*dd;}
if(sRoll){b+=(sRoll.speed??0)*droll;a+=sRoll.launch_deg*droll;}else a+=droll;
bs[i]=b*scale;
la[i]=a;
if(club){
let c=club.club_speed_mps+gauss(rng,0,club.sigma??0);
c*=1+(club.readout_frac_per_ms??0)*dms;
c*=1+distRel*dd;
c*=1+uniform(rng,-(club.depth_sys_frac??0),club.depth_sys_frac??0);
if(lowSigma>0)c*=1+gauss(rng,0,lowSigma);
c*=scale;
cs[i]=c;
sm[i]=c>0?bs[i]/c:NaN;
}
}
const smashValue=club&&club.club_speed_mps>0?fit.ball_speed_mps/club.club_speed_mps:null;
return{
n,
ball_speed:summary(fit.ball_speed_mps,bs),
launch_v:summary(fit.launch_v_deg,la),
club_speed:club?summary(club.club_speed_mps,cs):null,
smash:club&&smashValue!=null?summary(smashValue,sm.filter(Number.isFinite)):null,
draws:{ball_speed:bs,launch_v_deg:la,club_speed:cs,smash:sm},
systematics:S,
inflated:fit.flags?.includes(RC.DEPTH_DRIFT_SUSPECT)??false,
fit_inflation:infl,
};
}

