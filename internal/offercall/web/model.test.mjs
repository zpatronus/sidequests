import test from 'node:test';
import assert from 'node:assert/strict';
import {amount,calculate,decode,defaults,encode} from './model.mjs';
import {annualTax,bonusTax} from './policy.mjs';

const offer = overrides => ({...defaults,id:'test',city:'杭州',...overrides});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);

test('金额格式、未知与明确为零',()=>{
  for(const [input,value] of [['5万',50000],['5.5w',55000],['55000',55000],['120万',1200000],['０',0],['',null],['Infinity',null]]) assert.equal(amount(input),value);
  const unknown=calculate(offer({base:'50000'}));
  const zero=calculate(offer({base:'50000',guaranteed:'0',variable:'0'}));
  assert.equal(unknown.fixed,600000);
  assert.equal(unknown.guaranteed,null);
  assert.equal(unknown.target,null);
  assert.equal(zero.target,600000);
});
test('只有 HR 年包时不倒推 Base 或税后',()=>{
  const r=calculate(offer({hr:'125万'}));
  assert.equal(r.fixed,null);assert.equal(r.target,null);assert.equal(r.net,null);
});
test('16 / 18 薪可以确认目标而保底未知',()=>{
  for(const months of [16,18]){
    const o=offer({base:'5万',months:'',targetMonths:String(months)});
    const r=calculate(o);
    assert.equal(r.guaranteed,null);assert.equal(r.target,months*50000);assert.match(r.warnings[0],new RegExp(months+' 薪'));
    assert.equal(calculate(o,'zero').net,null);
  }
});
test('情景只放缩浮动奖金',()=>{
  const o=offer({base:'5.5万',guaranteed:'3',variable:'3'});
  assert.equal(calculate(o).guaranteed,825000);
  assert.equal(calculate(o).target,990000);
  assert.equal(calculate(o,'high').cash,1072500);
  assert.equal(calculate(o,'zero').cash,825000);
});
test('综合所得每档临界点连续且采用正确边际税率',()=>{
  const edges=[[36000,1080,.1],[144000,11880,.2],[300000,43080,.25],[420000,73080,.3],[660000,145080,.35],[960000,250080,.45]];
  for(const [edge,tax,next] of edges){close(annualTax(edge),tax);close(annualTax(edge+1),tax+next);}
  assert.equal(annualTax(-1),0);
});
test('年终奖跳档、自动优化、限一次、适用年份与金额资格',()=>{
  close(bonusTax(36000),1080);close(bonusTax(36001),3390.1);
  const o=offer({base:'5万',guaranteed:'0',variable:'10万元',eligible:'10万',qualification:'符合且本年度未使用'});
  const r=calculate(o);
  assert.ok(r.split<r.merged);
  assert.equal(r.tax,r.split);
  for(const patch of [{year:'2028'},{qualification:'待确认'},{qualification:'不符合或已使用'},{eligible:'110000'}]) assert.equal(calculate({...o,...patch}).split,null);
  assert.equal(calculate(o,'zero').split,null);
  assert.equal(calculate({...o,tax:'并入综合所得'}).tax,r.merged);
});
test('三城上下限及手填覆盖',()=>{
  for(const [city,s,f] of [['北京',36348,36348],['上海',37731,37731],['杭州',25611,42151]]){
    const o=offer({city,base:'12万'});
    const r=calculate(o);assert.equal(r.socialBase,s);assert.equal(r.fundBase,f);
    const override=calculate({...o,socialBase:'12000',fundBase:'8000'});assert.equal(override.socialBase,12000);assert.equal(override.fundBase,8000);
  }
});
test('上海补充公积金以及个人和单位独立缴存',()=>{
  const r=calculate(offer({city:'上海',fundBase:'10000',fundRate:'5',supplement:'2',employerFund:'7',employerSupplement:'3'}));
  close(r.fund,8400);close(r.companyFund,12000);close(r.totalFund,20400);
  assert.equal(calculate(offer({city:'上海',fundRate:'0',supplement:'0'})).fund,0);
});
test('签字费只计一次，股权及公司社保不计入现金',()=>{
  const o=offer({base:'5万',guaranteed:'0',variable:'0',sign:'2万',equity:'5万',rent:'0',living:'0'});
  const r=calculate(o);
  assert.equal(r.targetPackage,670000);assert.equal(r.cash,620000);assert.equal(r.remaining,r.net);
  close(r.net,r.cash-r.social-r.fund-r.tax);
  assert.equal(calculate(o,'guarantee').cash,600000);
});
test('信息不完整时部分计算，未知生活费不会生成现金结余',()=>{
  const r=calculate(offer({fundBase:'10000',fundRate:'6',rent:'4000'}));
  close(r.companyFund,7200);assert.equal(r.rent,48000);assert.equal(r.remaining,null);
  for(const city of ['','constructor','__proto__']){
    for(const value of Object.values(calculate(offer({city,base:'9e999'})))) if(typeof value==='number') assert.ok(Number.isFinite(value));
  }
});
test('JSON 保留原始金额、零和空白，拒绝坏数据和重复标记',()=>{
  const data=[offer({base:'5.5w',guaranteed:'0',variable:'',notes:'审批待定'})];
  assert.deepEqual(decode(encode(data)),data);
  assert.throws(()=>decode('[]'));assert.throws(()=>decode(encode([data[0],data[0]])));
  assert.throws(()=>decode(encode([{id:'x',tax:'other'}])));
});

