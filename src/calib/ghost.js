


import{DEG}from'../geom/constants.js';
import{makeCamera,projectMany,rFromEuler}from'../geom/camera.js';
import{matCorners}from'./mat.js';
import{nominalF}from'./pnp.js';






export function presetCamera(preset,camTemplate){
const{W,H}=camTemplate;
let f=camTemplate.f;
if(!Number.isFinite(f)&&Number.isFinite(preset.f_locked)){
const ref=Number.isFinite(preset.W)&&Number.isFinite(preset.H)?Math.max(preset.W,preset.H):Math.max(W,H);
f=preset.f_locked*(Math.max(W,H)/ref);
}
if(!Number.isFinite(f))f=nominalF(W,H);
const p=preset.pose;
const C=[p.X_m,p.Y_m,p.h_m];
const{R,t}=rFromEuler({yaw:p.yaw_deg*DEG,pitch:p.pitch_deg*DEG,roll:p.roll_deg*DEG},preset.view,C);
return makeCamera({W,H,f,k1:camTemplate.k1??0,R,t,readout:camTemplate.readout});
}





export function ghostCorners(preset,venue,camTemplate,margin=0.025){
const cam=presetCamera(preset,camTemplate);
const{uv}=projectMany(cam,matCorners(venue));
const corners=[];
const in_frame=[];
for(let i=0;i<4;i++){
const u=uv[2*i];
const v=uv[2*i+1];
corners.push([u,v]);
in_frame.push(u>=margin*cam.W&&u<=(1-margin)*cam.W&&v>=margin*cam.H&&v<=(1-margin)*cam.H);
}
return{corners,cam,in_frame};
}


export function ghostDistance(observed,ghost){
const g=ghost.corners??ghost;
const per=[];
for(let i=0;i<4;i++){
const o=observed[i];
per.push(o&&g[i]?Math.hypot(o[0]-g[i][0],o[1]-g[i][1]):NaN);
}
const max_px=per.some((x)=>!Number.isFinite(x))?NaN:Math.max(...per);
const rms_px=Math.sqrt(per.reduce((s,x)=>s+x*x,0)/4);
return{max_px,rms_px,per_corner_px:per};
}
