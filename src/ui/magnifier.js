








import{h}from'./dom.js';
import{icon}from'./components.js';
import{t}from'../i18n/index.js';
import{refineCorners}from'../calib/mat.js';

const ZOOM=2;
const LOUPE_CSS=132;
const REPEAT_DELAY_MS=400;
const REPEAT_EVERY_MS=70;

export function overlayColour(name,fallback){
try{return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;}catch(_){return fallback;}
}


export function snapshot(source,W,H){
const c=document.createElement('canvas');
c.width=W;
c.height=H;
c.getContext('2d').drawImage(source,0,0,W,H);
return c;
}


export function grayOf(canvas){
const{width:W,height:H}=canvas;
const px=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data;
const data=new Uint8Array(W*H);
for(let i=0,j=0;i<data.length;i++,j+=4)data[i]=(px[j]*77+px[j+1]*150+px[j+2]*29)>>8;
return{data,W,H};
}

export function createCornerPicker({onChange=()=>{},ghost=null}={}){
let frame=null;
let corners=[null,null,null,null];
let active=-1;
let sel=0;
let big=false;
let ghostPts=ghost;
let edge=null;
const promptId=`picker-prompt-${Math.random().toString(36).slice(2,8)}`;
const view=h('canvas.picker-canvas',{tabindex:'0',role:'application','aria-label':t('setup.picker.canvas'),'aria-describedby':promptId});
const loupe=h('canvas.loupe',{width:LOUPE_CSS*2,height:LOUPE_CSS*2,hidden:true,'aria-hidden':'true'});
const prompt=h('p.picker-prompt',{id:promptId,'aria-live':'polite'},'');
const cornerBtns=[0,1,2,3].map((i)=>h('button.corner-chip',{type:'button','data-corner':String(i),'aria-pressed':'false','aria-label':t('setup.picker.corner_select',{n:i+1,name:t(`setup.corner.${i}`)}),onclick:()=>api.select(i)},String(i+1)));
const arrow=(dir,dx,dy)=>{
const b=h('button.nudge',{type:'button','data-dir':dir,'aria-label':t(`setup.picker.nudge_${dir}`)},icon(dir==='left'?'chevron-left':dir==='right'?'chevron-right':'chevron-down'));
if(dir==='up')b.classList.add('flip');
let hold=0;
let rep=0;
const stop=()=>{clearTimeout(hold);clearInterval(rep);hold=0;rep=0;};
b.addEventListener('pointerdown',(e)=>{e.preventDefault();api.nudge(dx,dy);stop();hold=setTimeout(()=>{rep=setInterval(()=>api.nudge(dx,dy),REPEAT_EVERY_MS);},REPEAT_DELAY_MS);});
for(const ev of['pointerup','pointercancel','pointerleave'])b.addEventListener(ev,stop);
b.addEventListener('click',(e)=>{if(e.detail===0)api.nudge(dx,dy);});
return b;
};
const x10=h('button.nudge-x10',{type:'button','aria-pressed':'false',onclick:()=>{big=!big;x10.setAttribute('aria-pressed',big?'true':'false');}},t('setup.picker.x10'));
const nextBtn=h('button.nudge-next',{type:'button',onclick:()=>api.select((sel+1)%4)},t('setup.picker.next_corner'));
const fine=h('div.fine-adjust',{role:'group','aria-label':t('setup.picker.fine')},
h('div.corner-chips',{},cornerBtns),
h('div.nudge-pad',{},arrow('left',-1,0),arrow('up',0,-1),arrow('down',0,1),arrow('right',1,0)),
h('div.nudge-extra',{},x10,nextBtn));
const el=h('div.picker',{},h('div.picker-stage',{},view,loupe),prompt,fine);

function next(){return corners.findIndex((c)=>c===null);}

function updatePrompt(){
const i=active>=0?active:next();
if(i>=0)prompt.textContent=t('setup.picker.tap',{n:i+1,name:t(`setup.corner.${i}`)});
else prompt.textContent=t('setup.picker.adjust',{n:sel+1,name:t(`setup.corner.${sel}`)});
cornerBtns.forEach((b,j)=>{b.setAttribute('aria-pressed',j===sel?'true':'false');b.classList.toggle('set',Boolean(corners[j]));});
fine.hidden=!corners.some(Boolean);
}

function draw(){
if(!frame)return;
const ctx=view.getContext('2d');
ctx.drawImage(frame,0,0);
const s=Math.max(2,frame.width/480);
if(ghostPts)polygon(ctx,ghostPts,'rgba(255,255,255,0.9)',s,true);
if(corners.every(Boolean))polygon(ctx,corners,'rgba(0,200,120,0.95)',s,false);
corners.forEach((c,i)=>{
if(!c)return;
ctx.fillStyle=i===sel?overlayColour('--overlay-select','gold'):overlayColour('--overlay-go','green');
ctx.beginPath();
ctx.arc(c[0],c[1],(i===sel?6:5)*s,0,2*Math.PI);
ctx.fill();
ctx.lineWidth=s;
ctx.strokeStyle=overlayColour('--media-bg','black');
ctx.stroke();
ctx.fillStyle=overlayColour('--on-media','white');
ctx.strokeStyle=overlayColour('--media-bg','black');
ctx.lineWidth=3*s;
ctx.font=`bold ${12*s}px sans-serif`;
ctx.strokeText(String(i+1),c[0]+7*s,c[1]-7*s);
ctx.fillText(String(i+1),c[0]+7*s,c[1]-7*s);
});
}

function polygon(ctx,pts,color,s,dashed){
if(pts.some((p)=>!p))return;
ctx.save();
ctx.strokeStyle=color;
ctx.lineWidth=1.5*s;
if(dashed)ctx.setLineDash([6*s,4*s]);
ctx.beginPath();
pts.forEach((p,i)=>(i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])));
ctx.closePath();
ctx.stroke();
ctx.restore();
}

