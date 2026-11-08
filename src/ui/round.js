

















import{h,clear,select}from'./dom.js';
import*as C from'./components.js';
import{t,plural}from'../i18n/index.js';
import{fmtQuantity,parseInput,unitLabel}from'../i18n/units.js';
import{CLUBS}from'../session/settings.js';
import{nowIso}from'../session/ids.js';
import{clubName}from'./glossary.js';
import{mulberry32}from'../geom/rng.js';
import{coursePalette}from'../course/palette.js';
import{drawHole2d,sourceKind,sideKind,strokeSigmas}from'../course/draw2d.js';
import{createFlyover}from'../course/draw3d.js';
import{pointAlong,polylineLength,dist}from'../course/model.js';
import{generateCourse}from'../course/generate.js';
import{shotOutcome}from'../sim/engine.js';
import{playStroke,newRound,strokeContext,ballOf}from'../sim/round.js';
import{autoPutt,autoChip,manualPutts}from'../sim/putting.js';
import{recommendClub}from'../sim/recommend.js';
import{priorCarry,sidePrior}from'../sim/source.js';
import{lieFactors}from'../sim/lies.js';
import{normalizeSim}from'../sim/settings.js';
import{ELLIPSE_K95}from'../sim/params.js';
import{honestDistance}from'./sim-banner.js';

const CLUB_IDS=CLUBS.map((c)=>c[0]);
const AIM_STEP_DEG=2;
const LANDING_MS=900;
const Z10=1.2815515655446004;




export function rotateAim(from,aim,deg){
const a=(deg*Math.PI)/180;
const dx=aim.x-from.x,dy=aim.y-from.y;
const c=Math.cos(a),s=Math.sin(a);
return{x:from.x+dx*c-dy*s,y:from.y+dx*s+dy*c};
}


export function defaultAim(hole,ball,carry){
const[px,py]=hole.pin;
const toPin=dist(ball.x,ball.y,px,py);
if(!(carry>0)||toPin<=carry*1.08)return{x:px,y:py};
const cl=hole.centerline;
const L=polylineLength(cl);

let s0=0,best=Infinity;
for(let s=0;s<=L;s+=4){const p=pointAlong(cl,s);const d=dist(ball.x,ball.y,p.x,p.y);if(d<best){best=d;s0=s;}}
for(let s=s0;s<=L;s+=2){
const p=pointAlong(cl,s);
if(dist(ball.x,ball.y,p.x,p.y)>=carry)return{x:p.x,y:p.y};
}
return{x:px,y:py};
}


export function previewEllipse(from,aim,club,player,rows,lie,style){
const lf=lieFactors(lie==='tee'?'fairway':lie,club,style);
const pr=priorCarry(club,player,rows?.gap??null,rows?.gapping??player?.gapping);
const median=pr.median*lf.carry;
const sc=pr.sigma*lf.carry*lf.sigma;
const sd=sidePrior(club,median,rows?.side??null);
const L=Math.hypot(aim.x-from.x,aim.y-from.y)||1;
const ux=(aim.x-from.x)/L,uy=(aim.y-from.y)/L;
return{
ellipse:{x:from.x+ux*median,y:from.y+uy*median,sx:ELLIPSE_K95*sd.sigma*lf.sigma,sy:ELLIPSE_K95*sc},
band:{p10:median-Z10*sc,p90:median+Z10*sc},median,source:pr.source,small_sample:pr.small_sample,
};
}

const reducedMotion=()=>{try{return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;}catch(_){return false;}};






export function simRows(player,rows,club){
if(player?.kind!=='owner')return{gap:null,side:null,gapping:[]};
const gap=rows?.gap??[];
return{gap:gap.find((r)=>r.club===club)??null,side:rows?.side?.[club]??null,gapping:gap};
}


export async function ownRows(app){
const out={gap:[],side:{}};
if(!app.repo?.shots)return out;
try{
const shots=(await app.repo.shots.list()).filter((s)=>!s.deleted);
const{gapping,summarize}=await import('../store/stats.js');
out.gap=gapping(shots,{includeHB:false});
const by={};
for(const s of shots){
const m=s.metrics?.carry_side_m;
if(s.capture?.view!=='high_behind'||typeof m?.value!=='number')continue;
const k=s.club?.type??'unknown';
(by[k]??={v:[],s:[]}).v.push(m.value);
by[k].s.push(m.sigma??(Array.isArray(m.ci95)?(m.ci95[1]-m.ci95[0])/3.92:null));
}
for(const[k,x]of Object.entries(by)){const r=summarize(x.v,x.s);if(r)out.side[k]=r;}
}catch(e){
app.errors?.report?.(e,{where:'round.rows',silent:true});
}
return out;
}


