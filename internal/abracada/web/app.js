import {anchoredPanel,seats,sortedHand,wheelChoice} from './layout.mjs';
const $=id=>document.getElementById(id),names=['远古巨龙','黑暗幽灵','甜蜜的梦','猫头鹰','闪电风暴','冰晶术','火球术','治疗药水'],arts=['dragon','ghost','dream','owl','storm','ice','fire','potion'],effects=['其他所有人失去骰子点数生命','其他人失去1生命，自己恢复1','恢复骰子点数生命','拿取一个秘法石板','左右邻各失去1生命','左邻失去1生命','右邻失去1生命','恢复1生命'];let room,stream,busy=false,last=0,gameID='',pending,snapshot='',owlKey='',knownTablets=[],knownTabletKey='',tabletRequest=null;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e},img=a=>{const e=el('img');e.src='/abracada/art/'+a+'.svg';e.alt='';return e},code=()=>location.hash.slice(1).toUpperCase();
function message(s=''){$('message').textContent=s;$('message').hidden=!s}
const requestTimeout=10_000;
const attemptTimeout=3_000;
const reconnectInterval=3_000;
let requestInFlight=false, disconnectTimer, reconnectTimer, resumeInFlight=false;
const reloadDialog=$('reload-dialog');
const loadingDialog=$('request-loading');
const requestQuips=['正在翻咒语书…','给魔杖充个电…','猫头鹰正在跑腿…','拜托魔法石配合一下…','火球再小一点…','这次应该不会出包…'];
let nextRequestQuip=0;

function askReload(title,detail,reason='request'){
 if(reloadDialog.open&&reloadDialog.dataset.reason==='request')return;
 reloadDialog.dataset.reason=reason;
 $('reload-title').textContent=title;
 $('reload-detail').textContent=detail;
 if(!reloadDialog.open)reloadDialog.showModal();
}
for(const dialog of [reloadDialog,loadingDialog]){
 dialog.addEventListener('cancel',event=>event.preventDefault());
}
$('reload-page').onclick=()=>location.reload();

async function withRequestFeedback(task){
 if(requestInFlight||reloadDialog.open)throw Error('请等待当前操作完成');
 requestInFlight=true;
 closeSpellPreview();closeEmojiMenu();cancelEmojiGesture();
 const showQuip=()=>{
  $('request-quip').textContent=requestQuips[nextRequestQuip];
  nextRequestQuip=(nextRequestQuip+1)%requestQuips.length;
 };
 let quipTimer;
 try{
  showQuip();
  loadingDialog.showModal();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)quipTimer=setInterval(showQuip,1300);
  return await task();
 }finally{
  clearInterval(quipTimer);
  loadingDialog.close();
  requestInFlight=false;
 }
}

const versionedActions=new Set(['bots','start','cast','roll','end','take','next','reset']);
function newActionID(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
async function api(action,data,{background=false,fetcher=fetch,before}={}){
 const retryable=!data||versionedActions.has(action);
 if(data&&retryable&&!data.requestId){
  data={...data,requestId:newActionID()};
 }
 const request=async()=>{
  const deadline=new AbortController();
  let timer;
  const timeout=new Promise((_,reject)=>{
   timer=setTimeout(()=>{
    reject(Error('请求超时'));
    deadline.abort();
    askReload('请求超时','服务器 10 秒内未响应。请重新加载页面，确认刚才的操作是否已生效。');
   },requestTimeout);
  });
  const options=data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{cache:'no-store'};
  try{
   const fetchResult=async()=>{
    if(before)await before();
    deadline.signal.throwIfAborted();
    const url='/abracada/api/'+action;
    if(!retryable)return readResponse(await fetcher(url,{...options,signal:deadline.signal}));
    return retryRequest(url,options,fetcher,deadline.signal);
   };
   return await Promise.race([fetchResult(),timeout]);
  }finally{clearTimeout(timer);}
 };
 return background?request():withRequestFeedback(request);
}

async function readResponse(response){
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'请求失败');
 return result;
}

async function retryRequest(url,options,fetcher,deadline){
 const retry=Symbol('retry');
 for(;;){
  deadline.throwIfAborted();
  const attempt=new AbortController();
  let timer,finishAttempt;
  const retryTime=new Promise(resolve=>{
   finishAttempt=()=>{resolve(retry);attempt.abort();};
   timer=setTimeout(finishAttempt,attemptTimeout);
  });
  deadline.addEventListener('abort',finishAttempt,{once:true});
  try{
   const send=async()=>{
    try{
     const response=await fetcher(url,{...options,signal:attempt.signal});
     if([502,503,504].includes(response.status))return retryTime;
     return await readResponse(response);
    }catch(error){
     // Fetch and response body reads can both fail when a connection drops.
     if(attempt.signal.aborted||error instanceof TypeError)return retryTime;
     throw error;
    }
   };
   const result=await Promise.race([send(),retryTime]);
   if(result!==retry)return result;
  }finally{
   clearTimeout(timer);
   deadline.removeEventListener('abort',finishAttempt);
  }
 }
}

// PIN changes use the same feedback, with credentials supplied by the room login form.
window.abracadaUpdatePIN=(data,fetcher)=>api('pin',data,{fetcher});

function clearConnectionTimers(){
 clearTimeout(disconnectTimer);
 clearTimeout(reconnectTimer);
 disconnectTimer=undefined;
 reconnectTimer=undefined;
}
function watchDisconnect(){
 if(!room||document.hidden)return;
 $('connection').textContent='正在重新连接…';
 disconnectTimer??=setTimeout(()=>{
  if(room&&!document.hidden)askReload('实时连接已断开','实时连接已断开 10 秒。你可以重新加载页面，或等待自动重连。','connection');
 },requestTimeout);
 reconnectTimer??=setTimeout(()=>{
  reconnectTimer=undefined;
  connect();
 },reconnectInterval);
}
function stopConnection(){
 stream?.close();
 stream=null;
 clearConnectionTimers();
}
function connect(){
 if(!room||document.hidden){stopConnection();return;}
 stream?.close();
 const activeCode=room.code,source=new EventSource('/abracada/api/events?code='+activeCode);
 stream=source;
 const current=()=>source===stream&&room?.code===activeCode;
 const connected=()=>{
  clearConnectionTimers();
  if(reloadDialog.open&&reloadDialog.dataset.reason==='connection')reloadDialog.close();
  $('connection').textContent='● 实时连接';
 };
 watchDisconnect();
 source.onmessage=e=>{
  if(!current())return;
  const next=JSON.parse(e.data);
  connected();
  if(!busy)render(next);
 };
 source.addEventListener('reaction',event=>{if(current())showReaction(JSON.parse(event.data))});
 source.onerror=()=>{if(current())watchDisconnect();};
 source.addEventListener('expired',()=>{
  if(!current())return;
  stopConnection();
  if(reloadDialog.open&&reloadDialog.dataset.reason==='connection')reloadDialog.close();
  closeSpellPreview();closeEmojiMenu();cancelEmojiGesture();
  room=null;snapshot='';latestRoomSnapshot=null;cancelPresentation();
  $('entry').hidden=false;$('room').hidden=true;
  message('房间已过期或已关闭');
 });
}
async function act(action,extra={}){
 if(!room||busy||presentationActive||requestInFlight||reloadDialog.open)return false;
 busy=true;
 const request={code:room.code,game:room.game?.id,step:room.game?.step,lobbyVersion:room.lobbyVersion,...extra};
 let succeeded=false;
 try{
  const result=await api(action,request,{before:action==='cast'?focusSeatForCast:undefined});
  if(room?.code!==request.code)return false;
  if(action!=='leave')await render(result);
  message();
  succeeded=true;
  return true;
 }catch(error){message(error.message);return false;}
 finally{
  busy=false;
  if(action!=='leave'||!succeeded)connect();
 }
}
function confirm(title,fn,label='确认施法',effect=''){if(requestInFlight||reloadDialog.open)return;$('confirm-body').textContent=effect;$('confirm-title').textContent=title;$('confirm-accept').textContent=label;pending=fn;$('confirm-dialog').showModal()}
$('confirm-accept').onclick=()=>{const f=pending;$('confirm-dialog').close();f?.()};for(const id of ['confirm-close','confirm-cancel'])$(id).onclick=()=>$('confirm-dialog').close();for(const kind of ['rules','tablets']){$(kind+'-close').onclick=()=>$(kind+'-dialog').close()}$('rules-open').onclick=()=>$('rules-dialog').showModal();
try{$('name').value=localStorage.getItem('abr-name')||'';}catch{}
$('entry-form').onsubmit=async e=>{e.preventDefault();try{const nickname=$('name').value.trim();const next=await api(e.submitter?.dataset.entry||'create',{name:nickname,code:$('code').value.trim()});try{localStorage.setItem('abr-name',nickname);}catch{}location.hash=next.code;render(next);connect()}catch(e){message(e.message)}};
const spellPreview=$('spell-preview');
let spellAnchor=null,spellPreviewTimer;

