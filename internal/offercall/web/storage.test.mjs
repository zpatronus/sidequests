import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCityCosts,cityCostChanges,cityCostDefaults,MAX_IMPORT_BYTES,planOfferImport,readOfferImport} from './storage.mjs';
import {cityCostReferences} from './data/city-costs.mjs';
import {CITIES,CITY_REFERENCES} from './data/city-policies.mjs';

test('城市预设展示差异，保留手填值与明确的 0',()=>{
  const costs={rent:new Map([['上海','7900']]),living:new Map([['上海','3k']])};
  const offer={city:' 上海市 ',rent:'5200',living:'0'};
  assert.deepEqual(cityCostChanges(offer,costs),[
    {field:'rent',current:'5200',next:'7900'},
    {field:'living',current:'0',next:'3k'},
  ]);
  assert.deepEqual(cityCostChanges({...offer,rent:'7.9k',living:'3000'},costs),[]);
  assert.deepEqual(cityCostChanges({...offer,city:'其他城市'},costs),[]);
  assert.deepEqual(applyCityCosts(offer,costs),offer);
  assert.deepEqual(applyCityCosts({...offer,rent:''},costs),{...offer,rent:'7900'});
});

test('城市目录覆盖 31 个省级行政区，目录与来源不重复',()=>{
  assert.equal(new Set(CITIES.map(city=>city.province)).size,31);
  assert.equal(new Set(CITIES.map(city=>city.name)).size,CITIES.length);
  assert.ok(CITIES.every(city=>CITY_REFERENCES[city.name].length>0));
  for(const {name} of CITIES){
    assert.ok(cityCostReferences[name].rent>0,name);
    assert.ok(cityCostReferences[name].living>0,name);
    assert.match(cityCostReferences[name].rentSource,/^https:\/\//);
    assert.match(cityCostReferences[name].livingSource,/^https:\/\//);
  }
  assert.equal(cityCostReferences.宁波.rent,2400);
  assert.equal(cityCostReferences.南京.rent,3100);
  assert.equal(cityCostReferences.日喀则.rentSource,'https://livingcost.org/cost/china/shigatse');
});

test('新城市预设不覆盖旧备份中的生活成本',async()=>{
  const saved={id:'old-offer',city:'南京市',rent:'1700',living:'0'};
  const text=JSON.stringify({version:2,offers:[saved]});
  const [restored]=await readOfferImport({size:text.length,text:async()=>text});
  const costs=cityCostDefaults({});
  assert.deepEqual(applyCityCosts(restored,costs),saved);
  assert.equal(applyCityCosts({...restored,rent:''},costs).rent,'3100');
});

test('城市自定义租金覆盖内置预算',async()=>{
  const {cityCostDefaults}=await import('./storage.mjs');
  globalThis.localStorage={getItem:key=>key.endsWith('city-rent')?'{"上海":"6123"}':null};
  try{
    const costs=cityCostDefaults();
    assert.equal(costs.rent.get('上海'),'6123');
    assert.equal(costs.living.get('上海'),'4100');
    assert.equal(costs.rent.get('杭州'),'3700');
  }finally{delete globalThis.localStorage;}
});

test('追加保留旧记录并处理相同 ID，替换只使用备份内容',()=>{
  const current=[{id:'existing',notes:'旧通话'},{id:'existing-import'}];
  const incoming=[{id:'existing',notes:'新通话'},{id:'existing-import-2'}];
  const appended=planOfferImport(current,incoming,'append');
  assert.deepEqual(appended.offers.map(offer=>offer.id),['existing','existing-import','existing-import-3','existing-import-2']);
  assert.equal(appended.active,'existing-import-3');
  assert.equal(incoming[0].id,'existing');
  const replaced=planOfferImport(current,incoming,'replace');
  assert.deepEqual(replaced.offers,incoming);
  assert.equal(replaced.active,'existing');
  assert.throws(()=>planOfferImport(current,incoming,'cancel'));
});

test('导入拒绝过大文件、过多记录和无效记录',async()=>{
  const batch=Array.from({length:101},(_,index)=>({id:String(index)}));
  await assert.rejects(readOfferImport({size:MAX_IMPORT_BYTES+1,text:()=>assert.fail('不应读取过大的文件')}),/4 MiB/);
  await assert.rejects(readOfferImport(new Blob([JSON.stringify({version:2,offers:batch})])),/100/);
  await assert.rejects(readOfferImport(new Blob([JSON.stringify({version:2,offers:[{id:'bad',notes:[]}]})])),/字段格式无效/);
  const existing=batch.slice(0,100);
  assert.throws(()=>planOfferImport(existing,batch.slice(100),'append'),/100/);
  assert.equal(existing.length,100);
  assert.deepEqual(await readOfferImport(new Blob([JSON.stringify({version:2,offers:existing})])),existing);
});

test('新浏览器从空白 Offer 开始，已有本地记录照常读取',async()=>{
  const {loadOffers}=await import('./storage.mjs');
  const {encode}=await import('./model.mjs');
  const saved=[{id:'saved',company:'自填测试公司',notes:'测试记录',base:'1w'}];
  globalThis.localStorage={getItem:()=>null};
  try{
    const starter=loadOffers();
    assert.equal(starter.length,1);
    assert.equal(starter[0].company,undefined);
    assert.equal(starter[0].notes,undefined);
    assert.equal(starter[0].base,'0');
    globalThis.localStorage.getItem=()=>encode(saved);
    assert.deepEqual(loadOffers(),saved);
    globalThis.localStorage.getItem=()=>JSON.stringify({version:1,offers:saved});
    assert.deepEqual(loadOffers(),starter);
  }finally{delete globalThis.localStorage;}
});
