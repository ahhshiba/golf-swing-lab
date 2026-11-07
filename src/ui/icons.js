









export const ICON_PATHS=Object.freeze({
'chevron-left':'<path d="M15 18l-6-6 6-6"/>',
'chevron-right':'<path d="M9 18l6-6-6-6"/>',
'chevron-down':'<path d="M6 9l6 6 6-6"/>',
camera:'<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
'camera-off':'<path d="M2 2l20 20"/><path d="M9.5 4h5L16.5 7H20a2 2 0 0 1 2 2v8.5"/><path d="M17 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3"/><path d="M9.6 10.6a3.5 3.5 0 0 0 4.8 4.8"/>',
film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M17 7.5h4M3 12h18M3 16.5h4M17 16.5h4"/>',
'film-off':'<path d="M2 2l20 20"/><path d="M21 16V5a2 2 0 0 0-2-2H8"/><path d="M3 6v13a2 2 0 0 0 2 2h13"/><path d="M7 7v14M17 3v10M3 12h9"/>',
history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3.5 2"/>',
settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
info:'<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5M12 7.5h.01"/>',
target:'<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.5"/>',
level:'<rect x="2" y="8" width="20" height="8" rx="4"/><circle cx="12" cy="12" r="2"/><path d="M8 8v8M16 8v8"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
play:'<path d="M7 4.5v15l12-7.5z"/>',
pause:'<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
'step-back':'<path d="M18 5v14L8 12z"/><path d="M6 5v14"/>',
'step-forward':'<path d="M6 5v14l10-7z"/><path d="M18 5v14"/>',
flag:'<path d="M5 22V3"/><path d="M5 4h11l-2 4 2 4H5"/>',
ruler:'<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l2 2M10 9.5l2 2M13 6.5l2 2"/>',
trash:'<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M5.5 6l1 14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-14"/><path d="M10 11v6M14 11v6"/>',
download:'<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
upload:'<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 21h16"/>',
share:'<path d="M12 3v13"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
check:'<path d="M4.5 12.5l5 5 10-11"/>',
alert:'<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
x:'<path d="M6 6l12 12M18 6L6 18"/>',
star:'<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
'star-filled':'<path fill="currentColor" d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
'mic-off':'<path d="M2 2l20 20"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M19 10v2a7 7 0 0 1-.6 2.8M5 10v2a7 7 0 0 0 11.2 5.6"/><path d="M12 19v3"/>',
tripod:'<rect x="8" y="2" width="8" height="5" rx="1"/><path d="M12 7v4M12 11l-6 11M12 11l6 11M12 11v11"/>',
'phone-landscape':'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M18 11v2"/>',
'phone-portrait':'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
help:'<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01"/>',
shield:'<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
club:'<path d="M7 2l8.5 16"/><path d="M15.5 18l4.5-1.2a1.5 1.5 0 0 1 1.8 1.1l.3 1.2a1.5 1.5 0 0 1-1.1 1.8L14.6 22a1 1 0 0 1-1.2-.7l-.3-1.3a1 1 0 0 1 .7-1.2z"/><circle cx="5" cy="20" r="1.5"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
'external-link':'<path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
});

export const ICON_NAMES=Object.freeze(Object.keys(ICON_PATHS));


export function spriteMarkup(){
return ICON_NAMES.map((n)=>`<symbol id="i-${n}" viewBox="0 0 24 24">${ICON_PATHS[n]}</symbol>`).join('');
}


const SVG_NS='http://www.w3.org/2000/svg';





function parseSvg(doc,markup){
const DP=doc.defaultView?.DOMParser??globalThis.DOMParser;
if(typeof DP==='function'&&typeof doc.importNode==='function'){
const xml=new DP().parseFromString(markup.replace('<svg ',`<svg xmlns="${SVG_NS}" `),'image/svg+xml');
const root=xml.documentElement;
if(root&&root.localName==='svg')return doc.importNode(root,true);
}
return doc.createElement('svg');
}

export function injectSprite(doc=globalThis.document){
if(!doc)return null;
const have=doc.getElementById?.('icon-sprite');
if(have)return have;
const svg=parseSvg(doc,`<svg id="icon-sprite" class="icon-sprite" aria-hidden="true" focusable="false">${spriteMarkup()}</svg>`);
if(svg.getAttribute('id')!=='icon-sprite'){svg.setAttribute('id','icon-sprite');svg.setAttribute('aria-hidden','true');}
(doc.body??doc.documentElement).prepend(svg);
return svg;
}

export function icon(name,{doc=globalThis.document,label=null,size=null}={}){
const n=ICON_PATHS[name]?name:'info';
const mk=(tag)=>(typeof doc.createElementNS==='function'?doc.createElementNS(SVG_NS,tag):doc.createElement(tag));
const svg=mk('svg');
svg.setAttribute('class',`icon icon-${n}`);
svg.setAttribute('viewBox','0 0 24 24');
if(size){svg.setAttribute('width',String(Number(size)));svg.setAttribute('height',String(Number(size)));}
if(label){svg.setAttribute('role','img');svg.setAttribute('aria-label',String(label));}else svg.setAttribute('aria-hidden','true');
svg.setAttribute('focusable','false');
const use=mk('use');
use.setAttribute('href',`#i-${n}`);
svg.append(use);
return svg;
}