function closeSpellPreview(restoreFocus=false){
 clearTimeout(spellPreviewTimer);
 spellPreview.hidden=true;
 const anchor=spellAnchor;
 spellAnchor=null;
 anchor?.setAttribute('aria-expanded','false');
 if(restoreFocus&&anchor?.isConnected)anchor.focus();
}

function placePanel(panel,anchor,{width,maxHeight,align}){
 const rect=anchor.getBoundingClientRect();
 if(rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)return false;
 const panelWidth=Math.min(width,innerWidth-24);
 panel.style.width=panelWidth+'px';
 panel.style.maxHeight='';
 const naturalHeight=Math.min(panel.offsetHeight,maxHeight);
 const placement=anchoredPanel(rect,panelWidth,naturalHeight,innerWidth,innerHeight,{align});
 if(placement.maxHeight<44)return false;
 panel.style.maxHeight=Math.min(maxHeight,placement.maxHeight)+'px';
 panel.style.left=placement.left+'px';
 panel.style.top=placement.top+'px';
 return true;
}

function positionSpellPreview(){
 if(spellAnchor&&(!spellAnchor.isConnected||!placePanel(spellPreview,spellAnchor,{width:360,maxHeight:280}))){
  closeSpellPreview();
 }
}

function openSpellPreview(button,g,index){
 if(button.disabled||busy||requestInFlight||reloadDialog.open)return;
 clearTimeout(spellPreviewTimer);
 if(spellAnchor===button)return;
 closeSpellPreview();
 closeEmojiMenu();
 spellAnchor=button;
 button.setAttribute('aria-expanded','true');
 $('spell-preview-title').textContent='施放 '+g.ids[index]+' 号'+names[index]+'？';
 $('spell-preview-effect').textContent=effects[index]+(index===0?'；失败时自己失去骰子点数生命':'；失败时自己失去 1 点生命');
 spellPreview.hidden=false;
 positionSpellPreview();
}

function dismissSpellPreviewSoon(){
 clearTimeout(spellPreviewTimer);
 spellPreviewTimer=setTimeout(()=>{if(!spellPreview.contains(document.activeElement))closeSpellPreview()},240);
}

function castPreviewedSpell(){
 const button=spellAnchor;
 if(!button?.isConnected||button.disabled)return;
 const spell=Number(button.dataset.spell);
 closeSpellPreview();
 void act('cast',{spell});
}

spellPreview.addEventListener('pointerenter',()=>clearTimeout(spellPreviewTimer));
spellPreview.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&event.relatedTarget!==spellAnchor&&!spellAnchor?.contains(event.relatedTarget))dismissSpellPreviewSoon()});
$('spell-preview-cast').onclick=castPreviewedSpell;
document.addEventListener('pointerdown',event=>{
 if(spellAnchor&&!spellPreview.contains(event.target)&&!spellAnchor.contains(event.target))closeSpellPreview();
});
document.addEventListener('focusin',event=>{
 if(spellAnchor&&!spellPreview.contains(event.target)&&!spellAnchor.contains(event.target))closeSpellPreview();
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&spellAnchor)closeSpellPreview(spellPreview.contains(document.activeElement));
});

function spellButton(g,name,index){
 const b=el('button',undefined,'spell-'+(index+1));
 b.type='button';
 b.dataset.spell=String(index+1);
 b.append(el('b',g.ids[index],'spell-number'),img(arts[index]),el('strong',name));
 b.disabled=g.turn!==room.you||index+1<g.minimum||g.phase!=='playing';
 b.setAttribute('aria-haspopup','dialog');
 b.setAttribute('aria-controls','spell-preview');
 b.setAttribute('aria-expanded','false');
 b.onpointerenter=event=>{if(event.pointerType==='mouse')openSpellPreview(b,g,index)};
 b.onpointerleave=event=>{if(event.pointerType==='mouse'&&spellAnchor===b&&!spellPreview.contains(event.relatedTarget))dismissSpellPreviewSoon()};
 b.onclick=event=>{
  const mouse=event.pointerType==='mouse'||(!event.pointerType&&event.detail>0&&matchMedia('(hover: hover) and (pointer: fine)').matches);
  openSpellPreview(b,g,index);
  if(spellAnchor!==b)return;
  if(mouse)castPreviewedSpell();
  else if(event.detail===0)$('spell-preview-cast').focus();
 };
 return b;
}

