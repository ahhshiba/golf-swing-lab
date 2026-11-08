


import{displacement,spineTilt,turn,handPlaneDev,topShaftAngle,finalize}from'./pose.js';

export function computeDtl(ctx,cells){
const out={};
const run=(id,fn)=>{if(cells[id])out[id]=finalize(id,cells[id],fn(cells[id]));};
run('head_lift_z_m',(lv)=>displacement(ctx,lv,[7,8],'impact',2,+1));
run('head_depth_y_m',(lv)=>displacement(ctx,lv,[7,8],'impact',1,-1));
run('spine_forward_tilt_deg',(lv)=>spineTilt(ctx,lv,'forward'));
run('shoulder_turn_deg',(lv)=>turn(ctx,lv,11,12));
run('hip_turn_deg',(lv)=>turn(ctx,lv,23,24));
run('hand_plane_dev_m',(lv)=>handPlaneDev(ctx,lv));
run('top_shaft_angle_deg',(lv)=>topShaftAngle(ctx,lv));
run('early_extension_m',(lv)=>displacement(ctx,lv,[23,24],'impact',1,-1));
return out;
}
