const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs'),ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('core.js','utf8'),ctx);const L=ctx.Ledger;
assert.equal(L.period('2026-10-20',21),'2026-09');assert.equal(L.period('2026-10-21',21),'2026-10');assert.equal(L.period('2026-01-01',21),'2025-12');assert.equal(L.period('2026-10-01',1),'2026-10');
const tx=[{date:'2026-10-21',category:'생활',amount:10000,discount:1000,account:'국민'},{date:'2026-10-21',category:'이월',amount:2000,account:'국민'},{date:'2026-10-21',category:'기타',amount:3000,account:'국민'}];
assert.equal(JSON.stringify(L.budgetStats(tx,'국민',20000)),JSON.stringify({used:9000,carry:5000,remaining:6000}));
const d={transactions:tx,fixed:[{date:'2026-10-21',category:'적금',amount:50000},{date:'2026-10-21',category:'모임',amount:10000}],income:[{date:'2026-10-21',amount:100000}]};
const s=L.stats(d,'2026-10',21);assert.equal(s.variable,14000);assert.equal(s.fixedTotal,60000);assert.equal(s.chartFixed,10000);assert.equal(s.incomeTotal-s.variable-s.fixedTotal,26000);console.log('PASS: period boundaries, net, carryover, savings exclusion, balance');
