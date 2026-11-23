import test from 'node:test';
import assert from 'node:assert/strict';
import {CITY_CHOICES,cityName,findCities,isUSCity} from './cities.mjs';
import {calculate,defaults} from './model.mjs';
import {applyCityCosts,cityCostDefaults} from './storage.mjs';

test('Chinese city search accepts pinyin, initials, and close spellings',()=>{
  assert.equal(cityName('Níng Bō'),'宁波');
  assert.equal(cityName("Xi'an"),'西安');
  assert.equal(cityName('sz'),'sz');
  assert.ok(findCities('sz').some(city=>city.name==='深圳'));
  assert.ok(findCities('sz').some(city=>city.name==='苏州'));
  assert.equal(findCities('hangzohu')[0].name,'杭州');
  assert.equal(findCities('深圳市')[0].name,'深圳');
});

test('ten U.S. cities use their English names and keep China payroll out of calculations',()=>{
  const usCities=CITY_CHOICES.filter(city=>city.us);
  assert.equal(usCities.length,10);
  const costs=cityCostDefaults({});
  assert.equal(cityName('new york, ny'),'New York City');
  assert.equal(cityName('Washington D.C.'),'Washington, DC');
  assert.equal(isUSCity('纽约'),false);
  for(const city of usCities){
    assert.match(city.name,/^[A-Za-z, ]+$/);
    const offer=applyCityCosts({
      ...defaults,city:city.name,base:'100000',guaranteed:'0',variable:'0',socialBase:'20000',payCity:'杭州',
      socialRate:'10',fundBase:'20000',
    },costs);
    const result=calculate(offer);
    assert.ok(result.costs>0,city.name);
    assert.ok(result.cash>0,city.name);
    assert.equal(result.net,null,city.name);
    assert.equal(result.partialNet,null,city.name);
  }
});
