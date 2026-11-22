import {cityCostReferences} from './data/city-costs.mjs';
import {amount,decode,defaults,encode,prefillNumbers} from './model.mjs';

const key='offer-desk-v1';
export const MAX_IMPORT_BYTES=4*1024*1024;
const MAX_IMPORT_OFFERS=100;

export async function readOfferImport(file) {
  if(file.size>MAX_IMPORT_BYTES)throw new Error('备份文件不能超过 4 MiB。');
  return decode(await file.text(),{maxOffers:MAX_IMPORT_OFFERS});
}
export function readSetting(name) {
  try {return localStorage.getItem(key+'-'+name);} catch {return null;}
}
export function writeSetting(name,value) {
  if(localStorage.getItem(key+'-'+name)===value)return;
  localStorage.setItem(key+'-'+name,value);
  if(name==='city-rent'||name==='city-living')markChanged();
}
export function loadOffers() {
  try {
    return decode(localStorage.getItem(key));
  }catch{return [prefillNumbers({...defaults,id:'starter-offer'})];}
}
export function writeOffers(offers) {
  const data=encode(offers);
  if(localStorage.getItem(key)===data)return;
  localStorage.setItem(key,data);
  markChanged();
}
function markChanged() {
  localStorage.setItem(key+'-cloud-pending',Date.now()+':'+Math.random());
  globalThis.window?.dispatchEvent(new Event('offer-call-change'));
}
export const cityCostFields=['rent','living'];
export const cityCostSettings={rent:'city-rent',living:'city-living'};
export const cityName=value=>(value||'').trim().replace(/市$/,'');

export function cityCostOverrides(field) {
  try {return new Map(Object.entries(JSON.parse(readSetting(cityCostSettings[field])||'{}')));}
  catch {return new Map();}
}
export function cityCostDefaults(overrides) {
  return Object.fromEntries(cityCostFields.map(field=>[
    field,new Map([...Object.entries(cityCostReferences).map(([city,reference])=>[city,String(reference[field])]),...(overrides ? Object.entries(overrides[field]??{}) : cityCostOverrides(field))]),
  ]));
}
export function applyCityCosts(offer,costs,{includeZero=false}={}) {
  const city=cityName(offer.city);
  const defaults={};
  for(const field of cityCostFields){
    const value=offer[field];
    const cost=costs[field].get(city);
    if(cost!==undefined&&(!String(value??'').trim()||(includeZero&&amount(value)===0)))defaults[field]=cost;
  }
  return {...offer,...defaults};
}

export function planOfferImport(current,incoming,mode) {
  if(mode==='replace')return {offers:incoming,active:incoming[0].id};
  if(mode!=='append')throw new Error('请选择追加或替换。');
  if(current.length+incoming.length>MAX_IMPORT_OFFERS)throw new Error('追加后不能超过 100 份 Offer。可选择替换或导入较小的备份。');
  const occupied=new Set(current.map(offer=>offer.id));
  const reserved=new Set([...occupied,...incoming.map(offer=>offer.id)]);
  const appended=incoming.map(offer=>{
    if(!occupied.has(offer.id))return offer;
    let id=offer.id+'-import';
    for(let suffix=2;reserved.has(id);suffix++)id=offer.id+'-import-'+suffix;
    reserved.add(id);
    return {...offer,id};
  });
  return {offers:[...current,...appended],active:appended[0].id};
}
