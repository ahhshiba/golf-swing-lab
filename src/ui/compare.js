



import*as C from'./components.js';
import{t,has,fmtNum}from'../i18n/index.js';
import{fmtMetric}from'../i18n/units.js';
import{compareShots,compareSets,diffSummary}from'../store/compare.js';
import{RC}from'../contract/reason-codes.js';
import{clubName,viewName,metricName}from'./glossary.js';

function el(tag,cls,text){
const e=document.createElement(tag);
if(cls)e.className=cls;
if(text!==undefined&&text!==null)e.textContent=text;
return e;
}


export function noteText(n){
const p=n?.params??{};
switch(n?.kind){
case'view_mismatch':return t('compare.note.view_mismatch',{a:viewName(p.a),b:viewName(p.b)});
case'club_mismatch':return t('compare.note.club_mismatch',{a:clubName(p.a),b:clubName(p.b)});
case'empty_set':return t('compare.note.empty_set',{side:p.side??''});
default:return has(`compare.note.${n?.kind}`)?t(`compare.note.${n.kind}`,p):t('compare.note.other');
}
}

const fmtVal=(value,unit,id,units)=>fmtMetric({value,unit},units,{id});


export function diffLine(r,units){
const amount=fmtVal(Math.abs(r.delta),r.unit,r.id,units).text;
const dir=t(`compare.dir.${r.direction}`,{amount});
const sig=r.significant===true?t('compare.sig.yes'):(r.significant===false?t('compare.sig.no'):t('compare.sig.unknown'));
return{name:metricName(r.id),text:`${dir} · ${sig}`,significant:r.significant===true};
}

export function openCompare({A=[],B=[],units}={}){
const single=A.length===1&&B.length===1;
const r=single?compareShots(A[0],B[0]):compareSets(A,B);
const box=el('div','compare');
const head=el('p','cmp-sides',single?t('compare.sides.shots'):t('compare.sides.sets',{a:A.length,b:B.length}));
box.append(head);
const same=r.warnings.includes(RC.PRESET_MISMATCH)
?C.notice({variant:'caution',title:t('reason.PRESET_MISMATCH.short'),body:t('reason.PRESET_MISMATCH.long')})
:C.notice({variant:'info',title:t('compare.same_setup')});
box.append(same);
if(r.notes.length)box.append(C.notice({variant:'caution',title:t('compare.notes_title'),items:r.notes.map(noteText)}));

const rows=diffSummary(r).filter((x)=>x.direction!=='same');
if(!rows.length)box.append(el('p','hint',t('compare.nothing')));
else{
const ul=el('ul','cmp-lines');
for(const x of rows.slice(0,8)){
const d=diffLine(x,units);
const li=el('li',d.significant?'cmp-line is-sig':'cmp-line');
li.append(el('span','cmp-name',d.name),el('span','cmp-text',d.text));
ul.append(li);
}
box.append(el('h3','cmp-h',t('compare.lines_title')),ul);
}

const det=el('details','cmp-table');
det.append(el('summary',null,t('compare.table')));
const table=el('table','cmp');
const thead=el('thead');
const tr=el('tr');
for(const k of['compare.col.metric','compare.col.a','compare.col.b','compare.col.delta'])tr.append(el('th',null,t(k)));
thead.append(tr);
const tbody=el('tbody');
for(const m of Object.values(r.metrics)){
if(m.status!=='compared')continue;
const a=r.kind==='shots'?fmtVal(m.a.value,m.unit,m.id,units).text:t('compare.mean_n',{v:fmtVal(m.a.mean,m.unit,m.id,units).text,n:m.a.n});
const b=r.kind==='shots'?fmtVal(m.b.value,m.unit,m.id,units).text:t('compare.mean_n',{v:fmtVal(m.b.mean,m.unit,m.id,units).text,n:m.b.n});
const sign=m.delta>0?'+':'';
const d=Number.isFinite(m.delta)?`${sign}${fmtVal(m.delta,m.unit,m.id,units).text}${m.significant?' *':''}`:'—';
const row=el('tr');
row.append(el('td',null,metricName(m.id)),el('td',null,a),el('td',null,b),el('td',null,d.replace('+-','−')));
tbody.append(row);
}
table.append(thead,tbody);
det.append(table,el('p','hint',t('compare.star_note')));
box.append(det);
box.append(el('p','hint',t('compare.how',{n:fmtNum(95)})));
const s=C.sheet({title:t('compare.title'),content:box,testid:'compare-sheet'});
s.open();
return s;
}
