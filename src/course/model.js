








export const dist=(ax,ay,bx,by)=>{
const dx=bx-ax;
const dy=by-ay;
return Math.sqrt(dx*dx+dy*dy);
};

export function bbox(poly){
let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
for(const[x,y]of poly){
if(x<x0)x0=x;
if(x>x1)x1=x;
if(y<y0)y0=y;
if(y>y1)y1=y;
}
return[x0,y0,x1,y1];
}

const bboxCache=new WeakMap();
function cachedBox(poly){
let b=bboxCache.get(poly);
if(!b){b=bbox(poly);bboxCache.set(poly,b);}
return b;
}


export function inPoly(poly,x,y){
const b=cachedBox(poly);
if(x<b[0]||x>b[2]||y<b[1]||y>b[3])return false;
let inside=false;
for(let i=0,j=poly.length-1;i<poly.length;j=i++){
const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
if((yi>y)!==(yj>y)&&x<((xj-xi)*(y-yi))/(yj-yi)+xi)inside=!inside;
}
return inside;
}

const inAny=(polys,x,y)=>{
for(const p of polys)if(inPoly(p,x,y))return true;
return false;
};

export function lieAt(hole,x,y){
if(!inPoly(hole.bounds,x,y))return'ob';
if(inAny(hole.water,x,y))return'water';
if(inAny(hole.bunkers,x,y))return'bunker';
if(inPoly(hole.green.poly,x,y))return'green';
if(inAny(hole.fairway,x,y))return'fairway';
return'rough';
}

export function elevationAt(hole,x,y){
const[tx,ty]=hole.tees.middle;
const[px,py]=hole.pin;
const L=dist(tx,ty,px,py);
const{tee_z:z0,green_z:z1}=hole.elevation;
if(!(L>0))return z0;
const t=((x-tx)*(px-tx)+(y-ty)*(py-ty))/(L*L);
return z0+(z1-z0)*t;
}


export const teeOf=(hole,tees)=>hole.tees[tees]??hole.tees.middle;


export function segHit(a,b,c,d){
const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
const d1=o(c,d,a),d2=o(c,d,b),d3=o(a,b,c),d4=o(a,b,d);
if(((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0)))return true;
const on=(p,q,r)=>Math.min(p[0],q[0])<=r[0]&&r[0]<=Math.max(p[0],q[0])&&Math.min(p[1],q[1])<=r[1]&&r[1]<=Math.max(p[1],q[1]);
if(d1===0&&on(c,d,a))return true;
if(d2===0&&on(c,d,b))return true;
if(d3===0&&on(a,b,c))return true;
if(d4===0&&on(a,b,d))return true;
return false;
}


export function polySelfIntersects(poly){
const n=poly.length;
for(let i=0;i<n;i++){
const a=poly[i],b=poly[(i+1)%n];
for(let j=i+2;j<n;j++){
if(i===0&&j===n-1)continue;
if(segHit(a,b,poly[j],poly[(j+1)%n]))return true;
}
}
return false;
}


export function nearestOnPoly(poly,x,y){
let best={x:poly[0][0],y:poly[0][1],d:Infinity};
for(let i=0,j=poly.length-1;i<poly.length;j=i++){
const ax=poly[j][0],ay=poly[j][1],bx=poly[i][0],by=poly[i][1];
const vx=bx-ax,vy=by-ay;
const L2=vx*vx+vy*vy;
let t=L2>0?((x-ax)*vx+(y-ay)*vy)/L2:0;
t=t<0?0:t>1?1:t;
const px=ax+vx*t,py=ay+vy*t;
const d=dist(x,y,px,py);
if(d<best.d)best={x:px,y:py,d};
}
return best;
}

export function polylineLength(pts){
let s=0;
for(let i=1;i<pts.length;i++)s+=dist(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1]);
return s;
}


export function pointAlong(pts,s){
let acc=0;
for(let i=1;i<pts.length;i++){
const[ax,ay]=pts[i-1];
const[bx,by]=pts[i];
const L=dist(ax,ay,bx,by);
const last=i===pts.length-1;
if(s<=acc+L||last||(i===1&&s<0)){
const ux=L>0?(bx-ax)/L:0;
const uy=L>0?(by-ay)/L:1;
const t=s-acc;
return{x:ax+ux*t,y:ay+uy*t,ux,uy};
}
acc+=L;
}
const[x,y]=pts[0];
return{x,y,ux:0,uy:1};
}
