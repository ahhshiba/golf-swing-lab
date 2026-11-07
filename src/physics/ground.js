









import{center,project,ray}from'../geom/camera.js';
import{mat3Mul,mat3MulVec,mat3Transpose,rotAxisAngle}from'../geom/linalg.js';
import{BALL_SPOT}from'./perturb.js';
import{DEFAULT_VENUE,matCorners}from'../calib/mat.js';
import{CORNER_SIGMA_PX}from'../calib/pnp.js';


export const GROUND_YAW_SIGMA_FALLBACK_DEG=0.5;
export const CALIB_ROLL_SIGMA_FALLBACK_DEG=0.3;





export function rayToGround(cam,u,v,z0=0,tanA=0,xRef=0){
const{C,d}=ray(cam,u,v);
if(!Number.isFinite(d[0]))return null;
const den=d[2]-d[0]*tanA;
if(!(Math.abs(den)>1e-12))return null;
const s=(z0+(C[0]-xRef)*tanA-C[2])/den;
if(!(s>0))return null;
return[C[0]+s*d[0],C[1]+s*d[1],C[2]+s*d[2]];
}






export function yawAboutPoint(cam,angleRad,P=BALL_SPOT){
const Q=rotAxisAngle([0,0,1],angleRad);
const C=center(cam);
const rel=[C[0]-P[0],C[1]-P[1],C[2]-P[2]];
const r2=mat3MulVec(Q,rel);
const C2=[P[0]+r2[0],P[1]+r2[1],P[2]+r2[2]];
const R=mat3Mul(cam.R,mat3Transpose(Q));
const t=mat3MulVec(R,C2);
return{...cam,R,t:[-t[0],-t[1],-t[2]]};
}


export function sideOffset(cam){
return center(cam)[1];
}










export function groundDirSigmaDeg(cam,corners,sigmaPx){
const lat=corners.map(([x,y])=>{
const p=projectGround(cam,x,y);
if(!p)return NaN;
const a=rayToGround(cam,p.u+1,p.v,0);
const b=rayToGround(cam,p.u,p.v+1,0);
const c=rayToGround(cam,p.u,p.v,0);
if(!a||!b||!c)return NaN;
return Math.hypot(a[1]-c[1],b[1]-c[1])*sigmaPx;
});
const xs=corners.map((c)=>c[0]);
const trail=[0,1,2,3].filter((k)=>xs[k]<0);
const lead=[0,1,2,3].filter((k)=>xs[k]>=0);
const pair=(ks)=>Math.sqrt(ks.reduce((s,k)=>s+lat[k]**2,0))/ks.length;
const L=Math.max(...xs)-Math.min(...xs);
const s=Math.hypot(pair(trail),pair(lead))/L;
return Number.isFinite(s)?(s*180)/Math.PI:NaN;
}

function projectGround(cam,x,y){
const p=project(cam,[x,y,0]);
return p.z>0?p:null;
}






export function groundCalibSigmas(cam,calibration,venue){
let yaw=groundDirSigmaDeg(cam,matCorners(venue??DEFAULT_VENUE),CORNER_SIGMA_PX.auto);
if(!Number.isFinite(yaw))yaw=GROUND_YAW_SIGMA_FALLBACK_DEG;
const r=calibration?.pose_sigma?.roll_deg;
return{yaw_deg:yaw,roll_deg:Number.isFinite(r)?r:CALIB_ROLL_SIGMA_FALLBACK_DEG};
}
