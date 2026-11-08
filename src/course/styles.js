


















const T=(o)=>Object.freeze(o);

export const STYLE_IDS=Object.freeze(['parkland','links','desert']);

export const STYLE_TRAITS=Object.freeze({
parkland:T({ground:'normal',roughCarry:1,roughSigma:1}),
links:T({ground:'firm',roughCarry:1,roughSigma:1}),
desert:T({ground:'normal',roughCarry:0.9,roughSigma:1.15}),
});

const ROWS=T({kind:'rows',gap:[7,12],spacing:[17,24],r:[3,5],h:[12,20]});

export const STYLES=Object.freeze({
parkland:Object.freeze([
T({id:'parkland-p3-a',par:3,len:[120,170],dogleg:[0,0],corner:[0.5,0.5],fw:{apron:true,half:[10,12]},
green:{rx:[11,14],ry:[13,16],z:[-4,2],slope:[0.8,2.2]},
bunkers:[{at:'green',pos:'FL',r:[4,6]},{at:'green',pos:'R',r:[4,6]}],water:[],trees:ROWS,bound:[42,50]}),
T({id:'parkland-p3-b',par:3,len:[150,190],dogleg:[0,0],corner:[0.5,0.5],fw:{apron:true,half:[10,13]},
green:{rx:[12,15],ry:[14,17],z:[-2,5],slope:[0.6,1.8]},
bunkers:[{at:'green',pos:'L',r:[4,6]},{at:'green',pos:'B',r:[4,5]}],
water:[{kind:'side',s:[0.3,0.8],side:'R',gap:[10,14],width:[10,16]}],trees:ROWS,bound:[46,54]}),
T({id:'parkland-p4-a',par:4,len:[300,360],dogleg:[12,24],corner:[0.55,0.65],fw:{half:[15,18]},
green:{rx:[12,15],ry:[13,17],z:[-3,4],slope:[0.8,2.2]},
bunkers:[{at:'fw',s:[0.62,0.7],side:'any',r:[5,7]},{at:'green',pos:'FR',r:[4,6]}],water:[],trees:ROWS,bound:[45,52]}),
T({id:'parkland-p4-b',par:4,len:[340,405],dogleg:[0,8],corner:[0.5,0.6],fw:{half:[15,17]},
green:{rx:[11,14],ry:[14,18],z:[-5,3],slope:[0.5,1.6]},
bunkers:[{at:'fw',s:[0.58,0.66],side:'L',r:[5,7]},{at:'green',pos:'FL',r:[4,6]},{at:'green',pos:'FR',r:[4,6]}],
water:[{kind:'side',s:[0.62,0.86],side:'R',gap:[6,10],width:[12,18]}],trees:ROWS,bound:[48,56]}),
T({id:'parkland-p4-c',par:4,len:[265,315],dogleg:[18,30],corner:[0.6,0.7],fw:{half:[15,17]},
green:{rx:[10,13],ry:[12,15],z:[0,6],slope:[1,2.6]},
bunkers:[{at:'green',pos:'L',r:[4,6]},{at:'green',pos:'R',r:[4,6]}],water:[],trees:ROWS,bound:[44,50]}),
T({id:'parkland-p5-a',par:5,len:[440,505],dogleg:[10,22],corner:[0.5,0.6],fw:{half:[15,18]},
green:{rx:[12,15],ry:[14,18],z:[-4,4],slope:[0.6,2]},
bunkers:[{at:'fw',s:[0.45,0.52],side:'any',r:[5,7]},{at:'fw',s:[0.74,0.8],side:'any',r:[5,7]},{at:'green',pos:'FL',r:[4,6]}],
water:[],trees:ROWS,bound:[46,54]}),
T({id:'parkland-p5-b',par:5,len:[470,520],dogleg:[0,10],corner:[0.55,0.65],fw:{half:[15,18]},
green:{rx:[11,14],ry:[13,16],z:[-3,5],slope:[0.8,2.4]},
bunkers:[{at:'green',pos:'R',r:[4,6]},{at:'green',pos:'B',r:[4,5]}],
water:[{kind:'cross',s:[0.66,0.72],depth:[9,13]}],trees:ROWS,bound:[48,56]}),
]),
links:Object.freeze([
T({id:'links-p3-a',par:3,len:[130,180],dogleg:[0,0],corner:[0.5,0.5],fw:{apron:true,half:[12,15]},
green:{rx:[13,16],ry:[15,19],z:[-2,2],slope:[0.8,2.6]},
bunkers:[{at:'green',pos:'FL',r:[4,6]},{at:'green',pos:'FR',r:[4,6]},{at:'green',pos:'B',r:[4,5]}],
water:[],trees:null,bound:[55,64]}),
T({id:'links-p3-b',par:3,len:[100,140],dogleg:[0,0],corner:[0.5,0.5],fw:{apron:true,half:[12,14]},
green:{rx:[12,15],ry:[12,15],z:[-1,3],slope:[1,2.8]},
bunkers:[{at:'green',pos:'L',r:[4,6]},{at:'green',pos:'R',r:[4,6]},{at:'green',pos:'B',r:[3,5]}],
water:[],trees:null,bound:[55,62]}),
T({id:'links-p4-a',par:4,len:[330,400],dogleg:[0,10],corner:[0.5,0.6],fw:{half:[19,24]},
green:{rx:[14,17],ry:[15,19],z:[-2,2],slope:[0.6,2]},
bunkers:[{at:'fw',s:[0.52,0.58],side:'L',r:[4,6]},{at:'fw',s:[0.6,0.66],side:'R',r:[4,6]},
{at:'fw',s:[0.78,0.84],side:'any',r:[4,6]},{at:'green',pos:'FL',r:[4,5]},{at:'green',pos:'FR',r:[4,5]}],
water:[],trees:null,bound:[58,68]}),
T({id:'links-p4-b',par:4,len:[270,320],dogleg:[10,22],corner:[0.6,0.7],fw:{half:[19,23]},
green:{rx:[13,16],ry:[14,17],z:[-2,3],slope:[0.8,2.4]},
bunkers:[{at:'fw',s:[0.66,0.72],side:'any',r:[5,7]},{at:'green',pos:'F',r:[4,5]},{at:'green',pos:'L',r:[4,5]}],
water:[],trees:null,bound:[56,64]}),
T({id:'links-p4-c',par:4,len:[360,410],dogleg:[6,16],corner:[0.55,0.65],fw:{half:[20,25]},
green:{rx:[14,17],ry:[16,20],z:[-3,1],slope:[0.5,1.6]},
bunkers:[{at:'fw',s:[0.6,0.68],side:'any',r:[5,7]},{at:'green',pos:'R',r:[4,6]}],
water:[{kind:'side',s:[0.2,0.75],side:'L',gap:[8,12],width:[10,16]}],trees:null,bound:[62,70]}),
T({id:'links-p5-a',par:5,len:[450,515],dogleg:[6,18],corner:[0.55,0.62],fw:{half:[20,24]},
green:{rx:[14,17],ry:[16,20],z:[-2,2],slope:[0.6,2]},
bunkers:[{at:'fw',s:[0.42,0.48],side:'any',r:[5,7]},{at:'fw',s:[0.7,0.76],side:'L',r:[4,6]},
{at:'fw',s:[0.7,0.76],side:'R',r:[4,6]},{at:'green',pos:'FL',r:[4,5]}],
water:[{kind:'cross',s:[0.58,0.64],depth:[7,11]}],trees:null,bound:[58,68]}),
T({id:'links-p5-b',par:5,len:[425,470],dogleg:[14,26],corner:[0.6,0.68],fw:{half:[19,23]},
green:{rx:[13,16],ry:[15,18],z:[-1,3],slope:[0.8,2.2]},
bunkers:[{at:'fw',s:[0.5,0.56],side:'any',r:[5,7]},{at:'green',pos:'FR',r:[4,6]},{at:'green',pos:'B',r:[4,5]}],
water:[],trees:null,bound:[56,66]}),
]),
desert:Object.freeze([
T({id:'desert-p3-a',par:3,len:[110,160],dogleg:[0,0],corner:[0.5,0.5],fw:{apron:true,half:[10,12]},
green:{rx:[11,14],ry:[12,15],z:[-6,2],slope:[1,2.6]},
bunkers:[{at:'green',pos:'L',r:[4,6]}],water:[{kind:'front',gap:[7,10],depth:[10,15],wide:[14,22]}],
trees:T({kind:'scatter',n:[3,6],r:[1.5,2.5],h:[3,6]}),bound:[48,56]}),
T({id:'desert-p3-b',par:3,len:[150,195],dogleg:[0,0],corner:[0.5,0.5],fw:{apron:true,half:[10,12]},
green:{rx:[12,15],ry:[13,16],z:[-8,0],slope:[0.6,1.8]},
bunkers:[{at:'green',pos:'FR',r:[4,6]},{at:'green',pos:'B',r:[4,5]}],water:[],
trees:T({kind:'scatter',n:[4,8],r:[1.5,2.5],h:[3,6]}),bound:[50,58]}),
T({id:'desert-p4-a',par:4,len:[320,390],dogleg:[8,20],corner:[0.55,0.62],fw:{half:[15,18],islands:[[140,255],[-55,-7]]},
green:{rx:[12,15],ry:[13,16],z:[-6,4],slope:[0.8,2.2]},
bunkers:[{at:'fw',s:[0.5,0.58],side:'any',r:[5,7]},{at:'green',pos:'FL',r:[4,6]}],water:[],
trees:T({kind:'scatter',n:[5,10],r:[1.5,2.5],h:[3,6]}),bound:[50,58]}),
T({id:'desert-p4-b',par:4,len:[280,330],dogleg:[0,10],corner:[0.55,0.65],fw:{half:[15,17],islands:[[140,250],[-45,-7]]},
green:{rx:[11,14],ry:[12,15],z:[-3,6],slope:[1,2.6]},
bunkers:[{at:'green',pos:'R',r:[4,6]},{at:'green',pos:'B',r:[4,5]}],
water:[{kind:'side',s:[0.55,0.8],side:'L',gap:[8,12],width:[10,15]}],
trees:T({kind:'scatter',n:[4,8],r:[1.5,2.5],h:[3,6]}),bound:[50,58]}),
T({id:'desert-p4-c',par:4,len:[360,410],dogleg:[14,26],corner:[0.58,0.66],fw:{half:[15,18],islands:[[140,260],[0.72,-7]]},
green:{rx:[12,15],ry:[14,17],z:[-8,2],slope:[0.6,2]},
bunkers:[{at:'fw',s:[0.66,0.7],side:'any',r:[5,7]},{at:'green',pos:'FR',r:[4,6]}],water:[],
trees:T({kind:'scatter',n:[5,10],r:[1.5,2.5],h:[3,6]}),bound:[52,60]}),
T({id:'desert-p5-a',par:5,len:[450,510],dogleg:[10,22],corner:[0.52,0.6],fw:{half:[15,18],islands:[[140,260],[0.6,0.8],[-40,-7]]},
green:{rx:[12,15],ry:[14,17],z:[-6,6],slope:[0.6,2]},
bunkers:[{at:'fw',s:[0.66,0.72],side:'any',r:[5,7]},{at:'green',pos:'FL',r:[4,6]}],water:[],
trees:T({kind:'scatter',n:[6,12],r:[1.5,2.5],h:[3,6]}),bound:[52,60]}),
T({id:'desert-p5-b',par:5,len:[480,525],dogleg:[0,12],corner:[0.55,0.65],fw:{half:[15,18],islands:[[140,265],[0.62,-7]]},
green:{rx:[11,14],ry:[13,16],z:[-4,8],slope:[0.8,2.4]},
bunkers:[{at:'green',pos:'L',r:[4,6]},{at:'green',pos:'R',r:[4,6]}],
water:[{kind:'cross',s:[0.55,0.6],depth:[10,14]}],
trees:T({kind:'scatter',n:[6,12],r:[1.5,2.5],h:[3,6]}),bound:[52,60]}),
]),
});
