import {amount,hasMoneyUnit} from './numbers.mjs';

export const bonusUnits={guaranteed:'gu',variable:'vu',secondGuarantee:'secondGu'};

const moneyFields=new Set([
  'base','hr','sign','rent','living','expected','personal','hrEstimate','equity',
  'subsidy','extra','deduction','socialBase','fundBase','socialFixed','bonusBase','eligible',
]);

export function isMoneyField(offer,field) {
  const unit=bonusUnits[field];
  return unit
    ? (offer[unit]??(unit==='secondGu'?'元':'月'))==='元'||hasMoneyUnit(offer[field])
    : moneyFields.has(field);
}

export function usdInput(value,rate) {
  const number=amount(value);
  return number===null?String(value??''):String(Number((number*rate).toFixed(2)));
}

export function usdToRmb(value,rate) {
  const text=value.normalize('NFKC').trim();
  if(!text)return '';
  if(/[¥元]/.test(text))return null;
  const number=amount(text.replace(/\$\s*/g,'').replace(/^USD\s*|\s*USD$/gi,'').trim());
  if(number===null || number/rate>1e12)return null;
  return String(Number((number/rate).toFixed(2)));
}

// Session preferences are independent of offer records and comparison exports.
export function currencySession(storage,scope) {
  const prefix='offer-call-currency:'+scope+':';
  const memory=new Map();
  return {
    isUSD(key){
      if(memory.has(key))return memory.get(key);
      try{return storage?.getItem(prefix+key)==='USD';}catch{return false;}
    },
    setUSD(key,enabled){
      memory.set(key,enabled);
      try {
        if(enabled)storage?.setItem(prefix+key,'USD');
        else storage?.removeItem(prefix+key);
      }catch{ /* In-session memory also works when storage is unavailable. */ }
    },
  };
}
