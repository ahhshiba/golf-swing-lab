









import{project3}from'../viz/traj3d.js';
import{elevationAt,pointAlong,polylineLength}from'./model.js';

const NEAR=1;
const FOV_TAN=0.5206;

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(a)=>{const L=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/L,a[1]/L,a[2]/L];};
const smooth=(u)=>(u<=0?0:u>=1?1:u*u*(3-2*u));

function lookAt(eye,target,w,h){
const fwd=norm(sub(target,eye));
let right=cross(fwd,[0,0,1]);
if(Math.hypot(...right)<1e-6)right=[1,0,0];
right=norm(right);
const up=cross(right,fwd);
return{eye,fwd,right,up,F:h/2/FOV_TAN,w,h};
}

function teeXY(hole,tees){
const t=hole.tees[tees]??hole.tees.middle;
return[t[0],t[1]];
}


export function flyCamera(hole,u,w,h,tees='middle'){
const[tx,ty]=teeXY(hole,tees);
const cl=[[tx,ty],...hole.centerline.slice(1)];
const L=polylineLength(cl);
const g=(x,y)=>elevationAt(hole,x,y);
if(u==='static'){
const a=pointAlong(cl,L*0.15);
const m=pointAlong(cl,L*0.8);


const back=0;
const eye=[a.x-a.ux*back,a.y-a.uy*back,g(a.x,a.y)+0.32*L+14];
return lookAt(eye,[m.x,m.y,g(m.x,m.y)],w,h);
}
const k=smooth(u);
const s=-55+(L-65+55)*k;
const e=pointAlong(cl,s);
const lk=pointAlong(cl,Math.min(L,s+140));
const height=34-12*k;
return lookAt([e.x,e.y,g(e.x,e.y)+height],[lk.x,lk.y,g(lk.x,lk.y)],w,h);
}


function projectPoly(cam,pts){
const out=[];
const d=pts.map((p)=>dot(sub(p,cam.eye),cam.fwd));
for(let i=0;i<pts.length;i++){
const j=(i+1)%pts.length;
const a=pts[i],b=pts[j],da=d[i],db=d[j];
if(da>=NEAR)out.push(a);
if((da>=NEAR)!==(db>=NEAR)){
const s=(NEAR-da)/(db-da);
out.push([a[0]+(b[0]-a[0])*s,a[1]+(b[1]-a[1])*s,a[2]+(b[2]-a[2])*s]);
}
}
if(out.length<3)return null;
const scr=[];
for(const p of out){const q=project3(cam,p);if(!q)return null;scr.push(q);}
return scr;
}

function fillPoly(ctx,scr,fill,outline){
ctx.beginPath();
scr.forEach((p,i)=>(i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])));
ctx.closePath();
ctx.fillStyle=fill;
ctx.fill();
if(outline){ctx.lineWidth=2;ctx.strokeStyle=outline;ctx.stroke();}
}

function scene(hole){
const lift=(poly)=>poly.map(([x,y])=>[x,y,elevationAt(hole,x,y)]);
const[x0,y0]=hole.bounds.reduce(([a,b],[x,y])=>[Math.min(a,x),Math.min(b,y)],[Infinity,Infinity]);
const[x1,y1]=hole.bounds.reduce(([a,b],[x,y])=>[Math.max(a,x),Math.max(b,y)],[-Infinity,-Infinity]);
const m=900;
return{
ground:lift([[x0-m,y0-m],[x1+m,y0-m],[x1+m,y1+m],[x0-m,y1+m]]),
layers:[
['rough',[lift(hole.bounds)]],['fairway',hole.fairway.map(lift)],['green',[lift(hole.green.poly)]],
['bunker',hole.bunkers.map(lift)],['water',hole.water.map(lift)],
],
trees:hole.trees.map(([x,y,r,h])=>({p:[x,y,elevationAt(hole,x,y)],r,h})),
pin:[hole.pin[0],hole.pin[1],elevationAt(hole,hole.pin[0],hole.pin[1])],
};
}

