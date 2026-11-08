






import{h,clear}from'./dom.js';
import*as C from'./components.js';
import{t,plural}from'../i18n/index.js';
import{fmtQuantity}from'../i18n/units.js';
import{clubName}from'./glossary.js';
import{scorecard}from'../sim/round.js';
import{sourceKind,sideKind,strokeSigmas}from'../course/draw2d.js';



export function shortNames(names){
const cut=names.map((n)=>{
const cps=Array.from(String(n??''));
if(cps.some((c)=>/\p{Script=Han}/u.test(c)))return cps.slice(0,2).join('');
return cps.length<=4?cps.join(''):`${cps.slice(0,3).join('')}.`;
});
return cut.map((c,i)=>(cut.indexOf(c)!==i||cut.lastIndexOf(c)!==i?`${c}${i+1}`:c));
}


export const relKind=(rel)=>(rel===null?'':rel<=-2?'eagle':rel===-1?'birdie':rel===0?'par':rel===1?'bogey':'double');

const toPar=(n)=>(n===null||n===undefined?'—':n===0?t('score.even'):n>0?`+${n}`:String(n));

export function mountScorecard(root,app){
let round=null;
const fmt=(m)=>fmtQuantity(m,'distance',app.units()).text;
const nameOf=(p)=>p?.name||t(p?.kind==='guest'?'course.player.guest':'course.player.owner');

async function load(params){
if(params.round&&typeof params.round==='object')return params.round;
if(!app.repo?.rounds)return null;
try{
if(params.round_id)return(await app.repo.rounds.get(params.round_id))??null;
const list=await app.repo.rounds.list();
return list.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0]??null;
}catch(e){
app.errors?.report?.(e,{where:'scorecard.load',silent:true});
return null;
}
}

function strokesSheet(p,hole){
const list=round.strokes.filter((s)=>s.player_id===p.player_id&&s.hole===hole.n);
const items=list.map((s)=>{
if(s.source==='pickup')return h('li.sc-stroke',{},h('span.sc-stroke-head',t('score.pickup')));
const sg=strokeSigmas(s);
const carry=s.club==='putter'?fmt(s.carry.value):`${fmt(s.carry.value)}${sg.carry?` ± ${fmt(1.96*sg.carry)}`:''}`;
return h('li.sc-stroke',{'data-testid':'score-stroke','data-source':sourceKind(s)},
h('span.sc-stroke-head',`${s.n}. ${clubName(s.club)} · ${carry}`),
h('span.sc-stroke-src',{},C.validityTag(s.carry.validity),h('span',t(`sim.source.${sourceKind(s)}`)),
s.club==='putter'?null:h('span',`· ${t('sim.dim.side')}: ${t(`sim.source.${sideKind(s)}`)}`)),
s.event?h('span.sc-stroke-ev',`${t(`sim.event.${s.event}`)}${s.penalty?` · ${plural('sim.penalty',s.penalty)}`:''}`):null);
});
const box=h('div.sc-sheet',{},items.length?h('ol.sc-strokes',{},items):h('p',t('score.not_played')),h('p.hint',t('score.disclaimer')));
C.sheet({title:t('score.cell_title',{name:nameOf(p),n:hole.n}),content:box,testid:'score-cell-sheet'}).open();
}

