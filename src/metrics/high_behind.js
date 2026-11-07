





import{displacement,turn,finalize}from'./pose.js';

export function computeHighBehind(ctx,cells){
const out={};
const run=(id,fn)=>{if(cells[id])out[id]=finalize(id,cells[id],fn(cells[id]));};
run('head_sway_x_m',(lv)=>displacement(ctx,lv,[7,8],'top',0,+1,'zplane'));
run('head_depth_y_m',(lv)=>displacement(ctx,lv,[7,8],'impact',1,-1,'zplane'));
run('shoulder_turn_deg',(lv)=>turn(ctx,lv,11,12));
run('hip_turn_deg',(lv)=>turn(ctx,lv,23,24));
return out;
}
