







import{DEG}from'../geom/constants.js';
import{lm}from'../geom/lm.js';
import{makeCamera,project,eulerFromR,rFromEuler,nominalCamera,center}from'../geom/camera.js';
import{RC}from'../contract/reason-codes.js';
import{cameraFromParams,propagatePoseSigma,solveMatPose,nominalF,GRAVITY_SIGMA_DEG}from'./pnp.js';
import{makeCalibration}from'./report.js';
import{ballHeight}from'./ballspot.js';


export const LADDER_PRIORS=Object.freeze({
club_line:Object.freeze({
endpoint_sigma_px:3,
placement_yaw_sigma_deg:0.5,
placement_offset_sigma_m:0.03,
shaft_z_m:0.007,
D_sigma_m:0.05,
lateral_sigma_m:0.10,
ball_sigma_px:1,
floor:Object.freeze({yaw_deg:1.3}),
}),
ball_only:Object.freeze({
yaw_sigma_deg:4,
D_sigma_m:0.10,
ball_sigma_px:1,
no_gravity_angle_sigma_deg:2,
floor:Object.freeze({yaw_deg:3.0}),
}),
});

function wrapPi(x){
const twoPi=2*Math.PI;
let y=x-twoPi*Math.round(x/twoPi);
if(y<=-Math.PI)y+=twoPi;
return y;
}


function nominalPose(view,W,H,f,preset){
if(preset&&preset.pose){
const p=preset.pose;
return{C:[p.X_m,p.Y_m,p.h_m],yaw:p.yaw_deg*DEG,pitch:p.pitch_deg*DEG,roll:p.roll_deg*DEG,D:p.D_m};
}
const cam=nominalCamera(view,{W,H,f});
const C=center(cam);
const e=eulerFromR(cam.R,view);
return{C,yaw:e.yaw,pitch:e.pitch,roll:e.roll,D:Math.hypot(C[0],C[1])};
}


export function lateralKey(view){
return view==='face_on'?'X_m':'Y_m';
}

function solveWithPriors(o){
const{view,W,H,f,k1=0,R0,C0,nExtra=0}=o;
const base={R0,f0:f,fFree:false,W,H,k1};
const residual=(th)=>{
const cam=cameraFromParams(th,base);
const r=[];
for(const p of o.points){
const q=project(cam,p.X);
if(!Number.isFinite(q.u))return null;
r.push((q.u-p.uv[0])/p.sigma,(q.v-p.uv[1])/p.sigma);
}
if(o.line){
const L=o.line;
const eps=th[6];
const y0=th[7];
const a=project(cam,[-0.6*Math.cos(eps),y0-0.6*Math.sin(eps),L.z]);
const b=project(cam,[0.6*Math.cos(eps),y0+0.6*Math.sin(eps),L.z]);
if(!Number.isFinite(a.u)||!Number.isFinite(b.u))return null;
const nx=-(b.v-a.v);
const ny=b.u-a.u;
const nn=Math.hypot(nx,ny);
for(const p of L.uvs)r.push(((p[0]-a.u)*nx+(p[1]-a.v)*ny)/nn/L.sigma);
r.push(eps/L.eps_sigma,y0/L.y0_sigma);
}
const e=eulerFromR(cam.R,view);
const C=[th[3],th[4],th[5]];
const pr=o.priors;
if(pr.pitch)r.push(wrapPi(e.pitch-pr.pitch.mu)/pr.pitch.sigma);
if(pr.roll)r.push(wrapPi(e.roll-pr.roll.mu)/pr.roll.sigma);
if(pr.yaw)r.push(wrapPi(e.yaw-pr.yaw.mu)/pr.yaw.sigma);
if(pr.D)r.push((Math.hypot(C[0],C[1])-pr.D.mu)/pr.D.sigma);
if(pr.lateral)r.push((C[pr.lateral.index]-pr.lateral.mu)/pr.lateral.sigma);
return r;
};
const theta0=[0,0,0,C0[0],C0[1],C0[2]];
for(let i=0;i<nExtra;i++)theta0.push(0);
const res=lm({residual,theta0,maxIter:300,tol:1e-14});
if(!res.covRaw)return{ok:false,reason:res.reason};
const camL=cameraFromParams(res.theta,base);
const cam=makeCamera({W,H,f,k1,R:camL.R,t:camL.t,readout:o.readout});

const{sigma}=propagatePoseSigma(res.theta,res.covRaw,base,view);
let ss=0;
let n=0;
for(const p of o.points){
const q=project(cam,p.X);
ss+=(q.u-p.uv[0])**2+(q.v-p.uv[1])**2;
n++;
}
if(o.line){
const ip=res.r;
const off=2*o.points.length;
for(let i=0;i<o.line.uvs.length;i++){ss+=(ip[off+i]*o.line.sigma)**2;n++;}
}
return{ok:true,cam,sigma,theta:Array.from(res.theta),cov:res.covRaw,reducedChi2:res.reducedChi2,rmse:n?Math.sqrt(ss/n):null,lm:res};
}

