








import{CLUBS}from'../session/settings.js';


export const GLYPHS=Object.freeze(['circle','square','triangle','diamond','down','plus','cross','ring']);

const CLUB_ORDER=CLUBS.map((c)=>c[0]);






export function seriesIndex(club,series){
if(Number.isInteger(series))return((series%8)+8)%8;
const type=typeof club==='string'?club:club?.type;
const i=CLUB_ORDER.indexOf(type);
if(i>=0)return i;
const s=String(type??'').toLowerCase();
const iron=/^(\d)i$/.exec(s);
if(iron)return+iron[1]<=5?3:+iron[1]<=7?4:5;
if(/w$/.test(s)&&/^\d/.test(s))return 1;
if(/^\d?h|hybrid|ut/.test(s))return 2;
if(/^(gw|aw|\d\d)/.test(s))return 6;
if(/^lw/.test(s))return 7;
return 7;
}

function luminance(c){
const s=String(c).trim();
let rgb=null;
const h=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
if(h){
const x=h[1].length===3?h[1].split('').map((d)=>d+d).join(''):h[1];
rgb=[0,2,4].map((k)=>parseInt(x.slice(k,k+2),16));
}else{
const m=/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
if(m)rgb=[m[1],m[2],m[3]].map(Number);
}
if(!rgb)return null;
const[r,g,b]=rgb.map((v)=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});
return 0.2126*r+0.7152*g+0.0722*b;
}


export function vizPalette(el){
const view=el?.ownerDocument?.defaultView??globalThis;
let cs=null;
try{cs=view.getComputedStyle?view.getComputedStyle(el):null;}catch(_){cs=null;}
const fallback=(cs&&cs.color)||'gray';
const get=(name)=>{
const v=cs?String(cs.getPropertyValue(name)??'').trim():'';
return v||fallback;
};
const series=[];
for(let i=1;i<=8;i++)series.push(get(`--viz-series-${i}`));
const alphaRaw=cs?parseFloat(cs.getPropertyValue('--viz-ci-alpha')):NaN;
const bg=get('--viz-bg');
const lum=luminance(bg);
const fam=cs?String(cs.getPropertyValue('--font')||cs.fontFamily||'').trim():'';
return Object.freeze({
series:Object.freeze(series),
seriesGlyph:GLYPHS,
axis:get('--viz-axis'),
grid:get('--viz-grid'),
text:get('--viz-text'),
target:get('--viz-target'),
ciAlpha:Number.isFinite(alphaRaw)?Math.min(1,Math.max(0,alphaRaw)):0.16,
tracer:get('--viz-tracer'),
halo:get('--viz-tracer-halo'),
bg,
ink:get('--text'),
font:fam||'system-ui, sans-serif',
dark:lum!==null&&lum<0.2,
});
}
