






export const LAB_LINE_IDS=Object.freeze(['head_box','spine','shoulders','hip_walls','butt_line','stance',
'ball_hand_plane','ball_shoulder_plane','target_line']);
export const LAB_SENSITIVITIES=Object.freeze(['standard','relaxed']);
export const LAB_DEFAULTS=Object.freeze({lines:LAB_LINE_IDS,dynamic:false,sensitivity:'standard'});


export function normalizeLab(raw){
const s=raw!==null&&typeof raw==='object'?raw:{};
return{
lines:Array.isArray(s.lines)?LAB_LINE_IDS.filter((id)=>s.lines.includes(id)):[...LAB_DEFAULTS.lines],
dynamic:typeof s.dynamic==='boolean'?s.dynamic:LAB_DEFAULTS.dynamic,
sensitivity:LAB_SENSITIVITIES.includes(s.sensitivity)?s.sensitivity:LAB_DEFAULTS.sensitivity,
};
}