let presentationChain=Promise.resolve(),presentationActive=false,presentationGame='',presentationThrough=0,presentationEpoch=0,scheduledSnapshot='',rollWaiter=null,rollDrawing=null,pendingRollPresentation='',latestRoomSnapshot=null;
function cancelPresentation(){
 presentationEpoch++;
 presentationActive=false;
 scheduledSnapshot='';
 rollDrawing?.cancel();
 rollWaiter?.resolve(null);
 rollWaiter=null;
 $('cast-stage').hidden=true;
}
function olderRoomSnapshot(next,current=latestRoomSnapshot){
 if(current?.code!==next.code)return false;
 const versionDifference=(next.lobbyVersion??0)-(current.lobbyVersion??0);
 if(versionDifference!==0)return versionDifference<0;
 return next.game?.id===current.game?.id&&next.game?.step<current.game?.step;
}
function render(next){
 if(olderRoomSnapshot(next))return presentationChain;
 latestRoomSnapshot=next;
 const encoded=JSON.stringify(next);if(encoded===scheduledSnapshot)return presentationChain;
 const game=next.game;
 if(rollDrawing&&game?.id===rollDrawing.gameID&&game.events.some(e=>e.id===rollDrawing.eventID&&e.roll>0)){
  rollDrawing.cancel();
 }
 if(rollWaiter&&game?.id===rollWaiter.gameID){
  const rolled=game.events.find(e=>e.id===rollWaiter.eventID&&e.roll>0);
  if(rolled){rollWaiter.resolve(next);rollWaiter=null;}
 }
 if(!game||presentationGame!==game.id||!room?.game){
  cancelPresentation();
  presentationGame=game?.id||'';
  presentationThrough=Math.max(0,...(game?.events||[]).map(e=>e.id));
  scheduledSnapshot=encoded;
  presentationChain=Promise.resolve();
  renderNow(next);
  return presentationChain;
 }
 const casts=game.events.filter(e=>e.kind==='cast'&&e.id>presentationThrough);
 const passes=game.events.filter(e=>e.kind==='pass'&&e.id>presentationThrough);
 presentationThrough=Math.max(presentationThrough,...game.events.map(e=>e.id));scheduledSnapshot=encoded;
 const epoch=presentationEpoch;
 presentationChain=presentationChain.then(async()=>{
  if(epoch!==presentationEpoch||olderRoomSnapshot(next,room))return;
  presentationActive=true;
  try{
   for(const event of casts){
    showCastStage(event,game);
    await new Promise(resolve=>setTimeout(resolve,1000));
    if(epoch!==presentationEpoch)return;
    $('cast-stage').dataset.result=event.success?'success':'backfire';
    $('cast-stage-result').textContent=event.success?'施法成功':'反噬';
    $('cast-stage').setAttribute('aria-label',event.success?'施法成功':'施法反噬');
    if(next.game.phase==='rolling'&&next.game.events.at(-1)?.id===event.id&&!event.roll){
     let resolved;
     if(next.game.turn===room.you){
      const value=await drawRoll(event,epoch,game.id);
      if(epoch!==presentationEpoch||value===null)return;
      resolved=await api('roll',{code:next.code,game:next.game.id,step:next.game.step,roll:value});
     }else{
      resolved=await waitForRoll(event,game.id);
     }
     if(epoch!==presentationEpoch||!resolved)return;
     next=resolved;
     if(!olderRoomSnapshot(next))latestRoomSnapshot=next;
    }
    Object.assign(event,next.game?.events?.find(e=>e.id===event.id)||{});
    if(event.roll){
     $('cast-stage-result').textContent=(event.success?'施法成功':'反噬')+'（投到 '+event.roll+' 点）';
    }
    await new Promise(resolve=>setTimeout(resolve,event.roll?1400:750));
    if(!event.success)await new Promise(resolve=>setTimeout(resolve,1000));
    if(epoch!==presentationEpoch)return;
   }
   if(!casts.length&&passes.length)await new Promise(resolve=>setTimeout(resolve,350));
   $('cast-stage').hidden=true;
   const backfire=casts.find(e=>!e.success);
   if(backfire&&room?.game?.id===next.game.id){
    const impact=structuredClone(next),before=room.game;
    impact.game.turn=before.turn;impact.game.phase='playing';impact.game.deck=before.deck;impact.game.canEnd=false;
    for(const player of impact.game.players){const previous=before.players.find(p=>p.id===player.id);if(previous)player.hand=[...previous.hand]}
    renderNow(impact);
    await new Promise(resolve=>setTimeout(resolve,450));if(epoch!==presentationEpoch)return;
   }
   renderNow(next);
   if(casts.length&&['round-end','finished'].includes(next.game.phase)){
    $('round-result').hidden=true;
    await new Promise(resolve=>setTimeout(resolve,1320));
    if(epoch===presentationEpoch)$('round-result').hidden=false;
   }
  }finally{if(epoch===presentationEpoch){presentationActive=false;$('cast-stage').hidden=true}}
 }).catch(error=>{if(epoch===presentationEpoch){presentationActive=false;$('cast-stage').hidden=true;message(error.message)}});
 return presentationChain;
}
function showCastStage(event,game){
 const stage=$('cast-stage');stage.dataset.result='pending';
 $('cast-stage-name').textContent=game.players.find(p=>p.id===event.actor)?.name||'';
 $('cast-stage-spell').textContent=names[event.spell-1];
 $('cast-stage-number').textContent=game.ids[event.spell-1];
 $('cast-stage-number').className='spell-number spell-'+event.spell;
 $('cast-stage-art').replaceChildren(img(arts[event.spell-1]));
 $('cast-draw').hidden=true;$('cast-stage-result').textContent='?';stage.setAttribute('aria-label','正在施放'+names[event.spell-1]+'，等待结果');stage.dataset.player=event.actor;stage.hidden=false;positionCastCallout();
}
function drawRoll(event,epoch,gameID){
 const wrap=$('cast-draw'),canvas=$('cast-draw-pad'),ctx=canvas.getContext('2d'),button=$('cast-draw-button');
 wrap.hidden=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.lineWidth=8;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#e7d59e';
 const points=[];let drawing=false;
 let resolve;const result=new Promise(r=>resolve=r);
 const close=value=>{
  canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=canvas.onpointercancel=null;
  button.onclick=null;
  wrap.hidden=true;
  rollDrawing=null;
  resolve(value);
 };
 rollDrawing={gameID,eventID:event.id,cancel:()=>close(null)};
 const finish=()=>{
  if(epoch!==presentationEpoch){close(null);return;}
  let seed=Date.now()>>>0;for(const p of points)seed=Math.imul(seed^p.x,16777619)>>>0,seed=Math.imul(seed^p.y,16777619)>>>0,seed=Math.imul(seed^p.t,16777619)>>>0;
  close(1+seed%3);
 };
 canvas.onpointerdown=e=>{e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect(),p={x:Math.round((e.clientX-r.left)*canvas.width/r.width),y:Math.round((e.clientY-r.top)*canvas.height/r.height),t:Math.round(performance.now())};points.push(p);ctx.beginPath();ctx.moveTo(p.x,p.y)};
 canvas.onpointermove=e=>{if(!drawing)return;const r=canvas.getBoundingClientRect(),p={x:Math.round((e.clientX-r.left)*canvas.width/r.width),y:Math.round((e.clientY-r.top)*canvas.height/r.height),t:Math.round(performance.now())};points.push(p);ctx.lineTo(p.x,p.y);ctx.stroke()};
 canvas.onpointerup=e=>{if(drawing){drawing=false;finish()}};canvas.onpointercancel=()=>{if(drawing){drawing=false;finish()}};
  button.onclick=()=>{if(points.length===0)points.push({x:0,y:0,t:Date.now()>>>0});finish()};
 positionCastCallout();return result;
}
function waitForRoll(event,gameID){
 const latest=latestRoomSnapshot;
 if(latest?.game?.id===gameID&&latest.game.events.some(e=>e.id===event.id&&e.roll>0))return Promise.resolve(latest);
 return new Promise(resolve=>{rollWaiter={gameID,eventID:event.id,resolve};});
}
function renderNow(next){const callout=$('cast-stage');if(callout?.hidden&&callout.parentElement!==document.body)document.body.append(callout);const encoded=JSON.stringify(next);if(encoded===snapshot)return;if(room?.code!==next.code||room?.game?.id!==next.game?.id)cancelEmojiGesture();if(room?.code!==next.code||room?.game?.id!==next.game?.id||room?.game?.step!==next.game?.step){$('confirm-dialog').close();pending=null;}if(room?.code!==next.code||room?.game?.id!==next.game?.id||room?.game?.round!==next.game?.round){$('tablets-dialog').close();$('owl-dialog').close();}snapshot=encoded;room=next;$('entry').hidden=true;$('room').hidden=false;$('room-code').textContent='魔法桌 '+room.code;$('lobby').hidden=!!room.game;$('game').hidden=!room.game;$('phase-title').textContent=room.game?'出包魔法师':'等待魔法师';if(!room.game){$('lobby-count').textContent=(room.members.length+room.bots)+' / 6';const lobbyPeople=room.members.concat(Array.from({length:room.bots},(_,i)=>({id:'preview-'+i,name:['星尘学徒','苔藓术士','月光使者','迷雾巫师','琥珀法师'][i],bot:true})));$('lobby-seats').replaceChildren(...lobbyPeople.map((p,i)=>{const c=el('article',undefined,'lobby-seat');c.append(el('span',String(i+1).padStart(2,'0'),'lobby-index'),el('h3',p.name),el('span',p.bot?'机器人':p.id===room.host?'房主':'','lobby-role'));return c}));$('bots').replaceChildren(...Array.from({length:6},(_,count)=>{const button=el('button',String(count));button.type='button';button.disabled=room.you!==room.host||count>6-room.members.length;button.setAttribute('aria-pressed',String(count===room.bots));button.onclick=()=>act('bots',{count});return button}));$('start').hidden=room.you!==room.host;$('mode-note').textContent=room.members.length+room.bots===6?'六人扩展 · 43 个魔法石 · 5 个秘法石板':'标准玩法 · 36 个魔法石';return}
const g=room.game,own=g.players.find(p=>p.id===room.you);const tabletKey=currentTabletKey();if(knownTabletKey!==tabletKey){knownTabletKey=tabletKey;knownTablets=[];tabletRequest=null;}if(own.tablets>knownTablets.length)loadKnownTablets({background:true}).catch(()=>{});const by=id=>g.players.find(p=>p.id===id)?.name||'';if(gameID!==g.id){gameID=g.id;last=Math.max(0,...g.events.map(e=>e.id))}const ended=['round-end','finished'].includes(g.phase);$('round-label').textContent='第 '+g.round+' 轮';$('mode-label').textContent=g.players.length===6?'六人扩展':'标准玩法';$('turn-label').textContent=ended?'本轮结束':by(g.turn)+(g.turn===room.you?' · 轮到你':'');$('neighbors').textContent='你的左邻：'+by(own.left)+' · 右邻／下家：'+by(own.right);
$('score-strip').replaceChildren(...g.players.map(p=>{const score=el('div',undefined,'score-entry'+(p.id===room.you?' is-you':''));score.append(el('span',p.name),el('strong',p.score),el('span','/ 8','score-goal'));return score}));
renderSeats(g,by);if(!$('emoji-menu').hidden)positionEmojiMenu();
 $('action-panel').hidden=ended||g.turn!==room.you||g.phase==='rolling';$('action-title').textContent=g.turn===room.you?'选择你的法术':'等待 '+by(g.turn);$('action-help').textContent=g.canEnd?'可以继续施法，编号不能降低，也可以收手补牌。':'每回合至少尝试一次施法。';$('end-turn').disabled=g.turn!==room.you||!g.canEnd||g.phase!=='playing';$('spell-buttons').hidden=g.phase==='owl';closeSpellPreview();$('spell-buttons').replaceChildren(...names.map((name,index)=>spellButton(g,name,index)));$('secret-choice').hidden=g.phase!=='owl'||g.turn!==room.you;$('secret-slots').replaceChildren(...g.secrets.map((available,i)=>{const b=el('button','石板 '+(i+1));b.disabled=!available||g.turn!==room.you;b.onclick=()=>openOwl();return b}));
 $('deck-count').textContent='抽牌堆 '+g.deck;renderCountBoard(g);if(g.phase==='owl'&&g.turn===room.you&&owlKey!==g.id+':'+g.step){owlKey=g.id+':'+g.step;queueMicrotask(openOwl);}
$('secret-count').textContent='中央剩余 '+g.secrets.filter(Boolean).length+' 个 · 你持有 '+own.tablets+' 个';$('round-result').hidden=!ended;$('result-title').textContent=g.phase==='finished'?'全场赢家：'+g.winners.map(by).join('、'):'本轮结束';$('round-result').querySelector('.eyebrow').textContent=g.phase==='finished'?'游戏结束':'本轮结算';$('result-reason').textContent=g.phase==='finished'?'最后一轮：'+g.reason:g.reason;const resultKey=g.id+':'+g.round+':'+g.phase;if(ended&&$('round-result').dataset.resultKey!==resultKey){$('round-result').dataset.resultKey=resultKey;$('round-result').classList.remove('collapsed');$('result-toggle').textContent='收起结算';$('result-toggle').setAttribute('aria-expanded','true');}$('scoreboard').replaceChildren(...g.players.map(p=>el('div',p.name+' · 本轮 +'+p.gain+' · 累计 '+p.score+' 分')));$('next-round').textContent=g.phase==='finished'?'重新开局':'下一轮';$('next-round').hidden=room.you!==room.host;$('next-wait').textContent=room.you===room.host?'':'等待房主继续';$('history').replaceChildren(...g.events.slice().reverse().map(e=>el('li','第 '+e.round+' 轮 · '+e.text)));
for(const e of g.events){if(e.id<=last)continue;last=e.id;if(e.kind==='cast')animateCast(e)}}
$('start').onclick=()=>act('start');
$('end-turn').onclick=()=>confirm('结束回合并补牌？',()=>act('end'),'结束回合');
$('next-round').onclick=()=>act(room.game.phase==='finished'?'reset':'next');
$('invite').onclick=async()=>{
 try{await navigator.clipboard.writeText(location.href);message('邀请链接已复制');}
 catch{message(location.href);}
};
$('leave').onclick=()=>confirm('离开魔法桌？游戏中保留席位。',async()=>{
 if((!room.game||room.game.phase==='finished')&&!await act('leave'))return;
 stopConnection();
 room=null;
 latestRoomSnapshot=null;
 cancelPresentation();
 location.hash='';
 $('entry').hidden=false;$('room').hidden=true;
});
$('tablets-open').onclick=async()=>{
 try{
  const v=await loadKnownTablets();
  $('my-tablets').replaceChildren(...v.tablets.map(k=>{
   const c=el('div',undefined,'spell-'+k);
   c.append(el('b',room.game.supply[k-1],'spell-number'),img(arts[k-1]),el('p',names[k-1]));
   return c;
  }));
  $('tablets-dialog').showModal();
 }catch(error){message(error.message);}
};
async function resume(){
 const roomCode=code();
 if(document.hidden||!(/^[A-F0-9]{6}$/).test(roomCode))return;
 if(room?.code===roomCode&&!stream)connect();
 if(reloadDialog.open||resumeInFlight||busy||requestInFlight)return;
 resumeInFlight=true;
 try{
  const next=await api('room?code='+roomCode);
  if(code()!==roomCode)return;
  const rendered=render(next);
  if(!stream||room?.code!==roomCode){await rendered;connect();}
  else await rendered;
  if(next.game?.phase==='rolling')resumePendingRoll(next);
 }catch(error){message(error.message);}
 finally{resumeInFlight=false;}
}
window.addEventListener('hashchange',resume);
window.addEventListener('offline',watchDisconnect);
window.addEventListener('online',()=>{
 if(disconnectTimer!==undefined&&!document.hidden)connect();
});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){stopConnection();$('tablets-dialog').close();$('owl-dialog').close();}
 else resume();
});
window.addEventListener('pagehide',stopConnection);
window.addEventListener('pageshow',resume);
$('code').value=code();

