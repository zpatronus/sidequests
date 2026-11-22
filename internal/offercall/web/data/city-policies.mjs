const xiamenSocialSource = 'https://app.hrss.xm.gov.cn/jcubing/12333query/file-api/V1/b22ad292-5aa1-45f2-846c-1b42e5ad0993.html';
const establishedPolicies = {
  厦门: {
    social:[4579,22893], fund:[2265,32937], range:'5%–12%', fundRound:true,
    employee:[8,2,.5], fixed:0, employer:[16,8.2,.5],
    notes:'厦门采用 2026 年 10 月起普通企业职工标准，按 12 个月全年化。',
  },
  北京: { fundRound:true, social: [7270,36348], fund: [2540,36348], range:'5%–12%', employee: [8,2,.5], fixed:3, employer:[16,9.8,.5] },
  上海: { supplementalFund:true, fundRound:true, social: [7546,37731], fund: [2740,37731], range:'5%–7%，补充 1%–5%', employee:[8,2,.5], fixed:0, employer:[16,9,.5] },
  深圳: { social: [5521,27603], medical:[6727,33633], unemployment:[2700,48471], fund:[2700,48471], range:'5%–12%', employee:[8,2,.2], fixed:0, employer:[16,6.5,.8] },
  杭州: { fundRound:true, social: [5122,25611], fund: [2660,42151], range:'5%–12%', employee:[8,2,.5], fixed:0, employer:[16,9.5,.5] },
};

// The provincial capital or regional seat is listed first, followed by a major
// employment center. This is a coverage list, not a population or GDP ranking.
const regions = {
  北京:['北京'], 天津:['天津'], 上海:['上海'], 重庆:['重庆'],
  河北:['石家庄','唐山'], 山西:['太原','大同'], 内蒙古:['呼和浩特','包头'],
  辽宁:['沈阳','大连'], 吉林:['长春','吉林'], 黑龙江:['哈尔滨','大庆'],
  江苏:['南京','苏州'], 浙江:['杭州','宁波'], 安徽:['合肥','芜湖'],
  福建:['福州','厦门'], 江西:['南昌','赣州'], 山东:['济南','青岛'],
  河南:['郑州','洛阳'], 湖北:['武汉','襄阳'], 湖南:['长沙','株洲'],
  广东:['广州','深圳'], 广西:['南宁','柳州'], 海南:['海口','三亚'],
  四川:['成都','绵阳'], 贵州:['贵阳','遵义'], 云南:['昆明','曲靖'],
  西藏:['拉萨','日喀则'], 陕西:['西安','咸阳'], 甘肃:['兰州','天水'],
  青海:['西宁','海东'], 宁夏:['银川','石嘴山'], 新疆:['乌鲁木齐','克拉玛依'],
};

export const CITIES = Object.entries(regions).flatMap(([province,cities])=>
  cities.map(name=>({name,province})));

const pension = '2026 年职工养老月缴费基数';
const social = '2026 年职工社保月缴费基数';
const fund = '2026 年住房公积金月缴存基数';
const nationalSummary = 'https://zwfw.gansu.gov.cn/lingtai/zczx/zxfb/art/2026/art_ba28f1c9e78e46e0bd743ef901b3baeb.html';

