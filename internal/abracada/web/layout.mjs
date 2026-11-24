// Server order is counterclockwise. Local rotation must preserve neighbors.
export function seats(players,you){
 const self=players.findIndex(p=>p.id===you),n=players.length;
 if(self<0)return [];
 const paired=n%2===0,sideCount=Math.floor((n-1)/2),rows=sideCount+(paired?1:0);
 return Array.from({length:n},(_,offset)=>{
  const opposite=paired&&offset===n/2;
  const side=offset===0?'self':opposite?'opposite':offset<=sideCount?'right':'left';
  const row=offset===0?rows+1:opposite?1:side==='right'?rows-offset+1:offset-sideCount;
  const angle=Math.PI/2-offset*2*Math.PI/n;
  const ring=n===6?[[50,75],[83,75],[83,25],[50,25],[17,25],[17,75]]:null;
  return {player:players[(self+offset)%n],offset,side,row,column:side==='self'||opposite?'1 / -1':side==='right'?'2':'1',x:ring?ring[offset][0]:50+Math.cos(angle)*33,y:offset===0?75:opposite?25:ring?ring[offset][1]:50+Math.sin(angle)*31};
 });
}

// Sort a copy: unknown own stones remain unknown; the server hand is untouched.
export function sortedHand(hand){return [...hand].sort((a,b)=>a-b)}

// Prefer a side with enough room, then use the side with more usable space.
export function anchoredPanel(anchor,width,height,viewportWidth,viewportHeight,{align='center',gap=6,margin=12}={}){
 const above=anchor.top-gap-margin,below=viewportHeight-anchor.bottom-gap-margin;
 const opensAbove=above>=height||(below<height&&above>below);
 const maxHeight=Math.max(0,opensAbove?above:below);
 const panelHeight=Math.min(height,maxHeight);
 const x=align==='end'?anchor.right-width:(anchor.left+anchor.right-width)/2;
 return {
  left:Math.max(margin,Math.min(viewportWidth-width-margin,x)),
  top:opensAbove?anchor.top-gap-panelHeight:anchor.bottom+gap,
  maxHeight,
 };
}

// The first wheel choice is at twelve o'clock, then choices run clockwise.
export function wheelChoice(x,y,count){
 if(count<1||Math.hypot(x,y)<23)return -1;
 const angle=Math.atan2(y,x)+Math.PI/2;
 return (Math.round(angle*count/(2*Math.PI))+count)%count;
}