test('基数乘系数模式分开计算保底、绩效以及超出保底的部分',()=>{
  const o=offer({base:'40000',bonusMode:'factor',bonusBase:'20万',guaranteeFactor:'1.5',companyFactor:'1.2',departmentFactor:'1',personalFactor:'2',attendanceFactor:'1',sign:'7.5万'});
  const r=calculate(o);
  close(r.guaranteedBonus,300000);
  close(r.guaranteed,780000);
  close(r.factorTarget,480000);
  close(r.variable,180000);
  close(r.targetPackage,1035000);
  close(calculate(o,'zero').cash,855000);
  close(calculate(o,'high').cash,1125000);
  assert.equal(calculate({...o,personalFactor:''}).target,null);
  assert.equal(calculate({...o,personalFactor:'0'}).variable,0);
  assert.equal(decode(encode([o]))[0].bonusMode,'factor');
});

test('当前备份保留空值和明确为零的缴费参数',()=>{
  const [restored]=decode(encode([offer({city:'北京',base:'50000',fundBase:null,employerFund:'0',socialBase:'0'})]));
  assert.equal(restored.fundBase,null);
  const result=calculate(restored);
  assert.equal(result.fundBase,36348);
  assert.equal(result.companyFund,0);
  assert.equal(result.social,0);
});

test('首年保证情景可选签字费，第二年用独立保底并排除签字费',()=>{
  const o=offer({base:'40000',firstYearSpecial:'yes',bonusMode:'factor',bonusBase:'20万',guaranteeFactor:'1.5',companyFactor:'1',departmentFactor:'1',personalFactor:'1',attendanceFactor:'1',sign:'7.5万'});
  assert.equal(calculate(o,'guarantee',{includeSign:false}).cash,780000);
  assert.equal(calculate(o,'guarantee',{includeSign:true}).cash,855000);
  assert.equal(calculate(o,'guarantee',{employmentYear:2,includeSign:true}).cash,480000);
  assert.equal(calculate(o,'target',{employmentYear:2,includeSign:true}).cash,680000);
  assert.equal(calculate({...o,secondGuarantee:'20万'},'guarantee',{employmentYear:2}).cash,680000);
});

test('深圳按养老、医保、失业和公积金各自的基数上限估算',()=>{
  const o=offer({city:'深圳市',base:'6万',fundRate:'5',guaranteed:'0',variable:'0'});
  const r=calculate(o);
  assert.deepEqual([r.socialBase,r.medicalBase,r.unemploymentBase,r.fundBase],[27603,33633,48471,48471]);
  close(r.social,12*(27603*.08+33633*.02+48471*.002));
  close(r.companyFund,48471*.05*12);
  assert.ok(r.net>0);
  close(calculate({...o,socialBase:'10000',socialRate:'10'}).social,12000);
});

test('两年详细对比支持无奖金及半倍浮动，签字费与生活成本独立',()=>{
  const o=offer({base:'42000',firstYearSpecial:'yes',guaranteed:'1万',variable:'2万',sign:'10万',rent:'6000',living:'2000',secondGuarantee:'5000'});
  assert.equal(calculate(o,'fixed',{includeSign:false}).cash,504000);
  assert.equal(calculate(o,'fixed',{includeSign:true}).cash,604000);
  assert.equal(calculate(o,'half',{includeSign:false}).cash,524000);
  const second=calculate(o,'half',{employmentYear:2,includeSign:true});
  assert.equal(second.cash,519000);
  assert.equal(second.remaining,second.net-96000);
  assert.equal(calculate({...o,living:''},'half').remaining,null);
  assert.equal(calculate({...o,variable:''},'half').cash,null);
});

test('杭州最新下限与上海普补公积金按月分别取整',()=>{
  const hz=calculate(offer({base:'1000'}));
  assert.equal(hz.socialBase,5122);
  assert.equal(hz.fundBase,2660);
  const sh=calculate(offer({city:'上海',base:'6万',fundRate:'7',supplement:'5'}));
  assert.equal(sh.fund,(2641+1887)*12);
});

test('超限公积金仍计入缴存，但个人超限不扣税、单位超限计税',()=>{
  const r=calculate(offer({city:'北京',base:'5万',guaranteed:'0',variable:'0',fundBase:'5万',fundRate:'12'}));
  assert.equal(r.fund,72000);
  assert.equal(r.deductibleFund,52344);
  assert.equal(r.taxableCompanyFund,19656);
  close(r.comprehensiveTaxable,r.cash+r.taxableCompanyFund-r.basicDeduction-r.social-r.deductibleFund);
  close(r.net,r.cash-r.tax-r.social-r.fund);
});

