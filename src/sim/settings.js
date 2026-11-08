








export const SIM_OPTIONS=Object.freeze({
unobservedSide:Object.freeze(['sample','center']),
putting:Object.freeze(['auto','manual']),
puttSkill:Object.freeze([0,10,20,30]),
ob:Object.freeze(['drop_2','stroke_distance']),
maxScore:Object.freeze(['double_par','none']),
tees:Object.freeze(['forward','middle','back']),
});
export const SIM_DEFAULTS=Object.freeze({
unobservedSide:'sample',putting:'auto',puttSkill:20,ob:'drop_2',maxScore:'double_par',autoChipM:0,flyover:true,tees:'middle',
});
export const MANUAL_FEEDS_GAPPING=false;
export const AUTO_CHIP_RANGE_M=Object.freeze([10,40]);


export function normalizeSim(raw){
const s=raw!==null&&typeof raw==='object'?raw:{};
const out={};
for(const[k,list]of Object.entries(SIM_OPTIONS))out[k]=list.includes(s[k])?s[k]:SIM_DEFAULTS[k];
const c=s.autoChipM;
out.autoChipM=typeof c==='number'&&Number.isFinite(c)&&c>0?Math.min(AUTO_CHIP_RANGE_M[1],Math.max(AUTO_CHIP_RANGE_M[0],c)):0;
out.flyover=typeof s.flyover==='boolean'?s.flyover:SIM_DEFAULTS.flyover;
return out;
}
