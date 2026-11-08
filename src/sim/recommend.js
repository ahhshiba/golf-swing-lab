













import{CLUBS}from'../session/settings.js';
import{SIM_PARAMS as P}from'./params.js';
import{lieFactors}from'./lies.js';
import{playerCarries}from'./source.js';


export{playerCarries};

const r1=(x)=>Math.round(x*10)/10;








export function recommendClub({distance_m,lie='fairway',dz_m=0,player={},gapping=null}={}){
if(!(typeof distance_m==='number'&&Number.isFinite(distance_m)&&distance_m>=0))throw new RangeError('recommendClub: distance_m must be a number >= 0');
const dz=typeof dz_m==='number'&&Number.isFinite(dz_m)?dz_m:0;
const target=distance_m+dz*P.dz_factor;
if(lie==='green'){
const d=r1(distance_m);
return{club:'putter',carry:{median:d,p10:d,p90:d},alts:[],source:'reference',flags:[],plays_like_m:d,scaled:false,validity:'low_confidence',reason_codes:[]};
}
const rows=Array.isArray(gapping)?gapping:Array.isArray(player?.gapping)?player.gapping:[];
let ids=CLUBS.map((c)=>c[0]);
if(lie!=='tee')ids=ids.filter((c)=>c!=='driver');
if(lie==='bunker'&&distance_m<=P.greenside_bunker_m)ids=['sw'];
const carries=playerCarries(player,rows);
const cand=ids.map((club)=>{
const pr=carries.find((x)=>x.club===club);
const f=lieFactors(lie,club).carry;
return{club,pr,median:pr.median*f,p10:pr.p10*f,p90:pr.p90*f};
}).sort((a,b)=>b.median-a.median);
let best=0;
for(let i=1;i<cand.length;i++)if(Math.abs(cand[i].median-target)<Math.abs(cand[best].median-target))best=i;
const c=cand[best];
const alts=[];
if(best>0)alts.push(cand[best-1].club);
if(best<cand.length-1)alts.push(cand[best+1].club);
if(alts.length<2&&cand.length>2)alts.push(cand[best===0?2:cand.length-3].club);
return{
club:c.club,carry:{median:r1(c.median),p10:r1(c.p10),p90:r1(c.p90)},alts:alts.slice(0,2),
source:c.pr.source,flags:c.pr.small_sample?['small_sample']:[],plays_like_m:r1(target),
scaled:c.pr.scaled,validity:c.pr.validity,reason_codes:c.pr.reason_codes,
};
}
