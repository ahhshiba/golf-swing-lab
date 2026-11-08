










import{EVENTS}from'../contract/enums.js';
import{shownFaults}from'./faults.js';

export const PHASE_METRICS=Object.freeze({
address:Object.freeze(['spine_forward_tilt_deg','spine_side_tilt_deg']),
toe_up:Object.freeze([]),
mid_backswing:Object.freeze([]),
top:Object.freeze(['backswing_s','shoulder_turn_deg','hip_turn_deg','x_factor_deg','hand_plane_dev_m','top_shaft_angle_deg','head_sway_x_m']),
mid_downswing:Object.freeze(['downswing_s']),
impact:Object.freeze(['head_lift_z_m','head_depth_y_m','weight_shift_pct','early_extension_m','club_speed_mps','club_path_deg']),
mid_follow_through:Object.freeze([]),
finish:Object.freeze(['tempo_ratio']),
});
const WHOLE_SWING_PHASE='finish';

const has=(m)=>m&&Number.isFinite(m.value);

export function phaseCards(shot,labRecord){
const ev=shot?.events??{};
const shown=shownFaults(labRecord);
return EVENTS.map((event)=>{
const e=ev[event];
return{
event,
frame:Number.isFinite(e?.frame)?e.frame:null,
t_s:Number.isFinite(e?.t_s)?e.t_s:null,
metrics:PHASE_METRICS[event].filter((id)=>has(shot?.metrics?.[id])),
faults:shown.filter((f)=>(f.event??WHOLE_SWING_PHASE)===event),
};
});
}

export function faultMarks(shot,labRecord){
const ev=shot?.events??{};
return shownFaults(labRecord)
.map((f)=>({id:f.id,event:f.event,status:f.status,frame:f.event&&Number.isFinite(ev[f.event]?.frame)?ev[f.event].frame:null}))
.filter((m)=>m.frame!==null)
.sort((a,b)=>a.frame-b.frame||a.id.localeCompare(b.id));
}

export function stepFault(marks,frame,dir){
if(!marks?.length)return null;
if(dir>0)return marks.find((m)=>m.frame>frame)??null;
for(let i=marks.length-1;i>=0;i--)if(marks[i].frame<frame)return marks[i];
return null;
}
