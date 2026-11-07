







import{RC}from'../contract/reason-codes.js';
import{METRIC_IDS,METRIC_UNITS,METRIC_DEFAULT_ORIGIN}from'../contract/enums.js';
import{fpsAtLeast}from'../geom/constants.js';

const V='valid';
const E='estimated';
const LO='low_confidence';
const N='not';
const views=(face_on,dtl,high_behind)=>Object.freeze({face_on,dtl,high_behind});


const HB240=Object.freeze({high_behind:240});
const ROWS=[
['backswing_s',1,views(V,V,V),30,null],
['downswing_s',1,views(V,V,V),30,null],
['tempo_ratio',1,views(V,V,V),30,null],
['head_sway_x_m',2,views(V,N,LO),30,RC.VIEW_DEPTH_AXIS],
['head_lift_z_m',3,views(V,V,N),30,RC.VIEW_DEPTH_AXIS],
['head_depth_y_m',4,views(N,V,LO),30,RC.VIEW_DEPTH_AXIS],
['spine_forward_tilt_deg',5,views(N,V,N),30,RC.VIEW_PLANE_MISMATCH],
['spine_side_tilt_deg',6,views(V,N,N),30,RC.VIEW_PLANE_MISMATCH],
['shoulder_turn_deg',7,views(LO,LO,LO),30,null],
['hip_turn_deg',8,views(LO,LO,LO),30,null],
['x_factor_deg',9,views(LO,LO,LO),30,null],
['hand_plane_dev_m',10,views(N,V,N),30,RC.VIEW_PLANE_MISMATCH],
['top_shaft_angle_deg',11,views(N,E,N),120,RC.VIEW_PLANE_MISMATCH],
['weight_shift_pct',12,views(E,N,N),30,RC.VIEW_DEPTH_AXIS],
['early_extension_m',13,views(N,V,N),30,RC.VIEW_DEPTH_AXIS],


['club_speed_mps',14,views(LO,N,LO),30,RC.VIEW_DEPTH_AXIS,
{fpsTiers:{face_on:[{minFps:240,validity:E}]},minFpsByView:HB240,runtimeCodes:[RC.TRACK_MAY_BE_SHORT]}],
['club_path_deg',15,views(N,N,LO),240,RC.VIEW_PLANE_MISMATCH,
{runtimeCodes:[RC.TRACK_TOO_SHORT]}],

['ball_speed_mps',16,views(E,N,LO),200,RC.VIEW_DEPTH_AXIS,
{minFpsByView:HB240,depends:{high_behind:['club_speed_mps']},runtimeCodes:[RC.SMASH_ASSUMED]}],
['launch_v_deg',17,views(E,N,N),200,RC.VIEW_DEPTH_AXIS],
['launch_h_deg',18,views(N,N,LO),200,RC.LAUNCH_DIR_UNOBSERVABLE],

['carry_m',19,views(E,N,LO),200,RC.DEPENDS_ON_NULL,
{depends:['ball_speed_mps','launch_v_deg'],minFpsByView:HB240,
runtimeCodes:[RC.FLIGHT_MODELLED,RC.SPIN_MODELLED,RC.SPIN_ASSUMED,RC.WIND_IGNORED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED]}],
['smash_factor',20,views(E,N,N),240,RC.DEPENDS_ON_NULL,
{depends:['club_speed_mps','ball_speed_mps']}],


['attack_angle_deg',21,views(LO,N,N),240,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.VIEW_PLANE_MISMATCH},runtimeCodes:[RC.TRACK_TOO_SHORT]}],
['dynamic_loft_deg',22,views(E,N,N),240,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.DEPENDS_ON_NULL},depends:['attack_angle_deg','launch_v_deg'],runtimeCodes:[RC.DPLANE_MODEL]}],
['face_angle_deg',23,views(N,N,LO),240,RC.LAUNCH_DIR_UNOBSERVABLE,
{depends:['launch_h_deg','club_path_deg'],runtimeCodes:[RC.DPLANE_MODEL,RC.SPIN_LOFT_ASSUMED]}],
['face_to_path_deg',24,views(N,N,LO),240,RC.LAUNCH_DIR_UNOBSERVABLE,
{depends:['launch_h_deg','club_path_deg'],runtimeCodes:[RC.DPLANE_MODEL,RC.SPIN_LOFT_ASSUMED]}],
['spin_loft_deg',25,views(E,N,N),240,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.DEPENDS_ON_NULL},depends:['attack_angle_deg','dynamic_loft_deg'],runtimeCodes:[RC.DPLANE_MODEL]}],
['spin_rate_rpm',26,views(E,N,N),240,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.DEPENDS_ON_NULL},depends:['spin_loft_deg','club_speed_mps'],runtimeCodes:[RC.SPIN_MODELLED]}],
['spin_axis_deg',27,views(N,N,LO),240,RC.LAUNCH_DIR_UNOBSERVABLE,
{depends:['face_to_path_deg'],runtimeCodes:[RC.DPLANE_MODEL,RC.SPIN_LOFT_ASSUMED]}],
['total_m',28,views(E,N,LO),200,RC.DEPENDS_ON_NULL,
{depends:['carry_m'],minFpsByView:HB240,runtimeCodes:[RC.ROLL_MODELLED,RC.FLIGHT_MODELLED,RC.SPIN_MODELLED,RC.WIND_IGNORED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED]}],
['carry_side_m',29,views(N,N,LO),240,RC.LAUNCH_DIR_UNOBSERVABLE,
{depends:['launch_h_deg','spin_axis_deg'],runtimeCodes:[RC.DPLANE_MODEL,RC.FLIGHT_MODELLED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED]}],
['total_side_m',30,views(N,N,LO),240,RC.LAUNCH_DIR_UNOBSERVABLE,
{depends:['carry_side_m'],runtimeCodes:[RC.DPLANE_MODEL,RC.FLIGHT_MODELLED,RC.ROLL_MODELLED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED]}],
['curve_m',31,views(N,N,LO),240,RC.LAUNCH_DIR_UNOBSERVABLE,
{depends:['carry_side_m'],runtimeCodes:[RC.DPLANE_MODEL,RC.FLIGHT_MODELLED,RC.SMASH_ASSUMED,RC.LAUNCH_V_ASSUMED]}],
['apex_m',32,views(E,N,N),200,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.LAUNCH_V_ASSUMED},depends:['ball_speed_mps','launch_v_deg'],runtimeCodes:[RC.FLIGHT_MODELLED]}],
['landing_angle_deg',33,views(E,N,N),200,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.LAUNCH_V_ASSUMED},depends:['ball_speed_mps','launch_v_deg'],runtimeCodes:[RC.FLIGHT_MODELLED]}],
['hang_time_s',34,views(E,N,N),200,RC.VIEW_DEPTH_AXIS,
{nullCodes:{high_behind:RC.LAUNCH_V_ASSUMED},depends:['ball_speed_mps','launch_v_deg'],runtimeCodes:[RC.FLIGHT_MODELLED]}],
];






