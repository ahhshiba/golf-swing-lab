








(function(){
'use strict';
var BOOT_MS=8000;
var UNSAVED_FLAG='gsl.boot.unsaved';
var state={errors:[],shown:false,reason:null,timer:0};
window.__gslBoot=state;

function note(message,stack){
if(state.errors.length<20)state.errors.push({at:new Date().toISOString(),message:String(message||'').slice(0,500),stack:stack?String(stack).slice(0,2000):undefined});
}
window.addEventListener('error',function(e){note(e&&e.message,e&&e.error&&e.error.stack);});
window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;note(r&&r.message?r.message:r,r&&r.stack);});

function locale(){
var pref='auto';
try{var s=JSON.parse(localStorage.getItem('gsl-settings-v2')||'null');if(s&&typeof s.locale==='string')pref=s.locale;}catch(_){ }
if(pref==='zh-Hant'||pref==='en')return pref;
var langs=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'']);
return/^zh/i.test(String(langs[0]||''))?'zh-Hant':'en';
}

function report(){
var diag=null;
try{diag=JSON.parse(localStorage.getItem('gsl.diag/1')||'null');}catch(_){diag=null;}
return JSON.stringify({
schema:'gsl-boot-report/1',
reason:state.reason,
at:new Date().toISOString(),
page:location.origin+location.pathname,
user_agent:navigator.userAgent,
languages:navigator.languages||[],
standalone:Boolean((window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone),
errors:state.errors,
diag:diag,
},null,2);
}

function copy(text,done){
var fallback=function(){
var ta=document.createElement('textarea');
ta.value=text;
ta.setAttribute('readonly','');
ta.className='boot-report';
ta.setAttribute('aria-label','diagnostics');
done(ta);
};
try{
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){done(null);},fallback);
else fallback();
}catch(_){fallback();}
}

function show(reason,err){
if(err)note(err&&err.message?err.message:err,err&&err.stack);
if(state.shown||document.getElementById('app-ready')&&reason==='timeout')return;
state.shown=true;
state.reason=reason;
var host=document.getElementById('boot-error');
var tpl=document.getElementById('boot-fallback');
if(!host||!tpl||!tpl.content)return;
var loc=locale();
var block=tpl.content.querySelector('[data-locale="'+loc+'"]')||tpl.content.firstElementChild;
var node=block.cloneNode(true);
host.replaceChildren(node);
host.hidden=false;
var screens=document.querySelectorAll('[data-screen]');
for(var i=0;i<screens.length;i++)screens[i].hidden=true;
var tabbar=document.getElementById('tabbar');
if(tabbar)tabbar.hidden=true;
node.querySelector('[data-boot="reload"]').addEventListener('click',function(){
try{sessionStorage.removeItem(UNSAVED_FLAG);}catch(_){ }
location.reload();
});
node.querySelector('[data-boot="unsaved"]').addEventListener('click',function(){
try{sessionStorage.setItem(UNSAVED_FLAG,'1');}catch(_){ }
location.reload();
});
node.querySelector('[data-boot="copy"]').addEventListener('click',function(){
copy(report(),function(ta){
var ok=node.querySelector('.boot-copied');
if(ta){node.appendChild(ta);ta.focus();ta.select();}else if(ok)ok.hidden=false;
});
});
var h1=node.querySelector('h1');
if(h1){try{h1.focus();}catch(_){ }}
}

state.fail=show;
state.report=report;

state.recover=function(){
clearTimeout(state.timer);
if(!state.shown||state.reason!=='timeout')return;
var host=document.getElementById('boot-error');
if(host){host.hidden=true;host.replaceChildren();}
var tabbar=document.getElementById('tabbar');
if(tabbar)tabbar.hidden=false;
state.shown=false;
};
function arm(){
state.timer=setTimeout(function(){if(!document.getElementById('app-ready'))show('timeout');},BOOT_MS);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);
else arm();




try{
if(document.documentElement.hasAttribute('data-built')){
var l=document.createElement('link');
l.rel='preload';
l.as='fetch';
l.crossOrigin='anonymous';
l.href='i18n/'+locale()+'.json';
document.head.appendChild(l);
}
}catch(_){ }
})();
