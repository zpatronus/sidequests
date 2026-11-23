import test from 'node:test';
import assert from 'node:assert/strict';
import {isMoneyField,usdInput,usdToRmb} from './currency.mjs';
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