// Only a source covering all three employee-paid social insurance programs
// can feed the unified-base calculation. Pension-only data is reference data.
const regionalReferences = {
  天津:[{label:social,range:[5180,25902],combined:true,source:'https://tianjin.chinatax.gov.cn/11200000000/0300/030004/03000419/20260824171546537.shtml'}],
  重庆:[{label:social,range:[4553,22765],combined:true,source:'https://chinajob.mohrss.gov.cn/c/2026-11-16/642272.shtml'}],
  河北:[{label:pension,range:[4076,20382],source:nationalSummary}],
  山西:[{label:pension,range:[4244,21219],source:'https://shanxi.chinatax.gov.cn/son/detail/sz-11406-522-1824057'}],
  内蒙古:[
    {label:pension,range:[5058,25290],source:'https://neimenggu.chinatax.gov.cn/xxgk/tzgg/202608/t20260831_897017.html'},
    {label:'2026 年职工医保月缴费基数',range:[6744,25290],source:nationalSummary},
  ],
  吉林:[{label:pension+'（按公布平均工资推算）',range:[4488.9,22444.5],source:'https://xxgk.jl.gov.cn/zcbm/fgw_97992/xxgkmlqy/202609/t20260903_9698417.html'}],
  黑龙江:[{label:pension+'（按公布平均工资推算）',range:[4623,23115],source:'https://zc.51shebao.com/detail/840254'}],
  贵州:[{label:pension+'（按公布平均工资推算）',range:[4426.05,22130.25],source:'https://www.kaiyang.gov.cn/zmhd/rdhy/202609/t20260902_90807405.html'}],
  辽宁:[{label:pension,range:[4533,22665],source:nationalSummary}],
  江苏:[{label:social,range:[5025,25127],combined:true,source:'https://www.suzhou.gov.cn/szsrmzf/mszx/202610/3e20e821e48946c0bb2065cfb7c36429.shtml'}],
  浙江:[{label:pension,range:[5122,25611],source:'https://zhejiang.chinatax.gov.cn/art/2026/10/23/art_8414_84627.html'}],
  安徽:[{label:pension,range:[4354,21772],source:nationalSummary}],
  福建:[{label:pension,range:[4579,22893],source:xiamenSocialSource}],
  江西:[{label:pension,range:[3990,19947],source:'https://www.jxxf.gov.cn/xfxrmzfyyh/cjw006qrfmdrt/202610/4491a31a28804c9faa0b8b34592c0375.shtml'}],
  山东:[{label:pension,range:[4573,22863],source:nationalSummary}],
  河南:[{label:social,range:[3912,19560],combined:true,source:'https://shbx.hrss.henan.gov.cn/hnsi/zhengce/fagui/webinfo/1794202557855397.htm'}],
  湖北:[{label:social,range:[4552,22761],combined:true,source:'https://rst.hubei.gov.cn/zfxxgk/zc/qtzdgkwj/202610/t20261008_6027858.shtml'}],
  湖南:[{label:social,range:[4106,20529],combined:true,source:'https://rst.hunan.gov.cn/rst/xxgk/zcfg/zxzc/202608/t20260822_34049202.html'}],
  广东:[{label:'2026 年 7 月起企业职工养老月缴费基数',range:[5521,27603],source:'https://guangdong.chinatax.gov.cn/gdsw/mmsw_gkwj/2026-10/13/content_87b090a21cbb45a3b8adb477f596793a.shtml'}],
  广西:[{label:social,range:[4204.8,21024],combined:true,source:'https://guangxi.chinatax.gov.cn/xxgk/zfxxgk_22500/fdzdgknr/zcfg_22514/zcwj_22515/202609/t20260921_440354.html'}],
  海南:[{label:social,range:[4952.4,24762],combined:true,source:'https://law.esnai.cn/do.aspx?action=show&controller=home&lawid=235672'}],
  四川:[{label:pension,range:[4699,23493],source:'https://chinajob.mohrss.gov.cn/c/2026-09-11/602828.shtml'}],
  云南:[{label:social,range:[4403,22017],combined:true,source:'https://hrss.yn.gov.cn/jyj/NewsView.aspx?ClassID=1080&NewsID=65775'}],
  西藏:[{label:social,range:[7172.4,35862],combined:true,source:'https://hrss.xizang.gov.cn/xwzx/tzgg/202609/t20260914_558610.html'}],
  陕西:[{label:pension,range:[4737,23685],source:'https://www.htq.gov.cn/hzshtqzf/zwgk/sbxx/202609/99284856dec040c4b8ea1be3ad99d672.shtml'}],
  甘肃:[{label:pension,range:[4526,22626],source:'https://zwfw.gansu.gov.cn/kongtong/zczx/zxgg/art/2026/art_0ab232a319f044c08e5f022e7db9a620.html'}],
  青海:[{label:pension,range:[5333,26664],source:'https://file.m12333.cn/upfile/download/8b14112b-522c-1bd3-8360-f7f0b8015a22.pdf'}],
  宁夏:[{label:social,range:[5023,25113],combined:true,source:'https://law.esnai.cn/do.aspx?action=show&controller=home&lawid=235667'}],
  新疆:[{label:pension,range:[5246,26231],source:'https://hrlib.ciic-cloud.cn/news/info?id=01m4g0n8w4fyb4pw5at74x2avp'}],
};

