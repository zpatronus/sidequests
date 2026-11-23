import {findCities,isUSCity} from './cities.mjs';
import {readShare,startCloud} from './cloud.mjs';
import {chooseImportMode,confirmReset} from './dialogs.mjs';
import {hasMoneyUnit,invalidNumber} from './numbers.mjs';
import {amount,calculate,decode,defaults,encode,minutesOfDay,numeric,policyFor,prefillNumbers,scenarios} from './model.mjs';
import {applyCityCosts,cityCostChanges,cityCostDefaults,cityCostFields,cityName,loadOffers,planOfferImport,readOfferImport,readSetting,writeOffers,writeSetting} from './storage.mjs';
import {YEAR} from './policy.mjs';
import {csvCell,reportMarkdown,reportRows as rows,hourlyFields} from './report.mjs';

const $ = id => document.getElementById(id);
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shareID=new URLSearchParams(location.hash.slice(1)).get('share');
const readOnly=shareID!==null;
let snapshot, sharedOffers;
if(readOnly){
  document.documentElement.dataset.readonly='';
  $('app').hidden=true;
  $('saved').textContent='正在加载只读页面…';
  try {
    snapshot=await readShare(shareID);
    sharedOffers=decode(JSON.stringify(snapshot));
  } catch(error) {
    $('saved').textContent=error.message==='404'?'链接无效或已失效':'无法加载只读页面，请稍后重试';
    throw error;
  }
  document.title='只读共享 · Offer Desk';
  $('saved').hidden=true;
  $('readonly-notice').hidden=false;
  $('entry-title').textContent='Offer 详情';
  $('entry-help').hidden=true;
  $('tabs').setAttribute('aria-label','Offer 切换');
  $('app').hidden=false;
}
let offers=readOnly?sharedOffers:loadOffers();
let cityCosts=cityCostDefaults(readOnly?snapshot.cityCosts??{}:undefined);
const cloud=readOnly?null:startCloud(text=>{$('saved').textContent=text;});
let active=offers.some(o=>o.id===readSetting('active'))?readSetting('active'):offers[0].id;
const scenario='target';
let unit='万元', selectedMetric='';
let usdQuote=null;
let employmentYear=1, includeSign=true;
const yearOptions=()=>({employmentYear,includeSign});
const resultFor=offer=>calculate(applyCityCosts(offer,cityCosts),scenario,yearOptions());
document.documentElement.dataset.theme=readSetting('theme') || 'light';
function save() {
  if(readOnly)return;
  try {writeOffers(offers);writeSetting('active',active);}
  catch {$('saved').textContent='○ 保存失败，请导出备份';}
}
const current=()=>offers.find(o=>o.id===active);
const name=o=>o.company?.trim()||'未命名 Offer';
function roleLine(offer){
  const details=[offer.role,offer.level].map(value=>value?.trim()).filter(Boolean);
  return details.length?'<small class="offer-role">'+esc(details.join(' · '))+'</small>':'';
}
const amountUnit=(mode=unit)=>usdQuote?(mode==='元/小时'?'USD/小时':'USD'):mode;
const scaleAmount=(value,mode)=>usdQuote?value*usdQuote.rate:value/(mode==='万元'?10000:1);
const fmt=(value,mode=unit)=>value==null?'—':scaleAmount(value,mode)
  .toLocaleString('zh-CN',{maximumFractionDigits:!usdQuote&&mode==='元'?0:2})+' '+amountUnit(mode);
const workTimeFields=new Set(['workStart','workEnd']);
const invalidTime=value=>value.trim()!==''&&minutesOfDay(value)===null;
function nativeTime(value){
  const minutes=minutesOfDay(value);
  if(minutes===null)return '';
  return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}
