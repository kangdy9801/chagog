(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const net = t => Number(t.amount || 0) - Number(t.discount || 0);
  const sum = (rows, fn = net) => rows.reduce((a, r) => a + fn(r), 0);
  const special = t => ['이월', '기타'].includes(t.category);
  // '세부 지출 내역'에서 사용하는 월별 변동지출 예산. 기존 분류 예산(categoryBudgets)은
  // 과거 백업 호환성을 위해 그대로 보관하고, 새 예산은 spendingBudgets에 따로 저장한다.
  const SPENDING_DEFAULTS = Object.freeze({ 데이트: 200000, 교통: 200000, 생활비: 300000,
    통신비: 50000, 운동: 150000, 회사: 250000, '그 외': 150000 });
  const SPENDING_CATEGORIES = Object.keys(SPENDING_DEFAULTS);
  function spendingCategory(t) {
    const category = String(t.category || '').trim(), detail = String(t.detail || '').trim();
    if (category === '데이터' || category === '데이트') return '데이트';
    if (category === '교통') return '교통';
    if (category === '통신' || category === '통신비') return '통신비';
    if (category === '운동' || ((category === '생활' || category === '생활비')
      && ['운동', '헬스', '필라테스', '요가', '수영'].some(word => detail.includes(word)))) return '운동';
    if (category === '생활' || category === '생활비') return '생활비';
    if (category === '회사') return '회사';
    return '그 외';
  }
  // 이전 배포본에서 '데이터'로 저장된 사용자의 예산을 읽을 때만 '데이트'로 매핑한다.
  // 실제 저장된 월별 예산과 거래 기록은 변경하지 않아 기존 백업을 보존한다.
  function normalizeSpendingBudget(saved = {}) {
    const map = { ...SPENDING_DEFAULTS, ...saved };
    if (!Object.prototype.hasOwnProperty.call(saved, '데이트')
      && Object.prototype.hasOwnProperty.call(saved, '데이터')) map.데이트 = saved.데이터;
    delete map.데이터;
    return map;
  }
  function spendingBudgetsFor(data, key) {
    const all = data.spendingBudgets || {};
    if (Object.prototype.hasOwnProperty.call(all, key))
      return { map: normalizeSpendingBudget(all[key]), own: true, from: key };
    let from = null;
    for (const k of Object.keys(all)) if (k < key && (!from || k > from)) from = k;
    return { map: normalizeSpendingBudget(from ? all[from] : {}), own: false, from };
  }
  function spendingReport(rows, budgets) {
    const categories = SPENDING_CATEGORIES.map(category => {
      const transactions = rows.filter(t => spendingCategory(t) === category);
      const spent = sum(transactions), budget = Number(budgets[category] || 0);
      const rate = budget ? spent / budget * 100 : spent ? Infinity : 0;
      const status = !spent ? 'unused' : spent > budget ? 'over' : rate >= 80 ? 'warn' : 'ok';
      return { category, transactions, count: transactions.length, spent, budget,
        remaining: budget - spent, rate, status };
    });
    const budget = categories.reduce((n, c) => n + c.budget, 0), spent = sum(rows);
    return { categories, budget, spent, remaining: budget - spent,
      rate: budget ? spent / budget * 100 : spent ? Infinity : 0 };
  }
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
  const api = { version: '2026.11.23-3', SPENDING_DEFAULTS, SPENDING_CATEGORIES, spendingCategory, spendingBudgetsFor, spendingReport, net, period, periodRange, defaultStart, addMonths, addDays, isDate,
    sum, special, stats, budgetStats, budgetIncome, directIncomeAccount, fixedFor, fixedSource, budgetsFor, depositsFor, shiftDate, transferNet };
  if (typeof module !== 'undefined') module.exports = api; else root.Ledger = api;
})(typeof window !== 'undefined' ? window : globalThis);