export const REGISTRY=Object.freeze(Object.fromEntries(ROWS.map(([id,row,vs,minFps,nullCode,extra])=>[
id,
Object.freeze({
id,row,unit:METRIC_UNITS[id],value_origin:METRIC_DEFAULT_ORIGIN[id],views:vs,minFps,nullCode,
...(extra??{}),
}),
])));

if(ROWS.length!==METRIC_IDS.length||!METRIC_IDS.every((id)=>REGISTRY[id])){
throw new Error('metrics/registry: ids out of sync with contract METRIC_IDS');
}


export const POSE_METRIC_IDS=Object.freeze(METRIC_IDS.filter((id)=>REGISTRY[id].row<=13));

export const LM_ROW_IDS=Object.freeze(METRIC_IDS.filter((id)=>REGISTRY[id].row>=21));


export function nullCodeFor(id,view){
const r=REGISTRY[id];
if(!r)throw new RangeError(`unknown metric id '${id}'`);
return r.nullCodes?.[view]??r.nullCode;
}


export function minFpsFor(id,view){
const r=REGISTRY[id];
if(!r)throw new RangeError(`unknown metric id '${id}'`);
return r.minFpsByView?.[view]??r.minFps;
}






export function cellFor(id,view,fps){
const r=REGISTRY[id];
if(!r)throw new RangeError(`unknown metric id '${id}'`);
const base=r.views[view];
if(base===undefined)throw new RangeError(`unknown view '${view}'`);
if(base===N)return{validity:null,code:r.nullCodes?.[view]??r.nullCode};
if(!fpsAtLeast(fps,r.minFpsByView?.[view]??r.minFps))return{validity:null,code:RC.FPS_TOO_LOW};
let validity=base;
for(const tier of r.fpsTiers?.[view]??[])if(fpsAtLeast(fps,tier.minFps))validity=tier.validity;
return{validity,code:null};
}


export function viewsFor(id){
const r=REGISTRY[id];
return Object.keys(r.views).filter((v)=>r.views[v]!==N);
}