async function resumePendingRoll(state){
 if(presentationActive||olderRoomSnapshot(state))return;
 const event=state.game.events.at(-1);
 if(event?.kind!=='cast'||event.actor!==state.game.turn||event.roll)return;
 const key=state.game.id+':'+event.id;if(pendingRollPresentation===key)return;pendingRollPresentation=key;
 const epoch=presentationEpoch;let submitting=false;presentationActive=true;showCastStage(event,state.game);
 try{
  await new Promise(resolve=>setTimeout(resolve,1000));if(epoch!==presentationEpoch)return;
  $('cast-stage').dataset.result=event.success?'success':'backfire';$('cast-stage-result').textContent=event.success?'施法成功':'反噬';
  let final;
  if(state.you===event.actor){
   const value=await drawRoll(event,epoch,state.game.id);
   if(value===null||epoch!==presentationEpoch||olderRoomSnapshot(state))return;
   busy=true;
   submitting=true;
   final=await api('roll',{code:state.code,game:state.game.id,step:state.game.step,roll:value});
  }else final=await waitForRoll(event,state.game.id);
  if(!final||epoch!==presentationEpoch)return;
  Object.assign(event,final.game.events.find(e=>e.id===event.id)||{});
  $('cast-stage-result').textContent=(event.success?'施法成功':'反噬')+'（投到 '+event.roll+' 点）';
  await new Promise(resolve=>setTimeout(resolve,1400));if(epoch!==presentationEpoch)return;
  $('cast-stage').hidden=true;
  if(!olderRoomSnapshot(final)){latestRoomSnapshot=final;renderNow(final);}
 }catch(error){if(epoch===presentationEpoch)message(error.message)}
 finally{
  if(pendingRollPresentation===key)pendingRollPresentation='';
  if(epoch===presentationEpoch){presentationActive=false;$('cast-stage').hidden=true;}
  if(submitting){busy=false;connect();}
 }
}

function animateCast(e){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const source=document.querySelector('[data-player="'+e.actor+'"]');if(!source)return;
 if(!e.success){damageHit(source,'backfire',e.roll||1);return}
 const hits=new Map(),damage='#f68060',heal='#8fc58b',owl='#e7d59e';
 if(e.spell===2){for(const id of e.targets||[])hits.set(id,damage);hits.set(e.actor,heal)}
 else if(e.spell===3||e.spell===8)hits.set(e.actor,heal);
 else if(e.spell===4)hits.set(e.actor,owl);
 else for(const id of e.targets||[])hits.set(id,damage);
 const layer=$('effects'),origin=layer.getBoundingClientRect();
 const a=source.getBoundingClientRect();
 const x=a.left+a.width/2,y=a.top+a.height/2;
 for(const [id,color] of hits){
  const target=document.querySelector('[data-player="'+id+'"]');
  if(!target)continue;
  const b=target.getBoundingClientRect();
  const dx=b.left+b.width/2-x,dy=b.top+b.height/2-y;
  const effect=img(arts[e.spell-1]);
  Object.assign(effect.style,{
   position:'absolute',width:'72px',height:'74px',
   left:(x-origin.left-36)+'px',top:(y-origin.top-37)+'px',
   filter:'drop-shadow(0 0 18px '+color+')',
  });
  layer.append(effect);
  const motion=effect.animate([
   {opacity:0,transform:'scale(.3) rotate(-25deg)'},
   {opacity:1,offset:.2,transform:'scale(1.2)'},
   {opacity:0,transform:`translate(${dx}px,${dy}px) scale(.7) rotate(20deg)`},
  ],{duration:900,easing:'ease-in-out'});
  motion.onfinish=()=>{
   effect.remove();
   const recipient=document.querySelector('[data-player="'+id+'"]');
   if(color===heal)healHit(recipient,e.spell===3?e.roll:1);
   else if(color===owl)flashHit(recipient,color);
   else damageHit(recipient,e.spell,e.roll||1);
  };
 }
}

