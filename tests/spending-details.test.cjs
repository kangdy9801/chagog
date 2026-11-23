const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const Ledger = require('../core.js');
const root = path.join(__dirname, '..');
const expected = { 데이트: 200000, 교통: 200000, 생활비: 300000, 통신비: 50000, 운동: 150000, 회사: 250000, '그 외': 150000 };
assert.deepEqual(Ledger.SPENDING_DEFAULTS, expected);
assert.equal(Ledger.spendingReport([], expected).budget, 1300000);
const tx = [
  ['1','생활','식비',50000,5000,'국민','국민'],
  ['2','생활','운동',150000,0,'국민','국민'],
  ['3','데이트','카페',220000,0,'국민','국민'],
  ['4','기타','기타',10000,0,'기타','기타'],
  ['5','교통','주유',195000,0,'국민','국민'],
  ['6','통신','핸드폰',60000,0,'국민','국민'],
  ['7','회사','점심',100000,0,'국민','국민'],
  ['8','','',null,0,'',''],
].map(([id,category,detail,amount,discount,card,account]) => ({ id, date:'2026-11-22', category, detail, amount, discount,card,account,note:id==='1'?'구내식당':'' }));
const report = Ledger.spendingReport(tx, expected);
assert.equal(report.spent, 780000);
assert.equal(report.remaining, 520000);
assert.equal(report.categories.find(c => c.category === '생활비').spent, 45000);
assert.equal(report.categories.find(c => c.category === '운동').spent, 150000);
assert.equal(report.categories.find(c => c.category === '데이트').spent, 220000);
assert.equal(report.categories.find(c => c.category === '그 외').count, 2);
assert.equal(report.categories.find(c => c.category === '그 외').spent, 10000);
assert.equal(report.categories.find(c => c.category === '데이트').status,'over');
assert.equal(report.categories.find(c => c.category === '교통').status,'warn');
assert.equal(report.categories.find(c => c.category === '생활비').status,'ok');
const initial = { version:1, cycleDay:21, transactions:tx, fixed:[],income:[],budgets:{},categoryBudgets:{},fixedMonths:{},notes:{} };
const nodes = {};
function node(id) {
  if (!nodes[id]) nodes[id] = {value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,style:{},listeners:{},
    addEventListener(type,handler){this.listeners[type]=handler;},showModal(){this.open=true;},close(){this.open=false;},
    focus(){},setSelectionRange(){},querySelector(){return null;}};
  return nodes[id];
}
node('basis').value='21';
let saves = 0;
const window = { Ledger, ChagogImport:{version:Ledger.version},CloudLedger:{save(){saves++;return true;}} };
class MockFormData { constructor(form){return form.fields||[];} }
const context=vm.createContext({window,Ledger,document:{getElementById:node},crypto:crypto.webcrypto,FormData:MockFormData,
  console,Intl,Date,Number,String,Object,Array,Math,Set,Map,confirm:()=>true,alert:()=>{},setTimeout:()=>{}});
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
const snapshot=()=>JSON.parse(JSON.stringify(window.LedgerApp.snapshot()));
window.LedgerApp.replace(initial); // 2026.11 previous backup doesn't contain spendingBudgets
assert.deepEqual(snapshot().spendingBudgets,{});
node('month').value='2026-11';
const nav=tab=>node('nav').onclick({target:{closest:()=>({dataset:{tab}})}});
const click=dataset=>node('content').onclick({target:{closest:selector=>selector==='button'?{dataset}:null}});
const change=(id,value)=>node('content').onchange({target:{id,value,dataset:{}}});
const submit=fields=>{
  node('form').fields=Object.entries(fields);
  node('form').onsubmit({preventDefault(){},target:node('form')});
};
nav('details');
let html=node('content').innerHTML;
assert.match(html,/변동지출 예산 한눈에 보기/);
assert.match(html,/1,300,000원/);
assert.match(html,/780,000원/);
assert.match(html,/520,000원/);
assert.match(html,/데이트/);
assert.doesNotMatch(html,/원래 분류: 데이트/);
assert.match(html,/월 예산/);
assert.equal((html.match(/<details class="spending-item/g)||[]).length,7);
assert.equal((html.match(/data-spending-group="/g)||[]).length,7);
assert.doesNotMatch(html,/월별 추이|입금 금액 편집|분류별 비교/);
assert.match(html,/220,000원/);
// 새 분류는 기존 데이트 거래를 원래 분류로 중복 표기하지 않는다.
assert.match(html,/구내식당/);
assert.match(html,/할인·엔빵 5,000원/);
change('spendingStatusFilter','over');
html=node('content').innerHTML;
assert.equal((html.match(/<details class="spending-item/g)||[]).length,2);
change('spendingCategoryFilter','교통');
assert.equal((node('content').innerHTML.match(/<details class="spending-item/g)||[]).length,0);
click({action:'spending-reset'});
// Search must only display categories with matching transactions, without changing summary totals.
node('content').oninput({target:{id:'spendingSearch',value:'구내식당',selectionStart:4}});
assert.equal((node('content').innerHTML.match(/<details class="spending-item/g)||[]).length,1);
assert.match(node('content').innerHTML,/780,000원/);
click({action:'spending-reset'});
change('spendingCategoryFilter','운동');
html=node('content').innerHTML;
assert.equal((html.match(/<details class="spending-item/g)||[]).length,1);
assert.match(html,/150,000원/);
const toggle=node('content').listeners.toggle;
assert.equal(typeof toggle,'function');
toggle({target:{matches:()=>true,open:true,dataset:{spendingGroup:'2026-11:운동'}}});
change('spendingSort','spent');
assert.match(node('content').innerHTML,/data-spending-group="2026-11:운동" open/);
click({action:'spending-expand'});
click({action:'spending-reset'});
assert.equal((node('content').innerHTML.match(/data-spending-group="[^"]+" open/g)||[]).length,7);
click({action:'spending-collapse'});
assert.equal((node('content').innerHTML.match(/data-spending-group="[^"]+" open/g)||[]).length,0);
click({action:'spending-budget'});
assert.match(node('fields').innerHTML,/spend:생활비/);
submit({...Object.fromEntries(Object.entries(expected).map(([category,amount])=>['spend:'+category,String(amount)])), 'spend:운동':'0','spend:회사':'300000'});
assert.equal(node('formError').textContent,'');
assert.equal(snapshot().spendingBudgets['2026-11'].운동,0);
assert.equal(snapshot().spendingBudgets['2026-11'].회사,300000);
assert.ok(saves>0);
assert.match(node('content').innerHTML,/1,200,000원/); // 1,300,000 - 150,000 + 50,000
assert.equal(Ledger.spendingBudgetsFor(snapshot(),'2026-12').map.회사,300000);
assert.equal(Ledger.spendingBudgetsFor(snapshot(),'2026-10').map.회사,250000);
click({action:'spending-budget'});
submit({'spend:운동':'-1'});
assert.match(node('formError').textContent,/0원 이상의 정수/);
assert.equal(snapshot().spendingBudgets['2026-11'].운동,0);
// 과거 배포판에서 '데이터'라는 이름으로 저장한 예산의 호환성 검증.
const legacyBudget = { '2026-11': { 데이터: 245000, 교통: 210000 } };
assert.equal(Ledger.spendingBudgetsFor({spendingBudgets:legacyBudget},'2026-11').map.데이트,245000);
assert.equal(Ledger.spendingBudgetsFor({spendingBudgets:legacyBudget},'2026-12').map.데이트,245000);
assert.equal(Ledger.spendingBudgetsFor({spendingBudgets:legacyBudget},'2026-10').map.데이트,200000);
assert.equal(Ledger.spendingBudgetsFor({spendingBudgets:{'2026-11':{데이터:245000,데이트:270000}}},'2026-11').map.데이트,270000);
window.LedgerApp.replace({...initial,spendingBudgets:legacyBudget});
nav('details');
assert.match(node('content').innerHTML,/245,000원/);
click({action:'spending-budget'});
assert.match(node('fields').innerHTML,/name="spend:데이트"[^>]*value="245000"/);
submit({...Object.fromEntries(Object.entries(expected).map(([category,amount])=>['spend:'+category,String(amount)])), 'spend:데이트':'260000'});
assert.equal(snapshot().spendingBudgets['2026-11'].데이트,260000);
assert.equal(Object.hasOwn(snapshot().spendingBudgets['2026-11'],'데이터'),false);
assert.equal(Ledger.spendingBudgetsFor(snapshot(),'2026-12').map.데이트,260000);
assert.equal(snapshot().transactions.find(t=>t.id==='3').category,'데이트');
console.log('PASS: 7-category spending budget, legacy naming/budget compatibility, dashboard basis, filters, accordion state and editing');
