import {startCloud} from './cloud.mjs';
import {confirmReset} from './dialogs.mjs';
import {cityCostReferences} from './data/city-costs.mjs';
import {invalidNumber} from './numbers.mjs';
import {CITIES,CITY_REFERENCES,POLICIES} from './data/city-policies.mjs';
import {calculate,numeric,policyFor} from './model.mjs';
import {cityCostFields,cityCostOverrides,cityCostSettings,cityName,loadOffers,readSetting,writeOffers,writeSetting} from './storage.mjs';

const $=id=>document.getElementById(id);
const offers=loadOffers();
const cityCosts=Object.fromEntries(cityCostFields.map(field=>[field,cityCostOverrides(field)]));
const fieldGroups=[
  ['缴纳地点',['payCity']],
  ['公积金',['fundBase','fundRate','employerFund','supplement','employerSupplement']],
  ['社保',['socialBase','socialRate','employerSocial','socialFixed']],
];
const selected=()=>offers[Number($('offer').value)];
const status=message=>{$('settings-status').textContent=message;};
document.documentElement.dataset.theme=readSetting('theme')||'light';
for(const {name,province} of CITIES){
  $('city').add(new Option(province===name?name:province+' · '+name,name));
  const option=document.createElement('option');
  option.value=name;
  $('city-options').append(option);
}
offers.forEach((offer,index)=>$('offer').add(new Option(offer.company||'未命名 Offer',index)));
$('offer').value=String(Math.max(0,offers.findIndex(offer=>offer.id===readSetting('active'))));

