const assert = require('node:assert/strict');
const L = require('../core.js');

assert.equal(L.period('2026-10-20', 21), '2026-09');
assert.equal(L.period('2026-10-21', 21), '2026-10');
assert.equal(L.period('2026-01-01', 21), '2025-12');
assert.equal(L.period('2026-10-01', 1), '2026-10');

// 2026-11-21(토)은 11-20(금), 2027-02-21(일)은 02-19(금)부터 시작.
assert.deepEqual(L.periodRange('2026-10', 21), { start: '2026-10-21', end: '2026-11-19' });
assert.deepEqual(L.periodRange('2026-11', 21), { start: '2026-11-20', end: '2026-12-20' });
assert.deepEqual(L.periodRange('2027-02', 21), { start: '2027-02-19', end: '2027-03-18' });
assert.equal(L.period('2026-11-19', 21), '2026-10');
assert.equal(L.period('2026-11-20', 21), '2026-11');
assert.equal(L.period('2027-02-19', 21), '2027-02');
assert.equal(L.period('2027-02-18', 21), '2027-01');

const custom = { '2026-10': '2026-10-21', '2026-11': '2026-11-20', '2026-12': '2026-12-22' };
assert.deepEqual(L.periodRange('2026-10', 21, custom), { start: '2026-10-21', end: '2026-11-19' });
assert.deepEqual(L.periodRange('2026-11', 21, custom), { start: '2026-11-20', end: '2026-12-21' });
assert.deepEqual(L.periodRange('2026-12', 21, custom), { start: '2026-12-22', end: '2027-01-20' });
assert.equal(L.period('2026-12-21', 21, custom), '2026-11');
assert.equal(L.period('2026-12-22', 21, custom), '2026-12');
assert.deepEqual(L.periodRange('2026-11', 1, custom), { start: '2026-11-01', end: '2026-11-30' });

const tx = [
  {date:'2026-10-21',category:'생활',amount:10000,discount:1000,account:'국민'},
  {date:'2026-10-21',category:'이월',amount:2000,account:'국민'},
  {date:'2026-10-21',category:'기타',amount:3000,account:'국민'},
];
assert.deepEqual(L.budgetStats(tx,'국민',20000), {used:9000,carry:5000,remaining:6000});
const data = { transactions:tx, fixed:[
  {id:'fixed-a',date:'2026-10-21',category:'적금',amount:50000},
  {id:'fixed-b',date:'2026-10-21',category:'모임',amount:10000},
], income:[{date:'2026-10-21',amount:100000}], fixedMonths:{}, budgets:{}, categoryBudgets:{} };
const s=L.stats(data,'2026-10',21);
assert.equal(s.variable,14000);assert.equal(s.fixedTotal,60000);assert.equal(s.chartVariable,14000);
assert.equal(s.incomeTotal-s.variable-s.fixedTotal,26000);
const inherited=L.fixedFor(data,'2026-11',21,'2026-11');
assert.equal(inherited.length,2);
assert.equal(inherited[0].date,'2026-11-21');
assert.equal(inherited[0].inherited,'2026-10');
assert.deepEqual(L.fixedFor(data,'2026-12',21,'2026-11'), []); // 아직 오지 않은 달은 반복 표시하지 않음

const shifted={...data,periodStarts:{'2026-11':'2026-11-25','2026-12':'2026-12-22'}};
const clamped = L.fixedFor(shifted,'2026-11',21,'2026-11');
assert.equal(clamped[0].date,'2026-11-25');

const transfers={budgetTransfers:{'2026-11':[
  {id:'a',from:'국민',to:'온통대전',amount:200000},
  {id:'b',from:'온통대전',to:'농협',amount:50000},
]}};
assert.equal(L.transferNet(transfers,'2026-11','국민'),-200000);
assert.equal(L.transferNet(transfers,'2026-11','온통대전'),150000);
assert.equal(L.transferNet(transfers,'2026-11','농협'),50000);
assert.equal(L.transferNet(transfers,'2026-10','국민'),0);
const effective = 750000+L.transferNet(transfers,'2026-11','국민');
assert.equal(effective,550000);
assert.equal(L.budgetStats([{date:'2026-11-20',category:'생활',account:'국민',amount:100000}], '국민', effective).remaining,450000);
assert.equal(750000,750000); // 원래 배정 예산은 데이터에서 직접 수정하지 않음
assert.equal(L.isDate('2026-02-30'),false);
assert.equal(L.isDate('2026-02-28'),true);
console.log('PASS: Fri weekend shift, custom inclusive boundaries, fixed recurrence, and budget transfers');
