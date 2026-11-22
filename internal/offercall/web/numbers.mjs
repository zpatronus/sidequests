const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)\s*(万元|万|w|k|元)?|(\*\*|[+\-*/^()]))/iy;
const rateFields = new Set(['fundRate','supplement','employerFund','employerSupplement','socialRate','employerSocial','probationRate']);

export function hasMoneyUnit(value) {
  return /万|元|w|k/i.test(String(value??'').normalize('NFKC'));
}

export function amount(value) {
  const source=String(value??'').normalize('NFKC').trim()
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'')
    .replace(/[×✕]/g,'*').replace(/÷/g,'/').replace(/[−–]/g,'-').replace(/[¥￥]\s*(?=\d|\.)/g,'');
  if(!source || source.length>256)return null;
  const tokens=[];
  let cursor=0;
  while(cursor<source.length){
    tokenPattern.lastIndex=cursor;
    const token=tokenPattern.exec(source);
    if(!token)return null;
    if(token[1]!==undefined){
      tokens.push(Number(token[1])*(/万|w/i.test(token[2]??'')?10000:/k/i.test(token[2]??'')?1000:1));
    }else{
      tokens.push(token[3]);
    }
    cursor=tokenPattern.lastIndex;
  }

  let next=0;
  function primary(){
    const token=tokens[next++];
    if(typeof token==='number')return token;
    if(token!=='(')throw new SyntaxError();
    const value=expression();
    if(tokens[next++]!==')')throw new SyntaxError();
    return value;
  }
  function unary(){
    const op=tokens[next];
    if(op==='+'||op==='-'){
      next++;
      const value=unary();
      return op==='-'?-value:value;
    }
    const value=primary();
    if(tokens[next]!=='^'&&tokens[next]!=='**')return value;
    next++;
    return value**unary();
  }
  function product(){
    let value=unary();
    while(tokens[next]==='*'||tokens[next]==='/'){
      const op=tokens[next++];
      const right=unary();
      value=op==='*'?value*right:value/right;
      if(!Number.isFinite(value))throw new RangeError();
    }
    return value;
  }
  function expression(){
    let value=product();
    while(tokens[next]==='+'||tokens[next]==='-'){
      const op=tokens[next++];
      const right=product();
      value=op==='+'?value+right:value-right;
    }
    return value;
  }
  try{
    const result=expression();
    return next===tokens.length && Number.isFinite(result) && result>=0 && result<=1e12 ? result : null;
  }catch{return null;}
}

export function invalidNumber(key,value) {
  if(!String(value??'').trim())return false;
  const result=amount(value);
  return result===null || (rateFields.has(key)&&result>100) || (key==='workDays'&&(result<=0||result>7));
}