const group=(title,html)=>'<fieldset><legend>'+title+'</legend><div class="grid-fields">'+html+'</div></fieldset>';
function cityCostPlaceholder(offer,key) {
  const value=cityCosts[key].get(cityName(offer.city));
  if(value===undefined)return key==='rent'?'如 4000':'未知';
  return '城市默认 '+value+' 元/月';
}
function fundPlaceholder(offer){
  return policyFor(offer)?.supplementalFund?'留空按普通 7%＋补充 5% 测算':'留空按 12% 测算';
}
function resetField(offer,key) {
  const defaultValue=(key==='fundRate'?(policyFor(offer)?.supplementalFund?'7':'12'):undefined)
    ?? cityCosts[key]?.get(cityName(offer.city))
    ?? ({...defaults,bonusMode:'direct',performanceMultiplier:'1'})[key];
  const value=offer[key]??(key.startsWith('work')?defaults[key]:'')??'';
  return defaultValue!==undefined&&String(value)!==String(defaultValue)&&(value!==''||key==='months'||key.startsWith('work')||cityCostFields.includes(key))
    ? '<button type="button" class="reset-field" data-reset="'+key+'" data-default="'+esc(defaultValue)+'">重置</button>' : '';
}
function field(o,k,{label=numeric[k]??k,options,placeholder='',type='text',suffix,wide=false,help}={}) {
  const value=o[k]??(k.startsWith('work')?defaults[k]:'')??'';
  const reset=resetField(o,k);
  const content=options?'<select name="'+k+'">'+options.map(([v,l])=>'<option value="'+esc(v)+'" '+(value===v?'selected':'')+'>'+esc(l)+'</option>').join('')+'</select>':
    '<input name="'+k+'" type="'+type+'" '+(workTimeFields.has(k)?'list="work-time-options" step="60" autocomplete="off" aria-invalid="'+invalidTime(value)+'" ':'')+(k in numeric?'inputmode="text" aria-invalid="'+invalidNumber(k,value)+'"':'')+' value="'+esc(workTimeFields.has(k)?nativeTime(value):value)+'" placeholder="'+esc(placeholder)+'">';
  const tooltip=help?'<span class="field-help" tabindex="0" aria-label="'+esc(label)+'说明" aria-describedby="help-'+k+'">?<span id="help-'+k+'" role="tooltip">'+esc(help)+'</span></span>':'';
  return '<label class="field '+(wide?'wide':'')+'"><span class="field-title"><span class="field-name">'+esc(label)+'</span>'+tooltip+'</span><span class="control">'+content+(suffix??'')+'</span>'+reset+'</label>';
}
const options=(...items)=>items.map(v=>[v,v]);
const empty=(label,...items)=>[['',label],...options(...items)];
function renderFields() {
  const o=current();
  const f=(k,opts)=>field(o,k,opts);
  const special=o.firstYearSpecial==='yes';
  const factorMode=o.bonusMode==='factor';
  const bonus=(k,u,label=numeric[k])=>{
    const unit=o[u]??(u==='secondGu'?'元':'月');
    return f(k,{label,placeholder:'未知',suffix:'<select name="'+u+'" aria-label="'+label+'单位"><option '+(unit==='月'?'selected':'')+'>月</option><option '+(unit==='元'?'selected':'')+'>元</option></select>'});
  };
  const mode=f('bonusMode',{label:'奖金录入方式',options:[['direct','金额 / 月数'],['factor','基数 × 系数']],wide:true});
  const specialControl='<label class="wide check-field"><input type="checkbox" name="firstYearSpecial" '+(special?'checked':'')+'> 首年是否特殊</label>';
  const sharedBonus=factorMode
    ? ['bonusBase','companyFactor','departmentFactor','personalFactor','attendanceFactor']
      .map(k=>f(k,{placeholder:k==='bonusBase'?'如 20万':'未知，1 表示 100%'})).join('')+
      field({...o,performanceMultiplier:o.performanceMultiplier??'1'},'performanceMultiplier',{placeholder:'留空按 1',suffix:'<small class="field-hint">只乘超过保底的部分</small>'})
    : bonus('variable','vu');
  const guarantee=factorMode
    ? f('guaranteeFactor',{label:special?'首年保底系数':'保底系数',placeholder:'如 1.8'})
    : bonus('guaranteed','gu',special?'首年保底奖金':'保底奖金');
  const secondGuarantee=factorMode
    ? f('secondGuaranteeFactor',{placeholder:amount(o.secondGuarantee)>0?'留空沿用已录入金额':'留空按无保底'})+
      (amount(o.secondGuarantee)>0?bonus('secondGuarantee','secondGu','第二年保底金额（旧记录）'):'')
    : bonus('secondGuarantee','secondGu');
  const hr=f('hr',{label:special?'首年 HR 报出年包':'HR 报出年包',placeholder:'选填'});
  const yearFields=special
    ? group('首年',guarantee+hr)+group('第二年',secondGuarantee)
    : '';
  $('fields').innerHTML=group('基本信息',f('company',{label:'公司名称'})+'<div class="city-field">'+f('city',{label:'工作城市',placeholder:'点击选择或输入城市'})+'<button type="button" id="city-defaults" aria-haspopup="dialog" hidden>查看城市默认值</button></div>'+f('status',{label:'Offer 状态',options:empty('未知','预估','口头','书面')}))+
    group('薪资信息',f('base',{placeholder:'如 5.5万'})+f('months',{placeholder:'未知'})+mode+f('sign',{label:'首年签字费',placeholder:'选填'})+specialControl+sharedBonus+(special?'':guarantee+hr))+
    yearFields+
    group('工作时间',f('workStart',{label:'开始时间',type:'time'})+f('workEnd',{label:'结束时间',type:'time'})+f('workDays',{placeholder:'如 5'}))+
    group('公积金',f('fundRate',{placeholder:fundPlaceholder(o)}))+
    group('生活成本',cityCostFields.map(key=>f(key,{placeholder:cityCostPlaceholder(o,key)})).join(''))+
    '<p class="settings"><a href="settings.html">公积金与社保设置</a></p>'+
    '<details class="settings"><summary>个税设置</summary>'+
    group('奖金税务',f('tax',{label:'奖金税务方式',help:[
      '这个选项决定年终奖怎么扣个税，会影响预计到手金额。',
      '自动优化：奖金符合单独计税条件且已填写金额时，比较两种算法，取税额较低的结果。',
      '单独计税：将符合条件的那笔全年一次性奖金单独算税，其余收入照常算税。',
      '并入综合所得：奖金和工资合在一起，按全年收入计算个税。',
      '资格或金额不确定时，可以先选「自动优化」，系统会先把奖金和工资合并测算。',
    ].join('\n\n'),options:empty('默认自动优化','自动优化','单独计税','并入综合所得')})+f('year')+f('qualification',{label:'单独计税资格',options:empty('请选择','待确认','符合且本年度未使用','不符合或已使用')})+f('eligible')+f('deduction'))+'</details>'+
    '<details class="settings"><summary>更多设置</summary>'+
    group('报价与薪资',f('targetMonths',{placeholder:'如 18，保底未知可留空'})+f('equity')+f('subsidy')+f('extra'))+
    group('岗位与进度',f('role',{label:'岗位'})+f('level',{label:'职级'})+f('start',{label:'入职日期',type:'date'})+f('probation')+f('probationRate')+f('approval',{label:'审批状态',options:empty('待确认','需要审批','无需审批','审批通过')}))+
    '</details>';
  refreshCityDefaults();
  $('notes').value=o.notes||'';
  $('notes').readOnly=readOnly;
  if(readOnly)for(const input of $('fields').elements){
    if(input.tagName==='INPUT')input.readOnly=true;
    if(input.tagName==='SELECT'||input.type==='checkbox')input.disabled=true;
  }
}
function renderTabs() {
  $('tabs').innerHTML=offers.map((o,i)=>'<button draggable="'+!readOnly+'" data-index="'+i+'" aria-pressed="'+(active===o.id)+'"><span class="offer-tab-title"><span>'+esc(name(o))+'</span>'+roleLine(o)+'</span>'+(o.city?'<small>'+esc(o.city)+'</small>':'')+'</button>').join('')+'<button id="add">＋ 添加 Offer</button>';
}
const componentNames=['固定 Base','保证奖金','目标浮动奖金','签字费','现金补贴','额外奖金'];
function chart(result,mode=unit) {
  const vals=[result.fixed,result.guaranteedBonus,result.variable,result.sign,result.subsidy,result.extra];
  const total=vals.reduce((a,b)=>a+(b??0),0);
  return '<div class="bar" role="img" aria-label="'+esc(componentNames.map((n,i)=>n+' '+fmt(vals[i],mode)).join('，'))+'">'+vals.map((v,i)=>v>0?'<i class="segment s'+i+'" style="width:'+(v/total*100)+'%"></i>':'').join('')+'</div><div class="legend">'+componentNames.map((n,i)=>'<span><i class="segment s'+i+'"></i>'+n+' <b>'+fmt(vals[i],mode)+'</b></span>').join('')+'</div>';
}
function comparisonNumber(value,mode){
  if(value===null)return '—';
  const scaled=scaleAmount(value,mode);
  return (Math.abs(scaled)<.05?0:scaled)
    .toLocaleString('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:1});
}
function comparisonCells(values, mode, cost) {
  const known=values.filter(Number.isFinite);
  const low=Math.min(...known), high=Math.max(...known);
  return values.map(value=>{
    const style=Number.isFinite(value)&&high>low
      ? ' class="heat-cell'+(cost?' heat-cost':'')+(value===high?' heat-high':'')+'" style="--heat:'+((value-low)/(high-low)*100)+'%"'
      : '';
    return '<td'+style+' data-chart-value="'+(Number.isFinite(value)?value:'')+'">'+comparisonNumber(value,mode)+'</td>';
  }).join('');
}
function comparisonMetric(key,label,results,span=1,context='') {
  const mode=hourlyFields.has(key)?'元/小时':unit;
  const heading='<th class="comparison-label" scope="row" colspan="'+span+'" data-chart-unit="'+amountUnit(mode)+
    '" data-chart-context="'+esc(context)+'" data-chart-cost="'+(key==='rent'||key==='costs')+'">'+esc(label)+'</th>';
  return heading+comparisonCells(results.map(r=>r[key]),mode,key==='rent'||key==='costs');
}
const comparisonScenarios=[
  ['fixed','不含奖金'],
  ['guarantee','只含保底奖金'],
  ['half','浮动奖金 0.5×'],
  ['target','浮动奖金 1×'],
  ['high','浮动奖金 1.5×'],
];
const comparisonAmounts=[
  ['cash','税前现金'],['net','税后到手'],['remaining','税后扣生活成本'],
];
function comparisonTable() {
  const columnCount=offers.length+2;
  const headers='<thead><tr><th scope="col">情景<small class="comparison-unit">单位 '+amountUnit()+'</small></th><th scope="col">指标</th>'+
    offers.map(o=>'<th scope="col">'+esc(name(o))+roleLine(o)+'<small>'+esc([o.city,o.status].filter(Boolean).join(' · '))+'</small></th>').join('')+'</tr></thead>';
  const sectionTitle=title=>'<tr class="sign-row"><th colspan="'+columnCount+'" scope="rowgroup">'+title+'</th></tr>';
  const overviewResults=offers.map(resultFor);
  const overviewTitle='总览 · '+(employmentYear===1?'首年':'第二年')+' · 目标奖金';
  const overview='<tbody>'+sectionTitle(overviewTitle)+
    rows.map(([key,label])=>'<tr>'+comparisonMetric(key,label,overviewResults,2,overviewTitle)+'</tr>').join('')+'</tbody>';
  const groups=[[1,false,'首年 · 不含签字费'],[1,true,'首年 · 含签字费'],[2,false,'第二年 · 不含签字费']].map(([year,includeSign,title])=>{
    const detailRows=comparisonScenarios.flatMap(([scenario,label])=>{
      const results=offers.map(o=>calculate(applyCityCosts(o,cityCosts),scenario,{employmentYear:year,includeSign}));
      return comparisonAmounts.map(([key,metric],i)=>
        '<tr class="'+(i===0?'scenario-start':'')+'">'+
        (i===0?'<th class="comparison-label" rowspan="'+comparisonAmounts.length+'" aria-label="'+esc(label)+'">'+esc(label)+'</th>':'')+
        comparisonMetric(key,metric,results,1,title+' · '+label)+'</tr>');
    });
    return '<tbody>'+sectionTitle(title)+detailRows.join('')+'</tbody>';
  });
  const columns='<colgroup><col class="scenario-column"><col class="metric-column"><col span="'+offers.length+'"></colgroup>';
  return '<table aria-label="Offer 对比">'+columns+headers+overview+groups.join('')+'</table>';
}
const rowChart=$('comparison-chart');
let chartRow=null;
function hideComparisonChart(){
  rowChart.hidden=true;
  chartRow=null;
}
function renderComparisonChart(heading,cells){
  const values=cells.map(cell=>cell.dataset.chartValue===''?null:Number(cell.dataset.chartValue));
  const known=values.filter(Number.isFinite);
  const min=Math.min(0,...known), max=Math.max(0,...known);
  const range=max-min||1;
  const zero=-min/range*100;
  const mode=heading.dataset.chartUnit;
  const costs=heading.dataset.chartCost==='true';
  const series=values.map((value,index)=>{
    const offset=((Math.min(0,value??0)-min)/range)*100;
    const width=Math.abs(value??0)/range*100;
    const tone=costs?'cost':value<0?'negative':'positive';
    return '<li><div class="row-chart-label"><span>'+esc(name(offers[index]))+'</span><b>'+
      comparisonNumber(value,mode)+(value===null?'':' '+mode)+'</b></div><div class="row-chart-track" style="--zero:'+zero+'%">'+
      (value===null?'':'<span class="row-chart-bar '+tone+'" style="left:'+offset+'%;width:'+width+'%"></span>')+
      '</div></li>';
  });
  rowChart.innerHTML='<h3>'+esc(heading.textContent)+'</h3><p>'+esc(heading.dataset.chartContext)+'</p><ul>'+series.join('')+'</ul>';
}
$('table').addEventListener('pointermove',event=>{
  if(event.pointerType!=='mouse')return;
  const row=event.target.closest('tr');
  const heading=row?.querySelector('[data-chart-unit]');
  if(!heading){hideComparisonChart();return;}
  if(chartRow!==row){
    chartRow=row;
    renderComparisonChart(heading,[...row.querySelectorAll('[data-chart-value]')]);
    rowChart.hidden=false;
  }
  const margin=10, offset=16;
  const {width,height}=rowChart.getBoundingClientRect();
  const left=event.clientX+offset+width<=innerWidth-margin?event.clientX+offset:event.clientX-offset-width;
  const top=event.clientY+offset+height<=innerHeight-margin?event.clientY+offset:event.clientY-offset-height;
  rowChart.style.left=Math.max(margin,Math.min(left,innerWidth-width-margin))+'px';
  rowChart.style.top=Math.max(margin,Math.min(top,innerHeight-height-margin))+'px';
});
$('table').addEventListener('pointerleave',hideComparisonChart);
window.addEventListener('scroll',hideComparisonChart,{passive:true});
window.addEventListener('resize',hideComparisonChart);

function renderResults() {
  const o=current(), r=resultFor(o);
  const p=policyFor(o);
  const usOffer=isUSCity(o.city)||isUSCity(o.payCity);
  $('status').textContent=o.status||'未知';
  $('summary-context').textContent=[name(o),employmentYear===2?'第二年':'首年',scenarios[scenario],usOffer?'美国城市 · 税前与生活成本':p?.provisional?'自动测算 · 部分缴费参数为参考值':p?YEAR+' 年参考参数':'缴费政策待补充'].join(' · ');
  $('unit').textContent=unit+' ⇄';
  $('unit').hidden=usdQuote!==null;
  const peers=offers.filter(x=>x.id!==active).map(x=>[x,resultFor(x).net]);
  const differences=peers.map(([peer,value])=>[peer,r.net===null||value===null?null:r.net-value]);
  const signed=v=>v===null?'—':(v>0?'+':'')+fmt(v);
  const missingPayroll=[
    r.social===null?'社保':'',
    r.fund===null?'公积金':'',
  ].filter(Boolean).join('和');
  const netStatus=usOffer?'美国税后到手待核算':r.cash===null?'待补充税前现金收入':missingPayroll?'待补充'+missingPayroll+'缴费参数':'税前现金 '+fmt(r.cash);
  const metrics=[
    ['guaranteed','保证税前年薪',r.guaranteed,r.fixed===null?'待补充固定工资':r.guaranteed===null?'已知固定年薪 '+fmt(r.fixed):o.status==='书面'||o.status==='口头'?'已确认录入':'按录入估算','固定工资 '+fmt(r.fixed)+' ＋ 保底奖金 '+fmt(r.guaranteedBonus)],
    ['target','目标税前年包',r.targetPackage,r.target===null?'待补充奖金或目标薪数':(employmentYear===2?'按第二年保底与绩效假设':'按首年绩效与签字费选项'),'目标经常性现金 '+fmt(r.target)+' ＋ 签字费 '+fmt(r.sign)+' ＋ 补贴、额外奖金和股权估值。'+(o.bonusMode==='factor'?' 按绩效系数计算的奖金 '+fmt(r.factorTarget)+'，其中超过保底的部分计为浮动。':'')],
    ['equity','年度股权估值',r.equity,r.equity===null?'可在更多设置填写':'按录入的年度估值','年度股权估值按填写金额列示。首年和第二年沿用同一年度估值。股权归属、变现和个税未纳入现金测算。'],
    ['all-in','税前现金＋股权',r.cashWithEquity,r.equity===null?'待填写年度股权估值':'本情景合计','本情景税前现金 '+fmt(r.cash)+' ＋ 年度股权估值 '+fmt(r.equity)+'。没有股权时可填写 0。'],
    ['net','预计税后年收入',r.net,netStatus,'估算 · '+r.taxMethod+'。本情景税前现金 '+fmt(r.cash)+' − 个人社保 '+fmt(r.social)+' − 个人公积金 '+fmt(r.fund)+' − 个税 '+fmt(r.tax)+'。综合计税 '+fmt(r.merged)+'，可用单独计税方案 '+fmt(r.split)+'。计税扣除：基本减除费用 '+fmt(r.basicDeduction)+' ＋ 个人社保 '+fmt(r.social)+' ＋ 可税前扣除的个人公积金 '+fmt(r.deductibleFund)+' ＋ 专项附加扣除 '+(r.deduction===null?'未填写，本次按 0 计':fmt(r.deduction))+'，合计 '+fmt(r.taxableDeductions)+'。并入计税的超限单位公积金 '+fmt(r.taxableCompanyFund)+'，单独计税奖金 '+fmt(r.splitBonus)+'，综合所得应纳税所得额 '+fmt(r.comprehensiveTaxable)+'。'],
    ['monthly','每月税后收入',r.monthly,'年均','预计税后年收入 ÷ 12。'],
    ['hourlyCash','税前现金时薪',r.hourlyCash,r.workHours===null?'待填写有效工作时间':'按 '+r.workHours.toLocaleString('zh-CN',{maximumFractionDigits:1})+' 小时/年','本情景税前现金 ÷ 年工时。年工时＝每天开始到结束的时长 × 每周工作天数 × 52。'],
    ['hourlyNet','税后到手时薪',r.hourlyNet,r.workHours===null?'待填写有效工作时间':'按当前情景税后现金','本情景税后到手现金 ÷ 年工时。工作时段包含午休，全年按 52 周折算。'],
    ['companyFund','公司公积金',r.companyFund,r.companyFund===null?'缴费基数待确认':'每年 · 估算','公积金月基数 '+fmt(r.fundBase,'元')+' × 单位比例 × 12。'+(p?.range?'当地参考比例 '+p.range+'。':'')],
    ['totalFund','公积金总积累',r.totalFund,'含公司与个人','个人 '+fmt(r.fund)+' ＋ 单位 '+fmt(r.companyFund)+'。单列为资产积累。'],
    ['remaining','税后剩余现金',r.remaining,r.costs===null?'待补充生活成本':'扣除生活成本','税后现金 − 年租金 '+fmt(r.rent)+' − 其他年生活费 '+fmt(r.living)+'。'],
  ];
  if(r.partialNet!==null){
    const netMetric=metrics.find(([key])=>key==='net');
    netMetric.splice(1,4,'税后现金参考',r.partialNet,'未扣 '+missingPayroll,
      '按综合所得估算，并扣除已知的个人缴费。补齐'+missingPayroll+'缴费参数后可查看预计到手收入。');
  }
  $('metrics').innerHTML=metrics.map(([k,l,v,status])=>'<button data-metric="'+k+'" aria-expanded="'+(selectedMetric===k)+'" class="metric '+(k==='net'?'accent':'')+'"><span>'+l+'</span><strong class="'+(v===null?'unknown':'')+'">'+fmt(v,hourlyFields.has(k)?'元/小时':unit)+'</strong><small>'+esc(status)+'</small></button>').join('');
  const gapSection=$('income-gaps');
  gapSection.hidden=!differences.length;
  $('gap-cards').innerHTML=differences.map(([peer,value])=>
    '<div class="metric gap-metric"><span>'+esc(name(peer))+'</span>'+roleLine(peer)+'<strong class="'+
    (value===null?'unknown':'')+'">'+signed(value)+'</strong></div>').join('');
  const focus=metrics.find(m=>m[0]===selectedMetric);
  const hr=amount(o.hr);
  const hrGap=employmentYear===1 && hr>0 && r.targetPackage!==null ? r.targetPackage-hr : null;
  const hrGapPercent=hrGap===null?null:hrGap/hr*100;
  const showHrGap=hrGap!==null && Math.abs(hrGap)>hr*(0.01+Number.EPSILON);
  $('metric-explanation').innerHTML=focus?'<div class="formula"><b>'+focus[1]+'</b><p>'+esc(focus[4])+'</p></div>':'';
  $('composition').innerHTML=
    '<div class="chart"><h3>现金薪资构成 <small>目标结构 · 已录入部分</small></h3>'+chart(r)+'</div>'+
    (hr>0?'<div class="quotes"><span>HR 报价 <b>'+fmt(hr)+'</b></span></div>':'')+
    (showHrGap?'<p class="reconcile quote-warning"><b>报价差异超过 1%</b> · 计算年包比 HR 报价'+(hrGap>0?'高':'低')+' '+fmt(Math.abs(hrGap))+'（'+Math.abs(hrGapPercent).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:3})+'%）。请核对报价包含的项目。</p>':'')+
    '<details class="assumptions" '+(document.querySelector('.assumptions')?.open?'open':'')+'><summary>查看计算假设与社保</summary><p>个人社保 '+fmt(r.social)+' · 公司社保 '+fmt(r.companySocial)+' · '+((p?.medical||p?.unemployment)?'养老 / 医保 / 失业月基数 '+[r.socialBase,r.medicalBase,r.unemploymentBase].map(v=>fmt(v,'元')).join(' / '):'社保月基数 '+fmt(r.socialBase,'元'))+'</p>'+'<p><a href="settings.html">查看城市政策与缴费设置</a></p>'+'<ul>'+r.assumptions.map(a=>'<li>'+esc(a)+'</li>').join('')+'</ul></details>';
  hideComparisonChart();
  $('table').innerHTML=comparisonTable();
}
function full() {renderTabs();renderFields();renderResults();}
function refreshCityDefaults() {
  $('city-defaults').hidden=readOnly||cityCostChanges(current(),cityCosts).length===0;
}
const cityPicker=$('city-picker');
const citySearch=$('city-search');
function renderCityChoices() {
  const matches=findCities(citySearch.value);
  $('city-choices').innerHTML=[['United States',true],['中国',false]].map(([label,us])=>{
    const cities=matches.filter(city=>Boolean(city.us)===us);
    if(!cities.length)return '';
    return '<section><h3>'+label+'</h3><div class="city-buttons">'+cities.map(city=>
      '<button type="button" data-city="'+esc(city.name)+'">'+esc(city.name)+'</button>'
    ).join('')+'</div></section>';
  }).join('')||'<p>没有匹配的预设城市</p>';
  $('use-custom-city').disabled=!citySearch.value.trim();
}
function openCityPicker() {
  citySearch.value='';
  renderCityChoices();
  cityPicker.showModal();
}
function chooseCity(name) {
  const input=$('fields').elements.city;
  input.value=name;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  cityPicker.close();
  input.focus();
}
citySearch.addEventListener('input',renderCityChoices);
$('use-custom-city').onclick=()=>chooseCity(cityName(citySearch.value));
$('city-choices').onclick=e=>{
  const choice=e.target.closest('[data-city]');
  if(choice)chooseCity(choice.dataset.city);
};
citySearch.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing)return;
  e.preventDefault();
  const first=$('city-choices').querySelector('[data-city]');
  if(first)chooseCity(first.dataset.city);
  else if(citySearch.value.trim())chooseCity(cityName(citySearch.value));
});
$('fields').addEventListener('click',e=>{
  if(!readOnly&&e.target.name==='city')openCityPicker();
});
$('fields').addEventListener('keydown',e=>{
  if(!readOnly&&e.target.name==='city'&&e.key==='ArrowDown'){
    e.preventDefault();
    openCityPicker();
  }
});

