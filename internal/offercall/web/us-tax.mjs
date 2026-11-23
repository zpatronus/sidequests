import {US_CITIES} from './data/us-cities.mjs';
import {estimateUSRegional,marginalTax,usRegionalSources} from './us-state-tax.mjs';

// IRS Publication 505 (2026), Revenue Procedure 2026-35 (2027), and SSA wage bases.
const federalYears = new Map([
  [2026,{deduction:16100,socialLimit:184500,brackets:[12400,50400,105700,201775,256225,640600]}],
  [2027,{deduction:16600,socialLimit:192300,brackets:[12800,52025,109125,208325,264550,661375]}],
]);
const rates=[.10,.12,.22,.24,.32,.35,.37];
const states=new Map(US_CITIES.map(({name,state})=>[name,state]));

export const supportsUSFederalYear=year=>federalYears.has(year);

export function estimateUSFederal(cash,year,cnyToUSD) {
  const rules=federalYears.get(year);
  if(cash===null||!rules||!Number.isFinite(cnyToUSD)||cnyToUSD<=0)return null;
  const wages=cash*cnyToUSD;
  const taxable=Math.max(0,wages-rules.deduction);
  const incomeTax=marginalTax(taxable,rules.brackets,rates);
  const socialSecurity=Math.min(wages,rules.socialLimit)*.062;
  const medicare=wages*.0145+Math.max(0,wages-200000)*.009;
  return {
    year,
    incomeTax:incomeTax/cnyToUSD,
    socialSecurity:socialSecurity/cnyToUSD,
    medicare:medicare/cnyToUSD,
    net:(wages-incomeTax-socialSecurity-medicare)/cnyToUSD,
  };
}

export function estimateUSTax(city,cash,base,year,cnyToUSD) {
  const state=states.get(city);
  const federal=estimateUSFederal(cash,year,cnyToUSD);
  if(!state||!federal)return null;
  const {deduction,socialLimit}=federalYears.get(year);
  const regional=estimateUSRegional(state,cash*cnyToUSD,{
    year,deduction,socialLimit,
    fica:(federal.socialSecurity+federal.medicare)*cnyToUSD,
    monthlyBase:base===null?null:base*cnyToUSD,
  });
  const {stateTax,localTax,regionalPayroll}=regional;
  return {
    ...federal,
    state,
    stateTax:stateTax/cnyToUSD,
    localTax:localTax/cnyToUSD,
    regionalPayroll:regionalPayroll/cnyToUSD,
    net:federal.net-(stateTax+localTax+regionalPayroll)/cnyToUSD,
    sources:usRegionalSources[state],
  };
}