function showPolicy(){
  const name=$('city').value;
  const policy=Object.hasOwn(POLICIES,name)?POLICIES[name]:undefined;
  const items=Object.hasOwn(CITY_REFERENCES,name)?CITY_REFERENCES[name]:[];
  const target=$('policy');
  const summary=document.createElement('p');
  summary.className='settings-context';
  summary.textContent=policy?.employee?'支持自动测算':items.length?'已收录部分参数，缺项可按 Offer 覆盖。':'政策参数待补充。';
  target.replaceChildren(summary);
  const list=document.createElement('ul');
  for(const {label,range,source} of items){
    const item=document.createElement('li');
    const link=document.createElement('a');
    link.textContent=label;
    link.href=source;
    link.target='_blank';
    link.rel='noopener';
    item.append(link);
    if(range)item.append(' '+range[0].toLocaleString('zh-CN')+'–'+range[1].toLocaleString('zh-CN')+' 元/月');
    list.append(item);
  }
  if(policy?.range){
    const item=document.createElement('li');
    item.textContent='公积金比例 '+policy.range;
    list.append(item);
  }
  if(policy?.employee){
    const item=document.createElement('li');
    item.textContent='个人养老 / 医疗 / 失业 '+policy.employee.map(rate=>rate+'%').join(' / ');
    list.append(item);
  }
  target.append(list);
  const reference=Object.hasOwn(cityCostReferences,name)?cityCostReferences[name]:null;
  const costs=$('cost-reference');
  costs.replaceChildren();
  if(reference){
    const rentLabel=reference.modeled?'市中心约 40 ㎡一居室整租估算':'一居室整租：市中心';
    const outside=reference.outside===undefined?'':'，市中心外 '+reference.outside+' 元/月';
    const evidence=[
      [rentLabel+' '+reference.rent+' 元/月'+outside,reference.rentSource],
      ['单人生活费估算：'+reference.living+' 元/月，不含房租',reference.livingSource],
    ];
    if(reference.trend)evidence.push([reference.trend,reference.trendSource]);
    if(reference.modeled)evidence.push(['查看 Livingcost 的数据与估算方法','https://livingcost.org/about']);
    const budget=document.createElement('ul');
    for(const [label,source] of evidence){
      const item=document.createElement('li');
      const link=document.createElement('a');
      link.href=source;
      link.textContent=label;
      link.target='_blank';
      link.rel='noopener';
      item.append(link);
      budget.append(item);
    }
    costs.append(budget);
  }else{
    const info=document.createElement('p');
    info.textContent='暂无内置预算，可填写自己的默认值。';
    costs.append(info);
  }
  for(const field of cityCostFields){
    const input=$(field+'-default');
    input.value=cityCosts[field].get(name)??'';
    input.placeholder=reference?'内置参考 '+reference[field]+' 元/月':'留空表示没有默认值';
    input.setAttribute('aria-invalid',String(invalidNumber(field,input.value)));
  }
}
function fallback(offer,key){
  const cleared={...offer,[key]:''};
  const policy=policyFor(cleared);
  const result=calculate(cleared);
  const sumRates=values=>values?.reduce((total,value)=>total+value,0);
  return {
    payCity:offer.city,
    fundRate:result.personalRate,
    fundBase:result.fundBase,
    socialBase:result.socialBase,
    supplement:policy?.supplementalFund?result.personalExtra:undefined,
    employerFund:result.companyRate,
    employerSupplement:policy?.supplementalFund?result.companyExtra:undefined,
    socialRate:policy?.medical?'按各险种基数和费率':sumRates(policy?.employee),
    employerSocial:policy?.medical?'按各险种基数和费率':sumRates(policy?.employer),
    socialFixed:policy?.fixed,
  }[key];
}
function writeField(key,value){
  const offer=selected();
  try {
    const latest=loadOffers();
    const index=latest.findIndex(item=>item.id===offer.id);
    if(index<0){status('该 Offer 已删除。请返回 Offer 页面。');return false;}
    latest[index]={...latest[index],[key]:key!=='payCity'&&!value.trim()?null:value};
    writeOffers(latest);
    Object.assign(offer,latest[index]);
    status('已保存到本机');
    return true;
  }catch{status('保存失败');return false;}
}
function showOfferPayCity(offer){
  const city=cityName(offer.payCity)||cityName(offer.city);
  $('offer-pay-city').textContent=city?'当前测算使用 '+city+' 的缴费口径。覆盖值留空时采用可用的城市默认值。':'填写工作城市或缴纳城市后，可以采用当地政策。';
}
function renderOverride(offer,key) {
  const label=document.createElement('label');
  label.className='field';
  const title=key==='payCity'?'缴纳城市':numeric[key];
  label.append(title);
  const input=document.createElement('input');
  input.value=offer[key]??'';
  input.dataset.key=key;
  if(key==='payCity')input.setAttribute('list','city-options');
  else {
    input.inputMode='text';
    const validate=()=>input.setAttribute('aria-invalid',String(invalidNumber(key,input.value)));
    input.addEventListener('input',validate);
    validate();
  }
  const defaultValue=fallback(offer,key);
  input.placeholder=defaultValue==null?'暂无默认值':'默认 '+defaultValue;
  label.append(input);
  const reset=document.createElement('button');
  reset.type='button';
  reset.className='reset-field';
  reset.textContent='重置';
  const updateReset=()=>{reset.hidden=!input.value||fallback(selected(),key)==null;};
  updateReset();
  reset.onclick=async()=>{
    const next=fallback(selected(),key);
    if(await confirmReset(title,input.value,next) && writeField(key,'')){
      renderFields();
      $('overrides').querySelector('[data-key="'+key+'"]')?.focus();
    }
  };
  input.onchange=()=>{
    if(key!=='payCity'&&invalidNumber(key,input.value)){
      status('请输入有效的'+title);
      return;
    }
    if(writeField(key,input.value)){
      updateReset();
      if(key==='payCity')showOfferPayCity(offer);
      for(const field of $('overrides').querySelectorAll('input')){
        const value=fallback(selected(),field.dataset.key);
        field.placeholder=value==null?'暂无默认值':'默认 '+value;
        field.closest('.field').nextElementSibling.hidden=!field.value||value==null;
      }
    }
  };
  const row=document.createElement('div');
  row.className='override-field';
  row.append(label,reset);
  return row;
}
function renderFields(){
  const offer=selected();
  showOfferPayCity(offer);
  const sections=fieldGroups.map(([title,keys])=>{
    const fieldset=document.createElement('fieldset');
    const legend=document.createElement('legend');
    legend.textContent=title;
    const grid=document.createElement('div');
    grid.className='grid-fields';
    grid.append(...keys.map(key=>renderOverride(offer,key)));
    fieldset.append(legend,grid);
    return fieldset;
  });
  $('overrides').replaceChildren(...sections);
}
$('overrides').onsubmit=e=>e.preventDefault();
$('offer').onchange=renderFields;
$('city').onchange=showPolicy;
for(const field of cityCostFields){
  const input=$(field+'-default');
  input.oninput=()=>input.setAttribute('aria-invalid',String(invalidNumber(field,input.value)));
  input.onchange=()=>{
    const value=input.value.trim(), name=$('city').value;
    if(invalidNumber(field,value)){status('请输入有效的'+numeric[field]);return;}
    const next=new Map(cityCosts[field]);
    if(value)next.set(name,value);else next.delete(name);
    try{
      writeSetting(cityCostSettings[field],JSON.stringify(Object.fromEntries(next)));
      cityCosts[field]=next;
      status('已保存到本机');
    }catch{status('保存失败');}
  };
}
showPolicy();
renderFields();

startCloud(text=>{document.getElementById('sync-status').textContent=text;});