export function typeInUntil(round,done,max=400){
let r=round;
for(let k=0;k<max&&r.current&&!done(r);k++){
const sc=strokeContext(r);
if(sc.ball.lie==='green'&&r.rules.putting==='auto'){r=autoPutt(r,sc.player.player_id,mulberry32(sc.seed)).round;continue;}
const target=defaultAim(sc.hole,sc.ball,230);
const c=Math.max(3,dist(sc.ball.x,sc.ball.y,target.x,target.y)-4);
const out=shotOutcome({input:{kind:'manual',carry_m:c,side_m:0},club:c>180?'driver':c>120?'7i':'pw',player:sc.player,rows:{},rules:r.rules,rng:mulberry32(sc.seed),lie:sc.ball.lie,style:sc.style});
r=playStroke(r,out,target).round;
}
return r;
}


export function demoRound({seed=42,styleId='links',holes=9,players=2,putting='auto'}={}){
const course=generateCourse({seed,style:styleId,holes,tees:'middle'});
const ps=[{name:'Alex',kind:'owner',driver_carry_m:210},{name:'Sam',kind:'guest',driver_carry_m:190,handedness:'left'},
{name:'Kai',kind:'guest',driver_carry_m:230},{name:'Lee',kind:'guest',driver_carry_m:170}].slice(0,players);
return newRound({round_id:`round-demo-${seed}`,created_at:'2026-11-07T08:00:00.000Z',app_version:'0.4.0',course,settings:{putting},players:ps});
}



export function mountRound(root,app,opts={}){
let round=null;
let demo=false;
let rows={gap:[],side:{}};
let mode='loading';
let shownHole=null;
let handedTo=null;
let aim=null;
let club=null;
let clubPicked=false;
let fly=null;
let lastView=null;
let landing=1;
let anim=null;
let notes=[];
let doneHole=null;
let forceStatic=false;
let pendingFocus=null;
const units=()=>app.units();
const fmt=(m)=>fmtQuantity(m,'distance',units()).text;
const motionOff=()=>forceStatic||reducedMotion()||normalizeSim(app.settings()?.sim).flyover===false;

const playerIdx=(id)=>round.players.findIndex((p)=>p.player_id===id);
const playerOf=(id)=>round.players.find((p)=>p.player_id===id)??null;
const nameOf=(p)=>p?.name||t(p?.kind==='guest'?'course.player.guest':'course.player.owner');
const rowsFor=(p)=>(p?.kind==='owner'?{gap:rows.gap,side:null}:{gap:null,side:null});
const rowsForClub=(p,c)=>simRows(p,rows,c);

async function save(){
if(demo||!round)return;
try{await app.repo?.rounds?.put(round);}catch(e){app.errors?.report?.(e,{where:'round.save'});}
}

async function load(params){
if(params.round&&typeof params.round==='object')return params.round;
if(!app.repo?.rounds)return null;
try{
if(params.round_id)return(await app.repo.rounds.get(params.round_id))??null;
const list=await app.repo.rounds.list();
return list.filter((r)=>r.status==='active').sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0]??null;
}catch(e){
app.errors?.report?.(e,{where:'round.load',silent:true});
return null;
}
}

function stopAnims(){
fly?.destroy();
fly=null;
if(anim)cancelAnimationFrame(anim);
anim=null;
}

function header(extra){
return C.screenHeader({title:app.screenTitle('round'),back:true,onBack:()=>app.nav.back(),actions:extra});
}


function decide(){
if(!round){mode='none';return;}
if(round.status!=='active'||!round.current){mode=doneHole?'holedone':'finished';return;}
const hn=round.current.hole;
if(doneHole&&doneHole!==hn){mode='holedone';return;}
const holeStarted=round.strokes.some((s)=>s.hole===hn);
if(shownHole!==hn&&!holeStarted){mode='intro';return;}
shownHole=hn;
if(round.players.length>1&&handedTo!==round.current.player_id){mode='handoff';return;}
mode='play';
}

