


















import{BALL_D,BALL_R,DEG,G,RAD2DEG}from'../geom/constants.js';
import{project,ray,toCamera}from'../geom/camera.js';
import{lm}from'../geom/lm.js';
import{cholesky}from'../geom/linalg.js';
import{mad,median,MAD_TO_SIGMA}from'../geom/stats.js';
import{RC}from'../contract/reason-codes.js';
import{observationTimes,withReadoutMs}from'./shutter.js';
import{k1FromCornerFrac,restartOn,rollAboutPoint,withK1}from'./perturb.js';
import{MIN_TRACK_OBS,OUTLIER_K,planeTrack}from'./fit2d.js';
import{AERO_MODEL,CD_PRIOR,RPM_TO_RAD_S,accelInto,aeroCoefficients,backspinAxis,spinRatio}from'./aero.js';
import{spinPriorFor}from'./ballistics.js';

export const PARAM_NAMES=Object.freeze(['p0x','p0y','p0z','t0','v0x','v0y','v0z','cd','cl']);
export const IDX=Object.freeze({p0:0,t0:3,v0:4,cd:7,cl:8});

export const FIT3D_DEFAULTS=Object.freeze({
sigmaPxBase:0.3,
sigmaPxPerR:0.1,
blurAspectInflate:2,


staticAspectMax:1.1,
widthSigmaStatic:0.06,
widthSigmaBlur:0.25,
clModelSigma:0.05,
t0PriorSigma:0.05,
kappaMin:0.25,
kappaMax:4,
kappaPseudoDof:0,
rk4MaxStep:0.001,
depthDriftPsiDeg:10,
depthDriftRmsePx:1.5,
sensLiftStep:0.002,
sensReadoutStepMs:0.25,
sensRollStepDeg:0.1,
sensDistortionStep:0.005,
});










export function startFromStaticBall(cam,u,v,o={}){
const lift=o.lift_m??0;
const zc=BALL_R+lift;
const sp=o.sigma_px??0.3;
const sh=o.sigma_h_m??0.001;
const floor=o.floor_m??0.0003;
const hit=(uu,vv)=>{
const{C,d}=ray(cam,uu,vv);
if(!(Math.abs(d[2])>1e-12))return null;
const s=(zc-C[2])/d[2];
if(!(s>0))return null;
return{X:[C[0]+s*d[0],C[1]+s*d[1],zc],d};
};
const h0=hit(u,v);
if(!h0)return null;
const d=h0.d;
const dXdLift=[d[0]/d[2],d[1]/d[2],1];
const ju=hit(u+sp,v);
const jv=hit(u,v+sp);
const a=ju?ju.X.map((x,k)=>x-h0.X[k]):[0,0,0];
const b=jv?jv.X.map((x,k)=>x-h0.X[k]):[0,0,0];
const cov=[0,1,2].map((i)=>[0,1,2].map((j)=>a[i]*a[j]+b[i]*b[j]+sh*sh*dXdLift[i]*dXdLift[j]
+(i===j?floor*floor:0)));
return{X:h0.X,cov,sigma:cov.map((r,i)=>Math.sqrt(r[i])),dXdLift};
}


export function sphereExtent(f,Xc,R=BALL_R){
const[x,y,z]=Xc;
const den=z*z-R*R;
if(!(den>0))return{w:NaN,h:NaN};
return{
w:(2*f*R*Math.sqrt(Math.max(x*x+z*z-R*R,0)))/den,
h:(2*f*R*Math.sqrt(Math.max(y*y+z*z-R*R,0)))/den,
};
}


export function obsWeights(o,opt=FIT3D_DEFAULTS){
const r=Number.isFinite(o.r_px)&&o.r_px>0?o.r_px:Number.isFinite(o.w_px)?o.w_px/2:10;
const w=Number.isFinite(o.w_px)?o.w_px:2*r;
const h=Number.isFinite(o.h_px)?o.h_px:2*r;
const aspect=Math.max(w,h,2*r)/(2*r);
let sigmaPx=opt.sigmaPxBase+opt.sigmaPxPerR*r;
if(aspect>opt.blurAspectInflate)sigmaPx*=aspect/opt.blurAspectInflate;
let size;
if(aspect<=opt.staticAspectMax){
size={kind:'w',obs:w,sigmaFrac:opt.widthSigmaStatic,mx:1,my:0};
}else{

const lx=Math.max(w-2*r,0);
const ly=Math.max(h-2*r,0);
const n=Math.hypot(lx,ly)||1;
size={kind:'minor',obs:2*r,sigmaFrac:opt.widthSigmaBlur,mx:lx/n,my:ly/n};
}
return{sigmaPx,aspect,size,r};
}