function table(card){
const players=round.players;
const holes=round.course.holes;
const short=shortNames(players.map(nameOf));
const head=h('tr',{},h('th',{scope:'col'},t('score.hole')),h('th',{scope:'col'},t('score.par')),
players.map((p,i)=>h('th.sc-player',{scope:'col','aria-label':nameOf(p),title:nameOf(p)},h('span.player-swatch',{'data-p':String(i),'aria-hidden':'true'}),h('span.sc-pname',{'aria-hidden':'true'},short[i]))));
const rowsFor=(from,to)=>holes.slice(from,to).map((hole)=>h('tr',{'data-hole':String(hole.n)},
h('th',{scope:'row'},String(hole.n)),h('td',String(hole.par)),
card.players.map((cp,i)=>{
const r=cp.holes[hole.n-1];
const text=r.done?String(r.strokes):r.so_far?`(${r.so_far})`:'—';
const rel=r.done?r.strokes-r.par:null;
return h('td',{},h('button.sc-cell',{
type:'button','data-testid':'score-cell','data-player':cp.player_id,'data-hole':String(hole.n),'data-strokes':r.done?String(r.strokes):'',
'data-rel':rel===null?'':rel<0?'under':rel>0?'over':'par','data-mark':relKind(rel),
'aria-label':t('score.cell_a11y',{name:nameOf(players[i]),n:hole.n,s:text,putts:r.putts??'—',pen:r.penalties}),
onclick:()=>strokesSheet(players[i],hole),
},h('span.sc-mark',text),r.penalties?h('span.sc-pen',{'aria-hidden':'true'},'•'):null,r.picked_up?h('span.sc-pen',{'aria-hidden':'true'},'↑'):null));
})));
const sumRow=(label,key,testid)=>h('tr.sc-sum',{'data-testid':testid},h('th',{scope:'row',colspan:'2'},label),
card.players.map((cp)=>h('td',{'data-player':cp.player_id},key(cp))));
const parOf=(from,to)=>holes.slice(from,to).reduce((a,x)=>a+x.par,0);
const sumOf=(cp,f)=>cp.holes.reduce((a,r)=>a+(f(r)??0),0);
const body=[...rowsFor(0,9),sumRow(`${t('score.out')} (${parOf(0,9)})`,(cp)=>cp.out??'—','score-out')];
if(holes.length>9)body.push(...rowsFor(9,18),sumRow(`${t('score.in')} (${parOf(9,18)})`,(cp)=>cp.in??'—','score-in'));
body.push(sumRow(t('score.total'),(cp)=>cp.total??'—','score-total'),sumRow(t('score.to_par'),(cp)=>toPar(cp.to_par),'score-to-par'),
sumRow(t('score.putts'),(cp)=>sumOf(cp,(r)=>r.putts),'score-putts'),sumRow(t('score.penalties'),(cp)=>sumOf(cp,(r)=>r.penalties),'score-penalties'));
return h('div.sc-wrap',{},h('table.sc-table',{'data-testid':'score-table'},h('caption.visually-hidden',t('score.caption')),h('thead',{},head),h('tbody',{},body)));
}

async function share(){
try{
const m=await import('./share.js');
await m.openShareSheet(app,{kind:'round',round,playerId:round.players[0]?.player_id??null});
}catch(e){
app.errors?.report?.(e,{where:'scorecard.share'});
}
}

async function show(params={}){
round=await load(params);
const head=C.screenHeader({title:app.screenTitle('scorecard'),back:true,onBack:()=>app.nav.back()});
const disclaimer=h('p.hint.sc-disclaimer',{'data-testid':'score-disclaimer','data-i18n-key':'score.disclaimer'},t('score.disclaimer'));
if(!round){
clear(root,head,C.emptyState({icon:'flag',title:t('score.none.title'),body:t('score.none.body'),testid:'scorecard-empty'}),disclaimer);
return;
}
const card=scorecard(round);
root.dataset.roundId=round.round_id;
const legend=h('ul.sc-legend',{},round.players.map((p,i)=>h('li',{},h('span.player-swatch',{'data-p':String(i),'aria-hidden':'true'}),nameOf(p))));
const meta=[t(`course.style.${round.course.style}`),t('course.holes',{n:round.course.holes_n}),`${t('course.seed')} ${String(round.course.seed).padStart(6,'0')}`,t(`course.tees.${round.course.tees}`)].join(' · ');
clear(root,head,
h('p.sc-meta',meta),
round.status!=='finished'?h('p.round-pill.sc-status',{'data-testid':'score-status'},t(`course.status.${round.status}`)):null,
round.rules?.unobservedSide==='center'?h('p.round-pill',{'data-testid':'score-straight'},t('sim.straight_mode')):null,
legend,table(card),
h('p.hint',t('score.key')),
h('div.sc-actions',{},
round.status==='active'?C.button({label:t('score.resume'),variant:'primary',size:'lg',block:true,testid:'score-resume',onClick:()=>app.nav.go('round',{round_id:round.round_id})}):null,
C.button({label:t('score.share'),icon:'share',size:'lg',block:true,testid:'score-share',onClick:share})),
disclaimer);
}


app.e2e?.registerState?.('scorecard','full',async()=>{
const{demoRound,typeInUntil}=await import('./round.js');
const r=typeInUntil(demoRound({seed:7,styleId:'mixed',holes:18,players:2}),()=>false);
await show({round:{...r,status:'finished'}});
});

return{show};
}
