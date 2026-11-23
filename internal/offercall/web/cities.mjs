import {CITIES} from './data/city-policies.mjs';
import {US_CITIES} from './data/us-cities.mjs';

const pinyin = {
  北京:'bei jing', 天津:'tian jin', 上海:'shang hai', 重庆:'chong qing',
  石家庄:'shi jia zhuang', 唐山:'tang shan', 太原:'tai yuan', 大同:'da tong',
  呼和浩特:'hu he hao te', 包头:'bao tou', 沈阳:'shen yang', 大连:'da lian',
  长春:'chang chun', 吉林:'ji lin', 哈尔滨:'ha er bin', 大庆:'da qing',
  南京:'nan jing', 苏州:'su zhou', 杭州:'hang zhou', 宁波:'ning bo',
  合肥:'he fei', 芜湖:'wu hu', 福州:'fu zhou', 厦门:'xia men', 南昌:'nan chang', 赣州:'gan zhou',
  济南:'ji nan', 青岛:'qing dao', 郑州:'zheng zhou', 洛阳:'luo yang',
  武汉:'wu han', 襄阳:'xiang yang', 长沙:'chang sha', 株洲:'zhu zhou',
  广州:'guang zhou', 深圳:'shen zhen', 南宁:'nan ning', 柳州:'liu zhou',
  海口:'hai kou', 三亚:'san ya', 成都:'cheng du', 绵阳:'mian yang',
  贵阳:'gui yang', 遵义:'zun yi', 昆明:'kun ming', 曲靖:'qu jing',
  拉萨:'la sa', 日喀则:'ri ka ze', 西安:'xi an', 咸阳:'xian yang',
  兰州:'lan zhou', 天水:'tian shui', 西宁:'xi ning', 海东:'hai dong',
  银川:'yin chuan', 石嘴山:'shi zui shan', 乌鲁木齐:'wu lu mu qi', 克拉玛依:'ke la ma yi',
};

function searchKey(value) {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]/gu,'');
}

export const CITY_CHOICES = [
  ...CITIES.map(({name,province})=>{
    const spelling=pinyin[name];
    const initials=spelling.split(' ').map(syllable=>syllable[0]).join('');
    return {name,region:province,spelling,aliases:[spelling,initials]};
  }),
  ...US_CITIES.map(({name,state,aliases})=>({name,region:state,spelling:'',us:true,aliases:[name+' '+state,...aliases]})),
];

const exactNames=new Map();
for(const city of CITY_CHOICES){
  for(const alias of [city.name,...city.aliases]){
    const key=searchKey(alias);
    if(!exactNames.has(key))exactNames.set(key,city.name);
    else if(exactNames.get(key)!==city.name)exactNames.set(key,null);
  }
}
const usNames=new Set(US_CITIES.map(city=>city.name));

export function cityName(value) {
  const name=(value||'').trim().replace(/市$/,'');
  return exactNames.get(searchKey(name))??name;
}

export const isUSCity=value=>usNames.has(cityName(value));

function closeSpelling(query, value) {
  if(query.length<4 || Math.abs(query.length-value.length)>1)return false;
  if(query.length===value.length){
    const mismatches=[...query].flatMap((char,index)=>char===value[index]?[]:[index]);
    return mismatches.length===1 || (mismatches.length===2 && mismatches[1]===mismatches[0]+1 &&
      query[mismatches[0]]===value[mismatches[1]] && query[mismatches[1]]===value[mismatches[0]]);
  }
  const [short,long]=query.length<value.length?[query,value]:[value,query];
  const mismatch=[...short].findIndex((char,index)=>char!==long[index]);
  return mismatch===-1 || short.slice(mismatch)===long.slice(mismatch+1);
}

export function findCities(query) {
  const key=searchKey(query.trim().replace(/市$/,''));
  if(!key)return CITY_CHOICES;
  return CITY_CHOICES.flatMap(city=>{
    const keys=[city.name,...city.aliases,city.region].map(searchKey);
    const score=keys.includes(key)?0:keys.some(value=>value.startsWith(key))?1:
      keys.some(value=>value.includes(key))?2:
      city.spelling && closeSpelling(key,searchKey(city.spelling))?3:-1;
    return score<0?[]:[{city,score}];
  }).sort((a,b)=>a.score-b.score).map(({city})=>city);
}
