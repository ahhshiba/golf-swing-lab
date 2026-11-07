


















export const SCREENS=Object.freeze(['home','venue','setup','live','import','shot','history','diag','settings','about']);
export const SUB_SCREENS=Object.freeze(['venues','teach','privacy','help','licences','developer','drills','drill','stats','gapping']);
export const DATA_SCREENS=Object.freeze(['shot','stats','gapping','drill']);
export const ALL_SCREENS=Object.freeze([...SCREENS,...SUB_SCREENS]);


export const TABS=Object.freeze({practice:'home',history:'history',settings:'settings'});
export const TABBAR_HIDDEN=Object.freeze(['setup','live']);
const TAB_OF=Object.freeze({
home:'practice',venue:'practice',setup:'practice',live:'practice',import:'practice',drills:'practice',drill:'practice',
history:'history',teach:'history',stats:'history',gapping:'history',
settings:'settings',diag:'settings',about:'settings',venues:'settings',privacy:'settings',help:'settings',licences:'settings',developer:'settings',
});

export function tabOf(screen,prevTab='practice'){
return TAB_OF[screen]??(Object.hasOwn(TABS,prevTab)?prevTab:'practice');
}


export const SESSION_SCREENS=Object.freeze(['setup','live','import','shot']);

export function initialState(){
return{
screen:'home',
params:{},
stack:[],
booted:false,
repoReady:false,
sessionActive:false,
session:null,
updateAvailable:false,
updatePending:false,
venueId:null,
presetId:null,
view:'face_on',
status:'',
restoreFocus:null,
permissions:{motion:'unknown',camera:'unknown',microphone:'unknown',wakeLock:'unknown'},
lastShotId:null,
touches:0,
thermal:{degraded:false,model:'full',sampling:1},
healthPrompts:[],
backgroundRebuild:false,
eventModel:null,
};
}

export function createStore(initial=initialState()){
let state=Object.freeze({...initial});
const subs=new Set();
return{
get:()=>state,
set(patch){
const p=typeof patch==='function'?patch(state):patch;
if(!p||typeof p!=='object')return state;
const prev=state;
state=Object.freeze({...state,...p});
for(const fn of[...subs])fn(state,prev);
return state;
},
subscribe(fn){
subs.add(fn);
return()=>subs.delete(fn);
},
};
}


export function createNavigator(store){
return{
go(screen,params={},{opener=null}={}){
if(!ALL_SCREENS.includes(screen))throw new RangeError(`unknown screen '${screen}'`);
const s=store.get();
if(s.screen===screen){store.set({params});return;}
const entry=opener?{screen:s.screen,params:s.params,opener}:{screen:s.screen,params:s.params};
const stack=[...s.stack,entry].slice(-20);
store.set({screen,params,stack,restoreFocus:null});
},
back(fallback='home'){
const s=store.get();
const stack=[...s.stack];
const prev=stack.pop();
store.set(prev?{screen:prev.screen,params:prev.params,stack,restoreFocus:prev.opener??null}:{screen:fallback,params:{},stack:[],restoreFocus:null});
},

root(screen,params={}){
if(!ALL_SCREENS.includes(screen))throw new RangeError(`unknown screen '${screen}'`);
const s=store.get();
const stack=screen==='home'?[]:[{screen:'home',params:{}}];
if(s.screen===screen){store.set({params,stack});return;}
store.set({screen,params,stack,restoreFocus:null});
},
current:()=>store.get().screen,
stack:()=>store.get().stack.map((e)=>e.screen),
};
}


export function canApplyUpdate(state){
return!state.sessionActive;
}