async function settle(){

for(let guard=0;guard<8&&round?.current&&round.status==='active';guard++){
const ctx=strokeContext(round);
if(round.rules.putting!=='auto'||ctx.ball.lie!=='green')break;
const hn=round.current.hole;
const res=autoPutt(round,ctx.player.player_id,mulberry32(ctx.seed));
round={...res.round,updated_at:nowIso()};
notes.push({player:ctx.player.player_id,text:t('sim.putts.auto',{name:nameOf(ctx.player),n:res.strokes.length})});
if(round.current?.hole!==hn||!round.current)doneHole=hn;
landing=1;
}
await save();
}

function render(){
stopAnims();
decide();
root.dataset.mode=mode;
if(round){
root.dataset.roundId=round.round_id;
const c=round.current?strokeContext(round):null;
root.dataset.hole=String(round.current?.hole??'');
root.dataset.player=round.current?.player_id??'';
root.dataset.strokeN=c?String(c.ball.n):'';
root.dataset.ballX=c?String(c.ball.x):'';
root.dataset.ballY=c?String(c.ball.y):'';
root.dataset.lie=c?c.ball.lie:'';
root.dataset.toPinM=c?String(Math.round(c.ball.to_pin_m*100)/100):'';
}
if(mode==='none')return renderNone();
if(mode==='intro')return renderIntro();
if(mode==='handoff')return renderHandoff();
if(mode==='holedone')return renderHoleDone(!round.current);
if(mode==='finished')return renderHoleDone(true);
return renderPlay();
}

function renderNone(){
clear(root,header(),C.emptyState({icon:'flag',title:t('sim.none.title'),body:t('sim.none.body'),testid:'round-empty',
action:{label:t('screen.course.title'),onClick:()=>app.nav.go('course'),testid:'round-open-course'}}));
}

function holeLine(hole){
return t('sim.hole_line',{n:hole.n,of:round.course.holes_n,par:hole.par,length:fmt(hole.length_m)});
}

function renderIntro(){
const hole=round.course.holes[round.current.hole-1];
const canvas=h('canvas.round-fly',{'data-testid':'round-fly-canvas',role:'img','aria-label':t('sim.flyover.a11y',{n:hole.n,par:hole.par,length:fmt(hole.length_m)})});
const stat=motionOff();
const done=()=>{if(mode!=='intro')return;shownHole=round.current.hole;render();};
const skip=C.button({label:t('sim.flyover.skip'),variant:'primary',size:'lg',block:true,testid:'round-flyover-skip',onClick:()=>(fly?fly.skip():done())});
const box=h('section.round-intro',{'data-testid':'round-flyover','data-static':stat?'1':'0'},
h('h2.round-intro-title',t('sim.hole_title',{n:hole.n})),h('p.round-intro-sub',t('sim.hole_meta',{of:round.course.holes_n,par:hole.par,length:fmt(hole.length_m)})),canvas,skip);
box.addEventListener('click',(e)=>{if(!e.target.closest?.('button'))fly?.skip();});
clear(root,header(),box);
fly=createFlyover(canvas,{hole,palette:coursePalette(canvas),reducedMotion:stat,onDone:done,tees:round.course.tees});
fly.start();
const f=fly;
root.dataset.flyFrames=String(f.stats().frames);
const tick=()=>{if(fly===f){root.dataset.flyFrames=String(f.stats().frames);if(!f.stats().done)anim=requestAnimationFrame(tick);}};
if(!stat)anim=requestAnimationFrame(tick);
pendingFocus=skip;
}

function renderHandoff(){
const p=playerOf(round.current.player_id);
const i=playerIdx(p.player_id);
const go=C.button({label:t('sim.handoff.go',{name:nameOf(p)}),variant:'primary',size:'xl',block:true,testid:'round-handoff-go',
onClick:()=>{handedTo=p.player_id;render();}});
clear(root,header(),h('section.round-handoff',{'data-testid':'round-handoff','data-player':p.player_id},
h('p.round-handoff-pre',t('sim.handoff.pass')),
h('h2.round-handoff-name',{},h('span.player-swatch',{'data-p':String(i),'aria-hidden':'true'}),nameOf(p)),
h('p.round-handoff-sub',t('sim.handoff.sub',{n:round.current.hole,stroke:strokeContext(round).ball.n})),go));
pendingFocus=go;
}

