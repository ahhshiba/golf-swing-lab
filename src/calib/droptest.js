




import{G}from'../geom/constants.js';
import{ray}from'../geom/camera.js';
import{lm}from'../geom/lm.js';
import{solve}from'../geom/linalg.js';
import{RC}from'../contract/reason-codes.js';

export const DROP_TEST_RULE=Object.freeze({g_ref:G,tol_frac:0.03,min_obs:5});





export function detectionTime(cam,t_frame,u,v){
const ro=cam.readout;
if(!ro||!ro.ms)return t_frame;
const frac=ro.axis==='u'?u/cam.W:v/cam.H;
return t_frame+(ro.ms/1000)*ro.dir*(frac-0.5);
}

function planePoint(cam,u,v,y0){
const{C,d}=ray(cam,u,v);
if(!(Math.abs(d[1])>1e-9))return null;
const s=(y0-C[1])/d[1];
if(!(s>0))return null;
return[C[0]+s*d[0],y0,C[2]+s*d[2]];
}








export function dropTest(track,calib,opts={}){
const cam=calib.camera??calib;
const obs=Array.isArray(track)?track:track.obs;
const rule=opts.rule??DROP_TEST_RULE;
const sp=opts.sigma_px??1;
const y0=opts.plane_y??0;
const applyRO=opts.applyReadout??true;
const pts=[];
for(const o of obs){
if(!Number.isFinite(o.u)||!Number.isFinite(o.v)||!Number.isFinite(o.t_s))continue;
const P=planePoint(cam,o.u,o.v,y0);
if(!P)continue;
const Pv=planePoint(cam,o.u,o.v+0.5,y0);
const Pu=planePoint(cam,o.u+0.5,o.v,y0);
const sz=Pv&&Pu?sp*Math.hypot((Pv[2]-P[2])/0.5,(Pu[2]-P[2])/0.5):NaN;
if(!(sz>0))continue;
pts.push({t:applyRO?detectionTime(cam,o.t_s,o.u,o.v):o.t_s,x:P[0],z:P[2],sz});
}
if(pts.length<rule.min_obs){
return{ok:false,pass:null,g:null,sigma_g:null,rel_err:null,n:pts.length,reason_codes:[RC.TRACK_TOO_SHORT]};
}
pts.sort((a,b)=>a.t-b.t);
const t0=pts[0].t;

const A=[[0,0,0],[0,0,0],[0,0,0]];
const b=[0,0,0];
for(const p of pts){
const t=p.t-t0;
const row=[1,t,-0.5*t*t];
const w=1/(p.sz*p.sz);
for(let i=0;i<3;i++){
b[i]+=w*row[i]*p.z;
for(let j=0;j<3;j++)A[i][j]+=w*row[i]*row[j];
}
}
const init=solve(A,b)??[pts[0].z,0,G];
const residual=(th)=>pts.map((p)=>{
const t=p.t-t0;
return(p.z-(th[0]+th[1]*t-0.5*th[2]*t*t))/p.sz;
});
const res=lm({residual,theta0:Array.from(init),maxIter:50});
const g=res.theta[2];
const sigma_g=res.cov?Math.sqrt(res.cov[2][2]):NaN;
let ss=0;
for(let i=0;i<pts.length;i++)ss+=(res.r[i]*pts[i].sz)**2;
const rel_err=(g-rule.g_ref)/rule.g_ref;
return{
ok:true,
pass:Math.abs(rel_err)<=rule.tol_frac,
g,
sigma_g,
rel_err,
z0:res.theta[0],
vz:res.theta[1],
t0,
n:pts.length,
rms_m:Math.sqrt(ss/pts.length),
points:pts.map((p)=>[p.t,p.x,p.z]),
reason_codes:[],
};
}
