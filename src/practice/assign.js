








const timeOf=(x)=>{
if(typeof x==='number')return Number.isFinite(x)?x:NaN;
return Date.parse(String(x??''));
};

export function openSlots(drill){
return(drill?.slots??[]).filter((s)=>!s.shot_id).map((s)=>s.slot);
}

export function assignClips(drill,clips){
const order=(clips??[]).map((c,i)=>({i,t:timeOf(c?.started_at)}));
order.sort((a,b)=>{
const fa=Number.isFinite(a.t);
const fb=Number.isFinite(b.t);
if(fa&&fb&&a.t!==b.t)return a.t-b.t;
if(fa!==fb)return fa?-1:1;
return a.i-b.i;
});
const open=openSlots(drill);
return order.map((o,j)=>({slot:open[j]??null,clipIndex:o.i}));
}