function openOwl(){
 const g=room?.game;if(!g||g.phase!=='owl'||g.turn!==room.you)return;
 $('owl-result').hidden=true;$('owl-done').hidden=true;$('owl-picks').hidden=false;
 $('owl-picks').replaceChildren(...g.secrets.map((available,i)=>{const b=el('button');b.append(img('back'));b.setAttribute('aria-label','选择秘法石板 '+(i+1));b.disabled=!available;b.onclick=()=>chooseTablet(i);return b}));
 if(!$('owl-dialog').open)$('owl-dialog').showModal();
}
async function chooseTablet(slot){
 if(busy)return;const id=room.game.id,round=room.game.round;
 if(!await act('take',{slot}))return;
 if(room?.game?.id!==id||room.game.round!==round||room.game.phase==='owl')return;
 $('owl-picks').hidden=true;
 try{const result=await loadKnownTablets();if(result.game!==id||result.round!==round)return;const k=result.tablets.at(-1);if(!k)return;const face=img(arts[k-1]),text=el('div',undefined,'spell-'+k);text.append(el('b',room.game.ids[k-1],'spell-number'),el('h3',names[k-1]));$('owl-result').replaceChildren(face,text);$('owl-result').hidden=false;$('owl-done').hidden=false;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)face.animate([{opacity:0,transform:'rotateY(85deg) scale(.7)'},{opacity:1,transform:'rotateY(0) scale(1)'}],{duration:650,easing:'ease-out'});}catch(e){message(e.message);$('owl-dialog').close()}
}
$('owl-close').onclick=()=>$('owl-dialog').close();$('owl-done').onclick=()=>$('owl-dialog').close();

// Finish framing the table before requesting the cast, so its animation starts in view.
async function focusSeatForCast(){
 if(matchMedia('(min-width: 1100px)').matches)return;
 const button=$('end-turn');if(!button)return;
 const viewport=window.visualViewport;
 const bottom=(viewport?.height||innerHeight)+(viewport?.offsetTop||0);
 const start=window.scrollY;
 const target=Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,start+button.getBoundingClientRect().bottom-bottom+24));
 if(Math.abs(target-start)<2)return;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){window.scrollTo({top:target,behavior:'instant'});return;}
 await new Promise(resolve=>{
  let began,frame,done=false;
  const finish=()=>{if(done)return;done=true;cancelAnimationFrame(frame);window.removeEventListener('touchstart',finish);window.removeEventListener('wheel',finish);resolve()};
  window.addEventListener('touchstart',finish,{passive:true,once:true});window.addEventListener('wheel',finish,{passive:true,once:true});
  const tick=time=>{if(done)return;began??=time;const t=Math.min(1,(time-began)/230),ease=1-Math.pow(1-t,3);window.scrollTo({top:start+(target-start)*ease,behavior:'instant'});if(t<1)frame=requestAnimationFrame(tick);else finish()};
  frame=requestAnimationFrame(tick);
 });
}

const countSlotLabels={
 used:'已公开',
 visible:'对手手中可见',
 'known-tablet':'我的秘法石板',
 unknown:'未知',
};

function renderCountBoard(g){
 const visible=Array(8).fill(0),privateCounts=Array(8).fill(0);
 if(knownTabletKey===currentTabletKey()){
  for(const kind of knownTablets)privateCounts[kind-1]++;
 }
 for(const player of g.players){
  if(player.id===room.you)continue;
  for(const kind of player.hand)if(kind)visible[kind-1]++;
 }

 const board=$('count-board');
 for(const [i,name] of names.entries()){
  let row=board.children[i];
  const id=String(g.ids[i]),supply=g.supply[i];
  if(!row){
   row=el('div',undefined,'count-row spell-'+(i+1));
   const label=el('div',undefined,'count-label');
   label.append(el('b',id,'spell-number'),img(arts[i]),el('span',name),el('strong'));
   row.append(label,el('div',undefined,'count-slots'));
   board.append(row);
  }
  const used=g.used[i]+g.removed[i];
  const seen=used+visible[i];
  const known=seen+privateCounts[i];
  const label=row.querySelector('.count-label strong');
  const total=known+' / '+supply;
  if(label.textContent!==total)label.textContent=total;
  const title='已公开 '+used+' · 可见 '+visible[i]+' · 我的石板 '+privateCounts[i]+' · 未知 '+(supply-known);
  if(row.title!==title)row.title=title;

  const slots=row.querySelector('.count-slots');
  while(slots.children.length>supply)slots.lastElementChild.remove();
  for(let j=0;j<supply;j++){
   let slot=slots.children[j];
   if(!slot){
    slot=el('span',id);
    slots.append(slot);
   }
   const state=j<used?'used':j<seen?'visible':j<known?'known-tablet':'unknown';
   const className='count-slot '+state;
   if(slot.className===className)continue;
   slot.className=className;
   slot.title=countSlotLabels[state];
   slot.setAttribute('aria-label',id+'号：'+slot.title);
  }
 }
}

function currentTabletKey(){return room?.game?room.code+':'+room.game.id+':'+room.game.round+':'+room.you:'';}
function loadKnownTablets({background=false}={}){
 const key=currentTabletKey();if(!key)return Promise.reject(Error('游戏尚未开始'));
 if(tabletRequest?.key===key){
  const {promise}=tabletRequest;
  return background?promise:withRequestFeedback(()=>promise);
 }
 const code=room.code;
 const promise=api('tablets?code='+code,undefined,{background}).then(result=>{
  if(currentTabletKey()!==key||result.game!==room.game.id||result.round!==room.game.round)throw Error('本轮已结束，请重新查看');
  knownTabletKey=key;knownTablets=[...result.tablets];renderCountBoard(room.game);return result;
 }).finally(()=>{if(tabletRequest?.key===key)tabletRequest=null;});
 tabletRequest={key,promise};return promise;
}

function flashHit(target,color='#f68060'){
 if(!target)return;
 const flash=el('div',undefined,'damage-flash');target.append(flash);
 flash.style.setProperty('--hit-flash',color);const glow=flash.animate([{opacity:0},{opacity:1,offset:.2},{opacity:.65,offset:.5},{opacity:0}],{duration:400,easing:'ease-out'});glow.onfinish=()=>flash.remove();
}
function shakeHit(target,color='#f68060'){
 if(!target)return;flashHit(target,color);
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 target.animate([{translate:'0px 0px'},{translate:'-4px 0px',offset:.25},{translate:'3px 0px',offset:.55},{translate:'-1px 0px',offset:.8},{translate:'0px 0px'}],{duration:400,easing:'ease-in-out'});
}
const damageParticles={
 1:{shape:'ember',color:'#ffad55',count:12,duration:620,trajectory:(t,k)=>[t*.98-.49,-.12-Math.sin(t*Math.PI)*.34,k*.3-.15,.24]},
 2:{shape:'wisp',color:'#c5ace8',count:9,duration:740,trajectory:(t,k)=>[Math.cos(t*6.28)*.42,-.2-k*.24,Math.sin(t*6.28)*.28,.24+k*.1]},
 5:{shape:'bolt',color:'#b2baff',count:8,duration:460,trajectory:(t,k)=>[Math.round(t*4)/5-.4,.44,t*.8-.4,-.48]},
 6:{shape:'shard',color:'#aff5ff',count:10,duration:600,trajectory:(t,k)=>[Math.cos(t*6.28)*(.3+k*.18),Math.sin(t*6.28)*(.3+k*.18),0,0]},
 7:{shape:'flame',color:'#ff7945',count:10,duration:660,trajectory:(t,k)=>[(t-.5)*.72,-.26-k*.22,(t-.5)*.35,.18]},
 backfire:{shape:'spark',color:'#ff5757',count:14,duration:550,trajectory:(t,k)=>[(t-.5)*.96,.23+k*.21,(t-.5)*.3,-.08]},
};
function damageHit(target,spell,amount){
 if(!target)return;
 shakeHit(target);
 const style=damageParticles[spell];
 if(!style)return;
 const burst=el('div',undefined,'damage-particles '+style.shape+'-burst');
 burst.setAttribute('aria-hidden','true');
 burst.style.setProperty('--particle-color',style.color);
 target.append(burst);
 const width=target.clientWidth,height=target.clientHeight;
 const count=style.count+4*(amount**2-1);
 const particles=Array.from({length:count},(_,i)=>{
  const particle=el('span',undefined,'damage-particle '+style.shape);
  burst.append(particle);
  const [x,y,startX,startY]=style.trajectory(i/count,(i%7)/6);
  const angle=Math.atan2((y-startY)*height,(x-startX)*width)*180/Math.PI+90;
  const frame=(progress,scale,spin)=>{
   const dx=(startX+(x-startX)*progress)*width;
   const dy=(startY+(y-startY)*progress)*height;
   return `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(${angle+spin}deg) scale(${scale})`;
  };
  const sharp=spell===5||spell===6;
  return particle.animate([
   {opacity:0,transform:frame(0,.4,0)},
   {opacity:1,offset:.18,transform:frame(sharp?.45:.19,1.1,0)},
   {opacity:.72,offset:.56,transform:frame(.77,.94,spell===6?75:8)},
   {opacity:0,transform:frame(1,spell===2?1.65:.38,spell===6?155:20)},
  ],{duration:style.duration,delay:(i%7)*(sharp?10:19),fill:'both',easing:sharp?'ease-out':'ease-in-out'}).finished;
 });
 Promise.allSettled(particles).then(()=>burst.remove());
}
function healHit(target,amount){
 if(!target)return;
 const sweep=el('div',undefined,'heal-sweep');
 sweep.setAttribute('aria-hidden','true');
 target.append(sweep);
 const wash=el('div',undefined,'heal-wash');
 sweep.append(wash);
 wash.animate([
  {transform:'translateY(65%)'},
  {transform:'translateY(-100%)'},
 ],{duration:400,easing:'linear',fill:'forwards'});
 const rise=target.clientHeight;
 const count=3*amount**2;
 const columns=Math.ceil(Math.sqrt(count*2));
 const particles=Array.from({length:count},(_,i)=>{
  const plus=el('span','+','heal-plus');
  plus.style.left=(6+(i%columns+.5)*84/columns)+'%';
  plus.style.bottom=(12+Math.floor(i/columns)*14+i%3*3)+'%';
  sweep.append(plus);
  return plus.animate([
   {opacity:0,transform:'translateY(0) scale(.7)'},
   {opacity:.95,offset:.24},
   {opacity:.8,offset:.68},
   {opacity:0,transform:`translateY(${-rise*.26}px) scale(1)`},
  ],{duration:850,delay:230+(i%columns)*14+Math.floor(i/columns)*42,fill:'both',easing:'ease-out'}).finished;
 });
 Promise.allSettled(particles).then(()=>sweep.remove());
 const heart=target.querySelector('.heart-icon');
 heart?.animate([{transform:'scale(1)'},{transform:'scale(1.28)',offset:.45},{transform:'scale(1)'}],{duration:400,easing:'ease-out'});
}

