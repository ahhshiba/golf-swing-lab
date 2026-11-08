










import{BALL_R}from'../geom/constants.js';
import{center,project,ray}from'../geom/camera.js';
import{mat3Mul,mat3MulVec,mat3Transpose,rotAxisAngle}from'../geom/linalg.js';


export const BALL_SPOT=Object.freeze([0,0,0]);


export function cornerR2(cam){
return((cam.W/2)**2+(cam.H/2)**2)/(cam.f*cam.f);
}


export function k1FromCornerFrac(cam,frac){
return frac/cornerR2(cam);
}


export function withK1(cam,k1){
return{...cam,k1};
}


export function scaleAboutPoint(cam,k,P=BALL_SPOT){
const C=center(cam);
const C2=[0,1,2].map((i)=>P[i]+k*(C[i]-P[i]));
const t=mat3MulVec(cam.R,C2);
return{...cam,t:[-t[0],-t[1],-t[2]]};
}


export function rollAboutPoint(cam,angleRad,P=BALL_SPOT){
const C=center(cam);
const axis=[P[0]-C[0],P[1]-C[1],P[2]-C[2]];
const Q=rotAxisAngle(axis,angleRad);
const R=mat3Mul(cam.R,mat3Transpose(Q));
const t=mat3MulVec(R,C);
return{...cam,R,t:[-t[0],-t[1],-t[2]]};
}






export function restartOn(camFrom,camTo,start){
const p=project(camFrom,start.X);
const{C,d}=ray(camTo,p.u,p.v);
const zc=Number.isFinite(start.X[2])?start.X[2]:BALL_R;
if(!(Math.abs(d[2])>1e-12))return start;
const s=(zc-C[2])/d[2];
if(!(s>0))return start;
return{...start,X:[C[0]+s*d[0],C[1]+s*d[1],zc]};
}
