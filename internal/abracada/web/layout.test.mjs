import {test} from 'node:test';import assert from 'node:assert/strict';import {anchoredPanel,seats,sortedHand,wheelChoice} from './layout.mjs';
test('each viewer stays at bottom, right neighbor goes next, and every seat is unique',()=>{for(let n=2;n<=6;n++){const p=Array.from({length:n},(_,i)=>({id:String(i)}));for(const self of p){const s=seats(p,self.id);assert.equal(s[0].player.id,self.id);assert.equal(s[0].side,'self');assert.equal(s[1].side,n===2?'opposite':'right');assert.equal(s[1].player.id,String((Number(self.id)+1)%n));assert.equal(new Set(s.map(x=>x.row+':'+x.column)).size,n);assert.ok(s.every(x=>x.x>=0&&x.x<=100&&x.y>=0&&x.y<=100))}}});

test('even counts place the opposite player alone at the top, balanced on both sides',()=>{for(const n of [2,4,6]){const p=Array.from({length:n},(_,i)=>({id:String(i)}));for(const self of p){const s=seats(p,self.id),top=s.find(x=>x.side==='opposite');assert.equal(top.offset,n/2);assert.equal(top.row,1);assert.equal(top.column,'1 / -1');assert.equal(s.filter(x=>x.side==='right').length,n/2-1);assert.equal(s.filter(x=>x.side==='left').length,n/2-1);assert.ok(s[0].row>top.row)}}});

test('hands sort without mutating input or revealing unknown stones',()=>{const hand=[8,3,1,8,4];assert.deepEqual(sortedHand(hand),[1,3,4,8,8]);assert.deepEqual(hand,[8,3,1,8,4]);assert.deepEqual(sortedHand([0,0,0,0,0]),[0,0,0,0,0])});


test('an anchored panel flips below a high control and clamps to the viewport',()=>{
 const nearTop={left:5,right:45,top:14,bottom:54};
 assert.deepEqual(anchoredPanel(nearTop,180,130,320,600),{left:12,top:60,maxHeight:528});
 const nearBottom={left:290,right:330,top:525,bottom:565};
 assert.deepEqual(anchoredPanel(nearBottom,200,140,340,600),{left:128,top:379,maxHeight:507});
});

test('a tall picker uses the roomier side and keeps space for the viewport margin',()=>{
 const anchor={left:265,right:295,top:220,bottom:255};
 const panel=anchoredPanel(anchor,260,430,320,520,{align:'end'});
 assert.deepEqual(panel,{left:35,top:261,maxHeight:247});
});


test('emoji wheel has a dead zone and five clockwise slots starting at the top',()=>{
 assert.equal(wheelChoice(12,12,5),-1);
 for(let index=0;index<5;index++){
  const angle=index*2*Math.PI/5-Math.PI/2;
  assert.equal(wheelChoice(60*Math.cos(angle),60*Math.sin(angle),5),index);
 }
});
