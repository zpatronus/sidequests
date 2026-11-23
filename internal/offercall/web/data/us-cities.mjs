// Leading U.S. markets in CBRE's 2025 Scoring Tech Talent report, represented by
// their principal city. Monthly USD estimates are from the linked Livingcost pages.
const rows = [
  ['San Francisco','CA','ca/san-francisco',3199,1251,['SF','San Francisco Bay Area']],
  ['Seattle','WA','wa/seattle',2109,1186,[]],
  ['New York City','NY','ny/new-york',3692,1485,['New York','New York, NY','NYC']],
  ['Austin','TX','tx/austin',1888,945,[]],
  ['Washington, DC','DC','dc/washington',2374,1191,['DC','Washington D.C.']],
  ['Dallas','TX','tx/dallas',1506,1021,['Dallas-Fort Worth','DFW']],
  ['Boston','MA','ma/boston',2870,1125,[]],
  ['Raleigh','NC','nc/raleigh',1531,891,['Raleigh-Durham']],
  ['Atlanta','GA','ga/atlanta',1746,1054,[]],
  ['Denver','CO','co/denver',1821,1112,[]],
];

export const US_CITIES = rows.map(([name,state,path,rentUSD,livingUSD,aliases])=>({
  name,state,rentUSD,livingUSD,aliases,source:'https://livingcost.org/cost/united-states/'+path,
}));
