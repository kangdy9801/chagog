const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('merge.js', 'utf8'), sandbox);
const merge = sandbox.window.LedgerMerge.mergeDocuments;
const make = (tx = []) => ({ version: 1, transactions: tx, fixed: [], income: [], budgets: {}, categoryBudgets: {}, cycleDay: 21 });
const tx = (id, amount) => ({ id, date: '2026-10-21', category: '생활', amount });
const base = make([tx('old', 100)]);
const left = make([tx('old', 100), tx('a', 200)]);
const right = make([tx('old', 100), tx('b', 300)]);
const merged = merge(base, left, right);
assert.deepEqual(Array.from(merged.transactions, t => t.id), ['old', 'b', 'a']);
assert.equal(merged.transactions.reduce((a, t) => a + t.amount, 0), 600);
// Same record, different fields -> safe to merge.
const fieldLeft = make([{ ...tx('old', 100), note: 'local' }]);
const fieldRight = make([{ ...tx('old', 120) }]);
assert.equal(merge(base, fieldLeft, fieldRight).transactions[0].note, 'local');
assert.equal(merge(base, fieldLeft, fieldRight).transactions[0].amount, 120);
// Same field concurrently edited -> decline, preserve original local state.
assert.equal(merge(base, make([tx('old', 200)]), make([tx('old', 300)])), null);
// Deleted by one account while edited by other -> decline.
assert.equal(merge(base, make([]), make([tx('old', 200)])), null);
// Category budgets changed separately by both users -> merge values.
const budgetBase = make(); budgetBase.categoryBudgets = { '2026-10': { 생활: 100 } };
const budgetLeft = make(); budgetLeft.categoryBudgets = { '2026-10': { 생활: 200 } };
const budgetRight = make(); budgetRight.categoryBudgets = { '2026-10': { 생활: 100, 교통: 500 } };
const budgetMerged = merge(budgetBase, budgetLeft, budgetRight);
assert.equal(budgetMerged.categoryBudgets['2026-10'].생활, 200);
assert.equal(budgetMerged.categoryBudgets['2026-10'].교통, 500);
// Also merge independent accounts within a monthly budget array.
const b0 = make(); b0.budgets = { '2026-10': [{ id: 'k', account: '국민', amount: 100 }] };
const b1 = make(); b1.budgets = { '2026-10': [{ id: 'k', account: '국민', amount: 200 }, { id: 'h', account: '농협', amount: 150 }] };
const b2 = make(); b2.budgets = { '2026-10': [{ id: 'k', account: '국민', amount: 100 }, { id: 'c', account: 'CMA', amount: 100 }] };
assert.deepEqual(Array.from(merge(b0, b1, b2).budgets['2026-10'], v => v.id), ['k', 'c', 'h']);
// Duplicate account names after merging independent additions are NOT safe.
const dup0 = make();
const dup1 = make(); dup1.budgets = { '2026-10': [{ id: 'x', account: '국민', amount: 100 }] };
const dup2 = make(); dup2.budgets = { '2026-10': [{ id: 'y', account: '국민', amount: 200 }] };
assert.equal(merge(dup0, dup1, dup2), null);
// Different cycleDay changes cannot be merged automatically.
const c1 = make(); c1.cycleDay = 1;
const c2 = make(); c2.cycleDay = 21;
assert.equal(merge(make(), c1, c2).cycleDay, 1);
assert.equal(merge(make(), c1, c1).cycleDay, 1);
console.log('PASS: concurrent independent additions, field-level merges, delete/edit conflicts and budgets');