function scoreList(hn){
const sc=(round.players).map((p)=>{
const b=ballOf(round,p.player_id,hn);
return h('li.round-score-row',{},h('span.player-swatch',{'data-p':String(playerIdx(p.player_id)),'aria-hidden':'true'}),
h('span.rs-name',nameOf(p)),h('span.rs-val',b.done?(b.picked_up?t('sim.picked_up',{n:b.score}):String(b.score)):'—'));
});
return h('ul.round-scores',{'data-testid':'round-hole-scores'},sc);
}

function renderHoleDone(finished=false){
const hn=doneHole??round.course.holes_n;
const hole=round.course.holes[hn-1];
const toCard=C.button({label:t('sim.scorecard'),variant:finished?'primary':'secondary',size:'lg',block:true,testid:'round-scorecard',
onClick:()=>app.nav.go('scorecard',{round_id:round.round_id,round:demo?round:undefined})});
const next=!finished&&round.current?C.button({label:t('sim.next_hole',{n:round.current.hole}),variant:'primary',size:'lg',block:true,testid:'round-next',
onClick:()=>{doneHole=null;notes=[];handedTo=null;render();}}):null;
clear(root,header(),h('section.round-holedone',{'data-testid':'round-holedone'},
h('h2',finished?t('sim.finished'):t('sim.hole_done',{n:hn})),h('p.round-intro-sub',holeLine(hole)),
notes.length?h('ul.round-notes',{},notes.map((n)=>h('li',n.text))):null,
scoreList(hn),next,toCard));
pendingFocus=next??toCard;
}

function chip(kind,value,dim,quick=false){
const v=value?.validity??'estimated';
return h('span.round-chip',{'data-testid':'round-chip','data-kind':kind,'data-dim':dim},
C.validityTag(v),quick?h('span.rc-sub',t('sim.quick_tag')):null,h('span.rc-src',t(`sim.source.${kind}`)));
}

function lastCard(hole){
const list=round.strokes.filter((s)=>s.hole===hole.n&&s.source!=='pickup');
const s=list[list.length-1];
if(!s)return null;
const p=playerOf(s.player_id);
const sg=strokeSigmas(s);
const head=t('sim.last.head',{name:nameOf(p),n:s.n,club:clubName(s.club)});
const carry=s.club==='putter'?t('sim.last.putt',{d:fmt(s.carry.value)})
:sg.carry?t('sim.last.carry',{d:honestDistance(s.carry.value,1.96*sg.carry,units()).text}):t('sim.last.carry_typed',{d:fmt(s.carry.value)});
return h('section.card.round-last',{'data-testid':'round-last','data-source':sourceKind(s),'data-side':sideKind(s)},
h('h3.rl-head',{},h('span.player-swatch',{'data-p':String(playerIdx(s.player_id)),'aria-hidden':'true'}),head),
h('p.rl-carry',carry),
h('div.rl-chips',{},h('span.rl-dim',t('sim.dim.carry')),chip(sourceKind(s),s.carry,'carry',s.source==='quick')),
s.club==='putter'?null:h('div.rl-chips',{},h('span.rl-dim',t('sim.dim.side')),chip(sideKind(s),s.side,'side',s.source==='quick')),
s.event?h('p.rl-event',{'data-event':s.event},`${t(`sim.event.${s.event}`)}${s.penalty?` · ${plural('sim.penalty',s.penalty)}`:''}`):null,
h('p.hint.rl-sim',t('sim.last.simulated')));
}

