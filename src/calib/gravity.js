















import{RAD2DEG}from'../geom/constants.js';

const AXES=Object.freeze({
portrait:[[1,0,0],[0,-1,0],[0,0,-1]],
landscape_ccw:[[0,-1,0],[-1,0,0],[0,0,-1]],
landscape_cw:[[0,1,0],[1,0,0],[0,0,-1]],
portrait_upside:[[-1,0,0],[0,1,0],[0,0,-1]],
});


export function orientationName(o){
if(typeof o==='string'){
if(!AXES[o])throw new RangeError(`gravity: unknown orientation '${o}'`);
return o;
}
const a=((Math.round(o)%360)+360)%360;
if(a===0)return'portrait';
if(a===90)return'landscape_ccw';
if(a===180)return'portrait_upside';
if(a===270)return'landscape_cw';
throw new RangeError(`gravity: orientation angle ${o} is not a multiple of 90`);
}


export function cameraAxesInDevice(orientation){
return AXES[orientationName(orientation)].map((r)=>r.slice());
}







export function gravityPose(a,orientation='landscape_ccw',sign=1){
const v=Array.isArray(a)?a:[a?.x,a?.y,a?.z];
if(!v.every(Number.isFinite))return null;
const n=Math.hypot(v[0],v[1],v[2]);
if(!(n>1e-6))return null;
const up=[(sign*v[0])/n,(sign*v[1])/n,(sign*v[2])/n];
const ax=AXES[orientationName(orientation)];
const uc=ax.map((r)=>r[0]*up[0]+r[1]*up[1]+r[2]*up[2]);
const pitch=Math.atan2(uc[2],Math.hypot(uc[0],uc[1]));
const roll=Math.atan2(-uc[0],-uc[1]);
return{pitch,roll,pitch_deg:pitch*RAD2DEG,roll_deg:roll*RAD2DEG,up_cam:uc,norm:n};
}





export function accelFromPose(pitch,roll,orientation='landscape_ccw',sign=1,g_mag=9.80665){
const uc=[-Math.sin(roll)*Math.cos(pitch),-Math.cos(roll)*Math.cos(pitch),Math.sin(pitch)];
const ax=AXES[orientationName(orientation)];
const dev=[0,1,2].map((k)=>ax[0][k]*uc[0]+ax[1][k]*uc[1]+ax[2][k]*uc[2]);
return dev.map((x)=>sign*g_mag*x);
}






export function flatSlope(a,sign=1){
const v=Array.isArray(a)?a:[a?.x,a?.y,a?.z];
if(!v.every(Number.isFinite))return null;
const n=Math.hypot(v[0],v[1],v[2]);
if(!(n>1e-6))return null;
const z=Math.abs((sign*v[2])/n);
return{slope_deg:Math.acos(Math.min(1,z))*RAD2DEG,dir_deg:Math.atan2(sign*v[1],sign*v[0])*RAD2DEG};
}





export function lowPassStep(state,sample,t_s,tau_s=0.5){
if(!state)return{t_s,value:sample.slice()};
const dt=Math.max(0,t_s-state.t_s);
const alpha=tau_s>0?1-Math.exp(-dt/tau_s):1;
return{t_s,value:state.value.map((y,i)=>y+alpha*(sample[i]-y))};
}






export function stabilityCheck(samples,{span_s=1.0,tol_deg=0.1}={}){
if(!samples.length)return{stable:false,spread_deg:NaN,n:0,covered:false};
const tEnd=samples[samples.length-1].t_s;
const sel=samples.filter((s)=>s.t_s>=tEnd-span_s-1e-12);
const covered=samples[0].t_s<=tEnd-span_s+1e-12;
let spread=0;
for(const key of['pitch_deg','roll_deg']){
const m=sel.reduce((acc,s)=>acc+s[key],0)/sel.length;
for(const s of sel)spread=Math.max(spread,Math.abs(s[key]-m));
}
return{stable:covered&&spread<=tol_deg,spread_deg:spread,n:sel.length,covered};
}






export function createGravityTracker(opts={}){
const orientation=opts.orientation??'landscape_ccw';
const sign=opts.sign??1;
const tau=opts.tau_s??0.5;
const span=opts.span_s??1.0;
const tol=opts.tol_deg??0.1;
let lp=null;
let hist=[];
return{
push(a,t_s){
const v=Array.isArray(a)?a:[a?.x,a?.y,a?.z];
if(!v.every(Number.isFinite))return null;
lp=lowPassStep(lp,v,t_s,tau);
const g=gravityPose(lp.value,orientation,sign);
if(!g)return null;
hist.push({t_s,pitch_deg:g.pitch_deg,roll_deg:g.roll_deg});
hist=hist.filter((s)=>s.t_s>=t_s-2*span);
const st=stabilityCheck(hist,{span_s:span,tol_deg:tol});
return{pitch_deg:g.pitch_deg,roll_deg:g.roll_deg,stable:st.stable,spread_deg:st.spread_deg};
},
reset(){lp=null;hist=[];},
};
}


export function gravityPrior(g,{sigma_deg=0.4,slope_pitch_deg=0,slope_roll_deg=0}={}){
if(!g)return null;
return{pitch_deg:g.pitch_deg-slope_pitch_deg,roll_deg:g.roll_deg-slope_roll_deg,sigma_deg};
}

