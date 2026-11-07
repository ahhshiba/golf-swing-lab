


















import{findComponents,normRoi}from'./ccl.js';
import{diffFrame}from'./bgsub.js';
import{linkChains}from'./ball.js';

let CLUB_BUF=new Float32Array(0);

function headPoint(buf,W,comp,rest,headLen,tLo){
const ang=comp.angle;
const ex=Math.cos(ang),ey=Math.sin(ang);
const bb=comp.bbox;
let pmin=Infinity,pmax=-Infinity;
for(let y=bb.y0;y<bb.y1;y++){
for(let x=bb.x0;x<bb.x1;x++){
if(!(buf[y*W+x]>tLo))continue;
const pr=(x+0.5-comp.u)*ex+(y+0.5-comp.v)*ey;
if(pr<pmin)pmin=pr;
if(pr>pmax)pmax=pr;
}
}
if(!(pmax>pmin))return{u:comp.u,v:comp.v};
const dPlus=Math.hypot(comp.u+ex*pmax-rest.u,comp.v+ey*pmax-rest.v);
const dMinus=Math.hypot(comp.u+ex*pmin-rest.u,comp.v+ey*pmin-rest.v);
const sign=dPlus<=dMinus?1:-1;
const pEnd=sign>0?pmax:pmin;
let sw=0,su=0,sv=0;
for(let y=bb.y0;y<bb.y1;y++){
for(let x=bb.x0;x<bb.x1;x++){
const w=buf[y*W+x];
if(!(w>tLo))continue;
const pr=(x+0.5-comp.u)*ex+(y+0.5-comp.v)*ey;
if(sign*(pEnd-pr)<=headLen){sw+=w;su+=w*(x+0.5);sv+=w*(y+0.5);}
}
}
return sw>0?{u:su/sw,v:sv/sw}:{u:comp.u,v:comp.v};
}

export function trackClubHead(p){
const{frames,times,W,H,bg,restBall}=p;
if(!restBall||!(restBall.r_px>0)||!bg)return[];
const lastRest=p.lastRest;
if(!(lastRest>=1))return[];
const nWin=p.lookback??8;
const f0=Math.max(0,lastRest-nWin+1);
const f1=Math.min(frames.length-1,lastRest);
const roi=normRoi(p.roi??null,W,H);
const r=restBall.r_px;
const ballArea=Math.PI*r*r;
const roiArea=(roi.x1-roi.x0)*(roi.y1-roi.y0);
if(CLUB_BUF.length<W*H)CLUB_BUF=new Float32Array(W*H);
const buf=CLUB_BUF;
const maskR=r+2.5;
const mx0=Math.max(roi.x0,Math.floor(restBall.u-maskR)),mx1=Math.min(roi.x1,Math.ceil(restBall.u+maskR));
const my0=Math.max(roi.y0,Math.floor(restBall.v-maskR)),my1=Math.min(roi.y1,Math.ceil(restBall.v+maskR));
const dets=[];
const tm=[];
for(let f=f1;f>=f0;f--){
const fit=diffFrame(frames[f],bg,W,H,roi,buf,p.opts??{});
for(let y=my0;y<my1;y++){
for(let x=mx0;x<mx1;x++){
const dx=x+0.5-restBall.u,dy=y+0.5-restBall.v;
if(dx*dx+dy*dy<=maskR*maskR)buf[y*W+x]=0;
}
}
const tLo=Math.max(10,3.5*fit.sigma);
const tHi=Math.max(16,5.5*fit.sigma);
const comps=findComponents(buf,W,H,roi,{tLo,tHi,minArea:Math.max(30,ballArea),maxArea:0.5*roiArea});
const list=comps.map((c)=>{
const hp=headPoint(buf,W,c,restBall,4.5*r,tLo);
return{u:hp.u,v:hp.v,cu:c.u,cv:c.v,area:c.area,r_px:c.r_px,peak:c.peak,elong:c.elong,w_px:0,h_px:0};
});
dets.push(list);
tm.push(-times[f]);
}
if(dets.every((d)=>d.length===0))return[];
const backTol=4*r+8;
const res=linkChains(dets,tm,{
start:{u:restBall.u,v:restBall.v},
seedFrom:0,
seedTo:Math.min(3,dets.length-1),
firstGate:220,
tolRest:0,
stepGeFirst:false,
secondAngleDeg:55,
maxGap:1,
gatePx:14,
gateFrac:0.5,
minLen:3,
minStep:2,
maxStep:320,
backTol,
backFramesMax:4,
maxSeeds:12,
});
if(!res.best)return[];
const{chain,line,dperp}=res.best;
const conf=Math.min(0.9,0.25+0.25*Math.min(1,chain.length/4)+0.25*(1-Math.min(1,dperp/backTol))+0.15*(1-Math.min(1,line.rms/8)));
const out=chain.map(({f,c})=>{
const frame=f1-f;
return{frame,t_s:times[frame],u:c.u,v:c.v,conf};
});
out.sort((a,b)=>a.frame-b.frame);
return out;
}