function renderPlay(){
const ctx=strokeContext(round);
const hole=ctx.hole;
const p=ctx.player;
const i=playerIdx(p.player_id);
const r0=rowsFor(p);
const rec=recommendClub({distance_m:ctx.to_pin_m,lie:ctx.ball.lie,dz_m:ctx.dz_m,player:{...p,gapping:r0.gap??[]}});
const putting=ctx.ball.lie==='green';
if(!clubPicked||!club)club=rec.club==='putter'?'pw':rec.club;
const from={x:ctx.ball.x,y:ctx.ball.y};
const pv0=previewEllipse(from,{x:hole.pin[0],y:hole.pin[1]},club,p,rowsForClub(p,club),ctx.ball.lie,ctx.style);
if(!aim)aim=defaultAim(hole,ctx.ball,pv0.median);
const pv=previewEllipse(from,aim,club,p,rowsForClub(p,club),ctx.ball.lie,ctx.style);
root.dataset.aimM=String(Math.round(dist(from.x,from.y,aim.x,aim.y)*100)/100);
root.dataset.club=club;

const canvas=h('canvas.round-map',{'data-testid':'round-map'});
const balls=round.players.map((q,k)=>{
const b=ballOf(round,q.player_id,hole.n);
return b.done?null:{x:b.x,y:b.y,player:k,current:q.player_id===p.player_id,name:nameOf(q)};
}).filter(Boolean);
const strokesHere=round.strokes.filter((s)=>s.hole===hole.n);
const draw=(progress=landing)=>{
const r=drawHole2d(canvas,{
hole,strokes:strokesHere,ellipse:putting?null:pv.ellipse,aim:putting?null:aim,from,band:putting?null:pv.band,
palette:coursePalette(canvas),units:units(),focus:putting?'green':'hole',balls,players:round.players,progress,
labels:{simulated:t('sim.simulated')},tees:round.course.tees,
});
lastView=r.view;
return r;
};


const setAim=(a)=>{aim=a;renderPlay();};
let dragging=false;
const toWorldAim=(e)=>{
if(!lastView)return null;
const rect=canvas.getBoundingClientRect();
const[x,y]=lastView.toWorld(e.clientX-rect.left,e.clientY-rect.top);
return dist(from.x,from.y,x,y)>5?{x,y}:null;
};
canvas.addEventListener('pointerdown',(e)=>{if(putting)return;dragging=true;canvas.setPointerCapture?.(e.pointerId);const a=toWorldAim(e);if(a){aim=a;draw(1);}});
canvas.addEventListener('pointermove',(e)=>{if(!dragging)return;const a=toWorldAim(e);if(a){aim=a;draw(1);}});
canvas.addEventListener('pointerup',()=>{if(!dragging)return;dragging=false;renderPlay();});
canvas.addEventListener('pointercancel',()=>{dragging=false;});

const turn=h('div.round-turn',{'data-testid':'round-turn','aria-live':'polite'},
h('p.round-turn-name',{},h('span.player-swatch',{'data-p':String(i),'aria-hidden':'true'}),t('sim.turn',{name:nameOf(p)})),
h('p.round-turn-sub',`${holeLine(hole)} · ${t('sim.stroke_n',{n:ctx.ball.n})}`),
round.rules.unobservedSide==='center'?h('span.round-pill',{'data-testid':'round-straight'},t('sim.straight_mode')):null);

const facts=h('dl.round-facts',{},
h('div',{},h('dt',t('sim.to_pin')),h('dd',{'data-testid':'round-to-pin'},fmt(ctx.to_pin_m))),
h('div',{},h('dt',t('sim.lie')),h('dd',t(`sim.lie.${ctx.ball.lie}`))),
Math.abs(ctx.dz_m)>=1?h('div',{},h('dt',t('sim.elevation')),h('dd',t(ctx.dz_m>0?'sim.uphill':'sim.downhill',{d:fmt(Math.abs(ctx.dz_m))}))):null);

const parts=[header(),turn,h('div.round-map-wrap',{},canvas),legend(),facts];
if(putting){
parts.push(puttPanel(ctx));
}else{
const recBox=h('button.card.round-recommend',{type:'button','data-testid':'round-recommend',onclick:()=>recommendSheet(rec,ctx)},
h('span.rr-label',t('sim.recommend')),
h('span.rr-club',clubName(rec.club)),
h('span.rr-tag',{},C.validityTag(recValidity(rec))),
h('span.rr-range',t('sim.likely_carry',{lo:fmt(rec.carry.p10),hi:fmt(rec.carry.p90)})),
h('span.rr-src',`${t(rec.source==='gapping'?'sim.source.gapping':'sim.source.reference')}${rec.flags.includes('small_sample')?` · ${t('sim.small_sample')}`:''}`));
const clubSel=select(CLUB_IDS.map((c)=>[c,clubName(c)]),club,{'data-testid':'round-club','aria-label':t('sim.club'),
onchange:(e)=>{club=e.target.value;clubPicked=true;aim=null;renderPlay();}});
const aimRow=h('div.round-aim',{role:'group','aria-label':t('sim.aim')},
C.button({label:t('sim.aim.left'),icon:'chevron-left',testid:'round-aim-left',onClick:()=>setAim(rotateAim(from,aim,AIM_STEP_DEG))}),
C.button({label:t('sim.aim.right'),icon:'chevron-right',testid:'round-aim-right',onClick:()=>setAim(rotateAim(from,aim,-AIM_STEP_DEG))}),
C.button({label:t('sim.aim.reset'),variant:'plain',testid:'round-aim-reset',onClick:()=>setAim(null)}));
const aimInfo=h('p.hint.round-aim-info',t('sim.aim.info',{d:fmt(dist(from.x,from.y,aim.x,aim.y)),lo:fmt(pv.band.p10),hi:fmt(pv.band.p90)}));


const goBar=h('div.round-go',{role:'group','aria-label':t('sim.turn',{name:nameOf(p)})},
h('span.round-go-name',{},h('span.player-swatch',{'data-p':String(i),'aria-hidden':'true'}),nameOf(p)),
C.button({label:t('sim.swing'),icon:'camera',variant:'primary',size:'lg',testid:'round-swing',onClick:()=>go('live')}));
const actions=h('div.round-actions',{},
C.button({label:t('sim.import'),icon:'film',size:'lg',block:true,testid:'round-import',onClick:()=>go('import')}),
C.button({label:t('sim.manual'),icon:'ruler',size:'lg',block:true,testid:'round-manual',onClick:()=>manualSheet(ctx)}),
canAutoChip(ctx)?C.button({label:t('sim.auto_chip'),variant:'tinted',size:'lg',block:true,testid:'round-autochip',onClick:()=>doAutoChip(ctx)}):null);
parts.push(recBox,h('label.field.round-club-field',{},h('span.field-label',t('sim.club')),clubSel),aimRow,aimInfo,goBar,actions);
}
parts.push(notes.length?h('ul.round-notes',{},notes.map((n)=>h('li',n.text))):null,lastCard(hole),
h('div.round-foot',{},
C.button({label:t('sim.scorecard'),variant:'plain',testid:'round-scorecard',onClick:()=>app.nav.go('scorecard',{round_id:round.round_id,round:demo?round:undefined})}),
C.button({label:t('sim.end'),variant:'plain',testid:'round-end',onClick:endRound})));
clear(root,...parts);

const first=draw(landing);
root.dataset.mapParams=JSON.stringify(first.params);
if(landing<1)animateLanding(draw);
}

