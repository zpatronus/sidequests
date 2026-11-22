import test from 'node:test';
import assert from 'node:assert/strict';
import {amount,invalidNumber} from './numbers.mjs';

test('数字字段计算四则运算、括号、乘方、金额单位和全角字符',()=>{
  for(const [input,result] of [
    ['5.5万 × 12',660000],['(1200 + 800) / 2',1000],['3+2*4',11],['(3+2)×4',20],
    ['2^3^2',512],['2**-2',.25],['￥１２０，０００ ÷ 3',40000],['1,234,567',1234567],['120万元+6w',1260000],['5w + 2.5k',52500],['(3K + 2w) / 2',11500],
  ]) assert.equal(amount(input),result,input);
});

test('拒绝任意代码、不完整表达式、非有限值和越界数值',()=>{
  for(const input of ['abc','1+','(1+2','2 3','5/0','1/(2-2)','0*(5/0)','-2','globalThis.alert(1)','2^999','1000000000001']){
    assert.equal(amount(input),null,input);
    assert.equal(invalidNumber('rent',input),true,input);
  }
  assert.equal(invalidNumber('fundRate','80+30'),true);
  assert.equal(invalidNumber('fundRate','24/2'),false);
  assert.equal(invalidNumber('rent',''),false);
});