function drawFrame(ctx,cam,sc,pal){
const{w,h}=cam;

const sky=ctx.createLinearGradient?ctx.createLinearGradient(0,0,0,h*0.6):null;
if(sky){sky.addColorStop(0,pal.water);sky.addColorStop(1,pal.halo);}
ctx.fillStyle=sky??pal.halo;
ctx.fillRect(0,0,w,h);
const outline=pal.outlined?pal.outline:null;
const g=projectPoly(cam,sc.ground);
if(g){
fillPoly(ctx,g,pal.rough,null);
ctx.globalAlpha=0.45;
fillPoly(ctx,g,pal.halo,null);
ctx.globalAlpha=1;
}
for(const[kind,polys]of sc.layers)for(const poly of polys){const s=projectPoly(cam,poly);if(s)fillPoly(ctx,s,pal[kind],outline);}

const trees=[];
for(const tr of sc.trees){
const dep=dot(sub(tr.p,cam.eye),cam.fwd);
if(dep<NEAR)continue;
const base=project3(cam,tr.p);
const top=project3(cam,[tr.p[0],tr.p[1],tr.p[2]+tr.h]);
if(base&&top)trees.push({dep,base,top,half:(cam.F*tr.r)/dep});
}
trees.sort((a,b)=>b.dep-a.dep);
for(const tr of trees){
if(tr.base[1]<-50||tr.top[1]>h+50||tr.base[0]<-tr.half-20||tr.base[0]>w+tr.half+20)continue;
const midY=tr.base[1]+(tr.top[1]-tr.base[1])*0.25;
ctx.beginPath();
ctx.moveTo(tr.top[0],tr.top[1]);
ctx.lineTo(tr.base[0]+tr.half,midY);
ctx.lineTo(tr.base[0]-tr.half,midY);
ctx.closePath();
ctx.fillStyle=pal.tree;
ctx.fill();
ctx.lineWidth=1.5;
ctx.strokeStyle=pal.fairway;
ctx.stroke();
ctx.beginPath();
ctx.moveTo(tr.base[0],tr.base[1]);
ctx.lineTo(tr.base[0],midY);
ctx.strokeStyle=pal.tree;
ctx.lineWidth=Math.max(1,tr.half*0.2);
ctx.stroke();
}
const pb=project3(cam,sc.pin);
const pt=project3(cam,[sc.pin[0],sc.pin[1],sc.pin[2]+6]);
if(pb&&pt){
ctx.lineWidth=4;
ctx.strokeStyle=pal.text;
ctx.beginPath();
ctx.moveTo(pb[0],pb[1]);
ctx.lineTo(pt[0],pt[1]);
ctx.stroke();
ctx.lineWidth=2;
ctx.strokeStyle=pal.pin;
ctx.stroke();
const fl=Math.max(6,(pb[1]-pt[1])*0.45);
ctx.beginPath();
ctx.moveTo(pt[0],pt[1]);
ctx.lineTo(pt[0]+fl,pt[1]+fl*0.35);
ctx.lineTo(pt[0],pt[1]+fl*0.7);
ctx.closePath();
ctx.fillStyle=pal.pin;
ctx.fill();
ctx.lineWidth=1.5;
ctx.strokeStyle=pal.text;
ctx.stroke();
}
}






export function createFlyover(canvas,opts){
const{hole,palette:pal,reducedMotion=false,onDone,tees='middle',durationMs=4000}=opts??{};
if(!hole||!pal)throw new TypeError('createFlyover: hole and palette are required');
const now=opts.now??(()=>globalThis.performance?.now?.()??Date.now());
const raf=opts.raf??((fn)=>globalThis.requestAnimationFrame(fn));
const caf=opts.caf??((id)=>globalThis.cancelAnimationFrame?.(id));
const ctx=canvas.getContext('2d');
const sc=scene(hole);
const ms=[];
let frames=0,t0=0,rafId=null,done=false,dead=false;

const size=()=>{
const dpr=Math.min(3,globalThis.devicePixelRatio||1);
const w=Math.max(1,Math.round(canvas.clientWidth||canvas.width||300));
const h=Math.max(1,Math.round(canvas.clientHeight||canvas.height||200));
if(canvas.width!==Math.round(w*dpr))canvas.width=Math.round(w*dpr);
if(canvas.height!==Math.round(h*dpr))canvas.height=Math.round(h*dpr);
return{w,h,dpr};
};
const draw=(u)=>{
const a=now();
const{w,h,dpr}=size();
ctx.setTransform(dpr,0,0,dpr,0,0);
drawFrame(ctx,flyCamera(hole,u,w,h,tees),sc,pal);
frames++;
ms.push(now()-a);
};
const finish=()=>{
if(done||dead)return;
done=true;
if(rafId!==null)caf(rafId);
rafId=null;
try{onDone?.();}catch(_){ }
};
const tick=()=>{
rafId=null;
if(dead||done)return;
const u=Math.min(1,(now()-t0)/durationMs);
draw(u);
if(u>=1)finish();
else rafId=raf(tick);
};
return{
start(){
if(dead)return;
done=false;
if(reducedMotion){draw('static');return;}
t0=now();
draw(0);
rafId=raf(tick);
},
skip(){finish();},
destroy(){
dead=true;
if(rafId!==null)caf(rafId);
rafId=null;
},
stats:()=>({frames,ms:[...ms],done}),
};
}
