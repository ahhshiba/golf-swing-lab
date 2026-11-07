

let counter=0;


export function newId(prefix,env=globalThis){
const c=env.crypto;
if(c&&typeof c.randomUUID==='function')return`${prefix}-${c.randomUUID()}`;
counter+=1;
return`${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}


export function nowIso(){
return new Date().toISOString();
}