function legend(){
return h('ul.round-legend',{'aria-label':t('sim.legend')},
round.players.map((q,k)=>h('li',{},h('span.player-swatch',{'data-p':String(k),'aria-hidden':'true'}),nameOf(q))),
h('li',{},h('span.legend-ellipse',{'aria-hidden':'true'}),t('sim.ellipse')));
}

function animateLanding(draw0){
const motion=!reducedMotion();
let frames=0;

const draw=(u)=>{frames++;root.dataset.landingFrames=String(frames);draw0(u);};
if(!motion){landing=1;draw(1);return;}
const t0=performance.now();
const step=()=>{
const u=Math.min(1,(performance.now()-t0)/LANDING_MS);
landing=u;
draw(u);
anim=u<1?requestAnimationFrame(step):null;
};
anim=requestAnimationFrame(step);
}

function canAutoChip(ctx){
const lim=round.rules.autoChipM??0;
return lim>0&&ctx.ball.lie!=='green'&&ctx.ball.to_pin_m<=lim;
}

function puttPanel(ctx){
if(round.rules.putting==='auto')return h('p.hint',t('sim.putts.pending'));
let n=2;
const seg=C.segmented({options:[1,2,3,4,5,6].map((k)=>[String(k),String(k)]),value:'2',label:t('sim.putts.count'),testid:'round-putts',onChange:(v)=>{n=Number(v);}});
return h('section.card.round-putting',{'data-testid':'round-putting'},
h('h3',t('sim.putts.title',{d:fmt(ctx.to_pin_m)})),h('p.hint',t('sim.putts.manual_hint')),seg,
C.button({label:t('sim.putts.save'),variant:'primary',size:'lg',block:true,testid:'round-putts-save',onClick:async()=>{
const hn=round.current.hole;
const res=manualPutts(round,ctx.player.player_id,n);
await commit(res.round,hn);
}}));
}

async function doAutoChip(ctx){
const hn=round.current.hole;
const res=autoChip(round,ctx.player.player_id,mulberry32(ctx.seed));
await commit(res.round,hn,true);
}

function simCtx(){
const ctx=strokeContext(round);
return{round_id:round.round_id,hole:round.current.hole,player_id:ctx.player.player_id,stroke_n:ctx.ball.n,club,view:app.current?.view??null,name:nameOf(ctx.player)};
}

function go(screen){
app.sim.set(simCtx());
app.nav.go(screen,{sink:'sim'});
}