const emojiSendInterval=500;
const defaultQuickEmoji=['😂','🤣','😭','🤡','👍'];
function readEmojiList(key,limit){
 try{
  const saved=JSON.parse(localStorage.getItem(key)||'[]');
  if(Array.isArray(saved))return [...new Set(saved.filter(x=>typeof x==='string'))].slice(0,limit);
 }catch{}
 return [];
}
let emojiCatalog=null,emojiLoading=null,lastEmojiSend=-Infinity,emojiCloseTimer;
let recentEmoji=readEmojiList('abr-emoji-recent',10);
const savedQuickEmoji=readEmojiList('abr-emoji-quick',5);
const quickEmojiSlots=[...new Set([...(savedQuickEmoji.length?savedQuickEmoji:recentEmoji),...defaultQuickEmoji])].slice(0,5);
async function openEmojiMenu(){
 clearTimeout(emojiCloseTimer);
 if(!$('emoji-menu').hidden)return;
 closeSpellPreview();
 $('emoji-menu').hidden=false;document.querySelector('.emoji-toggle')?.setAttribute('aria-expanded','true');positionEmojiMenu();
 try{
  if(!emojiCatalog){emojiLoading??=api('emojis',undefined,{background:true});emojiCatalog=await emojiLoading;const allowed=new Set(emojiCatalog.flatMap(g=>g.emojis));recentEmoji=recentEmoji.filter(e=>allowed.has(e));}
  if($('emoji-menu').hidden)return;drawEmojiMenu();positionEmojiMenu();
 }catch(error){emojiLoading=null;message(error.message);closeEmojiMenu()}
}
function closeEmojiMenu(){clearTimeout(emojiCloseTimer);$('emoji-menu').hidden=true;document.querySelector('.emoji-toggle')?.setAttribute('aria-expanded','false')}
const quickEmojis=()=>[...quickEmojiSlots];
function emojiButton(emoji,quick=false){
 const b=el('button',emoji,'emoji-choice');
 b.type='button';b.setAttribute('aria-label','发送 '+emoji);b.onclick=()=>sendEmoji(emoji);
 if(quick&&matchMedia('(any-pointer: fine)').matches){
  b.draggable=true;
  b.ondragstart=event=>startEmojiDrag(event,emoji);
  b.ondragend=cancelEmojiGesture;
 }
 return b;
}
function rememberEmoji(emoji){
 if(!quickEmojiSlots.includes(emoji)){
  let slot=0,oldest=-1;
  for(const [index,value] of quickEmojiSlots.entries()){
   const rank=recentEmoji.indexOf(value);
   const age=rank===-1?recentEmoji.length:rank;
   if(age>=oldest){slot=index;oldest=age}
  }
  quickEmojiSlots[slot]=emoji;
  document.querySelector('.emoji-quick')?.children[slot]?.replaceWith(emojiButton(emoji,true));
 }
 recentEmoji=[emoji,...recentEmoji.filter(e=>e!==emoji)].slice(0,10);
 try{
  localStorage.setItem('abr-emoji-recent',JSON.stringify(recentEmoji));
  localStorage.setItem('abr-emoji-quick',JSON.stringify(quickEmojiSlots));
 }catch{}
}
function drawEmojiMenu(){
 const recent=$('emoji-recent');recent.replaceChildren();
 if(recentEmoji.length){recent.append(el('h3','最近'));const grid=el('div',undefined,'emoji-grid');grid.append(...recentEmoji.map(emoji=>emojiButton(emoji)));recent.append(grid)}
 $('emoji-groups').replaceChildren(...(emojiCatalog||[]).map(group=>{const section=el('section');section.append(el('h3',group.name));const grid=el('div',undefined,'emoji-grid');grid.append(...group.emojis.map(emoji=>emojiButton(emoji)));section.append(grid);return section}));
}
async function sendEmoji(emoji,target){
 if(!room?.game)return;
 const now=performance.now();
 if(now-lastEmojiSend<emojiSendInterval)return;
 lastEmojiSend=now;
 const activeCode=room.code;
 try{await api('react',{code:activeCode,emoji,...(target?{target,game:room.game.id}:{})},{background:true});if(room?.code===activeCode)rememberEmoji(emoji);}catch(error){message(error.message)}
}
function dismissEmojiMenuSoon(){
 clearTimeout(emojiCloseTimer);
 emojiCloseTimer=setTimeout(()=>{if(!$('emoji-menu').contains(document.activeElement))closeEmojiMenu()},240);
}
function positionEmojiMenu(){
 const menu=$('emoji-menu');
 if(menu.hidden)return;
 const button=document.querySelector('.emoji-toggle');
 if(!button||!placePanel(menu,button,{width:330,maxHeight:430,align:'end'}))closeEmojiMenu();
}
function bindEmojiToggle(button){
 button.setAttribute('aria-controls','emoji-menu');
 button.onpointerenter=event=>{if(event.pointerType==='mouse')void openEmojiMenu()};
 button.onpointerleave=event=>{if(event.pointerType==='mouse'&&!$('emoji-menu').contains(event.relatedTarget))dismissEmojiMenuSoon()};
 button.onclick=event=>{
  const mouse=event.pointerType==='mouse'||(!event.pointerType&&event.detail>0&&matchMedia('(hover: hover) and (pointer: fine)').matches);
  if(!mouse&&!$('emoji-menu').hidden){closeEmojiMenu();return}
  void openEmojiMenu();
  if(event.detail===0&&!$('emoji-menu').hidden)$('emoji-close').focus();
 };
}
const emojiWheel=$('emoji-wheel');
const emojiWheelChoices=$('emoji-wheel-choices');
let mousePoint=null,emojiDrag=null,wheel=null,highlightedSeat=null,emojiTouch=null;
const gameKey=()=>room?.game?room.code+':'+room.game.id:'';

function markEmojiTarget(seat){
 if(highlightedSeat===seat)return;
 highlightedSeat?.removeAttribute('data-emoji-target');
 highlightedSeat=seat;
 highlightedSeat?.setAttribute('data-emoji-target','');
}

function cancelEmojiGesture(){
 emojiDrag=null;
 emojiTouch=null;
 wheel=null;
 emojiWheel.hidden=true;
 markEmojiTarget(null);
}

function startEmojiDrag(event,emoji){
 if(!gameKey()||!event.dataTransfer){event.preventDefault();return}
 cancelEmojiGesture();closeSpellPreview();closeEmojiMenu();
 emojiDrag={emoji,game:gameKey()};
 event.dataTransfer.setData('text/plain',emoji);
 event.dataTransfer.effectAllowed='copy';
}