function integrate(p0,v0,cd,cl,taus,order,hMax,out){
const w=backspinAxis(v0);
let x=p0[0],y=p0[1],z=p0[2];
let vx=v0[0],vy=v0[1],vz=v0[2];
let tau=0;
const a1=[0,0,0],a2=[0,0,0],a3=[0,0,0],a4=[0,0,0];
for(const i of order){
const ti=taus[i];
if(!(ti>0)){
out[3*i]=p0[0];out[3*i+1]=p0[1];out[3*i+2]=p0[2];
continue;
}
const span=ti-tau;
if(span>0){
const n=Math.max(1,Math.ceil(span/hMax));
const h=span/n;
for(let s=0;s<n;s++){
accelInto(a1,vx,vy,vz,cd,cl,w);
const v2x=vx+0.5*h*a1[0],v2y=vy+0.5*h*a1[1],v2z=vz+0.5*h*a1[2];
accelInto(a2,v2x,v2y,v2z,cd,cl,w);
const v3x=vx+0.5*h*a2[0],v3y=vy+0.5*h*a2[1],v3z=vz+0.5*h*a2[2];
accelInto(a3,v3x,v3y,v3z,cd,cl,w);
const v4x=vx+h*a3[0],v4y=vy+h*a3[1],v4z=vz+h*a3[2];
accelInto(a4,v4x,v4y,v4z,cd,cl,w);
x+=(h/6)*(vx+2*v2x+2*v3x+v4x);
y+=(h/6)*(vy+2*v2y+2*v3y+v4y);
z+=(h/6)*(vz+2*v2z+2*v3z+v4z);
vx+=(h/6)*(a1[0]+2*a2[0]+2*a3[0]+a4[0]);
vy+=(h/6)*(a1[1]+2*a2[1]+2*a3[1]+a4[1]);
vz+=(h/6)*(a1[2]+2*a2[2]+2*a3[2]+a4[2]);
}
tau=ti;
}
out[3*i]=x;out[3*i+1]=y;out[3*i+2]=z;
}
return out;
}


export function tQuantile975(nu){
const z=1.959963984540054;
const n=Math.max(nu,1);
const z3=z*z*z;
const z5=z3*z*z;
const z7=z5*z*z;
return z+(z3+z)/(4*n)+(5*z5+16*z3+3*z)/(96*n*n)
+(3*z7+19*z5+17*z3-15*z)/(384*n*n*n);
}

function speedLaunch(v){
const sp=Math.hypot(v[0],v[1],v[2]);
const vh=Math.hypot(v[0],v[1]);
return{
speed:sp,
launchV:Math.atan2(v[2],vh)*RAD2DEG,
launchH:Math.atan2(-v[1],v[0])*RAD2DEG,
};
}


export function speedLaunchSigma(v,C){
const sp=Math.hypot(v[0],v[1],v[2]);
const vh=Math.hypot(v[0],v[1]);
const gs=[v[0]/sp,v[1]/sp,v[2]/sp];
const s2=sp*sp;
const gl=[(-v[2]*v[0])/(vh*s2),(-v[2]*v[1])/(vh*s2),vh/s2];
const quad=(g)=>{
let q=0;
for(let a=0;a<3;a++)for(let b=0;b<3;b++)q+=g[a]*C[a][b]*g[b];
return Math.sqrt(Math.max(q,0));
};
return{speed:quad(gs),launchDeg:quad(gl)*RAD2DEG};
}

function nullResult(flags,nObs,extra={}){
return{
ok:false,method:'fit3d',ball_speed_mps:null,launch_v_deg:null,launch_h_deg:null,v_vec:null,t0:null,
residual_rmse_px:null,cov:null,n_used:0,n_obs:nObs,flags,...extra,
};
}





