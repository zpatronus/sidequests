import {amount,calculate,scenarios} from './model.mjs';
import {TAX_SOURCE,YEAR} from './policy.mjs';

export const reportRows=[['base','月 Base'],['guaranteed','保证年薪'],['targetPackage','目标年包'],['cash','本情景税前现金'],['subsidy','年度现金补贴'],['extra','额外奖金'],['equity','年度股权估值'],['cashWithEquity','税前现金＋股权估值'],['net','预计税后年收入'],['hourlyCash','税前现金时薪（元/小时）'],['hourlyNet','税后到手时薪（元/小时）'],['companyFund','公司公积金'],['totalFund','公积金总积累'],['rent','年租金'],['costs','年度生活成本'],['remaining','税后剩余现金']];

export const hourlyFields=new Set(['hourlyCash','hourlyNet']);
export const formatHourly=value=>value===null?'—':value.toLocaleString('zh-CN',{maximumFractionDigits:2})+' 元/小时';

const escape = value => String(value??'').replace(/\r\n?|\n/g,' ').replace(/[\\`*_{}\[\]()<>#+.!|]/g,'\\$&');
const money = value => value===null ? '—' : (value/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 万元';
const name = offer => offer.company?.trim()||'未命名 Offer';
const tableRow = cells => '| '+cells.join(' | ')+' |';

export function csvCell(value) {
  if(typeof value==='number')return String(value);
  const text=String(value??'');
  const normalized=text.normalize('NFKC');
  const needsPrefix=/^[\t\r\n]/.test(normalized) || /^[=+@-]/.test(normalized.trimStart());
  return '"'+(needsPrefix?"'":'')+text.replaceAll('"','""')+'"';
}

function notesBlock(notes) {
  if (!notes) return '暂无记录';
  let longest=2;
  for(const [run] of notes.matchAll(/`+/g))longest=Math.max(longest,run.length);
  const fence = '`'.repeat(longest+1);
  return fence+'\n'+notes+(notes.endsWith('\n')?'':'\n')+fence;
}

export function reportMarkdown(offers, scenario, date=new Date(), options={}) {
  const entries=offers.map(offer=>({offer,result:calculate(offer,scenario,options)}));
  const lines=[
    '# Offer 对比报告','',
    '生成日期 '+date.toLocaleDateString('zh-CN')+' · '+YEAR+' 年参考政策 · '+scenarios[scenario]+' · '+(options.employmentYear===2?'第二年':'首年')+(options.employmentYear!==2&&options.includeSign!==undefined?(options.includeSign?' · 含签字费':' · 不含签字费'):''),'',
    '## 薪酬对比','',
    tableRow(['指标',...offers.map(offer=>escape(name(offer)))]),
    tableRow(['---',...offers.map(()=>'---:')]),
    ...reportRows.map(([key,label])=>tableRow([label,...entries.map(({result})=>
      hourlyFields.has(key)?formatHourly(result[key]):money(result[key]))])),
    '', '— 表示未知。','',
  ];
  for(const {offer,result:r} of entries) {
    const fields=[
      ['固定工资',r.fixed],['保底奖金',r.guaranteedBonus],['目标浮动奖金',r.variable],['签字费',r.sign],
      ['股权估值',r.equity],['HR 报价',amount(offer.hr)],
    ];
    const factorLines=offer.bonusMode==='factor' ? [
      '- 奖金基数 '+money(amount(offer.bonusBase))+(options.employmentYear===2?'':' · 首年保底系数 '+(amount(offer.guaranteeFactor)??'—')),
      '- 公司 × 部门 × 个人 × 出勤 '+['companyFactor','departmentFactor','personalFactor','attendanceFactor'].map(key=>amount(offer[key])??'—').join(' × ')+' · 浮动奖金倍率 '+(amount(offer.performanceMultiplier)??1)+' · 绩效公式奖金 '+money(r.factorTarget),
    ] : [];
    lines.push('## '+escape(name(offer)),'',escape([offer.role,offer.level,offer.city,offer.status].filter(Boolean).join(' · ')),'',
      ...fields.map(([label,value])=>'- '+label+' '+money(value)),
      ...factorLines,
      '- 个税 '+money(r.tax)+'（'+r.taxMethod+'）',
      '- 基本减除费用 '+money(r.basicDeduction)+' · 专项附加扣除 '+(r.deduction===null?'未填写，本次按 0 计':money(r.deduction))+' · 综合所得应纳税所得额 '+money(r.comprehensiveTaxable),
      '- 个人社保 '+money(r.social)+' · 个人公积金 '+money(r.fund)+'（可税前扣除 '+money(r.deductibleFund)+'） · 公司社保 '+money(r.companySocial),
      '', '### 通话记录','',notesBlock(offer.notes),
      '', '### 计算假设','',...r.assumptions.map(item=>'- '+escape(item)),'');
  }
  lines.push('## 政策来源','','- [国家税务总局 · 全年一次性奖金政策]('+TAX_SOURCE+')','');
  return lines.join('\n');
}
