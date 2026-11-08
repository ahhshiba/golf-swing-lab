
























import{RC}from'../contract/reason-codes.js';

const f=(o)=>Object.freeze(o);
const DEPTH=RC.VIEW_DEPTH_AXIS;
const PLANE=RC.VIEW_PLANE_MISMATCH;

export const LAB_PARAMS=f({
version:'lab-1.2.0',
relaxedFactor:1.5,

sigmaLevel:'valid',


handMotionSigma:0.015,
faults:f({
early_extension:f({views:f({dtl:30}),viewCode:f({face_on:DEPTH,high_behind:DEPTH}),
source:'metric:early_extension_m',op:'>',threshold:0.05,neutral:0,unit:'m',event:'impact',sysSigma:f({dtl:0.010})}),
loss_of_posture:f({views:f({dtl:30}),viewCode:f({face_on:PLANE,high_behind:PLANE}),
source:'lab:forward_tilt_change',op:'<',threshold:-8,neutral:0,unit:'deg',event:'impact'}),



over_the_top:f({views:f({dtl:30,high_behind:240}),viewCode:f({face_on:PLANE}),
source:f({dtl:'lab:hand_path_transition',high_behind:'metric:club_path_deg'}),
op:f({dtl:'>',high_behind:'<'}),threshold:f({dtl:0.05,high_behind:-4}),neutral:0,
unit:f({dtl:'m',high_behind:'deg'}),event:f({dtl:'mid_downswing',high_behind:'impact'})}),
sway:f({views:f({face_on:30}),viewCode:f({dtl:DEPTH,high_behind:DEPTH}),
source:'lab:pelvis_sway_top',op:'>',threshold:0.06,neutral:0,unit:'m',event:'top'}),
slide:f({views:f({face_on:30}),viewCode:f({dtl:DEPTH,high_behind:DEPTH}),
source:'lab:pelvis_past_lead_ankle',op:'>',threshold:0.03,neutral:0,unit:'m',event:'impact'}),
reverse_spine:f({views:f({face_on:30}),viewCode:f({dtl:PLANE,high_behind:PLANE}),
source:'lab:side_tilt_top',op:'<',threshold:-5,neutral:0,unit:'deg',event:'top'}),
head_dip:f({views:f({face_on:30,dtl:30}),viewCode:f({high_behind:DEPTH}),
source:'metric:head_lift_z_m',op:'<',threshold:-0.05,neutral:0,unit:'m',event:'impact',sysSigma:f({face_on:0.007,dtl:0.013})}),
early_rise:f({views:f({face_on:30,dtl:30}),viewCode:f({high_behind:DEPTH}),
source:'metric:head_lift_z_m',op:'>',threshold:0.06,neutral:0,unit:'m',event:'impact',sysSigma:f({face_on:0.007,dtl:0.013})}),




weight_back:f({views:f({face_on:30}),viewCode:f({dtl:DEPTH,high_behind:DEPTH}),
source:'metric:weight_shift_pct',op:'<',threshold:0,neutral:25,unit:'%',event:'impact'}),



overswing:f({views:f({dtl:120}),viewCode:f({face_on:PLANE,high_behind:PLANE}),disabled:RC.NOT_IMPLEMENTED,
source:'metric:top_shaft_angle_deg',op:'>',threshold:10,neutral:0,unit:'deg',event:'top'}),
tempo_off:f({views:f({face_on:30,dtl:30,high_behind:30}),viewCode:f({}),
source:'metric:tempo_ratio',op:'outside',threshold:f([2.4,3.6]),neutral:3,unit:'',event:null}),
}),
});


export const FAULT_IDS=Object.freeze(Object.keys(LAB_PARAMS.faults));


export function perView(v,view){
return v!==null&&typeof v==='object'&&!Array.isArray(v)?(v[view]??null):v;
}





export function ruleFor(id,view,sensitivity='standard'){
const r=LAB_PARAMS.faults[id];
if(!r)throw new RangeError(`unknown fault '${id}'`);
const minFps=r.views[view]??null;
const source=perView(r.source,view)??perView(r.source,Object.keys(r.views)[0]);
const[kind,key]=source.split(':');
const k=sensitivity==='relaxed'?LAB_PARAMS.relaxedFactor:1;
const scale=(x)=>r.neutral+(x-r.neutral)*k;
const raw=perView(r.threshold,view)??perView(r.threshold,Object.keys(r.views)[0]);
const threshold=Array.isArray(raw)?[scale(raw[0]),scale(raw[1])]:scale(raw);
return{
id,view,allowed:minFps!==null,minFps,disabled:r.disabled??null,viewCode:r.viewCode[view]??null,source,kind,key,
op:perView(r.op,view)??perView(r.op,Object.keys(r.views)[0]),threshold,
unit:perView(r.unit,view)??perView(r.unit,Object.keys(r.views)[0])??'',
event:minFps===null?null:perView(r.event,view),
sysSigma:perView(r.sysSigma??null,view)??0,
};
}
