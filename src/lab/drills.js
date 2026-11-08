











import{LAB_PARAMS}from'./params.js';







const d=(id,fault,view,metric,success)=>Object.freeze({id,fault,view,metric,success:Object.freeze({n:8,of:10,...success})});

export const LAB_DRILLS=Object.freeze([
d('ee_wall','early_extension','dtl','early_extension_m',{below:0.05}),
d('ee_chair','early_extension','dtl','early_extension_m',{below:0.05}),
d('posture_hold','loss_of_posture','dtl','head_lift_z_m',{below:0.06}),


d('ott_pump','over_the_top','dtl','hand_plane_dev_m',{clear:'over_the_top'}),
d('ott_gate','over_the_top','high_behind','club_path_deg',{above:-4}),
d('sway_wall','sway','face_on','head_sway_x_m',{above:-0.06}),
d('sway_feet','sway','face_on','head_sway_x_m',{above:-0.06}),
d('slide_post','slide','face_on','weight_shift_pct',{below:60}),
d('spine_stack','reverse_spine','face_on','head_sway_x_m',{below:0.04}),
d('dip_level','head_dip','face_on','head_lift_z_m',{above:-0.05}),
d('rise_hold','early_rise','dtl','head_lift_z_m',{below:0.06}),

d('weight_step','weight_back','face_on','weight_shift_pct',{above:10,below:45}),
d('three_quarter','overswing','dtl','top_shaft_angle_deg',{below:10}),
d('tempo_count','tempo_off','face_on','tempo_ratio',{above:2.4,below:3.6}),
d('tempo_pause','tempo_off','dtl','tempo_ratio',{above:2.4,below:3.6}),
]);


const live=(x)=>!LAB_PARAMS.faults[x.fault]?.disabled;
export const drillsFor=(faultId)=>LAB_DRILLS.filter((x)=>x.fault===faultId&&live(x));
export const drillsForView=(view)=>LAB_DRILLS.filter((x)=>(x.view===view||x.fault==='tempo_off')&&live(x));
export const drillById=(id)=>LAB_DRILLS.find((x)=>x.id===id)??null;
