import {US_CITIES} from './us-cities.mjs';

// Rounded monthly planning values in CNY. Rent is a whole one-bedroom home.
const rentIndex='https://www.cih-index.com/data/index/rentIndex.html';
const octoberBudget='https://www.dh-realting.com/en/insights/cost-of-living-in-china-monthly-budget-rent-and-expenses';
const existingReferences = {
  北京:{rent:6100,outside:3400,living:4000,rentSource:'https://www.numbeo.com/cost-of-living/in/Beijing',
    livingSource:octoberBudget,trend:'2026 年 10 月住宅租金环比 −0.85%，同比 −3.02%。',trendSource:rentIndex},
  上海:{rent:7100,outside:3800,living:4100,rentSource:'https://www.numbeo.com/cost-of-living/in/Shanghai',
    livingSource:octoberBudget,trend:'2026 年 10 月住宅租金环比 +0.25%，同比 +2.78%。',trendSource:rentIndex},
  深圳:{rent:5000,outside:3200,living:4000,rentSource:'https://www.numbeo.com/cost-of-living/in/Shenzhen',
    livingSource:octoberBudget,trend:'2026 年 10 月住宅租金环比 +0.11%，同比 +0.58%。',trendSource:rentIndex},
  // Wise reports US$508 per month. Convert at the 2026-11-20 CFETS rate and round to ¥100.
  宁波:{rent:2400,outside:1220,living:3400,rentSource:'https://www.numbeo.com/cost-of-living/in/Ningbo',
    livingSource:'https://wise.com/zh-cn/cost-of-living/china/ningbo',
    trend:'2026 年 10 月住宅样本平均租金 30.6 元/㎡·月。',trendSource:'https://www.cih-index.com/data/index/city/ningbo.html'},
  杭州:{rent:3700,outside:2400,living:3700,rentSource:'https://es.numbeo.com/coste-de-vida/ciudad/Hangzhou',
    livingSource:'https://www.livingcost.net/china/hangzhou',trend:'2026 年 9 月住宅租金结束连续 3 个月环比上涨，转为下跌。',trendSource:'https://m.cih-index.com/news/2026-10-10/55146350.html'},
};

// City-level Livingcost estimates retrieved in November 2026. Rent is a 40 m²
// city-centre one-bedroom. Living costs are for one person, excluding rent.
// USD figures converted at 6.7131 CNY/USD (CFETS, 2026-11-20), rounded to ¥100.
// https://www.chinamoney.com.cn/english/bmkcpr/index.html?tab=2
const livingcostEstimates = {
  天津:['tianjin',2000,2800],
  重庆:['chongqing',2100,2700],
  石家庄:['shijiazhuang',1400,2200],
  唐山:['tangshan',2300,2900],
  太原:['taiyuan',1500,2300],
  大同:['datong',800,3300],
  呼和浩特:['hohhot',1300,2500],
  包头:['baotou',1200,2600],
  沈阳:['shenyang',1500,2500],
  大连:['dalian',2500,3000],
  长春:['changchun',1200,2500],
  吉林:['jilin',1400,2200],
  哈尔滨:['harbin',1900,2600],
  大庆:['daqing',1700,2500],
  南京:['nanjing',3100,2800],
  苏州:['suzhou-js',2700,3400],
  合肥:['hefei',1500,3100],
  芜湖:['wuhu',1500,2600],
  福州:['fuzhou-fj',2400,2700],
  厦门:['xiamen',2500,2800],
  南昌:['nanchang',1300,2600],
  赣州:['ganzhou',3400,2700],
  济南:['jinan',1400,2400],
  青岛:['qingdao',2100,2600],
  郑州:['zhengzhou',1200,2200],
  洛阳:['luoyang',1100,2600],
  武汉:['wuhan',2100,2700],
  襄阳:['xiangyang',1600,2400],
  长沙:['changsha',1600,2800],
  株洲:['zhuzhou',1300,2600],
  广州:['guangzhou',3200,3000],
  南宁:['nanning',1500,2600],
  柳州:['liuzhou',1400,2600],
  海口:['haikou',2200,2800],
  三亚:['sanya',3500,2500],
  成都:['chengdu',2600,2600],
  绵阳:['mianyang',1400,2400],
  贵阳:['guiyang',1100,2800],
  遵义:['zunyi',1600,2600],
  昆明:['kunming',1400,2800],
  曲靖:['qujing',1500,2600],
  拉萨:['lhasa',3900,2700],
  日喀则:['shigatse',3500,2700],
  西安:['xi-an',1900,2500],
  咸阳:['xianyang',1900,2400],
  兰州:['lanzhou',1900,2800],
  天水:['tianshui',1700,2300],
  西宁:['xining',1200,2200],
  海东:['haidong',1400,2200],
  银川:['yinchuan',1600,2600],
  石嘴山:['shizuishan',2500,3100],
  乌鲁木齐:['urumqi',1600,2500],
  克拉玛依:['karamay',1100,2300],
};

// Convert source budgets at the published 2026-11-23 CNY/USD reference rate.
// Keep preset and persisted values in CNY, independent of the display switch.
const usReferenceRate=0.14996;

export const cityCostReferences = {
  ...existingReferences,
  ...Object.fromEntries(US_CITIES.map(({name,rentUSD,livingUSD,source})=>[name,{
    rent:Math.round(rentUSD/usReferenceRate),
    living:Math.round(livingUSD/usReferenceRate),
    rentUSD,livingUSD,modeled:true,rentSource:source,livingSource:source,
  }])),
  ...Object.fromEntries(Object.entries(livingcostEstimates).map(([city,[slug,rent,living]])=>{
    const source='https://livingcost.org/cost/china/'+slug;
    return [city,{rent,living,rentSource:source,livingSource:source,modeled:true}];
  })),
};