function dropTarget(event){
 const seat=event.target.closest?.('.seat[data-player]');
 return seat&&seat.dataset.player!==room?.you?seat:null;
}
$('game').addEventListener('dragover',event=>{
 if(!emojiDrag||emojiDrag.game!==gameKey())return;
 const seat=dropTarget(event);
 markEmojiTarget(seat);
 if(seat){event.preventDefault();event.dataTransfer.dropEffect='copy'}
});
$('game').addEventListener('dragleave',event=>{
 if(emojiDrag&&!$('game').contains(event.relatedTarget))markEmojiTarget(null);
});
$('game').addEventListener('drop',event=>{
 if(!emojiDrag||emojiDrag.game!==gameKey())return;
 event.preventDefault();
 const seat=dropTarget(event),emoji=emojiDrag.emoji;
 cancelEmojiGesture();
 if(seat)void sendEmoji(emoji,seat.dataset.player);
});

function nearestEmojiSeat(point){
 let best=null,distance=64;
 for(const seat of document.querySelectorAll('.seat[data-player]')){
  if(seat.dataset.player===room?.you)continue;
  const r=seat.getBoundingClientRect();
  if(!r.width||!r.height||r.bottom<=0||r.top>=innerHeight)continue;
  const dx=Math.max(r.left-point.x,0,point.x-r.right);
  const dy=Math.max(r.top-point.y,0,point.y-r.bottom);
  const gap=Math.hypot(dx,dy);
  if(gap<distance){distance=gap;best=seat}
 }
 return best;
}

function selectWheelEmoji(index){
 if(!wheel||wheel.index===index)return;
 wheel.index=index;
 [...emojiWheelChoices.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
}

function finishEmojiWheel(index){
 const selection=wheel;
 cancelEmojiGesture();
 if(selection?.game===gameKey()&&index>=0)void sendEmoji(selection.emojis[index],selection.target);
}

function openEmojiWheel(seat,point,keyboard=false){
 closeSpellPreview();closeEmojiMenu();
 const radius=86;
 const x=Math.min(innerWidth-radius,Math.max(radius,point.x));
 const y=Math.min(innerHeight-radius,Math.max(radius,point.y));
 const emojis=quickEmojis();
 wheel={x,y,keyboard,index:-1,emojis,game:gameKey(),target:seat.dataset.player};
 $('emoji-wheel-target').textContent=room.game.players.find(p=>p.id===wheel.target)?.name??'';
 emojiWheelChoices.replaceChildren(...emojis.map((emoji,index)=>{
  const b=el('button',emoji,'emoji-choice');
  const angle=index*2*Math.PI/emojis.length-Math.PI/2;
  b.type='button';b.setAttribute('aria-label','投掷 '+emoji);b.setAttribute('aria-pressed','false');
  b.style.left=86+Math.cos(angle)*60+'px';
  b.style.top=86+Math.sin(angle)*60+'px';
  b.onclick=()=>finishEmojiWheel(index);
  return b;
 }));
 emojiWheel.style.left=x+'px';emojiWheel.style.top=y+'px';emojiWheel.hidden=false;
 markEmojiTarget(seat);
}

document.addEventListener('pointermove',event=>{
 if(event.pointerType!=='mouse')return;
 mousePoint={x:event.clientX,y:event.clientY};
 if(wheel?.keyboard)selectWheelEmoji(wheelChoice(mousePoint.x-wheel.x,mousePoint.y-wheel.y,wheel.emojis.length));
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&wheel){cancelEmojiGesture();return}
 if(event.code!=='KeyV'||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||
  event.target.closest?.('input,textarea,select,[contenteditable]')||!mousePoint||!gameKey()||
  emojiDrag||document.querySelector('dialog[open]'))return;
 const seat=nearestEmojiSeat(mousePoint);
 if(seat){event.preventDefault();openEmojiWheel(seat,mousePoint,true)}
});
document.addEventListener('keyup',event=>{if(event.code==='KeyV'&&wheel?.keyboard)finishEmojiWheel(wheel.index)});
window.addEventListener('blur',()=>{mousePoint=null;cancelEmojiGesture()});
window.addEventListener('resize',()=>{if(wheel)cancelEmojiGesture()});

// The card accepts taps. A swipe starts only on its name or life display.
document.addEventListener('pointerdown',event=>{
 if(wheel&&!emojiWheel.contains(event.target))cancelEmojiGesture();
 if(event.pointerType!=='touch'||!event.isPrimary||!gameKey()||
  document.querySelector('dialog[open]'))return;
 const seat=event.target.closest?.('.seat[data-player]:not(.self)');
 if(!seat||event.target.closest('button,a,input,select,textarea,canvas,[contenteditable]'))return;
 emojiTouch={
  id:event.pointerId,seat,x:event.clientX,y:event.clientY,
  canSwipe:Boolean(event.target.closest('.seat-content > :is(h3,.life)')),
  moved:false,dragging:false,
 };
});
document.addEventListener('pointermove',event=>{
 if(emojiTouch?.id!==event.pointerId)return;
 const dx=event.clientX-emojiTouch.x,dy=event.clientY-emojiTouch.y;
 if(Math.hypot(dx,dy)>12)emojiTouch.moved=true;
 if(!emojiTouch.canSwipe)return;
 const index=wheelChoice(dx,dy,quickEmojiSlots.length);
 if(!emojiTouch.dragging){
  if(index<0)return;
  emojiTouch.dragging=true;
  openEmojiWheel(emojiTouch.seat,emojiTouch);
 }
 selectWheelEmoji(index);
});
document.addEventListener('pointerup',event=>{
 if(emojiTouch?.id!==event.pointerId)return;
 const touch=emojiTouch;
 emojiTouch=null;
 const dx=event.clientX-touch.x,dy=event.clientY-touch.y;
 const index=touch.canSwipe?wheelChoice(dx,dy,quickEmojiSlots.length):-1;
 if(touch.dragging||index>=0){
  if(!wheel)openEmojiWheel(touch.seat,touch);
  finishEmojiWheel(index);
 }else if(!touch.moved&&Math.hypot(dx,dy)<=12){
  openEmojiWheel(touch.seat,touch);
 }
});
document.addEventListener('pointercancel',event=>{
 if(emojiTouch?.id===event.pointerId)cancelEmojiGesture();
});

function showReaction(value){
 if(!room?.game)return;
 const seatFor=id=>[...document.querySelectorAll('.seat[data-player]')].find(seat=>seat.dataset.player===id);
 const sender=seatFor(value.player),target=value.target?seatFor(value.target):sender;
 if(!sender||!target)return;
 const from=sender.getBoundingClientRect(),to=target.getBoundingClientRect(),thrown=Boolean(value.target);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const layer=$('reactions'),origin=layer.getBoundingClientRect();
 const targetX=to.left+to.width/2,targetY=to.top+Math.min(44,to.height/2);
 const jitter=range=>(Math.random()-.5)*range;
 for(const direction of thrown?[-1,0,1]:[0]){
  const emoji=el('span',value.emoji,'floating-emoji');
  const x=targetX+(thrown?jitter(18):jitter(24)),y=targetY+(thrown?jitter(14):0);
  emoji.style.left=x-origin.left+'px';
  emoji.style.top=y-origin.top+'px';
  layer.append(emoji);
  const pose=(dx,dy,scale,angle=0)=>`translate(calc(-50% + ${dx}px),${dy}px) rotate(${angle}deg) scale(${scale})`;
  let frames,timing;
  if(reduced){
   frames=[{opacity:1,transform:pose(direction*30,0,1)},{opacity:1,offset:.7},{opacity:0}];
   timing={duration:thrown?1800:5000};
  }else if(thrown){
   const dx=from.left+from.width/2-x,dy=from.top+Math.min(44,from.height/2)-y;
   const splashX=direction*(46+jitter(18))+jitter(12);
   const splashY=(direction===0?42:13)+jitter(14);
   const angle=direction*28+jitter(24);
   frames=[
    {opacity:0,transform:pose(dx,dy,.6),easing:'ease-in'},
    {opacity:1,offset:.1,transform:pose(dx*.94,dy*.94,.8),easing:'ease-in-out'},
    {opacity:1,offset:.59,transform:pose(0,0,1.08),easing:'ease-out'},
    {opacity:1,offset:.83,transform:pose(splashX*.83,splashY*.75,1.08,angle*.8),easing:'ease-in'},
    {opacity:0,transform:pose(splashX,splashY,.78,angle)},
   ];
   timing={duration:1650,delay:(direction+1)*75,fill:'backwards'};
  }else{
   frames=[
    {opacity:0,transform:pose(0,0,.7)},
    {opacity:1,offset:.08,transform:pose(0,-12,1)},
    {opacity:1,offset:.7,transform:pose(0,-95,1)},
    {opacity:0,transform:pose(0,-160,1)},
   ];
   timing={duration:5000};
  }
  emoji.animate(frames,timing).onfinish=()=>emoji.remove();
 }
}
$('emoji-menu').addEventListener('pointerenter',()=>clearTimeout(emojiCloseTimer));
$('emoji-menu').addEventListener('pointerleave',event=>{
 if(event.pointerType==='mouse'&&!event.relatedTarget?.closest?.('.emoji-toggle'))dismissEmojiMenuSoon();
});
$('emoji-close').onclick=()=>{closeEmojiMenu();document.querySelector('.emoji-toggle')?.focus()};
document.addEventListener('pointerdown',event=>{if(!$('emoji-menu').hidden&&!$('emoji-menu').contains(event.target)&&!event.target.closest('.emoji-controls'))closeEmojiMenu()});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape'||$('emoji-menu').hidden)return;
 const restore=$('emoji-menu').contains(document.activeElement);
 closeEmojiMenu();
 if(restore)document.querySelector('.emoji-toggle')?.focus();
});
function positionActionPanels(){positionEmojiMenu();positionSpellPreview()}
window.addEventListener('resize',positionActionPanels);
window.addEventListener('scroll',event=>{
 if(event.target!==$('emoji-menu')&&event.target!==spellPreview){
  if(wheel&&!wheel.keyboard)cancelEmojiGesture();
  positionActionPanels();
 }
},{passive:true,capture:true});

