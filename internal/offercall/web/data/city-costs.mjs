// Rounded monthly planning values in CNY. Rent is a whole one-bedroom home.
const rentIndex='https://www.cih-index.com/data/index/rentIndex.html';
const octoberBudget='https://www.dh-realting.com/en/insights/cost-of-living-in-china-monthly-budget-rent-and-expenses';
export const cityCostReferences = {
  北京:{rent:6100,outside:3400,living:4000,rentSource:'https://www.numbeo.com/cost-of-living/in/Beijing',
    livingSource:octoberBudget,trend:'2026 年 10 月住宅租金环比 −0.85%，同比 −3.02%。',trendSource:rentIndex},
  上海:{rent:7100,outside:3800,living:4100,rentSource:'https://www.numbeo.com/cost-of-living/in/Shanghai',
    livingSource:octoberBudget,trend:'2026 年 10 月住宅租金环比 +0.25%，同比 +2.78%。',trendSource:rentIndex},
  深圳:{rent:5000,outside:3200,living:4000,rentSource:'https://www.numbeo.com/cost-of-living/in/Shenzhen',
    livingSource:octoberBudget,trend:'2026 年 10 月住宅租金环比 +0.11%，同比 +0.58%。',trendSource:rentIndex},
  杭州:{rent:3700,outside:2400,living:3700,rentSource:'https://es.numbeo.com/coste-de-vida/ciudad/Hangzhou',
    livingSource:'https://www.livingcost.net/china/hangzhou',trend:'2026 年 9 月住宅租金结束连续 3 个月环比上涨，转为下跌。',trendSource:'https://m.cih-index.com/news/2026-10-10/55146350.html'},
};
