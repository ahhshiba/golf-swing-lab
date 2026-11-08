















import{SIM_PARAMS as P}from'./params.js';
import{landTan,apexFrac,rollFraction}from'./lies.js';
import{lieAt,elevationAt,dist}from'../course/model.js';
import{dsin,dcos,deg2rad}from'../course/detmath.js';

const r2=(x)=>{
const y=Math.round(x*100)/100;
return y===0?0:y;
};

export const slopeCarry=(carry,dz,tan)=>{
const c=carry-dz/tan;
return c<0.3*carry?0.3*carry:c>1.5*carry?1.5*carry:c;
};

export function samplesToPath(samples,from,aim,z0=0){
const{ux,uy}=unit(from,aim);
const rx=uy,ry=-ux;
const s0=samples[0];
return samples.map(([,dn,ml,up])=>{
const down=dn-s0[1];
const right=-(ml-s0[2]);
return[from.x+ux*down+rx*right,from.y+uy*down+ry*right,z0+up-s0[3]];
});
}

export function parametricPath(from,landing,z0,apex,step=P.path_step_m){
const D=dist(from.x,from.y,landing.x,landing.y);
const pts=[];
if(!(D>0))return[[from.x,from.y,z0]];
const sa=P.apex_at*D;
const n=Math.max(1,Math.ceil(D/step));
for(let i=0;i<=n;i++){
const s=(D*i)/n;
const k=s<=sa?(sa-s)/sa:(s-sa)/(D-sa);
const zl=z0+(landing.z-z0)*(s/D);
pts.push([from.x+((landing.x-from.x)*s)/D,from.y+((landing.y-from.y)*s)/D,zl+apex*(1-k*k)]);
}
return pts;
}

export function slopeLanding(path,groundAt){
let apexSeen=false;
for(let i=1;i<path.length;i++){
const[ax,ay,az]=path[i-1];
const[bx,by,bz]=path[i];
if(bz<az)apexSeen=true;
if(!apexSeen)continue;
const ha=az-groundAt(ax,ay),hb=bz-groundAt(bx,by);
if(ha>0&&hb<=0){
const t=ha/(ha-hb);
const x=ax+(bx-ax)*t,y=ay+(by-ay)*t;
return{x,y,z:groundAt(x,y)};
}
}
const[x,y]=path[path.length-1];
return path.length>1?{x,y,z:groundAt(x,y)}:null;
}