function problem(cam,obs,start,priors,opt,kappa,keep){
const times=observationTimes(obs,cam);
const idx=[];
for(let i=0;i<obs.length;i++)if(keep[i])idx.push(i);
const n=idx.length;
const tRef=priors.tRef;
const tRel=new Float64Array(n);
const W=idx.map((i)=>obsWeights(obs[i],opt));
for(let k=0;k<n;k++)tRel[k]=times[idx[k]]-tRef;
const order=Array.from({length:n},(_,k)=>k).sort((a,b)=>tRel[a]-tRel[b]);
const pos=new Float64Array(3*n);
const taus=new Float64Array(n);
const Wst=start.whiten;
const m=3*n+6;
const residual=(th)=>{
for(let k=0;k<n;k++)taus[k]=tRel[k]-th[3];
integrate([th[0],th[1],th[2]],[th[4],th[5],th[6]],th[7],th[8],taus,order,opt.rk4MaxStep,pos);
const r=new Float64Array(m);
for(let k=0;k<n;k++){
const X=[pos[3*k],pos[3*k+1],pos[3*k+2]];
const p=project(cam,X);
if(!(p.z>0.05))return null;
const o=obs[idx[k]];
const s=W[k].sigmaPx*kappa;
r[3*k]=(p.u-o.u)/s;
r[3*k+1]=(p.v-o.v)/s;
const sz=W[k].size;
const ext=sphereExtent(cam.f,toCamera(cam,X));
const pred=sz.kind==='w'?ext.w:sz.mx*ext.h+sz.my*ext.w;
r[3*k+2]=Number.isFinite(sz.obs)&&sz.obs>0?(pred-sz.obs)/(sz.sigmaFrac*sz.obs):0;
}
let j=3*n;
const d0=th[0]-start.X[0],d1=th[1]-start.X[1],d2=th[2]-start.X[2];
r[j++]=Wst[0][0]*d0+Wst[0][1]*d1+Wst[0][2]*d2;
r[j++]=Wst[1][0]*d0+Wst[1][1]*d1+Wst[1][2]*d2;
r[j++]=Wst[2][0]*d0+Wst[2][1]*d1+Wst[2][2]*d2;
r[j++]=(th[3]-priors.t0Rel)/priors.t0Sigma;
r[j++]=(th[7]-priors.cd.mean)/priors.cd.sigma;
r[j++]=(th[8]-priors.cl.mean)/priors.cl.sigma;
return r;
};

const pixelResiduals=(th)=>{
const r=residual(th);
if(!r)return null;
const out=new Float64Array(2*n);
for(let k=0;k<n;k++){
const s=W[k].sigmaPx*kappa;
out[2*k]=r[3*k]*s;
out[2*k+1]=r[3*k+1]*s;
}
return out;
};
return{residual,pixelResiduals,idx,n,W};
}

function runLm(prob,theta0){
return lm({residual:prob.residual,theta0,maxIter:100});
}

function priorsFor(input,init,opt){
const sp=spinPriorFor(input.club??null,input.spinOverrides??null);
const speed0=Math.max(Math.hypot(init.v0[0],init.v0[1],init.v0[2]),5);
const S=spinRatio(sp.mean_rpm*RPM_TO_RAD_S,speed0);
const{cd,cl}=aeroCoefficients(S);
const Sd=spinRatio(sp.sigma_rpm*RPM_TO_RAD_S,speed0);
const dClds=S>0?(AERO_MODEL.CL_EXP*cl)/S:0;
const clSigma=Math.hypot(dClds*Sd,opt.clModelSigma);
return{
tRef:init.tRef,
t0Rel:init.t0Rel,
t0Sigma:Math.max(opt.t0PriorSigma,5/Math.max(input.fps||240,1)),
cd:{mean:sp.category?cd:CD_PRIOR.mean,sigma:CD_PRIOR.sigma},
cl:{mean:cl,sigma:clSigma},
spin:sp,
};
}


function startWhitening(start){
let C=null;
if(Array.isArray(start.cov)&&start.cov.length===3)C=start.cov.map((r)=>Array.from(r));
if(!C){
const s=normSigma(start.sigma);
C=[[s[0]**2,0,0],[0,s[1]**2,0],[0,0,s[2]**2]];
}
const L=cholesky(C);
if(!L){
const s=C.map((r,i)=>Math.sqrt(Math.max(r[i],1e-8)));
return{W:[[1/s[0],0,0],[0,1/s[1],0],[0,0,1/s[2]]],C};
}

const W=[[0,0,0],[0,0,0],[0,0,0]];
for(let i=0;i<3;i++){
W[i][i]=1/L[i][i];
for(let j=0;j<i;j++){
let acc=0;
for(let k=j;k<i;k++)acc+=L[i][k]*W[k][j];
W[i][j]=-acc/L[i][i];
}
}
return{W,C};
}