function positionCastCallout(){
 const stage=$('cast-stage');if(stage.hidden)return;
 const seat=document.querySelector('[data-player="'+stage.dataset.player+'"]');if(!seat)return;
 const area=seat.querySelector('.seat-content')||seat;
 if(stage.parentElement!==area)area.append(stage);
 stage.removeAttribute('style');stage.dataset.side='overlay';
 stage.style.setProperty('--callout-art-height',Math.max(34,Math.min(86,area.getBoundingClientRect().height-91))+'px');
}
window.addEventListener('resize',positionCastCallout);window.addEventListener('scroll',positionCastCallout,{passive:true});

// Keep unchanged seats and stones mounted: state updates must not replay dealing.
function renderSeats(g,by){
 const parent=$('seats');
 if(parent.dataset.game!==g.id){parent.replaceChildren();parent.dataset.game=g.id;}
 const existing=new Map([...parent.children].map(node=>[node.dataset.player,node]));
 const ordered=seats(g.players,room.you);
 for(const [index,s] of ordered.entries()){
  const p=s.player;let card=existing.get(p.id);
  if(!card){
   card=el('article');card.dataset.player=p.id;
   const content=el('div',undefined,'seat-content');content.append(el('h3'),el('div',undefined,'life'),el('div',undefined,'hand'));card.append(content);
   if(p.id===room.you){const controls=el('div',undefined,'emoji-controls'),quick=el('div',undefined,'emoji-quick');quick.setAttribute('aria-label','快捷表情');const button=el('button','☺︎','emoji-toggle');button.type='button';button.setAttribute('aria-label','发送表情');bindEmojiToggle(button);controls.append(quick,button);card.append(controls);quick.append(...quickEmojis().map(emoji=>emojiButton(emoji,true)))}
  }
  existing.delete(p.id);
  card.className='seat '+(s.offset===0?'self ':s.side==='opposite'?'opposite ':'')+(p.id===g.turn&&!['round-end','finished'].includes(g.phase)?'active':'');
  card.style.gridColumn=s.column;card.style.gridRow=s.row;card.style.setProperty('--x',s.x+'%');card.style.setProperty('--y',s.y+'%');
  const heading=card.querySelector('h3'),name=p.name+(p.id===room.you?' · 你':'');const headingKey=name+':'+p.tablets;if(heading.dataset.key!==headingKey){heading.replaceChildren(document.createTextNode(name));if(p.tablets>=1){const count=el('span','秘法石板 '+p.tablets,'player-tablets');count.setAttribute('aria-label',p.tablets+' 个秘法石板');heading.append(count)}heading.dataset.key=headingKey;}
  const health=card.querySelector('.life');
  if(health.dataset.value!==String(p.life)){
   clearTimeout(health.updateTimer);
   const updateHealth=()=>{health.dataset.value=String(p.life);health.className='life '+(p.life>=5?'healthy':p.life>=3?'wounded':p.life>0?'critical':'depleted');health.setAttribute('aria-label','生命 '+p.life+' / 6');health.replaceChildren(el('span','♥︎','heart-icon'),el('strong',p.life),el('span','/ 6','life-max'));};
   const incoming=g.events.filter(e=>e.kind==='cast'&&e.id>last);
   const affected=incoming.filter(e=>e.success?((e.targets||[]).includes(p.id)||(e.actor===p.id&&[2,3,8].includes(e.spell))):e.actor===p.id);
   const delay=health.dataset.value!==undefined&&!matchMedia('(prefers-reduced-motion: reduce)').matches?Math.max(0,...affected.map(e=>e.success?1320:420)):0;
   if(delay)health.updateTimer=setTimeout(updateHealth,delay);else updateHealth();
  }
  const hand=card.querySelector('.hand'),stones=sortedHand(p.hand),signature=g.round+':'+g.supply.join(',')+':'+stones.join(',');
  if(hand.dataset.signature!==signature){
   const pool=new Map();for(const node of hand.children){const k=Number(node.dataset.kind);if(!pool.has(k))pool.set(k,[]);pool.get(k).push(node)}
   const keep=[];
   for(const k of stones){let stone=pool.get(k)?.shift();if(stone){stone.style.animation='none'}else{stone=el('div',undefined,'stone spell-'+k);stone.dataset.kind=String(k);stone.append(img(k?arts[k-1]:'back'),el('b',k?g.supply[k-1]:'?'));}
    const number=stone.querySelector('b'),label=String(k?g.ids[k-1]:'?');if(number.textContent!==label)number.textContent=label;keep.push(stone);
   }
   const retained=new Set(keep);for(const node of [...hand.children])if(!retained.has(node))node.remove();
   keep.forEach((node,i)=>{if(hand.children[i]!==node)hand.insertBefore(node,hand.children[i]||null)});
   hand.dataset.signature=signature;hand.dataset.count=String(stones.length);
  }
  const toggle=card.querySelector('.emoji-toggle');if(toggle)toggle.setAttribute('aria-expanded',String(!$('emoji-menu').hidden));
  if(parent.children[index]!==card)parent.insertBefore(card,parent.children[index]||null);
 }
 for(const node of existing.values())node.remove();
}

$('result-toggle').onclick=()=>{const collapsed=$('round-result').classList.toggle('collapsed');$('result-toggle').textContent=collapsed?'查看结算':'收起结算';$('result-toggle').setAttribute('aria-expanded',String(!collapsed));requestAnimationFrame(clampResultWindow)};

function clampResultWindow(){
 const panel=$('round-result');if(panel.hidden||!matchMedia('(min-width:1100px)').matches)return;
 const r=panel.getBoundingClientRect(),gap=12;
 const x=Math.max(gap,Math.min(r.left,innerWidth-r.width-gap)),y=Math.max(gap,Math.min(r.top,innerHeight-r.height-gap));
 panel.style.left=x+'px';panel.style.top=y+'px';panel.style.right='auto';panel.style.bottom='auto';
}
$('result-title').onpointerdown=event=>{
 if(!matchMedia('(min-width:1100px)').matches||event.button!==0)return;
 const panel=$('round-result'),handle=event.currentTarget,r=panel.getBoundingClientRect(),dx=event.clientX-r.left,dy=event.clientY-r.top;
 handle.setPointerCapture(event.pointerId);event.preventDefault();
 handle.onpointermove=e=>{panel.style.left=(e.clientX-dx)+'px';panel.style.top=(e.clientY-dy)+'px';panel.style.right='auto';panel.style.bottom='auto';clampResultWindow()};
 handle.onpointerup=handle.onpointercancel=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null};
};
window.addEventListener('resize',()=>{if(!matchMedia('(min-width:1100px)').matches)$('round-result').removeAttribute('style');else clampResultWindow()});
new MutationObserver(()=>requestAnimationFrame(clampResultWindow)).observe($('round-result'),{attributes:true,attributeFilter:['hidden','class']});
resume();
