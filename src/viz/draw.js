
















import{t}from'../i18n/index.js';

export const YD_PER_M=1.09361;

export let FS=1;

export function setup(canvas,palette){
FS=1;
try{
const d=canvas.ownerDocument;
const px=d?parseFloat((d.defaultView??globalThis).getComputedStyle(d.documentElement).fontSize):NaN;
if(px>0)FS=Math.min(2.5,Math.max(1,px/16));
}catch(_){ }
const cw=canvas.clientWidth;
const ch=canvas.clientHeight;
let k=1;
if(cw>0&&ch>0){
k=Math.min(3,Math.max(1,globalThis.devicePixelRatio||1));
const W=Math.round(cw*k);
const H=Math.round(ch*k);
if(canvas.width!==W)canvas.width=W;
if(canvas.height!==H)canvas.height=H;
}
const ctx=canvas.getContext('2d');
ctx.setTransform(k,0,0,k,0,0);
ctx.setLineDash([]);
ctx.globalAlpha=1;
ctx.lineCap='round';
ctx.lineJoin='round';
const w=cw>0?cw:canvas.width;
const h=ch>0?ch:canvas.height;
if(palette){
ctx.fillStyle=palette.bg;
ctx.fillRect(0,0,w,h);
}else ctx.clearRect(0,0,w,h);
return{ctx,w,h,k};
}

export function distUnit(units){
const yd=(units?.distance??'yd')!=='m';
return{f:yd?YD_PER_M:1,key:yd?'yd':'m'};
}

export const unitText=(key)=>t(`unit.${key}`);

export function niceStep(span,maxTicks=5){
const raw=Math.max(span,1e-9)/Math.max(1,maxTicks);
const p=10**Math.floor(Math.log10(raw));
for(const m of[1,2,2.5,5,10])if(m*p>=raw)return m*p;
return 10*p;
}

export const lerpScale=(d0,d1,r0,r1)=>(x)=>r0+((x-d0)/((d1-d0)||1))*(r1-r0);

export function dash(ctx,validity){
ctx.setLineDash(validity==='low_confidence'?[6,4]:validity==='simulated'?[1.5,4]:[]);
}

export function text(ctx,s,x,y,o={}){
ctx.font=`${o.weight??500} ${(o.size??11)*FS}px ${o.font??'system-ui, sans-serif'}`;
ctx.textAlign=o.align??'left';
ctx.textBaseline=o.base??'alphabetic';
if(o.halo){
ctx.lineWidth=3;
ctx.strokeStyle=o.halo;
ctx.strokeText(s,x,y);
}
ctx.fillStyle=o.colour;
ctx.fillText(s,x,y);
}

export function glyph(ctx,kind,x,y,r,colour,bg){
ctx.setLineDash([]);
ctx.beginPath();
const open=kind==='plus'||kind==='cross'||kind==='ring';
switch(kind){
case'square':ctx.rect(x-r*0.85,y-r*0.85,r*1.7,r*1.7);break;
case'triangle':ctx.moveTo(x,y-r*1.1);ctx.lineTo(x+r,y+r*0.75);ctx.lineTo(x-r,y+r*0.75);ctx.closePath();break;
case'down':ctx.moveTo(x,y+r*1.1);ctx.lineTo(x+r,y-r*0.75);ctx.lineTo(x-r,y-r*0.75);ctx.closePath();break;
case'diamond':ctx.moveTo(x,y-r*1.2);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r*1.2);ctx.lineTo(x-r,y);ctx.closePath();break;
case'plus':ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.moveTo(x,y-r);ctx.lineTo(x,y+r);break;
case'cross':{const d=r*0.8;ctx.moveTo(x-d,y-d);ctx.lineTo(x+d,y+d);ctx.moveTo(x+d,y-d);ctx.lineTo(x-d,y+d);break;}
default:ctx.arc(x,y,kind==='ring'?r*0.85:r,0,Math.PI*2);
}
if(open){
if(bg){ctx.lineWidth=4.5;ctx.strokeStyle=bg;ctx.stroke();}
ctx.lineWidth=2;
ctx.strokeStyle=colour;
ctx.stroke();
}else{
if(bg){ctx.lineWidth=3;ctx.strokeStyle=bg;ctx.stroke();}
ctx.fillStyle=colour;
ctx.fill();
}
}

export function thin(list,max=200){
const a=Array.isArray(list)?list.filter(Boolean):[];
if(a.length<=max)return{list:a,sampled:false};
const out=[];
for(let i=0;i<max;i++)out.push(a[Math.floor((i*a.length)/max)]);
return{list:out,sampled:true};
}


export function ticks(d0,d1,maxTicks){
const s=niceStep(d1-d0,maxTicks);
const out=[];
for(let v=Math.ceil(d0/s-1e-9)*s;v<=d1+1e-9;v+=s)out.push(Math.abs(v)<1e-9?0:v);
return{step:s,list:out};
}

export const finite=(x)=>typeof x==='number'&&Number.isFinite(x);


export const TITLE_B=34;


export function axisTitleX(ctx,P,box,s){
if(s)text(ctx,s,(box.l+box.r)/2,box.b+28*FS,{colour:P.text,align:'center',font:P.font,size:11,weight:600});
}


export function axisTitleY(ctx,P,box,s){
if(s)text(ctx,s,4,box.t-4*FS-4,{colour:P.text,align:'left',font:P.font,size:11,weight:600});
}


export function tickText(ctx,P,s,x,y,w){
ctx.font=`500 ${11*FS}px ${P.font}`;
const half=ctx.measureText(s).width/2;
text(ctx,s,Math.min(w-half-2,Math.max(half+2,x)),y,{colour:P.text,align:'center',font:P.font,size:11});
}
