import test from 'node:test';
import assert from 'node:assert/strict';
import {currencySession,isMoneyField,usdInput,usdToRmb} from './currency.mjs';
import {decode,encode} from './model.mjs';

test('USD display accepts RMB expressions and a USD edit produces a canonical RMB value',()=>{
  assert.equal(usdInput('5.5万',.15),'8250');
  assert.equal(usdInput('0',.15),'0');
  assert.equal(usdInput('',.15),'');
  assert.equal(usdToRmb('$8,250',.15),'55000');
  assert.equal(usdToRmb('USD 8,250',.15),'55000');
  assert.equal(usdToRmb('4000 + 500',.15),'30000');
  assert.equal(usdToRmb('¥55,000',.15),null);
  assert.equal(usdToRmb('100/',.15),null);
  assert.equal(usdToRmb('',.15),'');
  const [saved]=decode(encode([{id:'rmb',base:usdToRmb('$8,250',.15)}]));
  assert.equal(saved.base,'55000');
});

test('only monetary fields and monetary bonuses are converted',()=>{
  const offer={guaranteed:'2',gu:'月',variable:'3万',vu:'月',fundRate:'7'};
  for(const field of ['base','rent','living','bonusBase','secondGuarantee','variable']) {
    assert.ok(isMoneyField(offer,field),field);
  }
  for(const field of ['guaranteed','fundRate','workDays','months','personalFactor','year']) {
    assert.equal(isMoneyField(offer,field),false,field);
  }
});


test('offer and table choices are independent and persist only in the tab storage',()=>{
  const values=new Map();
  const storage={
    getItem:key=>values.get(key),
    setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key),
  };
  const first=currencySession(storage,'editor');
  first.setUSD('offer:a',true);
  assert.equal(first.isUSD('offer:b'),false);
  assert.equal(first.isUSD('table'),false);
  first.setUSD('table',true);
  const reload=currencySession(storage,'editor');
  assert.equal(reload.isUSD('offer:a'),true);
  assert.equal(reload.isUSD('table'),true);
  reload.setUSD('offer:a',false);
  assert.equal(reload.isUSD('table'),true);
  assert.equal(currencySession(storage,'share:abc').isUSD('table'),false);
  assert.equal(currencySession(null,'editor').isUSD('offer:a'),false);
});
