






import{REASON_CODES}from'./reason-codes.js';
import{VALUE_VALIDITIES,NULL_VALIDITIES}from'./enums.js';
import{ContractError,validateMetric}from'./validate.js';

const VALUE_INPUT_KEYS=['value','unit','ci95','sigma','validity','value_origin','measured','reason_codes'];

function fail(who,errors){
const text=errors.map((e)=>`${e.path}: ${e.msg}`).join('; ');
throw new ContractError(`${who}: ${text}`,errors);
}


function normalizeCodes(codes,who){
if(codes===undefined||codes===null)return[];
const list=typeof codes==='string'?[codes]:codes;
if(!Array.isArray(list))throw new ContractError(`${who}: reason codes must be a string or an array of strings`);
return[...new Set(list)];
}

function finish(who,metric){
const errors=validateMetric(metric);
if(errors.length)fail(who,errors);
return metric;
}






export function metricValue(input){
if(input===null||typeof input!=='object'||Array.isArray(input)){
throw new ContractError('metricValue: expected an options object');
}
for(const k of Object.keys(input)){
if(!VALUE_INPUT_KEYS.includes(k))throw new ContractError(`metricValue: unknown option '${k}'`);
}
if(input.value===null||input.value===undefined){
throw new ContractError('metricValue: value must be a finite number (use metricNull for an honest null)');
}
if(!VALUE_VALIDITIES.includes(input.validity)){
throw new ContractError(`metricValue: validity must be one of ${VALUE_VALIDITIES.join('|')} for a number, got ${String(input.validity)}`);
}
const metric={
value:input.value,
unit:input.unit,
ci95:input.ci95===undefined||input.ci95===null?null:Array.from(input.ci95),
sigma:input.sigma===undefined?null:input.sigma,
validity:input.validity,
value_origin:input.value_origin,
measured:input.measured===undefined?false:input.measured,
reason_codes:normalizeCodes(input.reason_codes,'metricValue'),
};
return finish('metricValue',metric);
}






export function metricNull(validity,codes,unit,value_origin='derived'){
if(!NULL_VALIDITIES.includes(validity)){
throw new ContractError(`metricNull: validity must be one of ${NULL_VALIDITIES.join('|')} for a null, got ${String(validity)}`);
}
const list=normalizeCodes(codes,'metricNull');
if(list.length===0)throw new ContractError('metricNull: at least one reason code is required');
const metric={
value:null,
unit,
ci95:null,
sigma:null,
validity,
value_origin,
measured:false,
reason_codes:list,
};
return finish('metricNull',metric);
}






export function downgrade(metric,code){
if(typeof code!=='string'||!Object.prototype.hasOwnProperty.call(REASON_CODES,code)){
throw new ContractError(`downgrade: unknown reason code ${String(code)}`);
}
if(metric===null||typeof metric!=='object'||!Array.isArray(metric.reason_codes)){
throw new ContractError('downgrade: expected a Metric value');
}
const next={
...metric,
ci95:metric.ci95===null?null:Array.from(metric.ci95),
reason_codes:metric.reason_codes.includes(code)?[...metric.reason_codes]:[...metric.reason_codes,code],
};
if(next.value!==null)next.validity='low_confidence';
return finish('downgrade',next);
}
