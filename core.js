(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const net = t => Number(t.amount || 0) - Number(t.discount || 0);
  const sum = (rows, fn = net) => rows.reduce((a, r) => a + fn(r), 0);
  const special = t => ['이월', '기타'].includes(t.category);
  const monthIndex = key => { const [y, m] = key.split('-').map(Number); return y * 12 + m - 1; };
  function addMonths(key, offset) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  function addDays(date, days) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  function isDate(date) {
    return typeof date === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)
      && addDays(date, 0) === date;
  }
  // 한국 달력의 21일이 토요일·일요일이면 직전 금요일로 당김.
  function defaultStart(key, day = 21) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, day));
    const weekday = d.getUTCDay();
    if (day === 21 && (weekday === 0 || weekday === 6)) d.setUTCDate(d.getUTCDate() - (weekday === 6 ? 1 : 2));
    return d.toISOString().slice(0, 10);
  }
  /** 사용자 기간은 달별 '시작 날짜'로 보존. 종료일은 다음 달 시작 전날이므로 중복 집계되지 않음. */
  function periodRange(key, day = 21, starts = {}) {
    const next = addMonths(key, 1), custom = day === 21 ? starts : {};
    const start = custom?.[key] || defaultStart(key, day);
    const end = addDays(custom?.[next] || defaultStart(next, day), -1);
    return { start, end };
  }
  function period(date, day = 21, starts = {}) {
    const base = date.slice(0, 7);
    if (day === 1) return base;
    for (let n = -2; n <= 1; n++) {
      const key = addMonths(base, n), r = periodRange(key, day, starts);
      if (r.start <= date && date <= r.end) return key;
    }
    // 정상이면 모든 날짜가 정확히 하나의 기간에 속함.
    return date < periodRange(base, day, starts).start ? addMonths(base, -1) : base;
  }
  function shiftDate(date, months) {
    const [y, m, d] = date.split('-').map(Number);
    const total = y * 12 + m - 1 + months, ny = Math.floor(total / 12), nm = total % 12 + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate()))}`;
  }
  /** 고정지출은 해당 기간을 직접 편집한 뒤에는 그 달 값, 아니면 이전 달 템플릿을 적용. */
  function fixedSource(data, key, day, nowKey) {
    const managed = new Set(Object.keys(data.fixedMonths || {}).filter(k => data.fixedMonths[k]));
    for (const t of data.fixed) managed.add(period(t.date, day, data.periodStarts));
    if (managed.has(key)) return { own: true, from: key };
    if (nowKey && key > nowKey) return { own: false, from: null };
    let from = null;
    for (const k of managed) if (k < key && (!from || k > from)) from = k;
    return { own: false, from };
  }
  function fixedFor(data, key, day, nowKey) {
    const src = fixedSource(data, key, day, nowKey);
    if (src.own) return data.fixed.filter(t => period(t.date, day, data.periodStarts) === key);
    if (!src.from) return [];
    const diff = monthIndex(key) - monthIndex(src.from), { start, end } = periodRange(key, day, data.periodStarts);
    return data.fixed.filter(t => period(t.date, day, data.periodStarts) === src.from).map(t => {
      // 매월 같은 날짜를 우선하고, 해당 월의 사용자 지정 기간을 벗어나면 경계 날짜로 보정.
      const shifted = shiftDate(t.date, diff);
      return { ...t, id: `${String(t.id).split('~')[0]}~${key}`,
        date: shifted < start ? start : shifted > end ? end : shifted,
        dateInferred: false, inherited: src.from };
    });
  }
  function budgetsFor(data, key) {
    if (Array.isArray(data.budgets[key])) return { list: data.budgets[key], own: true, from: key };
    let from = null;
    for (const k of Object.keys(data.budgets)) if (k < key && Array.isArray(data.budgets[k]) && (!from || k > from)) from = k;
    return { list: from ? data.budgets[from] : [], own: false, from };
  }
  function depositsFor(data, key) {
    const all = data.categoryBudgets || {};
    if (all[key] && typeof all[key] === 'object') return { map: all[key], own: true, from: key };
    let from = null;
    for (const k of Object.keys(all)) if (k < key && all[k] && typeof all[k] === 'object' && (!from || k > from)) from = k;
    return { map: from ? all[from] : {}, own: false, from };
  }
  function stats(data, key, day, nowKey) {
    const { start, end } = periodRange(key, day, data.periodStarts);
    const inPeriod = rows => rows.filter(t => t.date >= start && t.date <= end);
    const tx = inPeriod(data.transactions), fixed = fixedFor(data, key, day, nowKey), income = inPeriod(data.income);
    return {
      tx, fixed, income, variable: sum(tx), fixedTotal: sum(fixed),
      savings: sum([...tx, ...fixed].filter(t => t.category === '적금')),
      incomeTotal: sum(income), chartVariable: sum(tx.filter(t => t.category !== '적금')),
    };
  }
  function budgetStats(rows, account, amount) {
    const a = rows.filter(t => t.account === account), used = sum(a.filter(t => !special(t))), carry = sum(a.filter(special));
    return { used, carry, remaining: amount - used - carry };
  }
  /**
   * 급여는 기존처럼 월간 예산을 배분할 때 사용하고, 급여 외 수입(이월 포함)은
   * 수입 관리에서 지정한 계좌의 사용 가능 예산에 직접 반영한다.
   * '기타' 계좌는 구버전 기록과의 호환을 위해 구분과 관계없이 직접 반영한다.
   * 계좌가 비어 있는 수입은 임의 계좌로 배정하지 않고 일반 수입에 남겨 둔다.
   */
  function directIncomeAccount(t) {
    const account = String(t.account || '').trim(), category = String(t.category || '').trim();
    return account && (account === '기타' || (category && category !== '급여')) ? account : null;
  }
  function budgetIncome(rows) {
    const byAccount = Object.create(null);
    let main = 0;
    for (const t of rows) {
      const account = directIncomeAccount(t);
      if (account) byAccount[account] = (byAccount[account] || 0) + net(t);
      else main += net(t);
    }
    return { main, byAccount };
  }
  /** 이체는 지출·수입이나 최초 배정 예산에 더하지 않고, 계좌 사이 가용액만 이동한다. */
  function transferNet(data, key, account) {
    return (data.budgetTransfers?.[key] || []).reduce((v, t) => v + (t.to === account ? t.amount : 0) - (t.from === account ? t.amount : 0), 0);
  }
  const api = { version: '2026.11.23-1', net, period, periodRange, defaultStart, addMonths, addDays, isDate,
    sum, special, stats, budgetStats, budgetIncome, directIncomeAccount, fixedFor, fixedSource, budgetsFor, depositsFor, shiftDate, transferNet };
  if (typeof module !== 'undefined') module.exports = api; else root.Ledger = api;
})(typeof window !== 'undefined' ? window : globalThis);