function applyFloor(sigma,floor){
const out={...sigma};
for(const[k,v]of Object.entries(floor??{}))if(!(out[k]>=v))out[k]=v;
return out;
}

function gravityPriors(gravity,nominal,noGravSigmaDeg){
if(gravity&&Number.isFinite(gravity.pitch_deg)&&Number.isFinite(gravity.roll_deg)){
const s=(gravity.sigma_deg??GRAVITY_SIGMA_DEG)*DEG;
return{pitch:{mu:gravity.pitch_deg*DEG,sigma:s},roll:{mu:gravity.roll_deg*DEG,sigma:s},codes:[]};
}
const s=noGravSigmaDeg*DEG;
return{pitch:{mu:nominal.pitch,sigma:s},roll:{mu:nominal.roll,sigma:s},codes:[RC.NO_GRAVITY_REF]};
}

function ctxDefaults(ctx){
const W=ctx.W;
const H=ctx.H;
const f=ctx.f??ctx.preset?.f_locked??nominalF(W,H);
return{W,H,f,k1:ctx.k1??0,view:ctx.view};
}






export function solveClubLine(o){
const P=LADDER_PRIORS.club_line;
const{W,H,f,k1,view}=ctxDefaults(o);
const nom=nominalPose(view,W,H,f,o.preset);
const g=gravityPriors(o.gravity,nom,LADDER_PRIORS.ball_only.no_gravity_angle_sigma_deg);
const codes=[...g.codes];
const D=o.D_assumed??nom.D;
const R0=rFromEuler({yaw:nom.yaw,pitch:g.pitch.mu,roll:g.roll.mu},view);
const scale=D/nom.D;
const C0=[nom.C[0]*scale,nom.C[1]*scale,nom.C[2]];
const points=[];
const priors={pitch:g.pitch,roll:g.roll,D:{mu:D,sigma:P.D_sigma_m}};
if(o.ball){
const hb=ballHeight(o.lie??'mat',o.tee_lift_m??null,o.tee_lift_source??'measured');
codes.push(...hb.reason_codes);
points.push({X:[0,0,hb.z_m],uv:o.ball,sigma:P.ball_sigma_px});
}else{
const lk=lateralKey(view);
priors.lateral={index:lk==='X_m'?0:1,mu:C0[lk==='X_m'?0:1],sigma:P.lateral_sigma_m};
}
const line={
uvs:[o.p1,o.p2],sigma:P.endpoint_sigma_px,z:P.shaft_z_m,
eps_sigma:P.placement_yaw_sigma_deg*DEG,y0_sigma:P.placement_offset_sigma_m,
};
const s=solveWithPriors({view,W,H,f,k1,R0,C0,nExtra:2,points,line,priors,readout:o.readout});
if(!s.ok)return{ok:false,method:'club_line',calibration:null,reason_codes:[...codes,RC.IMPLAUSIBLE_VALUE],solve:s};
const sigma=applyFloor(s.sigma,P.floor);
const calibration=makeCalibration({
method:'club_line',source:o.source,cam:s.cam,view,f_locked:Boolean(o.fLocked??Number.isFinite(o.preset?.f_locked)),
sigma,rmse_px:s.rmse,slope_deg:o.slope_deg,preset:o.preset,readout_source:o.readout_source,
});
return{ok:true,method:'club_line',calibration,reason_codes:[...new Set(codes)],solve:{...s,sigma_raw:s.sigma,sigma}};
}