function manualSheet(ctx){
const u=units().distance;
const carryIn=h('input',{type:'text',inputmode:'decimal','data-testid':'round-manual-carry',autocomplete:'off','aria-describedby':'round-manual-hint'});
const sideIn=h('input',{type:'text',inputmode:'decimal','data-testid':'round-manual-side',autocomplete:'off'});
let dir;
const dirSeg=C.segmented({options:[['left',t('sim.manual.left')],['right',t('sim.manual.right')]],value:dir,label:t('sim.manual.direction'),testid:'round-manual-dir',onChange:(v)=>{dir=v;}});
const err=h('p.field-error',{role:'alert','data-testid':'round-manual-error'});
const box=h('div.round-manual',{},
h('p#round-manual-hint.hint',t('sim.manual.hint')),
h('label.field',{},h('span.field-label',t('sim.manual.carry',{unit:unitLabel(u)})),carryIn),
h('label.field',{},h('span.field-label',t('sim.manual.side',{unit:unitLabel(u)})),sideIn,h('span.hint',t('sim.manual.side_hint'))),
dirSeg,err);
let sh=null;
const ok=C.button({label:t('sim.manual.save'),variant:'primary',size:'lg',block:true,testid:'round-manual-save',onClick:()=>{
const c=parseInput(carryIn.value,u);
if(!(typeof c==='number'&&c>=1&&c<=400)){err.textContent=t('sim.manual.bad_carry');carryIn.focus();return;}
let side=null;
if(sideIn.value.trim()){
const s=parseInput(sideIn.value,u);
if(!(typeof s==='number'&&Math.abs(s)<=150)){err.textContent=t('sim.manual.bad_side');sideIn.focus();return;}
if(!dir&&Math.abs(s)>0){err.textContent=t('sim.manual.need_dir');dirSeg.querySelector?.('[role="radio"]')?.focus();return;}
const hand=ctx.player.handedness==='left'?-1:1;
side=s===0?0:(dir==='right'?1:-1)*Math.abs(s)*hand;
}
sh.close();
app.sim.set(simCtx());
app.sim.submit({kind:'manual',carry_m:c,side_m:side});
}});
box.append(ok);
sh=C.sheet({title:t('sim.manual.title',{name:nameOf(ctx.player),club:clubName(club)}),content:box,testid:'round-manual-sheet'});
sh.open();
return sh;
}



function recValidity(rec){
return rec.source==='gapping'&&!rec.flags.includes('small_sample')?'estimated':'low_confidence';
}

function recommendSheet(rec,ctx){
const box=h('div.round-rec',{},
h('p',t('sim.rec.body',{club:clubName(rec.club),d:fmt(rec.plays_like_m)})),
h('p.rr-sheet-range',{},C.validityTag(recValidity(rec)),h('span',t('sim.likely_carry',{lo:fmt(rec.carry.p10),hi:fmt(rec.carry.p90)}))),
h('p.hint',t(rec.source==='gapping'?'sim.rec.gapping':'sim.rec.reference')),
rec.flags.includes('small_sample')?h('p.hint',t('sim.rec.small_sample')):null,
rec.alts.length?h('p',t('sim.rec.alts',{a:rec.alts.map(clubName).join(' / ')})):null,
ctx.player.kind==='guest'?h('p.hint',t('sim.rec.guest')):null);
const sh=C.sheet({title:t('sim.recommend'),content:box,testid:'round-recommend-sheet'});
sh.open();
return sh;
}

async function endRound(){
const ok=await C.confirmSheet({title:t('sim.end.title'),consequence:t('sim.end.body'),confirmLabel:t('sim.end.confirm'),cancelLabel:t('sim.end.keep'),destructive:true,testid:'round-end'});
if(!ok)return;
round={...round,status:'abandoned',updated_at:nowIso()};
app.sim.set(null);
await save();
app.nav.go('scorecard',{round_id:round.round_id,round:demo?round:undefined});
}

async function commit(next,holeBefore,animate=true){
round={...next,updated_at:nowIso()};
const holeAfter=round.current?.hole??null;
aim=null;
clubPicked=false;
landing=animate?0:1;
if(holeAfter!==holeBefore){doneHole=holeBefore;}
await settle();
if(round.status!=='active')app.sim.set(null);
await save();
if(mode==='holedone'||doneHole)landing=1;
if(app.nav.current()==='round')render();
}


