const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.join(__dirname, '..');
const Ledger = require('../core.js');
const elems = {};
let saves = 0;
function node(id) {
  if (!elems[id]) {
    elems[id] = { value: '', textContent: '', innerHTML: '', style: {}, hidden: false, disabled: false,
      callbacks: {}, addEventListener(name, fn) { this.callbacks[name] = fn; },
      showModal() {this.open = true;}, close() {this.open = false;}, focus() {},
      setSelectionRange() {}, querySelector() {return null;} };
  }
  return elems[id];
}
node('basis').value = '21';
const window = { Ledger, ChagogImport: { version: Ledger.version }, CloudLedger: { save() { saves++; return true; } } };
class MockFormData {
  constructor(form) { return form.fields || []; }
}
const context = vm.createContext({ window, Ledger, document: { getElementById: node },
  crypto: crypto.webcrypto, FormData: MockFormData, console,
  Intl, Date, Number, String, Object, Array, Math, Set, Map,
  confirm: () => true, alert: () => {}, setTimeout: () => {}, });
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'), context);
const snap = () => JSON.parse(JSON.stringify(window.LedgerApp.snapshot()));
const nav = which => node('nav').onclick({target:{closest: () => ({dataset:{tab:which}})}});
const click = dataset => node('content').onclick({target:{closest: name => name === 'button' ? {dataset} : null}});
const submit = values => {
  node('form').fields = Object.entries(values);
  node('form').onsubmit({preventDefault(){}, target:node('form')});
  assert.equal(node('formError').textContent,'','Form should accept valid values');
};
// The old backup data shape must remain loadable and auto-upgrade to the new optional fields.
const data = {version:1,cycleDay:21,transactions:[
  {id:'expense1', date:'2026-11-20',category:'생활',detail:'식비',card:'국민',account:'국민',amount:100000,discount:0},
  {id:'expense2', date:'2026-11-19',category:'생활',detail:'식비',card:'국민',account:'국민',amount:50000,discount:0},
],fixed:[],income:[],budgets:{'2026-11':[
  {id:'budget1',account:'국민',amount:750000},{id:'budget2',account:'농협',amount:100000},
]},categoryBudgets:{},fixedMonths:{},notes:{}};
window.LedgerApp.replace(data);
node('month').value='2026-11';
nav('cards');
assert.match(node('content').innerHTML,/750,000원/);
assert.equal(snap().periodStarts['2026-11'],undefined);
assert.deepEqual(snap().budgetTransfers,{});

click({action:'transfer-new',from:'국민'});
assert.match(node('fields').innerHTML,/받는 계좌/);
submit({from:'국민',to:'온통대전',amount:'200000'});
let state=snap();
assert.equal(state.budgets['2026-11'][0].amount,750000);
assert.equal(state.budgetTransfers['2026-11'][0].amount,200000);
assert.match(node('content').innerHTML,/550,000원/);
assert.match(node('content').innerHTML,/450,000원/); // 550000 - 100000 used
assert.match(node('content').innerHTML,/온통대전/);
assert.match(node('content').innerHTML,/−200,000원/);
assert.match(node('content').innerHTML,/\+200,000원/);
nav('dashboard');
assert.match(node('content').innerHTML,/450,000원/); // 대시보드 계좌별 잔액에도 같은 이체 계산 적용
nav('cards');

const id=state.budgetTransfers['2026-11'][0].id;
click({transferEdit:id});
submit({from:'국민',to:'온통대전',amount:'150000'});
assert.equal(snap().budgetTransfers['2026-11'][0].amount,150000);
assert.equal(snap().budgets['2026-11'][0].amount,750000);
// A transfer can't be larger than the unspent *allocation* (before expenses).
click({action:'transfer-new',from:'국민'});
node('form').fields=Object.entries({from:'국민',to:'농협',amount:'900000'});
node('form').onsubmit({preventDefault(){},target:node('form')});
assert.match(node('formError').textContent,/옮길 수 있는 예산/);
node('dialog').close();
click({transferDelete:id});
assert.equal(snap().budgetTransfers['2026-11'].length,0);
click({action:'transfer-new',from:'국민'});
submit({from:'국민',to:'온통대전',amount:'200000'});
let rootTransfer=snap().budgetTransfers['2026-11'][0].id;
click({action:'transfer-new',from:'온통대전'});
submit({from:'온통대전',to:'농협',amount:'100000'});
click({transferDelete:rootTransfer});
assert.equal(snap().budgetTransfers['2026-11'].length,2, 'dependent transfer must prevent deleting its funding source');
// Clear records before the period test.
for (const transfer of [...snap().budgetTransfers['2026-11']].reverse()) click({transferDelete:transfer.id});
assert.equal(snap().budgetTransfers['2026-11'].length,0);

node('editPeriod').onclick();
assert.match(node('fields').innerHTML,/시작 날짜/);
submit({start:'2026-11-20',end:'2026-12-21'});
state=snap();
assert.equal(state.periodStarts['2026-11'],'2026-11-20');
assert.equal(state.periodStarts['2026-12'],'2026-12-22');
assert.deepEqual(JSON.parse(JSON.stringify(window.LedgerApp.context())),{
  key:'2026-11',day:21,start:'2026-11-20',end:'2026-12-21',
});
assert.match(node('periodSummary').textContent,/2026\.11\.20 – 2026\.12\.21/);
assert.equal(saves>0,true);

// Manually specified end date moves the next starting boundary, not the existing transactions themselves.
assert.equal(state.transactions[0].date,'2026-11-20');
assert.equal(state.transactions[1].date,'2026-11-19');
node('month').value='2026-10';
nav('transactions');
assert.match(node('content').innerHTML,/50,000원/);
assert.match(node('periodSummary').textContent,/2026\.10\.21 – 2026\.11\.19/);

console.log('PASS: legacy restore, cards UI, transfer create/edit/delete/limit, period form, and selected range');