function toImage(ev){
const r=view.getBoundingClientRect();
return[((ev.clientX-r.left)/r.width)*frame.width,((ev.clientY-r.top)/r.height)*frame.height,ev.clientX-r.left,r.width];
}

function drawLoupe(u,v,xCss,wCss){
loupe.hidden=false;
loupe.style.left=xCss<wCss/2?'':'4px';
loupe.style.right=xCss<wCss/2?'4px':'';
const ctx=loupe.getContext('2d');
const half=loupe.width/(2*2*ZOOM);
ctx.imageSmoothingEnabled=false;
ctx.fillStyle=overlayColour('--media-bg','black');
ctx.fillRect(0,0,loupe.width,loupe.height);
ctx.drawImage(frame,u-half,v-half,2*half,2*half,0,0,loupe.width,loupe.height);
ctx.strokeStyle=overlayColour('--overlay-stop','red');
ctx.lineWidth=2;
ctx.beginPath();
ctx.moveTo(loupe.width/2,0);ctx.lineTo(loupe.width/2,loupe.height);
ctx.moveTo(0,loupe.height/2);ctx.lineTo(loupe.width,loupe.height/2);
ctx.stroke();
}

function loupeAt(i){
const c=corners[i];
if(!c||!frame){loupe.hidden=true;return;}
const r=view.getBoundingClientRect();
drawLoupe(c[0],c[1],(c[0]/frame.width)*(r.width||1),r.width||1);
}

function nearest(u,v){
let best=-1;
let bd=Infinity;
corners.forEach((c,i)=>{
if(!c)return;
const d=Math.hypot(c[0]-u,c[1]-v);
if(d<bd){bd=d;best=i;}
});
return bd<frame.width*0.06?best:-1;
}

view.addEventListener('pointerdown',(ev)=>{
if(!frame)return;
ev.preventDefault();
view.setPointerCapture?.(ev.pointerId);
const[u,v,x,w]=toImage(ev);
const near=nearest(u,v);
active=near>=0?near:next();
if(active<0)active=sel;
corners[active]=[u,v];
sel=active;
edge=null;
drawLoupe(u,v,x,w);
draw();
updatePrompt();
});
view.addEventListener('pointermove',(ev)=>{
if(active<0||!frame)return;
ev.preventDefault();
const[u,v,x,w]=toImage(ev);
corners[active]=[u,v];
drawLoupe(u,v,x,w);
draw();
});
const end=()=>{
if(active<0)return;
active=-1;
const n=next();
if(n>=0){loupe.hidden=true;sel=n;}
draw();
updatePrompt();
onChange(api.corners(),{edge});
};
view.addEventListener('pointerup',end);
view.addEventListener('pointercancel',end);
view.addEventListener('keydown',(e)=>{
const k={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
if(k){e.preventDefault();const m=e.shiftKey?10:1;api.nudge(k[0]*m,k[1]*m,{raw:true});return;}
if(/^[1-4]$/.test(e.key)){e.preventDefault();api.select(Number(e.key)-1);}
if(e.key==='Enter'&&frame&&!corners[sel]){

e.preventDefault();
corners[sel]=ghostPts?.[sel]?[...ghostPts[sel]]:[frame.width/2,frame.height/2];
draw();updatePrompt();loupeAt(sel);onChange(api.corners(),{edge});
}
});

const api={
el,
setFrame(canvas){
frame=canvas;
view.width=canvas.width;
view.height=canvas.height;
view.style.aspectRatio=`${canvas.width} / ${canvas.height}`;
draw();
updatePrompt();
},
frame:()=>frame,
setGhost(g){ghostPts=g;if(globalThis.__GSL_E2E__&&g)view.dataset.ghost=JSON.stringify(g.map((p)=>[+p[0].toFixed(2),+p[1].toFixed(2)]));draw();},
reset(){corners=[null,null,null,null];sel=0;edge=null;loupe.hidden=true;draw();updatePrompt();onChange(null,{edge});},
corners:()=>(corners.every(Boolean)?corners.map((c)=>[c[0],c[1]]):null),
setCorners(cs){corners=cs.map((c)=>(c?[c[0],c[1]]:null));draw();updatePrompt();},
select(i){sel=Math.max(0,Math.min(3,i));draw();updatePrompt();loupeAt(sel);},
selected:()=>sel,

nudge(dx,dy,{raw=false}={}){
if(!frame||!corners[sel])return;
const m=raw?1:big?10:1;
const c=corners[sel];
corners[sel]=[Math.max(0,Math.min(frame.width,c[0]+dx*m)),Math.max(0,Math.min(frame.height,c[1]+dy*m))];
edge=null;
draw();
loupeAt(sel);
onChange(api.corners(),{edge});
},

refine(){
const cs=api.corners();
if(!cs||!frame)return null;
try{
const r=refineCorners(grayOf(frame),cs);
if(r?.ok){
corners=r.corners.map((c)=>[c[0],c[1]]);
edge=r.max_edge_residual_px;
draw();
onChange(api.corners(),{edge,refine:r});
}
return r;
}catch(_){
return null;
}
},
edgeResidual:()=>edge,
};
updatePrompt();
return api;
}
