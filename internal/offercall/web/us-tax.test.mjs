import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateUSFederal,estimateUSTax} from './us-tax.mjs';
import {calculate,defaults} from './model.mjs';
import {US_CITIES} from './data/us-cities.mjs';

test('2026 single filer uses the standard deduction, marginal brackets, and FICA',()=>{
  const estimate=estimateUSFederal(100000,2026,1);
  assert.equal(estimate.incomeTax,13170);
  assert.equal(estimate.socialSecurity,6200);
  assert.equal(estimate.medicare,1450);
  assert.equal(estimate.net,79180);
  assert.equal(estimateUSFederal(100000,2025,1),null);
  assert.equal(estimateUSFederal(100000,2026,null),null);
});

test('2027 applies the Social Security wage cap and Additional Medicare Tax',()=>{
  const estimate=estimateUSFederal(250000,2027,1);
  assert.ok(Math.abs(estimate.socialSecurity-11922.60)<.01);
  assert.equal(estimate.medicare,4075);
});

test('every US city calculates in RMB with a rate regardless of the display currency',()=>{
  for(const {name} of US_CITIES){
    const offer={...defaults,city:name,base:'50000',guaranteed:'0',variable:'0',rent:'10000',living:'5000'};
    const result=calculate(offer,'target',{cnyToUSD:.15});
    assert.ok(result.net>0,name);
    assert.equal(result.remaining,result.net-180000,name);
    assert.equal(result.usTax.net,result.net,name);
    assert.equal(calculate(offer,'target',{employmentYear:2,cnyToUSD:.15}).usTax.year,2027,name);
  }
});


test('regional estimates distinguish local taxes, capped premiums, and zero-income-tax states',()=>{
  const result=city=>estimateUSTax(city,100000,100000/12,2026,1);
  assert.equal(result('Austin').net,79180);
  assert.equal(result('Dallas').stateTax,0);
  assert.equal(result('Seattle').stateTax,0);
  assert.ok(Math.abs(result('Seattle').regionalPayroll-1387.159)<.01);
  assert.equal(result('New York City').regionalPayroll,411.91);
  assert.ok(Math.abs(result('New York City').localTax-3441.09)<.01);
  assert.equal(result('Denver').localTax,69);
  assert.ok(Math.abs(result('Denver').stateTax-3691.6)<.01);
  assert.ok(Math.abs(result('Raleigh').stateTax-3481.275)<.01);
  assert.ok(result('San Francisco').net<result('Austin').net);
});
