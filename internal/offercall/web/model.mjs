import {amount,hasMoneyUnit} from './numbers.mjs';
export {amount} from './numbers.mjs';
import {POLICIES} from './data/city-policies.mjs';
import {YEAR,annualTax,bonusTax} from './policy.mjs';

const OFFER_VERSION=2;
const contributionFields=[
  'fundRate','fundBase','employerFund','supplement','employerSupplement',
  'socialBase','socialRate','employerSocial','socialFixed',
];

export const numeric = {
  workDays:'每周工作天数', base:'税前月 Base', months:'固定工资月数', guaranteed:'保底奖金', variable:'目标浮动奖金',
  hr:'HR 报出年包', sign:'签字费', fundRate:'公积金比例 %', rent:'月租金', living:'其他月生活费',
  targetMonths:'总目标薪数（含固定与奖金）', expected:'向 HR 报出的期望年包', personal:'个人预估年包',
  hrEstimate:'HR 年包预估', equity:'年度股权估值', subsidy:'年度现金补贴', extra:'额外奖金',
  deduction:'年度专项附加扣除', socialBase:'月社保基数', fundBase:'月公积金基数',
  supplement:'上海补充公积金比例 %', employerFund:'单位公积金比例 %', employerSupplement:'上海单位补充公积金比例 %',
  socialRate:'个人社保合计比例 %', employerSocial:'单位社保合计比例 %', socialFixed:'个人社保每月固定费用',
  secondGuarantee:'第二年保底奖金', secondGuaranteeFactor:'第二年保底系数', performanceMultiplier:'浮动奖金倍率', bonusBase:'奖金基数（元）', guaranteeFactor:'首年保底系数', companyFactor:'公司系数',
  departmentFactor:'部门系数', personalFactor:'个人系数', attendanceFactor:'出勤系数',
  eligible:'本情景符合单独计税的奖金金额', year:'收入年度', probation:'试用期月数', probationRate:'试用期工资比例 %',
};
export const strings = ['workStart','workEnd','firstYearSpecial','secondGu','bonusMode','company','city','level','role','status','payCity','notes','start','approval','gu','vu','tax','qualification'];
const choices = {firstYearSpecial:['yes','no'],secondGu:['月','元'],bonusMode:['direct','factor'],status:['预估','口头','书面'],gu:['月','元'],vu:['月','元'],tax:['自动优化','单独计税','并入综合所得'],qualification:['待确认','符合且本年度未使用','不符合或已使用']};
export const defaults = {workStart:'09:00',workEnd:'19:00',workDays:'5',firstYearSpecial:'no',months:'12',status:'预估',gu:'月',vu:'月',tax:'自动优化',qualification:'待确认',year:String(YEAR)};
export const sum = (...values) => values.some(v=>v===null) ? null : values.reduce((a,b)=>a+b,0);
const multiply = (a,b) => a === 0 || b === 0 ? 0 : a === null || b === null ? null : a*b;
export function prefillNumbers(offer) {
  const filled = {...offer};
  for (const key of Object.keys(numeric)) {
    if(contributionFields.includes(key)){
      filled[key]??=null;
      continue;
    }
    if(key==='secondGuaranteeFactor')continue;
    filled[key] ??= key==='performanceMultiplier'?'1':'0';
  }
  return filled;
}
export const scenarios = {guarantee:'只看保证',target:'目标奖金',zero:'零浮动',high:'150% 浮动'};
export function policyFor(o) {
  const city=(o.payCity || o.city || '').trim().replace(/市$/,'');
  return Object.hasOwn(POLICIES,city) ? POLICIES[city] : undefined;
}
export function minutesOfDay(input) {
  const time=String(input??'').normalize('NFKC').trim();
  if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time))return null;
  const [hours,minutes]=time.split(':').map(Number);
  return hours*60+minutes;
}
function annualWorkHours(offer) {
  const start=minutesOfDay(offer.workStart??defaults.workStart);
  const end=minutesOfDay(offer.workEnd??defaults.workEnd);
  const days=amount(offer.workDays??defaults.workDays);
  if(start===null||end===null||start===end||days===null||days<=0||days>7)return null;
  return ((end-start+1440)%1440)/60*days*52;
}
export function calculate(o, scenario='target', {employmentYear=1, includeSign=scenario!=='guarantee'}={}) {
  const second=employmentYear===2;
  const special=o.firstYearSpecial==='yes';
  const policy = policyFor(o);
  const n = key => amount(o[key]);
  const rate = key => {const v=n(key); return v!==null && v<=100 ? v : null;};
  const base = n('base'), months = n('months'), fixed = multiply(base,months);
  const bonusValue = (key,unit) => multiply(n(key),(o[unit]??(unit==='secondGu'?'元':'月'))==='元'||hasMoneyUnit(o[key])?1:base);
  const byFactor = o.bonusMode==='factor';
  const commonGuarantee = byFactor ? multiply(n('bonusBase'),n('guaranteeFactor')) : bonusValue('guaranteed','gu');
  const secondGuarantee = byFactor && n('secondGuaranteeFactor')!==null
    ? multiply(n('bonusBase'),n('secondGuaranteeFactor'))
    : bonusValue('secondGuarantee','secondGu') ?? 0;
  const guaranteedBonus = second && special ? secondGuarantee : commonGuarantee;
  const factorTarget = ['companyFactor','departmentFactor','personalFactor','attendanceFactor']
    .reduce((total,key)=>multiply(total,n(key)),n('bonusBase'));
  const statedVariable = byFactor
    ? (factorTarget===null || guaranteedBonus===null ? null : multiply(Math.max(0,factorTarget-guaranteedBonus),n('performanceMultiplier')??1))
    : bonusValue('variable','vu');
  const targetMonths = n('targetMonths');
  const guaranteed = sum(fixed,guaranteedBonus);
  const targetFromMonths = multiply(base,targetMonths);
  const inferredVariable = targetFromMonths===null || guaranteed===null || targetFromMonths<guaranteed ? null : targetFromMonths-guaranteed;
  const variable = statedVariable ?? inferredVariable;
  const recurring = sum(guaranteed,variable);
  const target = recurring ?? (targetFromMonths!==null && (guaranteed ?? fixed ?? 0)<=targetFromMonths && (byFactor ? factorTarget===null : n('variable')===null) ? targetFromMonths:null);
  const sign = second || !includeSign ? 0 : n('sign'), subsidy = n('subsidy'), extra = n('extra'), equity = n('equity');
  const factor = {half:.5,target:1,high:1.5}[scenario]??0;
  const fixedOnly=scenario==='fixed';
  const regularOnly=fixedOnly || scenario==='guarantee';
  const selected = fixedOnly ? fixed : scenario==='target' ? target : sum(guaranteed,multiply(variable,factor));
  const cash = sum(selected, sign??0, regularOnly?0:(subsidy??0),regularOnly?0:(extra??0));
  const cashWithEquity = sum(cash,equity);
  const bound = (key, limits) => n(key) ?? (base===null || !limits ? null: Math.min(limits[1],Math.max(limits[0],base)));
  const socialBase = bound('socialBase',policy?.social), fundBase = bound('fundBase',policy?.fund);
  const isShanghai = policy?.supplementalFund===true;
  const ordinary = rate('fundRate');
  const supplement = isShanghai ? rate('supplement') : 0;
  const employerOrdinary = rate('employerFund');
  const employerSupplement = isShanghai ? rate('employerSupplement') : 0;
  const defaultOrdinary = isShanghai ? 7 : 12;
  const personalRate = ordinary ?? defaultOrdinary;
  const personalExtra = supplement ?? (isShanghai && ordinary===null ? 5 : 0);
  const companyRate = employerOrdinary ?? personalRate;
  const companyExtra = employerSupplement ?? (employerOrdinary===null || supplement!==null ? personalExtra : 0);
  const annualFund = (monthlyBase,ordinaryRate,supplementRate)=>{
    if(ordinaryRate===0 && supplementRate===0)return 0;
    if(monthlyBase===null)return null;
    const monthly = rate=>{
      const contribution=monthlyBase*rate/100;
      return policy?.fundRound ? Math.round(contribution) : contribution;
    };
    return (monthly(ordinaryRate)+monthly(supplementRate))*12;
  };
  const fund = annualFund(fundBase,personalRate,personalExtra);
  const companyFund = annualFund(fundBase,companyRate,companyExtra);
  const taxFundBase = fundBase===null || !policy?.fund ? fundBase : Math.min(fundBase,policy.fund[1]);
  const approvedFund = (ordinaryRate,supplementRate)=>annualFund(taxFundBase,Math.min(12,ordinaryRate),Math.min(supplementRate,Math.max(0,12-ordinaryRate)));
  const deductibleFund = fund===null ? null : Math.min(fund,approvedFund(personalRate,personalExtra));
  const taxableCompanyFund = companyFund===null ? 0 : Math.max(0,companyFund-approvedFund(companyRate,companyExtra));
  const medicalBase = policy?.medical ? bound('socialBase',policy.medical) : socialBase;
  const unemploymentBase = policy?.unemployment ? bound('socialBase',policy.unemployment) : socialBase;
  const socialBases = [socialBase,medicalBase,unemploymentBase];
  const payrollSocial = (override, rates) => override!==null
    ? multiply(socialBase,override*.01)
    : rates ? sum(...rates.map((rate,i)=>multiply(socialBases[i],rate*.01))) : null;
  const social = socialBase===0 ? 0 : multiply(sum(payrollSocial(rate('socialRate'),policy?.employee),n('socialFixed')??policy?.fixed??(rate('socialRate')!==null?0:null)),12);
  const companySocial = multiply(payrollSocial(rate('employerSocial'),policy?.employer),12);
  const deduction = n('deduction');
  const basicDeduction = 60000;
  const taxableDeductions = sum(basicDeduction,social,deductibleFund,deduction??0);
  const year = sum(n('year'),second?1:0);
  const taxableCash = sum(cash,taxableCompanyFund);
  const merged = taxableCash===null || taxableDeductions===null ? null : annualTax(taxableCash-taxableDeductions);
  const eligible = n('eligible');
  const availableBonus = fixedOnly ? 0 : sum(guaranteedBonus,multiply(variable,factor),regularOnly?0:(extra??0));
  const canSplit = merged!==null && year!==null && Number.isInteger(year) && year>=2023 && year<=2027 &&
    o.qualification==='符合且本年度未使用' && eligible!==null && eligible>0 && availableBonus!==null && eligible<=availableBonus && eligible<=cash;
  const split = canSplit ? annualTax(taxableCash-eligible-taxableDeductions)+bonusTax(eligible):null;
  const useSplit = split!==null && (o.tax==='单独计税' || (o.tax!=='并入综合所得' && split<merged));
  const tax = useSplit ? split : merged;
  const splitBonus = useSplit ? eligible : 0;
  const comprehensiveTaxable = cash===null || taxableDeductions===null ? null : Math.max(0,taxableCash-splitBonus-taxableDeductions);
  const net = tax===null ? null : cash-tax-social-fund;
  const workHours=annualWorkHours(o);
  const hourlyCash=workHours===null || cash===null ? null : cash/workHours;
  const hourlyNet=workHours===null || net===null ? null : net/workHours;
  const rent = multiply(n('rent'),12), living = multiply(n('living'),12);
  const costs = sum(rent,living);
  const remaining = net===null || costs===null ? null : net-costs;
  const warnings = [];
  if (targetMonths!==null && (months===null || guaranteedBonus===null)) warnings.push(targetMonths+' 薪里有多少个月保底？');
  else if (base===null && (months!==0 || o.gu!=='元' || o.vu!=='元')) warnings.push('税前月 Base 是多少？');
  if (guaranteedBonus===null || variable===null) warnings.push(byFactor
    ? '奖金基数、首年保底系数和目标绩效系数分别是多少？'
    : '保底奖金和目标浮动奖金各是多少？');
  if (ordinary===null || n('fundBase')===null || (isShanghai && supplement===null)) warnings.push('公积金缴存比例和实际基数是多少？');
  if (!o.approval) warnings.push('目前报价是否还需要内部审批？');
  const assumptions = [
    policy?.notes,
    policy?.medical && policy===POLICIES.深圳?'深圳按 2026 年下半年新入职参考值全年化估算。养老、职工医保一档和失业险分别取基数。失业费率暂按个人 0.2%、单位 0.8% 参考估算。手填社保基数或合计费率可覆盖。':'',
    socialBase===null || fundBase===null ? '可在公积金与社保设置中补充缺少的缴费基数。' :
      n('socialBase')===null || n('fundBase')===null ? '假设用当前月 Base 按参考区间推算未填写的缴费基数。':'采用手填缴费基数。',
    ordinary===null?'公积金比例待确认，按普通 '+personalRate+'%'+(personalExtra?'、补充 '+personalExtra+'%':'')+' 测算。':'采用手填个人公积金比例。',
    employerOrdinary===null?'单位普通公积金比例暂与个人相同。':'',
    isShanghai && ordinary!==null && supplement===null?'已填写普通公积金比例，未填写的补充公积金按 0 计。':'',
    [sign,subsidy,extra,deduction].some(v=>v===null)?'未确认的签字费、补贴、额外奖金或专项扣除暂未纳入对应估算。':'',
    second && special?'第二年沿用当前 Base 和目标奖金参数。首年保底不结转，第二年保底未填写时按无保底估算。':'',
    byFactor?'绩效奖金按奖金基数 × 公司 × 部门 × 个人 × 出勤系数。超过当年保底的部分再乘浮动奖金倍率。':'',
    equity!==null?'股权单独列示，税后现金测算仅含现金收入。':'',
    year!==YEAR?'当前年度采用 2026 年缴费参数和现行综合所得税表估算。':'',
    o.qualification!=='符合且本年度未使用' && (guaranteedBonus>0 || variable>0)?'奖金资格待确认或不可用，按综合所得测算。':'',
    o.tax==='单独计税' && !canSplit?'单独计税条件尚未满足，本情景暂按并入综合所得估算。':'',
    '按完整年度测算，入职日和试用期仅记录。单位社保参考值含养老、医疗、失业，医疗按当地含生育口径；工伤等差异可手填覆盖。',
  ].filter(Boolean);
  return {base,fixed,factorTarget,guaranteedBonus,guaranteed,variable,target,targetPackage:sum(target,sign??0,subsidy??0,extra??0,equity??0),cash,cashWithEquity,sign,equity,subsidy,extra,personalRate,personalExtra,companyRate,companyExtra,socialBase,medicalBase,unemploymentBase,fundBase,fund,companyFund,totalFund:sum(fund,companyFund),social,companySocial,merged,split,tax,taxMethod:useSplit?'全年一次性奖金单独计税':'并入综合所得',deductibleFund,taxableCompanyFund,basicDeduction,deduction,taxableDeductions,splitBonus,comprehensiveTaxable,net,workHours,hourlyCash,hourlyNet,monthly:multiply(net,1/12),rent,living,costs,remaining,warnings:warnings.slice(0,3),assumptions};
}
export function encode(offers) {return JSON.stringify({version:OFFER_VERSION,offers},null,2);}
export function decode(raw,{maxOffers=Infinity}={}) {
  const data=JSON.parse(typeof raw==='string'?raw.replace(/^﻿/,''):raw);
  if (!Array.isArray(data?.offers) || !data.offers.length) throw Error('请选择有效的 Offer Desk JSON 备份。');
  if (data.version!==OFFER_VERSION) throw Error('仅支持 v'+OFFER_VERSION+' 的 Offer Desk JSON 备份。');
  if (data.offers.length>maxOffers) throw Error('备份文件最多可包含 '+maxOffers+' 份 Offer。');
  const ids=new Set();
  return data.offers.map(offer=>{
    if (!offer || typeof offer.id!=='string' || !offer.id || ids.has(offer.id)) throw Error('Offer 标识无效或重复。');
    ids.add(offer.id);
    const clean={...offer};
    for (const key of [...strings,...Object.keys(numeric)]) {
      if (offer[key]===undefined || offer[key]===null) continue;
      if (typeof offer[key]!=='string' && !(key in numeric && typeof offer[key]==='number')) throw Error('字段格式无效。');
      clean[key]=String(offer[key]);
      if (choices[key] && clean[key] && !choices[key].includes(clean[key])) throw Error('选项值无效。');
    }
    return clean;
  });
}
