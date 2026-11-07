














import{RC}from'./reason-codes.js';
import{SCHEMA_V1,SCHEMA_V2,LM_METRIC_IDS,METRIC_UNITS,METRIC_DEFAULT_ORIGIN,LM_ALGORITHM_NONE}from'./enums.js';

export{SCHEMA_V1,SCHEMA_V2};

const isObj=(x)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const copy=(x)=>(x===undefined?undefined:JSON.parse(JSON.stringify(x)));


export function migratedNull(id){
return{
value:null,unit:METRIC_UNITS[id],ci95:null,sigma:null,validity:'not_computed',
value_origin:METRIC_DEFAULT_ORIGIN[id],measured:false,reason_codes:[RC.MIGRATED_V1],
};
}

export function migrateShot(any){
if(!isObj(any)||any.schema!==SCHEMA_V1)return{shot:any,migrated:false};
const out={};
for(const[k,v]of Object.entries(any))if(v!==undefined)out[k]=copy(v);
out.schema=SCHEMA_V2;
if(isObj(out.algorithms)&&!('lm'in out.algorithms))out.algorithms.lm={...LM_ALGORITHM_NONE};
if(isObj(out.metrics))for(const id of LM_METRIC_IDS)if(!(id in out.metrics))out.metrics[id]=migratedNull(id);
for(const k of['flight','tracks','practice'])if(!(k in out))out[k]=null;
return{shot:out,migrated:true};
}