export function solveBallOnly(o){
const P=LADDER_PRIORS.ball_only;
const{W,H,f,k1,view}=ctxDefaults(o);
const nom=nominalPose(view,W,H,f,o.preset);
const g=gravityPriors(o.gravity,nom,P.no_gravity_angle_sigma_deg);
const codes=[...g.codes];
const hb=ballHeight(o.lie??'mat',o.tee_lift_m??null,o.tee_lift_source??'measured');
codes.push(...hb.reason_codes);
const D=o.D_assumed??nom.D;
const yaw0=Number.isFinite(o.yaw_assumed_deg)?o.yaw_assumed_deg*DEG:nom.yaw;
const R0=rFromEuler({yaw:yaw0,pitch:g.pitch.mu,roll:g.roll.mu},view);

const fwd={W,H,f,cx:W/2,cy:H/2};
const x=(o.ball[0]-fwd.cx)/f;
const y=(o.ball[1]-fwd.cy)/f;
const d=[R0[0]*x+R0[3]*y+R0[6],R0[1]*x+R0[4]*y+R0[7],R0[2]*x+R0[5]*y+R0[8]];
const dh=Math.hypot(d[0],d[1]);
const sRay=dh>1e-9?D/dh:D;
const C0=[-sRay*d[0],-sRay*d[1],hb.z_m-sRay*d[2]];
const points=[{X:[0,0,hb.z_m],uv:o.ball,sigma:P.ball_sigma_px}];
const priors={pitch:g.pitch,roll:g.roll,yaw:{mu:yaw0,sigma:P.yaw_sigma_deg*DEG},D:{mu:D,sigma:P.D_sigma_m}};
const s=solveWithPriors({view,W,H,f,k1,R0,C0,points,priors,readout:o.readout});
if(!s.ok)return{ok:false,method:'ball_only',calibration:null,reason_codes:[...codes,RC.IMPLAUSIBLE_VALUE],solve:s};
const sigma=applyFloor(s.sigma,P.floor);
const calibration=makeCalibration({
method:'ball_only',source:o.source,cam:s.cam,view,f_locked:Boolean(o.fLocked??Number.isFinite(o.preset?.f_locked)),
sigma,rmse_px:s.rmse,slope_deg:o.slope_deg,preset:o.preset,readout_source:o.readout_source,
});
return{ok:true,method:'ball_only',calibration,reason_codes:[...new Set(codes)],solve:{...s,sigma_raw:s.sigma,sigma}};
}

function finitePt(p){
return Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
}










export function selectMethod(visible){
const c=visible.corners;
if(Array.isArray(c)&&c.length===4&&c.every(finitePt))return'mat_pnp';
const hasGrav=Boolean(visible.gravity&&Number.isFinite(visible.gravity.pitch_deg)&&Number.isFinite(visible.gravity.roll_deg));
if(visible.club&&finitePt(visible.club.p1)&&finitePt(visible.club.p2)&&hasGrav)return'club_line';
if(finitePt(visible.ball))return'ball_only';
return null;
}






export function calibrate(visible,ctx){
const method=selectMethod(visible);
if(method===null)return{ok:false,method:null,calibration:null,reason_codes:[RC.OUT_OF_FRAME],solve:null};
if(method==='mat_pnp'){
const fLocked=ctx.fLocked??Number.isFinite(ctx.preset?.f_locked??ctx.f);
const f=ctx.f??ctx.preset?.f_locked??nominalF(ctx.W,ctx.H);
const s=solveMatPose({
corners:visible.corners,venue:ctx.venue,view:ctx.view,W:ctx.W,H:ctx.H,f,fLocked,
cornerSource:ctx.cornerSource??'manual',gravity:visible.gravity,k1:ctx.k1,readout:ctx.readout,
});
if(!s.ok)return{ok:false,method,calibration:null,reason_codes:s.reason_codes,solve:s};
const calibration=makeCalibration({
method,source:ctx.source,cam:s.cam,view:ctx.view,f_locked:fLocked,sigma:s.sigma,rmse_px:s.rmse,
slope_deg:ctx.slope_deg,preset:ctx.preset,readout_source:ctx.readout_source,
});
return{ok:true,method,calibration,reason_codes:s.reason_codes,solve:s};
}
const common={...ctx,gravity:visible.gravity,ball:finitePt(visible.ball)?visible.ball:null};
if(method==='club_line')return solveClubLine({...common,p1:visible.club.p1,p2:visible.club.p2});
return solveBallOnly(common);
}

