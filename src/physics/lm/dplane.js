














import{LM_PARAMS}from'./params.js';

const D=Math.PI/180;
const P=LM_PARAMS.dplane;
const clamp=(x,lo,hi)=>(x<lo?lo:x>hi?hi:x);


export function interp(x,xs,ys){
if(!(x>xs[0]))return ys[0];
const n=xs.length-1;
if(x>=xs[n])return ys[n];
let k=1;
while(x>xs[k])k++;
return ys[k-1]+((ys[k]-ys[k-1])*(x-xs[k-1]))/(xs[k]-xs[k-1]);
}


export const hRatio=(sl)=>interp(sl,P.sl_knots_deg,P.h);

export const vRatio=(sl)=>interp(sl,P.sl_knots_deg,P.v);


export function clubDir(aoa,path){
const a=aoa*D,p=path*D;
return[Math.cos(a)*Math.cos(p),-Math.cos(a)*Math.sin(p),Math.sin(a)];
}


export function faceNormal(dl,face){
const l=dl*D,f=face*D;
return[Math.cos(l)*Math.cos(f),-Math.cos(l)*Math.sin(f),Math.sin(l)];
}


export function spinLoft3D(aoa,path,dl,face){
const c=clubDir(aoa,path);
const n=faceNormal(dl,face);
const d=c[0]*n[0]+c[1]*n[1]+c[2]*n[2];
return Math.acos(clamp(d,-1,1))/D;
}


export function spinAxisDeg(aoa,path,dl,face){
const c=clubDir(aoa,path);
const n=faceNormal(dl,face);
const wx=c[1]*n[2]-c[2]*n[1];
const wy=c[2]*n[0]-c[0]*n[2];
const wz=c[0]*n[1]-c[1]*n[0];
const hz=Math.hypot(wx,wy);
if(!(hz+Math.abs(wz)>1e-15))return 0;
return Math.atan2(-wz,hz)/D;
}


export function forwardDplane({face,path,dl,aoa},o={}){
const sl=spinLoft3D(aoa,path,dl,face);
const h=clamp(hRatio(sl)+(o.dh??0),P.h_min,1);
const v=clamp(vRatio(sl)+(o.dv??0),P.v_min,1);
return{launch_h:h*face+(1-h)*path,launch_v:v*dl+(1-v)*aoa,spin_loft:sl,h,v,axis:spinAxisDeg(aoa,path,dl,face)};
}






export function inverseVertical(lv,aoa,o={}){
const face=o.face??0,path=o.path??0,dv=o.dv??0;
let dl=lv,sl=0,v=1;
for(let k=0;k<200;k++){
sl=spinLoft3D(aoa,path,dl,face);
v=clamp(vRatio(sl)+dv,P.v_min,1);
const next=(lv-(1-v)*aoa)/v;
const done=Math.abs(next-dl)<1e-13;
dl=next;
if(done)break;
}
return{dl,spin_loft:spinLoft3D(aoa,path,dl,face),v};
}


export function inverseHorizontal(lh,path,spinLoft,dh=0){
const h=clamp(hRatio(spinLoft)+dh,P.h_min,1);
return{face:(lh-(1-h)*path)/h,face_to_path:(lh-path)/h,h};
}


export function inverseDplane({launch_h,launch_v,path,aoa},o={}){
let face=launch_h,dl=launch_v,sl=0,h=1,v=1;
for(let k=0;k<400;k++){
sl=spinLoft3D(aoa,path,dl,face);
h=clamp(hRatio(sl)+(o.dh??0),P.h_min,1);
v=clamp(vRatio(sl)+(o.dv??0),P.v_min,1);
const f2=(launch_h-(1-h)*path)/h;
const d2=(launch_v-(1-v)*aoa)/v;
const done=Math.abs(f2-face)+Math.abs(d2-dl)<1e-13;
face=f2;dl=d2;
if(done)break;
}
return{face,dl,spin_loft:spinLoft3D(aoa,path,dl,face),h,v};
}