const cityDialog=$('city-defaults-dialog');
function renderCityDefaults() {
  const changes=cityCostChanges(current(),cityCosts);
  const city=cityName(current().city);
  $('city-defaults-title').textContent=city+' · 生活成本默认值';
  $('city-defaults-list').innerHTML=changes.map(({field,current,next})=>
    '<li><div><strong>'+esc(numeric[field])+'</strong><p>从 '+esc(current||'空白')+' → '+esc(next)+' 元/月'+'</p></div>'+
    '<button type="button" data-city-cost="'+field+'" aria-label="替换'+esc(numeric[field])+'">替换</button></li>'
  ).join('');
}
$('fields').addEventListener('click',e=>{
  if(readOnly||e.target.id!=='city-defaults')return;
  renderCityDefaults();
  cityDialog.showModal();
});
cityDialog.addEventListener('click',e=>{
  const field=e.target.closest('[data-city-cost]')?.dataset.cityCost;
  if(readOnly||!field)return;
  const offer=current();
  for(const change of cityCostChanges(offer,cityCosts)){
    if(field==='all'||field===change.field)offer[change.field]=change.next;
  }
  save();
  renderFields();
  renderResults();
  if(cityCostChanges(offer,cityCosts).length){
    renderCityDefaults();
    cityDialog.querySelector('[data-city-cost]').focus();
  }else{
    cityDialog.close();
  }
});
cityDialog.addEventListener('close',()=>{
  const trigger=$('city-defaults');
  (trigger.hidden?$('fields').elements.city:trigger).focus();
});

