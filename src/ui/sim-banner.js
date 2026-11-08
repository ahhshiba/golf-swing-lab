






import{h,clear}from'./dom.js';
import*as C from'./components.js';
import{t}from'../i18n/index.js';
import{convert,fmtQuantity,unitLabel}from'../i18n/units.js';
import{fmtNum}from'../i18n/index.js';
import{clubName}from'./glossary.js';







export function honestDistance(m,half,units){
const q=fmtQuantity(m,'distance',units);
if(!(typeof half==='number'&&half>0)||!(typeof m==='number'&&Number.isFinite(m))||q.unit==='')return{text:q.text,range:false,value:q.value,pm:null,unit:q.unit};
const du=units?.distance==='m'?'m':'yd';
const v=convert(m,'m',du),hd=convert(half,'m',du);
const step=Math.max(1,10**(Math.floor(Math.log10(hd))-1));
const r=(x)=>Math.round(x/step)*step;
const unit=unitLabel(du);
const value=fmtNum(r(v)),pm=fmtNum(Math.max(step,r(hd)));
if(hd/v>0.3){
const lo=fmtNum(Math.max(0,r(v-hd))),hi=fmtNum(r(v+hd));
return{text:`${lo}–${hi} ${unit}`,range:true,value,pm,lo,hi,unit};
}
return{text:`${value} ± ${pm} ${unit}`,range:false,value,pm,unit};
}








export function mountSimBanner(el,app,ctx,opts={}){
const mode=opts.mode??'live';
let last=null;
let dead=false;
const box=h('section.sim-banner',{'data-testid':'sim-banner','data-mode':mode,role:'region','aria-label':t('sim.banner.label')});
el.append(box);

const line=()=>(ctx?t('sim.banner.line',{n:ctx.hole,stroke:ctx.stroke_n,club:clubName(ctx.club),name:ctx.name??''}):t('sim.none.title'));

function paint(){
if(dead)return;
const parts=[h('p.sb-line',{},C.icon('flag'),h('span',line()))];
if(!ctx){
clear(box,...parts);
return;
}
if(mode==='import'){
parts.push(h('p.hint.sb-hint',t('sim.banner.import')));
}else if(!last){
parts.push(h('p.hint.sb-hint',t('sim.banner.wait')));
}else{
const m=last.metrics?.carry_m;
const half=Array.isArray(m?.ci95)&&m.ci95.every(Number.isFinite)?(m.ci95[1]-m.ci95[0])/2:Number.isFinite(m?.sigma)?1.96*m.sigma:null;
const f=m&&typeof m.value==='number'?honestDistance(m.value,half,app.units()):null;

parts.push(h('div.sb-read-row',{},C.validityTag(m?.validity??'low_confidence'),h('span.sb-sub',t('sim.quick_tag'))),
h('p.sb-read',{'data-testid':'sim-banner-read','data-range':f?.range?'1':'0'},
f?t(f.range?'sim.banner.read_range':'sim.banner.read',{d:f.text,about:f.range?`${f.value} ${f.unit}`:''}):t('sim.banner.read_none')),
h('div.sb-actions',{},
C.button({label:t('sim.use_shot'),variant:'primary',size:'lg',testid:'sim-banner-use',onClick:use}),
C.button({label:t('sim.retake'),size:'lg',testid:'sim-banner-retake',onClick:()=>{last=null;paint();}})));
}
clear(box,...parts);
}

function use(){
if(!last||!ctx)return;
const result={...last,view:last.view??ctx.view??app.current?.view??null};
last=null;
paint();
app.sim.submit({kind:'quick',result});
app.nav.back();
}

paint();
return{
quick(r){
if(dead||!r)return;
last=r;
paint();
},
destroy(){
dead=true;
box.remove();
},
};
}



export function simImport(el,app){
const b=mountSimBanner(el,app,app.sim.active(),{mode:'import'});
el.use=(shot)=>{
app.sim.submit({kind:'shot',shot});
app.nav.back();
};
return b;
}