const localReferences = {
  南京:[{label:fund,range:[2660,42400],fund:true,source:'https://gjj.nanjing.gov.cn/zwgk/tzgg/202607/t20260717_5878580.html'}],
  苏州:[{label:fund+'（常规下限）',range:[5025,40600],fund:true,source:'https://www.suzhou.gov.cn/szsrmzf/zwgg/202607/501539493f89439aa33768e34a069914.shtml'}],
  郑州:[{label:fund,range:[2350,28849],fund:true,round:true,source:'https://zzgjj.zhengzhou.gov.cn/gjjg/10200414.jhtml'}],
  青岛:[{label:fund+'（市辖七区）',range:[2400,34342.75],fund:true,round:true,source:'https://www.qingdao.gov.cn/zwgk/zdgk/fgwj/zcwj/szbmgw/202607/t20260706_10652620.shtml'}],
  成都:[{label:fund+'（城市新区及中心城区）',range:[2330,32969],fund:true,source:'https://hrlib.ciic-cloud.cn/news/info?id=01m0w61940aehp09mac7n49c32'}],
  厦门:[
    {label:social+'（2026 年 10 月起）',range:[4579,22893],source:xiamenSocialSource},
    {label:fund,range:[2265,32937],source:'https://hrlib.ciic-cloud.cn/news/info?id=01m0ywmttrkcqk9ybc6jfytg4g'},
  ],
  北京:[
    {label:social,source:'https://www.beijing.gov.cn/zhengce/zhengcefagui/202608/t20260821_4831679.html'},
    {label:fund,range:[2540,36348],source:'https://www.beijing.gov.cn/fwcj/jiage/zxfb/69c68d72e6316310852dceac.html'},
  ],
  上海:[
    {label:social,range:[7546,37731],source:'https://www.shanghai.gov.cn/nw17239/20260907/5b1efa2a9f004fb0897103bd4f75f559.html'},
    {label:fund,range:[2740,37731],source:'https://www.shanghai.gov.cn/gwk/affairs/content/0064@f3d788ec72e9404ebcbf3d27fda98435'},
  ],
  宁波:[{label:fund+'（市区下限，暂行上限）',range:[2660,38907],fund:true,source:'https://www.haishu.gov.cn/col/col1229100020/art/2026/art_ed8daf35d53e482893accae0bcb57abd.html'}],
  杭州:[{label:fund,range:[2660,42151],source:'https://apiv4.cst123.cn/cst/news/shareDetail?id=1265385379872112640'}],
  深圳:[
    {label:'2026 年职工医保月缴费基数',range:[6727,33633],source:'https://hsa.sz.gov.cn/gkmlpt/content/12/12567/post_12567884.html'},
    {label:fund,range:[2700,48471],source:'https://www.sz.gov.cn/hdjl/ywzsk/jsj/zfgjj/content/post_12893587.html'},
  ],
};

export const CITY_REFERENCES = Object.fromEntries(CITIES.map(({name,province})=>
  [name,[...(regionalReferences[province]??[]),...(localReferences[name]??[])]]));
export const POLICIES = Object.fromEntries(CITIES.flatMap(({name})=>{
  if(Object.hasOwn(establishedPolicies,name))return [[name,establishedPolicies[name]]];
  const references=CITY_REFERENCES[name];
  if(!references.length)return [];
  const base=references.find(entry=>entry.combined)?.range;
  const housing=references.find(entry=>entry.fund);
  return [[name,{social:base,fund:housing?.range,fundRound:housing?.round,notes:'已收录部分当地政策。请手动填写未收录的缴费参数。'}]];
}));