$('fields').addEventListener('submit',e=>e.preventDefault());
$('fields').addEventListener('input',e=>{
  if(readOnly||!e.target.name)return;
  const offer=current();
  offer[e.target.name]=e.target.name==='firstYearSpecial'?(e.target.checked?'yes':'no'):e.target.name==='fundRate'&&!e.target.value.trim()?null:e.target.value;
  const bonusUnit={guaranteed:'gu',variable:'vu',secondGuarantee:'secondGu'}[e.target.name];
  if(bonusUnit && hasMoneyUnit(e.target.value) && amount(e.target.value)!==null) {
    current()[bonusUnit]='元';
    $('fields').elements[bonusUnit].value='元';
  }
  if(workTimeFields.has(e.target.name))e.target.setAttribute('aria-invalid',String(invalidTime(e.target.value)));
  if(e.target.name in numeric)e.target.setAttribute('aria-invalid',String(invalidNumber(e.target.name,e.target.value)));
  if(['company','city','role','level'].includes(e.target.name))renderTabs();
  const refreshReset=input=>{
    const label=input.closest('.field');
    if(!label)return;
    label.querySelector('.reset-field')?.remove();
    label.insertAdjacentHTML('beforeend',resetField(offer,input.name));
  };
  if(e.target.name==='city'){
    const fundInput=$('fields').elements.fundRate;
    fundInput.placeholder=fundPlaceholder(offer);
    refreshReset(fundInput);
    for(const key of cityCostFields){
      const input=$('fields').elements[key];
      input.placeholder=cityCostPlaceholder(offer,key);
      refreshReset(input);
    }
  }
  refreshReset(e.target);
  if(e.target.name==='city'||cityCostFields.includes(e.target.name))refreshCityDefaults();
  if(['bonusMode','firstYearSpecial'].includes(e.target.name)){
    renderFields();
    $('fields').elements[e.target.name].focus();
  }
  save();renderResults();
});
$('fields').addEventListener('click',async e=>{
  const button=e.target.closest('[data-reset]');
  if(readOnly||!button)return;
  const input=$('fields').elements[button.dataset.reset];
  const label=button.closest('.field').querySelector('.field-name').textContent;
  const next=button.dataset.reset==='fundRate'&&policyFor(current())?.supplementalFund?'普通 7%（补充比例由设置决定）':button.dataset.default;
  if(!await confirmReset(label,input.value,next))return;
  input.value=button.dataset.reset==='fundRate'?'':button.dataset.default;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.focus();
});
$('notes').addEventListener('input',e=>{if(!readOnly){current().notes=e.target.value;save();}});
$('tabs').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.id==='add') {if(readOnly)return;const id=globalThis.crypto.randomUUID?.()??String(Date.now());offers.push(prefillNumbers({...defaults,id}));active=id;}
  else active=offers[Number(b.dataset.index)].id;
  selectedMetric='';save();full();
  if(b.id==='add')$('fields').elements.company.focus();else $('tabs').querySelector('[aria-pressed=true]').focus();
});
let draggedOfferId=null;
function reorderOffer(id,targetId,after) {
  if(readOnly||id===targetId)return;
  const moving=offers.find(offer=>offer.id===id);
  if(!moving || !offers.some(offer=>offer.id===targetId))return;
  const ordered=offers.filter(offer=>offer.id!==id);
  ordered.splice(ordered.findIndex(offer=>offer.id===targetId)+(after?1:0),0,moving);
  if(ordered.every((offer,index)=>offer===offers[index]))return;
  offers=ordered;
  save();renderTabs();renderResults();
  $('tabs').querySelector('[data-index="'+offers.indexOf(moving)+'"]')?.focus();
}
const tabBar=$('tabs');
const dropTab=event=>event.target.closest('button[data-index]');
function clearDropIndicator(){
  tabBar.querySelector('[data-drop]')?.removeAttribute('data-drop');
}
function insertAfter(event,button) {
  const box=button.getBoundingClientRect();
  return event.clientX>=box.left+box.width/2;
}
tabBar.addEventListener('dragstart',event=>{
  if(readOnly){event.preventDefault();return;}
  const button=dropTab(event);
  if(!button)return;
  draggedOfferId=offers[Number(button.dataset.index)].id;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',draggedOfferId);
});
tabBar.addEventListener('dragover',event=>{
  const button=dropTab(event);
  clearDropIndicator();
  if(!button || draggedOfferId===null || offers[Number(button.dataset.index)].id===draggedOfferId)return;
  event.preventDefault();
  event.dataTransfer.dropEffect='move';
  button.dataset.drop=insertAfter(event,button)?'after':'before';
});
tabBar.addEventListener('drop',event=>{
  const button=dropTab(event);
  clearDropIndicator();
  if(!button||draggedOfferId===null)return;
  event.preventDefault();
  reorderOffer(draggedOfferId,offers[Number(button.dataset.index)].id,insertAfter(event,button));
  draggedOfferId=null;
});
tabBar.addEventListener('dragend',()=>{
  draggedOfferId=null;
  clearDropIndicator();
});
tabBar.addEventListener('keydown',event=>{
  if(!event.altKey || !['ArrowLeft','ArrowRight'].includes(event.key))return;
  const button=dropTab(event);
  if(!button)return;
  const index=Number(button.dataset.index), after=event.key==='ArrowRight';
  const neighbor=offers[index+(after?1:-1)];
  if(!neighbor)return;
  event.preventDefault();
  reorderOffer(offers[index].id,neighbor.id,after);
});
const deleteDialog=$('delete-dialog');
const deleteNext=$('delete-next');
let pendingDelete=null;
let deleteStep=0;
function renderDeleteStep() {
  const offer=offers.find(o=>o.id===pendingDelete);
  $('delete-title').textContent='删除 Offer（'+(deleteStep+1)+' / 3）';
  $('delete-description').textContent=[
    '要删除「'+name(offer)+'」吗？',
    '此操作会删除「'+name(offer)+'」的薪酬数据和通话记录。',
    '最后确认：永久删除「'+name(offer)+'」。'+(offers.length===1?'删除后将打开一份空白 Offer。':''),
  ][deleteStep];
  deleteNext.textContent=['继续','确认删除记录','永久删除'][deleteStep];
  deleteDialog.querySelector('[autofocus]').focus();
}
$('delete-offer').onclick=()=>{
  if(readOnly)return;
  pendingDelete=active;
  deleteStep=0;
  deleteDialog.showModal();
  renderDeleteStep();
};
deleteNext.onclick=()=>{
  if(pendingDelete===null)return;
  if(deleteStep<2){
    deleteStep++;
    renderDeleteStep();
    return;
  }
  const index=offers.findIndex(o=>o.id===pendingDelete);
  if(index<0){deleteDialog.close();return;}
  offers.splice(index,1);
  if(!offers.length){
    const id=globalThis.crypto.randomUUID?.()??String(Date.now());
    offers.push({...defaults,id});
  }
  active=offers[Math.min(index,offers.length-1)].id;
  selectedMetric='';
  save();
  deleteDialog.close();
  full();
  $('tabs').querySelector('[aria-pressed=true]').focus();
};
deleteDialog.addEventListener('close',()=>{pendingDelete=null;});
$('metrics').addEventListener('click',e=>{const b=e.target.closest('button');if(b){selectedMetric=selectedMetric===b.dataset.metric?'':b.dataset.metric;renderResults();$('metrics').querySelector('[data-metric="'+b.dataset.metric+'"]').focus();}});
function renderYears(){
  $('employment-years').innerHTML=[[1,'首年'],[2,'第二年']].map(([year,label])=>
    '<button data-year="'+year+'" aria-pressed="'+(employmentYear===year)+'">'+label+'</button>').join('');
}
$('employment-years').onclick=e=>{
  if(!e.target.dataset.year)return;
  employmentYear=Number(e.target.dataset.year);
  renderYears();renderResults();
  $('employment-years').querySelector('[aria-pressed=true]').focus();
};
$('include-sign').onchange=e=>{includeSign=e.target.checked;renderResults();};
$('unit').onclick=()=>{unit=unit==='万元'?'元':'万元';renderResults();};
const currencySelect=$('currency');
const currencyStatus=$('currency-status');
currencySelect.value='CNY';
function setCurrencyStatus(message) {
  currencyStatus.textContent=message;
  currencyStatus.hidden=message==='';
}
currencySelect.onchange=async()=>{
  if(currencySelect.value==='CNY'){
    usdQuote=null;
    setCurrencyStatus('');
    renderResults();
    return;
  }
  currencySelect.disabled=true;
  setCurrencyStatus('正在获取汇率…');
  try {
    const response=await fetch('https://api.frankfurter.dev/v2/rate/cny/usd',{
      signal:AbortSignal.timeout(6000),
      credentials:'omit',
      referrerPolicy:'no-referrer',
    });
    if(!response.ok)throw new Error('Rate unavailable');
    const quote=await response.json();
    if(quote.base!=='CNY'||quote.quote!=='USD'||!Number.isFinite(quote.rate)||quote.rate<=0||
      !/^\d{4}-\d{2}-\d{2}$/.test(quote.date))throw new Error('Invalid exchange rate');
    usdQuote=quote;
    setCurrencyStatus('1 CNY ≈ '+quote.rate.toLocaleString('en-US',{maximumFractionDigits:6})+
      ' USD · '+quote.date+' 参考汇率');
  }catch{
    currencySelect.value='CNY';
    usdQuote=null;
    setCurrencyStatus('暂时无法获取汇率，继续显示人民币。');
  }finally{
    currencySelect.disabled=false;
    renderResults();
  }
};