async function onInput(input,ctxIn){
if(!round||!round.current)return;
const sc=strokeContext(round);
const ctx=ctxIn??{};
if(ctx.round_id&&(ctx.round_id!==round.round_id||ctx.player_id!==sc.player.player_id||ctx.hole!==round.current.hole||ctx.stroke_n!==sc.ball.n)){
C.toast.info(t('sim.stale'));
return;
}
const useClub=ctx.club??club??'driver';
const view=input.kind==='quick'?(input.result?.view??ctx.view??app.current?.view??null):input.kind==='shot'?(input.shot?.capture?.view??null):null;
try{
const out=shotOutcome({input,view,club:useClub,player:sc.player,rows:rowsForClub(sc.player,useClub),rules:round.rules,rng:mulberry32(sc.seed),lie:sc.ball.lie,style:sc.style});
const a=aim??defaultAim(sc.hole,sc.ball,out.carry.value);
const hn=round.current.hole;
const res=playStroke(round,out,a);
await commit(res.round,hn);
}catch(e){
app.errors?.report?.(e,{where:'round.stroke'});
}
}
app.sim.onSubmit((input,ctx)=>{onInput(input,ctx);});

async function show(params={}){
stopAnims();
const next=await load(params);
const same=round&&next&&next.round_id===round.round_id;

if(!(same&&!params.round&&!params.reset)){
round=next;
demo=Boolean(params.round);
shownHole=params.skipIntro&&round?.current?round.current.hole:null;
handedTo=null;
doneHole=null;
notes=[];
aim=null;
clubPicked=false;
landing=1;
forceStatic=Boolean(params.staticIntro);
rows=round?await ownRows(app):{gap:[],side:{}};
if(round?.status==='active')await settle();
}
render();
}


const e2e=app.e2e;
const playDemo=async(o={})=>{
await show({round:demoRound(o),skipIntro:true,reset:true});
handedTo=round.current.player_id;
render();
};
e2e?.registerState?.('round','flyover',async()=>{await show({round:demoRound(),staticIntro:true,reset:true});});
e2e?.registerState?.('round','aim',async()=>{await playDemo();aim=rotateAim({x:strokeContext(round).ball.x,y:strokeContext(round).ball.y},aim,2*AIM_STEP_DEG);render();});
e2e?.registerState?.('round','recommend',async()=>{await playDemo();root.querySelector('[data-testid="round-recommend"]')?.click();});
e2e?.registerState?.('round','manual',async()=>{await playDemo();root.querySelector('[data-testid="round-manual"]')?.click();});
e2e?.registerState?.('round','green',async()=>{
await playDemo({players:2,putting:'manual'});

round=typeInUntil(round,(r)=>strokeContext(r).ball.lie==='green',24);
handedTo=round.current?.player_id??null;
landing=1;
render();
});
e2e?.registerState?.('round','perf',async()=>{


const r=demoRound({seed:42,styleId:'links',holes:18,players:1});
await show({round:r,reset:true});
const f=fly;
await new Promise((res)=>{const w=()=>(f.stats().done?res():setTimeout(w,50));w();});
const flyStats=f.stats();

for(let k=0;k<12&&round.current?.hole===1;k++){
const sc=strokeContext(round);
const target=defaultAim(sc.hole,sc.ball,230);
const out=shotOutcome({input:{kind:'manual',carry_m:Math.max(5,dist(sc.ball.x,sc.ball.y,target.x,target.y)-4),side_m:0},club:'7i',player:sc.player,rows:{},rules:round.rules,rng:mulberry32(sc.seed),lie:sc.ball.lie,style:sc.style});
await commit(playStroke(round,out,target).round,1,false);
}
const t0=performance.now();
root.querySelector('[data-testid="round-next"]')?.click();
await new Promise((res)=>requestAnimationFrame(()=>res()));
const tFly=performance.now()-t0;
const t1=performance.now();
root.querySelector('[data-testid="round-flyover-skip"]')?.click();
await new Promise((res)=>requestAnimationFrame(()=>res()));
const tPlay=performance.now()-t1;
return{frames:flyStats.frames,ms:flyStats.ms,next_to_flyover_ms:tFly,skip_to_play_ms:tPlay,mode};
});

return{
async show(params){
await show(params);
const f=pendingFocus;
pendingFocus=null;
if(f&&opts.focusPrimary)f.focus?.();
},
hide(){stopAnims();},
};
}