function normSigma(sigma){
if(Array.isArray(sigma)||ArrayBuffer.isView(sigma))return[sigma[0],sigma[1],sigma[2]].map((s)=>Math.max(s,1e-4));
const s=Math.max(Number.isFinite(sigma)?sigma:0.005,1e-4);
return[s,s,s];
}















export function fit3d(input){
const opt={...FIT3D_DEFAULTS,...(input.opts??{})};
const cam=input.cam;
const all=input.obs??[];
const origIdx=[];
all.forEach((o,i)=>{if(Number.isFinite(o.u)&&Number.isFinite(o.v)&&Number.isFinite(o.t_s))origIdx.push(i);});
const obs=origIdx.map((i)=>all[i]);
if(obs.length<MIN_TRACK_OBS)return nullResult([RC.TRACK_TOO_SHORT],obs.length);
const sw=startWhitening(input.start);
const start={
X:Array.from(input.start.X),cov:sw.C,sigma:sw.C.map((r,i)=>Math.sqrt(r[i])),whiten:sw.W,
dXdLift:input.start.dXdLift??[0,0,1],
};



const times=observationTimes(obs,cam);
const sp0=project(cam,start.X);
const dpx=(cam.f*BALL_D)/Math.max(sp0.z,0.1);
const moving=obs.map((o)=>!(Math.hypot(o.u-sp0.u,o.v-sp0.v)<1.5*dpx));
const initObs=moving.filter(Boolean).length>=2?obs.filter((_,i)=>moving[i]):obs;
const initTimes=moving.filter(Boolean).length>=2?times.filter((_,i)=>moving[i]):times;



let pt;
if(input.init&&Array.isArray(input.init.v0)&&Number.isFinite(input.init.t0)){
const tr=median(Array.from(times));
pt={ok:true,t_ref:tr,vx:input.init.v0[0],given:true};
}else pt=planeTrack(cam,initObs,initTimes,start.X[1],{minObs:2,robust:true});
if(!pt.ok||!(Math.abs(pt.vx)>1e-6))return nullResult([RC.TRACK_TOO_SHORT],obs.length);
const t0Rel=pt.given?input.init.t0-pt.t_ref:(start.X[0]-pt.x0)/pt.vx;
const init=pt.given
?{tRef:pt.t_ref,t0Rel,v0:Array.from(input.init.v0)}
:{tRef:pt.t_ref,t0Rel,v0:[pt.vx,0,pt.vz-G*t0Rel]};
const priors=priorsFor(input,init,opt);
if(Number.isFinite(input.t_impact_guess)){

priors.t0Rel=input.t_impact_guess-pt.t_ref;
}
const theta0=[start.X[0],start.X[1],start.X[2],t0Rel,init.v0[0],init.v0[1],init.v0[2],priors.cd.mean,priors.cl.mean];


let keep=obs.map(()=>true);
let kappa=1;
let prob=problem(cam,obs,start,priors,opt,kappa,keep);
let res=runLm(prob,theta0);
if(!res.r)return nullResult([RC.TRACK_TOO_SHORT],obs.length,{lm:{converged:false,reason:res.reason}});


const e=new Float64Array(prob.n);
for(let k=0;k<prob.n;k++)e[k]=Math.hypot(res.r[3*k],res.r[3*k+1]);
const thr=Math.max(median(e)+OUTLIER_K*MAD_TO_SIGMA*mad(e),0.5);
const rejected=[];
for(let k=0;k<prob.n;k++)if(e[k]>thr)rejected.push(prob.idx[k]);
if(rejected.length>0&&obs.length-rejected.length>=MIN_TRACK_OBS){
keep=obs.map((_,i)=>!rejected.includes(i));
prob=problem(cam,obs,start,priors,opt,kappa,keep);
res=runLm(prob,Array.from(res.theta));
}else rejected.length=0;
const nUsed=prob.n;
if(nUsed<MIN_TRACK_OBS)return nullResult([RC.TRACK_TOO_SHORT],obs.length);



let pixelDof=Math.max(2*nUsed-6,1);
{
let ss=0;
for(let k=0;k<nUsed;k++)ss+=res.r[3*k]**2+res.r[3*k+1]**2;
if(res.J&&res.covRaw){
let lev=0;
for(let k=0;k<nUsed;k++){
for(const row of[res.J[3*k],res.J[3*k+1]]){
for(let a=0;a<row.length;a++){
let acc=0;
for(let b=0;b<row.length;b++)acc+=res.covRaw[a][b]*row[b];
lev+=row[a]*acc;
}
}
}
if(Number.isFinite(lev))pixelDof=Math.max(2*nUsed-lev,1);
}
const k2=(ss+opt.kappaPseudoDof)/(pixelDof+opt.kappaPseudoDof);
kappa=Math.min(Math.max(Math.sqrt(k2),opt.kappaMin),opt.kappaMax);
prob=problem(cam,obs,start,priors,opt,kappa,keep);
res=runLm(prob,Array.from(res.theta));
}
const th=res.theta;
const v0=[th[4],th[5],th[6]];
const sl=speedLaunch(v0);
const px=prob.pixelResiduals(th);
if(!px)return nullResult([RC.TRACK_TOO_SHORT],obs.length,{lm:{converged:false,reason:res.reason}});
let ss=0;
for(let k=0;k<nUsed;k++)ss+=px[2*k]**2+px[2*k+1]**2;
const rmse=Math.sqrt(ss/nUsed);
const cov=res.cov;
const vBlock=cov?[4,5,6].map((a)=>[4,5,6].map((b)=>cov[a][b])):null;
const sig=vBlock?speedLaunchSigma(v0,vBlock):{speed:NaN,launchDeg:NaN};

const flags=[];
if(Math.abs(sl.launchH)>opt.depthDriftPsiDeg||rmse>opt.depthDriftRmsePx)flags.push(RC.DEPTH_DRIFT_SUSPECT);


let sens=null;
if(input.sensitivities!==false){
const refit=(cam2,start2)=>{
const p2=problem(cam2,obs,start2,priors,opt,kappa,keep);
const r2=runLm(p2,Array.from(th));
return r2.r?speedLaunch([r2.theta[4],r2.theta[5],r2.theta[6]]):null;
};
const dl=opt.sensLiftStep;
const sLift=refit(cam,{...start,X:start.X.map((x,k)=>x+start.dXdLift[k]*dl)});
const dm=opt.sensReadoutStepMs;
const sRo=refit(withReadoutMs(cam,(cam.readout?.ms??0)+dm),start);

const dr=opt.sensRollStepDeg;
const camR=rollAboutPoint(cam,dr*DEG);
const sRoll=refit(camR,restartOn(cam,camR,start));
const dd=opt.sensDistortionStep;
const camD=withK1(cam,(cam.k1??0)+k1FromCornerFrac(cam,dd));
const sDist=refit(camD,restartOn(cam,camD,start));
const d=(s2,step)=>(s2?{speed:(s2.speed-sl.speed)/step,launch_deg:(s2.launchV-sl.launchV)/step}:null);
sens={
lift:d(sLift,dl)??{speed:0,launch_deg:0},
readout:d(sRo,dm)??{speed:0,launch_deg:0},
roll:d(sRoll,dr),
distortion:d(sDist,dd),
};
}

return{
ok:true,
method:'fit3d',
ball_speed_mps:sl.speed,
launch_v_deg:sl.launchV,
launch_h_deg:sl.launchH,
v_vec:v0,
p0:[th[0],th[1],th[2]],
t0:pt.t_ref+th[3],
cd:th[7],
cl:th[8],
residual_rmse_px:rmse,
cov,
param_names:PARAM_NAMES,
theta:Array.from(th),
speed_sigma:sig.speed,
launch_sigma_deg:sig.launchDeg,
n_used:nUsed,
n_obs:obs.length,
rejected:rejected.map((k)=>origIdx[k]),
kappa,
pixel_dof:pixelDof,

t_factor:tQuantile975(pixelDof)/1.959963984540054,
flags,
sens,
priors:{cd:priors.cd,cl:priors.cl,spin:priors.spin},
start,
lm:{converged:res.converged,reason:res.reason,iterations:res.iterations,reducedChi2:res.reducedChi2},
};
}
