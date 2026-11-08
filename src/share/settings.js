






export const TRAIL_IDS=Object.freeze(Array.from({length:8},(_,i)=>`trail-${i+1}`));
export const SHARE_LAYOUTS=Object.freeze(['portrait','landscape']);
export const SHARE_DEFAULTS=Object.freeze({
ballColour:'trail-1',clubColour:'trail-4',layout:'portrait',card:true,lines:false,faceMask:false,appMark:false,
});


export function normalizeShare(raw){
const s=raw!==null&&typeof raw==='object'?raw:{};
const out={
ballColour:TRAIL_IDS.includes(s.ballColour)?s.ballColour:SHARE_DEFAULTS.ballColour,
clubColour:TRAIL_IDS.includes(s.clubColour)?s.clubColour:SHARE_DEFAULTS.clubColour,
layout:SHARE_LAYOUTS.includes(s.layout)?s.layout:SHARE_DEFAULTS.layout,
};
if(out.clubColour===out.ballColour){
out.clubColour=out.ballColour!==SHARE_DEFAULTS.clubColour?SHARE_DEFAULTS.clubColour:TRAIL_IDS.find((id)=>id!==out.ballColour);
}
for(const k of['card','lines','faceMask','appMark'])out[k]=typeof s[k]==='boolean'?s[k]:SHARE_DEFAULTS[k];
return out;
}