export function firstTreeHit(path,trees,groundAt,skipNear=null){
if(!trees.length||path.length<2)return null;
const live=skipNear?trees.filter((t)=>dist(t[0],t[1],skipNear.x,skipNear.y)>t[2]+0.5):trees;
let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
for(const[x,y]of path){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
const near=live.filter((t)=>t[0]+t[2]>=x0&&t[0]-t[2]<=x1&&t[1]+t[2]>=y0&&t[1]-t[2]<=y1);
if(!near.length)return null;
for(const[x,y,z]of path){
for(const t of near){
if(dist(x,y,t[0],t[1])<t[2]&&z-groundAt(x,y)<t[3])return{x,y,tree:t};
}
}
return null;
}

function unit(a,b){
const L=dist(a.x,a.y,b.x,b.y);
return L>0?{ux:(b.x-a.x)/L,uy:(b.y-a.y)/L,L}:{ux:0,uy:1,L:0};
}


function walkBack(hole,p,q,pred,step=0.25){
const{ux,uy,L}=unit(p,q);
for(let t=step;t<=L;t+=step){
const x=p.x+ux*t,y=p.y+uy*t;
if(pred(lieAt(hole,x,y)))return{x,y};
}
return{x:q.x,y:q.y};
}


function edgeCandidates(hole,exit){
const out=[];
for(const poly of hole.fairway){
for(let i=0,j=poly.length-1;i<poly.length;j=i++){
const ax=poly[j][0],ay=poly[j][1],bx=poly[i][0],by=poly[i][1];
const vx=bx-ax,vy=by-ay;
const L2=vx*vx+vy*vy;
if(!(L2>0))continue;
const L=Math.sqrt(L2);
let t=((exit.x-ax)*vx+(exit.y-ay)*vy)/L2;
t=t<0?0:t>1?1:t;
const ts=[t];
for(let k=0;k<=Math.floor(L/2);k++)ts.push((2*k)/L);
for(const u of ts){
if(u<0||u>1)continue;
const x=ax+vx*u,y=ay+vy*u;
out.push({x,y,d:dist(exit.x,exit.y,x,y),nx:-vy/L,ny:vx/L});
}
}
}
return out.sort((p,q)=>p.d-q.d);
}





function obOutcome(hole,from,exit,rules){
if(rules?.ob==='stroke_distance')return{rest:{x:from.x,y:from.y,lie:from.lie,keep:true},penalty:1};
const m=P.ob_drop_inside_m;
for(const c of edgeCandidates(hole,exit)){
const{ux,uy,L}=unit(exit,c);
const dirs=L>0?[[ux,uy],[c.nx,c.ny],[-c.nx,-c.ny]]:[[c.nx,c.ny],[-c.nx,-c.ny]];
for(const[dx,dy]of dirs){
const x=r2(c.x+dx*m),y=r2(c.y+dy*m);
if(lieAt(hole,x,y)==='fairway')return{rest:{x,y,lie:'fairway'},penalty:2};
}
}
const ex={x:r2(exit.x),y:r2(exit.y)};
if(lieAt(hole,ex.x,ex.y)==='rough')return{rest:{...ex,lie:'rough'},penalty:2};
return{rest:{x:from.x,y:from.y,lie:from.lie,keep:true},penalty:2};
}

function waterOutcome(hole,from,entry,back){

const dry=walkBack(hole,entry,back,(l)=>l!=='water');
const{ux,uy}=unit(entry,back);
let x=r2(dry.x+ux*P.water_drop_back_m),y=r2(dry.y+uy*P.water_drop_back_m);
let lie=lieAt(hole,x,y);
if(lie==='water'||lie==='ob'){x=r2(dry.x);y=r2(dry.y);lie=lieAt(hole,x,y);}
if(lie==='water'||lie==='ob')return{rest:{x:from.x,y:from.y,lie:from.lie,keep:true},penalty:1};
return{rest:{x,y,lie},penalty:1};
}

export function resolveStroke(hole,{from,aim,draw,club,source,handedness='right',rules=null,style=null}){
const ground=(x,y)=>elevationAt(hole,x,y);
const hand=handedness==='left'?-1:1;
const done=(landing,rest,penalty,event)=>{
let ev=event;
const x=r2(rest.x),y=r2(rest.y);

let rs={x,y,lie:rest.keep?rest.lie:lieAt(hole,x,y)};
if(!penalty&&dist(x,y,hole.pin[0],hole.pin[1])<=P.cup_m){rs={x:hole.pin[0],y:hole.pin[1],lie:lieAt(hole,hole.pin[0],hole.pin[1])};ev='holed';}
const lx=r2(landing.x),ly=r2(landing.y);
return{landing:{x:lx,y:ly,z:r2(ground(lx,ly))},rest:rs,penalty,event:ev};
};
if(source==='pickup'||source==='penalty')return done(from,{x:from.x,y:from.y,lie:from.lie,keep:true},0,null);

const{ux,uy}=unit(from,aim);
const vx=uy,vy=-ux;
const C=Math.max(0,draw.carry_m);
const S=draw.side_m*hand;

if(club==='putter'||source==='auto_chip'){
const p={x:from.x+ux*C+vx*S,y:from.y+uy*C+vy*S};
return done(p,{x:p.x,y:p.y},0,null);
}


const z0=ground(from.x,from.y);

const fin=(v)=>typeof v==='number'&&Number.isFinite(v);
const landDegS=fin(draw.land_deg)?draw.land_deg:null;
const tan=landDegS!==null?dsin(deg2rad(landDegS))/dcos(deg2rad(landDegS)):landTan(club);
let c=C;
for(let i=0;i<3;i++){
const px=from.x+ux*c+vx*S,py=from.y+uy*c+vy*S;
c=slopeCarry(C,ground(px,py)-z0,tan);
}
const land={x:from.x+ux*c+vx*S,y:from.y+uy*c+vy*S};
land.z=ground(land.x,land.y);


const path=parametricPath(from,land,z0,fin(draw.apex_m)?draw.apex_m:apexFrac(club)*C);
const hit=firstTreeHit(path,hole.trees,ground,from);
if(hit){
const lie=lieAt(hole,hit.x,hit.y);
if(lie==='ob'){const o=obOutcome(hole,from,walkBack(hole,hit,from,(l)=>l!=='ob'),rules);return done(hit,o.rest,o.penalty,'ob');}
if(lie==='water'){const w=waterOutcome(hole,from,hit,from);return done(hit,w.rest,w.penalty,'water');}
return done(hit,{x:hit.x,y:hit.y,lie},0,'tree');
}

const lieL=lieAt(hole,land.x,land.y);
if(lieL==='ob'){const o=obOutcome(hole,from,walkBack(hole,land,from,(l)=>l!=='ob'),rules);return done(land,o.rest,o.penalty,'ob');}
if(lieL==='water'){const w=waterOutcome(hole,from,land,from);return done(land,w.rest,w.penalty,'water');}


const R=c*rollFraction(club,lieL,style,landDegS);
const d=unit(from,land);
let rest={x:land.x,y:land.y};
for(let t=P.roll_step_m;t<=R+1e-9;t+=P.roll_step_m){
const q={x:land.x+d.ux*t,y:land.y+d.uy*t};
const l=lieAt(hole,q.x,q.y);
if(l==='water'){const w=waterOutcome(hole,from,q,land);return done(land,w.rest,w.penalty,'water');}
if(l==='ob'){const o=obOutcome(hole,from,rest,rules);return done(land,o.rest,o.penalty,'ob');}
rest=q;
if(l==='bunker')break;
if(dist(q.x,q.y,hole.pin[0],hole.pin[1])<=P.cup_m)break;
}
return done(land,rest,0,null);
}
