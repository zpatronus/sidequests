export const YEAR = 2026;
export const TAX_SOURCE = 'https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html';
const annual = [[36000,.03,0],[144000,.1,2520],[300000,.2,16920],[420000,.25,31920],[660000,.3,52920],[960000,.35,85920],[Infinity,.45,181920]];
const bonus = [[3000,.03,0],[12000,.1,210],[25000,.2,1410],[35000,.25,2660],[55000,.3,4410],[80000,.35,7160],[Infinity,.45,15160]];
function tax(amount, divisor, brackets) {
  const [,rate, deduction] = brackets.find(([limit]) => amount / divisor <= limit);
  return Math.max(0, amount * rate - deduction);
}
export const annualTax = amount => tax(amount,1,annual);
export const bonusTax = amount => tax(amount,12,bonus);
