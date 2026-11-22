import {readSetting, writeSetting, loadOffers, cityCostFields, cityCostOverrides} from './storage.mjs';
import {encode} from './model.mjs';

const pendingKey='cloud-pending';
const delay=5000;

function browserID() {
  let id=readSetting('browser-id');
  if(!id){
    id=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
    writeSetting('browser-id',id);
  }
  return id;
}

async function request(path,options) {
  const response=await fetch(new URL(path,document.baseURI),options);
  if(!response.ok)throw new Error(String(response.status));
  return response;
}

export async function readShare(id) {
  const response=await request('api/share/'+encodeURIComponent(id));
  return response.json();
}

export function startCloud(onStatus=()=>{}) {
  let timer;
  let retryAfter=0;
  const withLock=task=>navigator.locks ? navigator.locks.request('offer-call-cloud',task) : task();
  const headers=()=>({Authorization:'Bearer '+browserID()});
  const save=async()=>{
    const pending=readSetting(pendingKey);
    const snapshot=JSON.parse(encode(loadOffers()));
    snapshot.cityCosts=Object.fromEntries(cityCostFields.map(field=>[field,Object.fromEntries(cityCostOverrides(field))]));
    await request('api/save',{method:'PUT',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
    if(readSetting(pendingKey)===pending)writeSetting(pendingKey,'');
    onStatus(readSetting(pendingKey) ? '● 已保存到本机 · 等待同步' : '● 已同步');
  };

  function schedule() {
    clearTimeout(timer);
    const pending=readSetting(pendingKey);
    if(!pending)return;
    const due=Number(pending.split(':')[0])+delay;
    onStatus('● 已保存到本机 · 等待同步');
    timer=setTimeout(async()=>{
      try {
        await withLock(async()=>{
          const latest=readSetting(pendingKey);
          if(latest && Number(latest.split(':')[0])+delay<=Date.now())await save();
        });
        retryAfter=0;
        schedule();
      } catch(error) {
        if(!['413','503'].includes(error.message)){
          retryAfter=Date.now()+30000;
          schedule();
        }
        onStatus(error.message==='413'?'● 已保存到本机 · 数据过大':error.message==='503'?'● 已保存到本机 · 云端未配置':'● 已保存到本机 · 同步失败，将重试');
      }
    },Math.max(0,Math.max(due,retryAfter)-Date.now()));
  }

  window.addEventListener('offer-call-change',()=>{
    retryAfter=0;
    schedule();
  });
  window.addEventListener('storage',schedule);
  window.addEventListener('pageshow',schedule);
  window.addEventListener('online',()=>{
    retryAfter=0;
    schedule();
  });
  Promise.resolve(withLock(browserID)).catch(()=>{});
  schedule();

  return {
    async share(){
      return withLock(async()=>{
        await save();
        const response=await request('api/share',{method:'POST',headers:headers()});
        const {uuid}=await response.json();
        return new URL('./#share='+uuid,document.baseURI).href;
      });
    },
  };
}