$('theme').onclick=()=>{const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';try{writeSetting('theme',root.dataset.theme);}catch{}};
function download(filename,body,type) {
  const now=new Date();
  const padded=value=>String(value).padStart(2,'0');
  const day=String(now.getFullYear())+padded(now.getMonth()+1)+padded(now.getDate());
  const time=[now.getHours(),now.getMinutes(),now.getSeconds()].map(padded).join('');
  const datedFilename=filename.replace(/(\.[^.]+)$/,'-'+day+'-'+time+'$1');
  const url=URL.createObjectURL(new Blob([body],{type}));
  const a=document.createElement('a');a.href=url;a.download=datedFilename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('json').onclick=()=>download('offer-desk.json',encode(offers),'application/json');
$('csv').onclick=()=>{
  const results=offers.map(o=>resultFor(o));
  const records=[['指标（元）',...offers.map(name)],['入职年度',...offers.map(()=>employmentYear===2?'第二年':'首年')],['计算情景',...offers.map(()=>scenarios[scenario])],['政策年度',...offers.map(()=>YEAR)],...rows.map(([k,label])=>[label,...results.map(r=>r[k]==null?'':Math.round(r[k]))])];
  download('offer-comparison.csv','\uFEFF'+records.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
};
$('import').onclick=()=>$('file').click();
$('file').onchange=async e=>{
  if(readOnly)return;
  const file=e.target.files[0];if(!file)return;
  try {
    const incoming=await readOfferImport(file);
    const mode=await chooseImportMode(offers.length,incoming.length);
    if(mode!=='append'&&mode!=='replace')return;
    const imported=planOfferImport(offers,incoming,mode);
    writeOffers(imported.offers);
    offers=imported.offers;
    active=imported.active;
    selectedMetric='';
    try {writeSetting('active',active);} catch { /* Offer records were saved above. */ }
    full();
    $('message').textContent=(mode==='replace'?'已替换为备份中的 ':'已追加 ')+incoming.length+' 份 Offer。';
  }catch(error){$('message').textContent=error instanceof SyntaxError?'文件不是有效的 JSON。':error.message;}
  finally{e.target.value='';}
};
$('report-open').onclick=()=>{
  $('export-list').innerHTML=offers.map((o,i)=>'<label><input type="checkbox" value="'+i+'" checked> '+esc(name(o))+'</label>').join('');
  $('export-error').textContent='';
  $('export').showModal();
};
$('markdown').onclick=()=>{
  const chosen=[...$('export-list').querySelectorAll(':checked')].map(x=>offers[Number(x.value)]);
  if(!chosen.length){$('export-error').textContent='请至少选择一份 Offer。';return;}
  download('offer-comparison.md',reportMarkdown(chosen.map(offer=>applyCityCosts(offer,cityCosts)),scenario,new Date(),yearOptions()),'text/markdown;charset=utf-8');
  $('export').close();
};
$('work-time-options').innerHTML=Array.from({length:96},(_,index)=>{
  const hours=String(Math.floor(index/4)).padStart(2,'0');
  const minutes=String((index%4)*15).padStart(2,'0');
  return '<option value="'+hours+':'+minutes+'"></option>';
}).join('');
renderYears();full();
window.addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  if(readOnly){location.reload();return;}
  offers=loadOffers();
  cityCosts=cityCostDefaults();
  if(!offers.some(o=>o.id===active))active=offers[0].id;
  full();
});

window.addEventListener('hashchange',()=>location.reload());
const shareButton=$('share');
const shareLoading=shareButton.querySelector('.share-loading');
shareButton.onclick=async()=>{
  const label=shareButton.getAttribute('aria-label');
  const controls=[
    $('app'),
    document.querySelector('header .home-nav'),
    ...[...shareButton.parentElement.children].filter(control=>control!==shareButton),
  ];
  for(const control of controls)control.inert=true;
  shareButton.disabled=true;
  shareButton.setAttribute('aria-busy','true');
  shareLoading.hidden=false;
  shareButton.setAttribute('aria-label','正在生成链接…');
  $('message').textContent='';
  let link, savedLocally=false;
  try {
    writeOffers(offers);
    savedLocally=true;
    link=await cloud.share(AbortSignal.timeout(10000));
  } catch {
    $('share-error-message').textContent=savedLocally
      ? '所有记录均已保存在此浏览器中。请稍后再试。'
      : '无法确认记录已保存到本机。请导出 JSON 备份。';
  } finally {
    shareButton.setAttribute('aria-label',label);
    shareButton.removeAttribute('aria-busy');
    shareLoading.hidden=true;
    shareButton.disabled=false;
    for(const control of controls)control.inert=false;
    shareButton.focus();
  }
  if(link){
    $('share-url').value=link;
    $('share-status').textContent='';
    $('share-dialog').showModal();
    $('share-url').select();
  }else{
    $('share-error-dialog').showModal();
  }
};
$('copy-share').onclick=async()=>{
  $('share-url').select();
  try {
    await navigator.clipboard.writeText($('share-url').value);
    $('share-status').textContent='链接已复制。';
  } catch {
    $('share-status').textContent='请手动复制所选链接。';
  }
};
