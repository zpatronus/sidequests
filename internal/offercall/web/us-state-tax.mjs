// Resident, single-filer planning estimates. Amounts and thresholds are USD.
// 2027 uses the 2026 income-tax schedules where newer local schedules aren't modeled.
export const usRegionalSources = {
  CA:['https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/2026/10.html','https://edd.ca.gov/en/payroll_taxes/rates_and_withholding'],
  WA:['https://dor.wa.gov/taxes-rates/income-tax','https://paidleave.wa.gov/updates/','https://wacaresfund.wa.gov/how-it-works'],
  NY:['https://www.tax.ny.gov/pdf/2026/inc/it2105i_2026.pdf','https://docs.paidfamilyleave.ny.gov/content/main/PressRe/paid-family-leave-2026.jsp'],
  TX:['https://comptroller.texas.gov/transparency/revenue/docs/96-1774.pdf'],
  DC:['https://otr.cfo.dc.gov/am/page/dc-individual-and-fiduciary-income-tax-rates'],
  MA:['https://www.mass.gov/info-details/tax-rates','https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator'],
  NC:['https://www.ncdor.gov/individual-estimated-income-tax/open'],
  GA:['https://dor.georgia.gov/taxes/important-tax-updates'],
  CO:['https://tax.colorado.gov/individual-income-tax-guide','https://content.govdelivery.com/accounts/CODLE/bulletins/4005988',
    'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Department-of-Finance/Our-Divisions/Treasury/Business-Tax-Information/Business-Tax-FAQ'],
};

export function marginalTax(taxable, thresholds, rates) {
  let total=0;
  let lower=0;
  for(const [index,rate] of rates.entries()){
    const upper=thresholds[index]??Infinity;
    total+=Math.max(0,Math.min(taxable,upper)-lower)*rate;
    lower=upper;
  }
  return total;
}

const excess=(amount,threshold)=>Math.max(0,amount-threshold);

function nyStateTax(wages, taxable) {
  const thresholds=[8500,11700,13900,80650,215400,1077550,5000000,25000000];
  const rates=[.039,.044,.0515,.054,.059,.0685,.0965,.103,.109];
  const base=marginalTax(taxable,thresholds,rates);
  if(wages<=107650)return base;
  if(wages>25000000)return taxable*.109;
  const phaseIn=threshold=>Math.round(Math.min(1,excess(wages,threshold)/50000)*10000)/10000;
  if(taxable<=215400)return base+(taxable*.059-base)*phaseIn(107650);
  if(taxable<=1077550)return base+567+2047*phaseIn(215400);
  if(taxable<=5000000)return base+2614+30172*phaseIn(1077550);
  return base+32786+32500*phaseIn(5000000);
}

export function estimateUSRegional(state, wages, {year, deduction, socialLimit, fica, monthlyBase}) {
  let stateTax=0, localTax=0, regionalPayroll=0;
  const cappedWages=Math.min(wages,socialLimit);
  switch(state){
    case 'CA': {
      const taxable=excess(wages,5900);
      stateTax=marginalTax(taxable,[11456,27157,42861,59498,75197,384109,460927,768213,1000000],
        [.01,.02,.04,.06,.08,.093,.103,.113,.123,.133]);
      regionalPayroll=wages*(year===2027?.014:.013);
      break;
    }
    case 'WA':
      regionalPayroll=cappedWages*(year===2027?.012*.707:.0113*.7143)+wages*.0058;
      break;
    case 'NY': {
      const taxable=excess(wages,8000);
      stateTax=nyStateTax(wages,taxable);
      localTax=marginalTax(taxable,[12000,25000,50000],[.03078,.03762,.03819,.03876]);
      regionalPayroll=Math.min(wages*.00432,411.91);
      break;
    }
    case 'DC':
      stateTax=marginalTax(excess(wages,deduction),[10000,40000,60000,250000,500000,1000000],
        [.04,.06,.065,.085,.0925,.0975,.1075]);
      break;
    case 'MA': {
      const taxable=excess(wages,4400+Math.min(fica,2000));
      stateTax=taxable*.05+excess(taxable,1107750)*.04;
      regionalPayroll=cappedWages*.0046;
      break;
    }
    case 'NC':
      stateTax=excess(wages,12750)*.0399;
      break;
    case 'GA':
      stateTax=excess(wages,15000)*.0499;
      break;
    case 'CO':
      stateTax=excess(wages,deduction)*.044;
      localTax=(monthlyBase??wages/12)>=500?5.75*12:0;
      regionalPayroll=cappedWages*.0044;
      break;
    case 'TX':
      break;
    default:
      return null;
  }
  return {stateTax,localTax,regionalPayroll};
}
