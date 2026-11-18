// Synthetic fixtures only: no real guest records or workstation-specific paths.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=path.resolve(__dirname,'../src');
global.JSZip=require(path.join(src,'jszip.min.js'));global.sax=require(path.join(src,'sax.js'));
vm.runInThisContext(fs.readFileSync(path.join(src,'ranking-data.js'),'utf8'));
require(path.join(src,'engine.js'));
const api=createWorkbench({headers:Array.from({length:22},(_,i)=>'字段'+i),options:[['中国','挪威','美国'],['意向投资企业','招商合作机构'],['4.外资企业'],[],[]],industryAliases:{},inviters:['市投资促进局','福田区人民政府'],columnWidths:Array(22).fill(20)});
const record=(line,name,title,location='中国',guest='测试嘉宾',unit='市投资促进局')=>{
 const values=Array(22).fill('');Object.assign(values,{1:name,3:location,4:'意向投资企业',5:'4.外资企业',8:guest,9:title,10:'中国',13:unit,16:'是'});return {line,values,section:unit};
};
(async()=>{
 const cases=[
  [record(1,'美威水产(上海)有限公司','总经理','中国','测试嘉宾','福田区人民政府'),record(2,'挪威美威集团','中国区总经理','挪威')],
  [record(1,'百胜中国控股有限公司','百胜中国控股有限公司公共事务总监'),record(2,'百胜餐饮(深圳)有限公司','百胜中国公共事务总监')],
  [record(1,'挪威海风集团','中国区总经理','挪威'),record(2,'海风水产(上海)有限公司','总经理')],
  [record(1,'测试甲集团','市场总监'),record(2,'测试甲集团','战略总监')],
  [record(1,'测试乙集团','总经理'),record(2,'测试乙集团','')],
  [record(1,'测试丙集团','合伙人高级副总裁'),record(2,'测试丙集团','合伙人、高级副总裁')]
 ];
 for(const input of cases){
  const source=JSON.stringify(input),results=[api.process(input),api.process([...input].reverse())];
  assert.equal(JSON.stringify(input),source);
  for(const result of results){
   assert.equal(result.rows.length,1);assert.equal(api.confirmedScope(result,'all').rows.length,api.guestAttendance(result).total);
  }
  assert.deepEqual(results[0].rows[0].values.slice(1,11),results[1].rows[0].values.slice(1,11));
 }
 const mowi=api.process(cases[0]);assert.equal(mowi.rows[0].values[1],'挪威美威集团');assert.equal(mowi.rows[0].values[3],'挪威');assert.equal(mowi.rows[0].values[9],'中国区总经理');
 assert(!mowi.notices.some(n=>n.label==='集团名称与国别不一致'));
 const annotated=record(1,'美威水产(上海)有限公司','总经理');annotated.values[21]='原备注｜待核对：机构性质与集团国别不一致；同集团同名嘉宾已合并，职务差异待核对';assert.equal(api.process([annotated]).rows[0].values[21],'原备注');
 const roles=api.process(cases[3]).rows[0].values[9];assert(roles.includes('市场总监'));assert(roles.includes('战略总监'));
 const distinct=api.process([record(1,'测试甲集团','总经理'),record(2,'测试乙集团','总经理')]);assert.equal(distinct.rows.length,2);assert(distinct.notices.some(n=>n.label.includes('同名嘉宾涉及不同集团')));
 const multiplePeople=api.process([record(1,'美威水产(上海)有限公司','总经理','中国','嘉宾甲'),record(2,'挪威美威集团','董事长','挪威','嘉宾乙')]);assert.equal(multiplePeople.rows.length,2);assert.equal(api.confirmedScope(multiplePeople,'all').confirmedEnterprises.length,1);
 const buf=await api.exportExcel(mowi,'2026-11-19','all');const zip=await JSZip.loadAsync(buf);const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.equal((xml.match(/<row\b/g)||[]).length,api.guestAttendance(mowi).total+1);
 console.log('PASS: parent groups, cross-country subsidiaries, qualified titles, multiple roles, blank titles, punctuation, input order, distinct companies, dashboard/export reconciliation');
})().catch(error=>{console.error(error);process.exitCode=1});