test('首年特殊开关共享或拆分保底，绩效倍率独立于保底',()=>{
  const o=offer({base:'4万',bonusMode:'factor',bonusBase:'20万',guaranteeFactor:'1.5',secondGuaranteeFactor:'.5',
    companyFactor:'1',departmentFactor:'1',personalFactor:'2',attendanceFactor:'1',performanceMultiplier:'2',sign:'10万'});
  const shared={...o,firstYearSpecial:'no'};
  assert.equal(calculate(shared).cash,1080000);
  assert.equal(calculate(shared,'target',{includeSign:false}).cash,980000);
  assert.equal(calculate(shared,'target',{employmentYear:2}).guaranteedBonus,300000);
  const split={...o,firstYearSpecial:'yes'};
  assert.equal(calculate(split).cash,1080000);
  const second=calculate(split,'target',{employmentYear:2});
  assert.equal(second.guaranteedBonus,100000);
  assert.equal(second.variable,600000);
  assert.equal(second.cash,1180000);
  assert.equal(calculate({...split,performanceMultiplier:'0'}).guaranteedBonus,300000);
  assert.equal(decode(encode([shared]))[0].firstYearSpecial,'no');
  assert.equal(calculate({...split,bonusMode:'direct',secondGuarantee:'3',secondGu:'月'},'guarantee',{employmentYear:2}).guaranteedBonus,120000);
});

test('签字费独立于首年特殊设置，始终只影响首年',()=>{
  const o=offer({base:'4万',guaranteed:'0',variable:'0',sign:'10万'});
  assert.equal(calculate(o).cash,580000);
  assert.equal(calculate(o,'target',{employmentYear:2}).cash,480000);
  assert.equal(calculate({...o,firstYearSpecial:'no'}).cash,580000);
});

test('厦门支持税后自动测算，部分政策城市不会把缺失的费率当零',()=>{
  const xiamen=calculate(offer({city:'厦门',base:'5万',guaranteed:'0',variable:'0'}));
  assert.equal(xiamen.socialBase,22893);
  assert.equal(xiamen.fundBase,32937);
  assert.ok(xiamen.net>0);
  const zhengzhou={...defaults,city:'郑州',base:'30000',guaranteed:'0',variable:'0',socialBase:null,socialRate:null};
  const partial=calculate(zhengzhou);
  assert.equal(partial.socialBase,19560);
  assert.equal(partial.fundBase,28849);
  assert.equal(partial.net,null);
  assert.ok(calculate({...zhengzhou,socialRate:'10.5'}).net>0);
});

test('年度股权、补贴和额外奖金单列，股权只增加现金与股权合计',()=>{
  const o=offer({base:'4万',guaranteed:'0',variable:'0',subsidy:'1万',extra:'2万',equity:'8万'});
  const r=calculate(o);
  assert.equal(r.subsidy,10000);
  assert.equal(r.extra,20000);
  assert.equal(r.cash,510000);
  assert.equal(r.cashWithEquity,590000);
  assert.equal(r.targetPackage,590000);
  assert.equal(r.net,calculate({...o,equity:'0'}).net);
  assert.equal(calculate({...o,equity:''}).cashWithEquity,null);
  assert.equal(calculate(o,'fixed').cashWithEquity,560000);
});

test('仅接受当前版本的备份',()=>{
  const offers=[{id:'sample',notes:'第一行\n\n第二行'}];
  for(const version of [1,3,undefined]){
    assert.throws(()=>decode(JSON.stringify({version,offers})),/仅支持 v2/);
  }
  assert.deepEqual(decode('\uFEFF'+encode(offers)),offers);
  assert.equal(JSON.parse(encode(offers)).version,2);
});

test('公积金默认按 12%，上海拆成普通与补充，手填比例优先',()=>{
  const bj=calculate(offer({city:'北京',base:'5w'}));
  assert.equal(bj.personalRate,12);
  assert.equal(bj.companyFund,52344);
  const sh=calculate(offer({city:'上海',base:'5w'}));
  assert.deepEqual([sh.personalRate,sh.personalExtra,sh.companyRate,sh.companyExtra],[7,5,7,5]);
  const custom=calculate(offer({city:'上海',base:'5w',fundRate:'5'}));
  assert.deepEqual([custom.personalRate,custom.personalExtra],[5,0]);
  assert.equal(calculate(offer({city:'北京',base:'5w',fundRate:'0'})).fund,0);
});

test('工作时薪默认按 975，支持跨午夜、调整天数和缺失输入',()=>{
  const o=offer({base:'5万',guaranteed:'0',variable:'0'});
  const standard=calculate(o);
  assert.equal(standard.workHours,2600);
  close(standard.hourlyCash,600000/2600);
  close(standard.hourlyNet,standard.net/2600);
  const overnight=calculate({...o,workStart:'22:00',workEnd:'06:00',workDays:'4+1'});
  assert.equal(overnight.workHours,2080);
  const exact=calculate({...o,workStart:'9:07',workEnd:'18:42'});
  close(exact.workHours,575/60*5*52);
  assert.equal(calculate({...o,workStart:'09:67'}).workHours,null);
  assert.equal(calculate({...o,workStart:''}).hourlyCash,null);
  assert.equal(calculate({...o,workDays:'8'}).hourlyNet,null);
});
