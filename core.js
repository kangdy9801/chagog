(function (root) {
  const pad = n => String(n).padStart(2, '0');
  // 금액이 비어 있는(NA) 거래는 0원으로 계산
  const net = t => Number(t.amount || 0) - Number(t.discount || 0);
  function period(date, day) {
    let [y, m, d] = date.split('-').map(Number);
    if (d < day) { m--; if (m === 0) { m = 12; y--; } }
    return `${y}-${pad(m)}`;
  }
  const sum = (rows, fn = net) => rows.reduce((a, r) => a + fn(r), 0);
  const special = t => ['이월', '기타'].includes(t.category);
  const monthIndex = key => { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1); };
  function shiftDate(date, months) {
    const [y, m, d] = date.split('-').map(Number);
    const total = y * 12 + (m - 1) + months, ny = Math.floor(total / 12), nm = total % 12 + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(d, new Date(ny, nm, 0).getDate()))}`;
  }

  /**
   * 고정지출: 그 달에 직접 입력·수정한 내역이 있으면 그것을 쓰고,
   * 없으면 가장 가까운 이전 달 내역을 날짜만 옮겨 그대로 적용한다(이번 달까지만).
   */
  function fixedSource(data, key, day, nowKey) {
    const managed = new Set(Object.keys(data.fixedMonths || {}).filter(k => data.fixedMonths[k]));
    for (const t of data.fixed) managed.add(period(t.date, day));
    if (managed.has(key)) return { own: true, from: key };
    if (nowKey && key > nowKey) return { own: false, from: null };
    let from = null;
    for (const k of managed) if (k < key && (!from || k > from)) from = k;
    return { own: false, from };
  }
  function fixedFor(data, key, day, nowKey) {
    const src = fixedSource(data, key, day, nowKey);
    if (src.own) return data.fixed.filter(t => period(t.date, day) === key);
    if (!src.from) return [];
    const diff = monthIndex(key) - monthIndex(src.from);
    return data.fixed.filter(t => period(t.date, day) === src.from).map(t => ({
      ...t,
      id: `${String(t.id).split('~')[0]}~${key}`,
      date: shiftDate(t.date, diff),
      dateInferred: false,
      inherited: src.from,
    }));
  }

  /** 계좌·카드 예산: 그 달 예산이 없으면 가장 가까운 이전 달 예산을 그대로 적용 */
  function budgetsFor(data, key) {
    if (Array.isArray(data.budgets[key])) return { list: data.budgets[key], own: true, from: key };
    let from = null;
    for (const k of Object.keys(data.budgets)) if (k < key && Array.isArray(data.budgets[k]) && (!from || k > from)) from = k;
    return { list: from ? data.budgets[from] : [], own: false, from };
  }

  /** 분류별 입금 금액: 그 달 값이 없으면 가장 가까운 이전 달 값을 그대로 적용 */
  function depositsFor(data, key) {
    const all = data.categoryBudgets || {};
    if (all[key] && typeof all[key] === 'object') return { map: all[key], own: true, from: key };
    let from = null;
    for (const k of Object.keys(all)) if (k < key && all[k] && typeof all[k] === 'object' && (!from || k > from)) from = k;
    return { map: from ? all[from] : {}, own: false, from };
  }

  function stats(data, key, day, nowKey) {
    const inPeriod = rows => rows.filter(t => period(t.date, day) === key);
    const tx = inPeriod(data.transactions), fixed = fixedFor(data, key, day, nowKey), income = inPeriod(data.income);
    return {
      tx, fixed, income,
      variable: sum(tx),
      fixedTotal: sum(fixed),
      savings: sum([...tx, ...fixed].filter(t => t.category === '적금')),
      incomeTotal: sum(income),
      // 그래프는 변동지출만 사용 (고정지출 전체 제외, 변동지출 중 적금도 제외)
      chartVariable: sum(tx.filter(t => t.category !== '적금')),
    };
  }
  function budgetStats(rows, account, amount) {
    const a = rows.filter(t => t.account === account), used = sum(a.filter(t => !special(t))), carry = sum(a.filter(special));
    return { used, carry, remaining: amount - used - carry };
  }

  const api = { version: '2026.10.22-2', net, period, sum, special, stats, budgetStats, fixedFor, fixedSource, budgetsFor, depositsFor, shiftDate };
  if (typeof module !== 'undefined') module.exports = api; else root.Ledger = api;
})(typeof window !== 'undefined' ? window : globalThis);
