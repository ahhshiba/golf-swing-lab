








export const PLAYER_TOKENS=Object.freeze(['--trail-1','--trail-4','--trail-3','--trail-5']);


export function coursePalette(el){
const view=el?.ownerDocument?.defaultView??globalThis;
let cs=null;
try{cs=view.getComputedStyle?view.getComputedStyle(el):null;}catch(_){cs=null;}
const fallback=(cs&&cs.color)||'gray';
const get=(name)=>{
const v=cs?String(cs.getPropertyValue(name)??'').trim():'';
return v||fallback;
};
const outline=get('--course-outline');
const fam=cs?String(cs.getPropertyValue('--font')||cs.fontFamily||'').trim():'';
return Object.freeze({
fairway:get('--course-fairway'),
rough:get('--course-rough'),
green:get('--course-green'),
bunker:get('--course-bunker'),
water:get('--course-water'),
tree:get('--course-tree'),
ob:get('--course-ob'),
pin:get('--course-pin'),
outline,

outlined:outline!=='transparent'&&outline!==fallback&&!/^rgba\(0, 0, 0, 0\)$/.test(outline),
halo:get('--media-bg'),
players:Object.freeze(PLAYER_TOKENS.map(get)),
aim:get('--trail-6'),
ellipse:get('--trail-7'),
text:get('--trail-6'),
font:fam||'system-ui, sans-serif',
});
}
