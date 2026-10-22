const $ = id => document.getElementById(id);
const { net, period, sum, stats, budgetStats, fixedFor, fixedSource, budgetsFor, depositsFor } = Ledger;
const blank = () => ({ version: 1, transactions: [], fixed: [], income: [], budgets: {}, categoryBudgets: {}, fixedMonths: {}, cycleDay: 21 });
let data = blank(), tab = 'dashboard', mode = 'month', search = '', filter = '', editing = null;
// 변동지출 내역 추가 필터 (카드 · 계좌 · 날짜 범위 · 금액 범위 · 정렬)
const noExtra = () => ({ card: '', account: '', from: '', to: '', min: '', max: '', sort: 'date-desc' });
let extra = noExtra();
const EMPTY = '__EMPTY__';
const SORTS = { 'date-desc': ['최신순', (a, b) => b.date.localeCompare(a.date)], 'date-asc': ['오래된순', (a, b) => a.date.localeCompare(b.date)],
  'amount-desc': ['실지출 큰 순', (a, b) => net(b) - net(a)], 'amount-asc': ['실지출 작은 순', (a, b) => net(a) - net(b)] };
const extraActive = () => Object.entries(extra).some(([k, v]) => v !== noExtra()[k]);
const NA_FILTER = '__NA__';
// 계좌 구분 '기타' = 출장비·부수입 같은 수입으로 따로 충당하는 지출
// → 세부 지출 내역의 분류 합계에서 빠지고, 카드·계좌 예산에서는 '기타' 계좌로 수입과 맞춰 봄
const SIDE_ACCOUNT = '기타';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const money = v => Math.round(v).toLocaleString('ko-KR'), won = v => money(v) + '원';
const key = () => $('month').value, day = () => +$('basis').value, uid = () => crypto.randomUUID();
const colors = ['#38785d', '#a8c78b', '#e4ae96', '#8bacb1', '#c7bd90', '#b6a2bb', '#7c9483', '#d3b2a4'];
const navs = [['dashboard', '▦', '대시보드'], ['transactions', '↗', '변동지출'], ['cards', '▤', '카드·계좌 예산'], ['details', '◷', '세부지출내역'], ['fixed', '▣', '고정지출'], ['income', '↓', '수입 관리']];
const NA = '<span class="na">NA</span>';
const monthLabel = k => `${k.slice(0, 4)}년 ${Number(k.slice(5))}월`;
function nowKey() { const d = new Date(); return period(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day()); }
const monthStats = k => stats(data, k, day(), nowKey());
const yearKeys = () => Array.from({ length: 12 }, (_, i) => `${key().slice(0, 4)}-${pad(i + 1)}`);
// 변동지출 중 아직 비어 있는 칸(NA)이 있는 기록
const incomplete = t => !t.category || !t.detail || t.amount == null || !t.card || !t.account;

$('month').value = nowKey();
$('basis').value = data.cycleDay || 21;

function toast(t) { $('toast').textContent = t; $('toast').style.display = 'block'; setTimeout(() => { $('toast').style.display = 'none'; }, 2500); }
function save() { return window.CloudLedger?.save() || false; }
function range(k) {
  const [y, m] = k.split('-').map(Number), end = day() === 1 ? new Date(y, m, 0) : new Date(y, m, 20);
  return `${y}.${pad(m)}.${pad(day())} – ${end.getFullYear()}.${pad(end.getMonth() + 1)}.${pad(end.getDate())}`;
}
function panel(title, body, sub = '', action = '') { return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>${body}</section>`; }
function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">아직 기록이 없어요. 첫 내역을 추가해 보세요.</td></tr>`}</tbody></table></div>`; }
function metric(label, v, sub, feature = false) { return `<article class="metric ${feature ? 'featured' : ''}"><label>${label}</label><strong>${money(v)}<em>원</em></strong><p>${sub}</p></article>`; }
function aggregate() {
  const list = yearKeys().map(monthStats);
  return { tx: list.flatMap(x => x.tx), fixed: list.flatMap(x => x.fixed), income: list.flatMap(x => x.income), ...Object.fromEntries(['variable', 'fixedTotal', 'incomeTotal', 'savings', 'chartVariable'].map(k => [k, list.reduce((a, x) => a + x[k], 0)])) };
}
// 고정지출을 모임 / 적금 / 주식 / 그 외로 나눔
const FIXED_PARTS = ['모임', '적금', '주식'];
function fixedParts(rows) {
  const out = Object.fromEntries([...FIXED_PARTS, '그 외'].map(k => [k, 0]));
  rows.forEach(t => { out[FIXED_PARTS.includes(t.category) ? t.category : '그 외'] += net(t); });
  return out;
}
const fixedPartsText = p => FIXED_PARTS.map(k => `${k} ${won(p[k])}`).join(' · ') + (p['그 외'] ? ` · 그 외 ${won(p['그 외'])}` : '');
function groups(rows) { const out = {}; rows.forEach(t => { const c = t.category || 'NA'; out[c] = (out[c] || 0) + net(t); }); return Object.entries(out).sort((a, b) => b[1] - a[1]); }

// 그래프: 변동지출만 (고정지출 전체 제외, 적금 분류 제외)
function donut(rows) {
  const g = groups(rows.filter(t => t.category !== '적금')).filter(x => x[1] > 0), total = g.reduce((a, x) => a + x[1], 0);
  let at = 0;
  const gradient = g.map(([, n], i) => { const start = at; at += n / total * 100; return `${colors[i % colors.length]} ${start}% ${at}%`; }).join(',');
  return `<div class="donut-wrap"><div class="donut" style="background:${total ? `conic-gradient(${gradient})` : '#edf1ea'}"><div><span>변동지출</span><strong>${money(total)}</strong><span>원</span></div></div><div class="donut-key">${g.map(([k, n], i) => `<div class="key-row"><span><i class="dot" style="background:${colors[i % colors.length]}"></i>${esc(k)}</span><b>${(n / total * 100).toFixed(1)}%</b></div>`).join('') || '<p>기록을 추가하면<br>지출 비중이 표시돼요.</p>'}</div></div>`;
}
function annualChart() {
  const months = yearKeys().map(monthStats), max = Math.max(1, ...months.map(s => s.chartVariable));
  return `<div class="legend"><span><i class="dot" style="background:#38785d"></i>변동지출 · 고정지출 제외</span></div><div class="chart">${months.map((s, i) => `<div class="bar-col"><div class="bars"><div class="bar" title="${i + 1}월 변동지출 ${won(s.chartVariable)}" style="height:${s.chartVariable / max * 150}px;background:#38785d"></div></div><span>${i + 1}월</span></div>`).join('')}</div>`;
}
function annualTable() {
  const months = yearKeys().map(k => { const st = monthStats(k); return { st, p: fixedParts(st.fixed) }; });
  const other = months.some(m => m.p['그 외']);
  const head = ['월 / 시작 월 기준', '수입', '변동지출', ...FIXED_PARTS, ...(other ? ['고정 · 그 외'] : []), '고정지출 합계', '월 잔액'];
  return table(head, months.map(({ st: s, p }, i) => {
    const left = s.incomeTotal - s.variable - s.fixedTotal;
    return `<tr><td>${i + 1}월</td><td>${won(s.incomeTotal)}</td><td>${won(s.variable)}</td>${FIXED_PARTS.map(k => `<td>${won(p[k])}</td>`).join('')}${other ? `<td>${won(p['그 외'])}</td>` : ''}<td>${won(s.fixedTotal)}</td><td class="${left < 0 ? 'negative' : ''}">${won(left)}</td></tr>`;
  }).join(''));
}

function renderDashboard(s) {
  const a = mode === 'year' ? aggregate() : s;
  let html = `<div class="panel-head"><div><h2>${mode === 'year' ? key().slice(0, 4) + '년 한눈에 보기' : Number(key().slice(5)) + '월의 흐름'}</h2><p>${mode === 'year' ? '1월~12월 · 선택한 집계 기준 적용' : range(key())}</p></div><div><button data-mode="month" class="${mode === 'month' ? 'primary' : ''}">월간</button> <button data-mode="year" class="${mode === 'year' ? 'primary' : ''}">연간</button></div></div>`;
  html += `<div class="cards">${metric('총 수입', a.incomeTotal, '수입 내역 자동 합산')}${metric('변동지출', a.variable, '결제 금액 − 할인 및 엔빵')}${metric('고정지출', a.fixedTotal, fixedPartsText(fixedParts(a.fixed)))}${metric('남은 금액', a.incomeTotal - a.variable - a.fixedTotal, '수입 − 변동지출 − 고정지출', true)}</div>`;
  html += `<div class="grid">${panel('월별 지출 흐름', annualChart(), key().slice(0, 4) + '년 · 변동지출 기준 (고정지출·적금 제외)')}${panel('지출 비중', donut(a.tx), '변동지출 기준 · 고정지출 제외')}</div>`;
  if (mode === 'year') html += panel('월간 현황표', annualTable(), '월은 집계 기간의 시작 월로 표시합니다.');
  else html += panel('월간 현황표', table(['항목', '금액', '집계 기준'], [
    ['이번 달 일반 사용', sum(s.tx.filter(t => !Ledger.special(t))), '이월·기타 제외'],
    ['이월·기타', sum(s.tx.filter(Ledger.special)), '분류가 이월 또는 기타인 거래'],
    ...(() => { const p = fixedParts(s.fixed); return [...FIXED_PARTS.map(k => [`고정지출 · ${k}`, p[k], `분류가 ${k}인 고정지출`]), ...(p['그 외'] ? [['고정지출 · 그 외', p['그 외'], '모임·적금·주식 외 고정지출']] : [])]; })(),
    ['고정지출 합계', s.fixedTotal, '매월 자동 적용 · 그래프 제외'],
  ].map(r => `<tr><td>${r[0]}</td><td>${won(r[1])}</td><td>${r[2]}</td></tr>`).join('')), range(key()));
  return html;
}

function renderList(s, nav) {
  const listKey = tab === 'transactions' ? 'tx' : tab, all = s[listKey];
  const matches = t => (!filter || (filter === NA_FILTER ? incomplete(t) : (t.category || 'NA') === filter)) &&
    (!search || [t.category, t.detail, t.card, t.account, t.note, t.date].join(' ').toLowerCase().includes(search.toLowerCase()));
  const isTx = tab === 'transactions';
  const pick = (value, chosen) => !chosen || (chosen === EMPTY ? !value : value === chosen);
  const matchesExtra = t => !isTx || (pick(t.card, extra.card) && pick(t.account, extra.account)
    && (!extra.from || t.date >= extra.from) && (!extra.to || t.date <= extra.to)
    && (extra.min === '' || (t.amount != null && net(t) >= +extra.min)) && (extra.max === '' || (t.amount != null && net(t) <= +extra.max)));
  const rows = all.filter(t => matches(t) && matchesExtra(t)).sort(isTx ? SORTS[extra.sort][1] : SORTS['date-desc'][1]);
  const cats = [...new Set(data[tab].map(t => t.category || 'NA'))];
  let html = '';

  if (tab === 'transactions') {
    const missing = all.filter(incomplete);
    if (missing.length) html += `<div class="notice">아직 비어 있는(NA) 칸이 있는 기록이 <b>${missing.length}건</b> 있어요. 금액이 NA인 기록은 0원으로 계산돼요. <button data-action="show-na">NA 기록만 보기</button></div>`;
  }
  if (tab === 'fixed') {
    const src = fixedSource(data, key(), day(), nowKey());
    if (!src.own && src.from) html += `<div class="notice"><b>${monthLabel(src.from)}</b> 고정지출을 이 달에도 그대로 적용하고 있어요. 수정·삭제·추가하면 이 달 내역으로 저장되고, 다음 달부터는 바뀐 내용이 이어서 적용돼요.</div>`;
    else if (!src.own && key() > nowKey()) html += `<div class="notice">아직 시작되지 않은 달이에요. 이 달이 되면 지난달 고정지출이 자동으로 채워져요.</div>`;
    else if (src.own) html += `<div class="notice">이 달 고정지출은 다음 달에도 그대로 이어서 적용돼요. 금액이 바뀌는 달에만 그 달에서 수정하면 돼요.</div>`;
  }

  let cards = metric('선택 월 합계', sum(all), range(key()), true);
  if (tab === 'fixed') {
    const p = fixedParts(all);
    cards += FIXED_PARTS.map(k => metric(k, p[k], k === '주식' && p['그 외'] ? `그 외 고정지출 ${won(p['그 외'])}` : '고정지출 · 그래프 제외')).join('');
  } else {
    cards += metric('현재 조회 합계', sum(rows), rows.length + '건');
    if (tab === 'transactions') cards += metric('할인 및 엔빵', sum(rows, t => +t.discount || 0), '실지출에서 자동 차감');
  }
  html += `<div class="cards">${cards}</div>`;

  const filterOptions = `<option value="">전체 분류</option>${tab === 'transactions' ? `<option value="${NA_FILTER}" ${filter === NA_FILTER ? 'selected' : ''}>NA(미입력) 있는 기록만</option>` : ''}${cats.map(c => `<option value="${esc(c)}" ${filter === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
  const head = tab === 'transactions' ? ['날짜', '구분', '지출 내역', '결제 금액', '할인·엔빵', '실지출', '카드', '계좌', '비고', '관리']
    : tab === 'income' ? ['날짜', '구분', '내역', '금액', '입금 수단', '계좌', '비고', '관리'] : ['날짜', '구분', '내역', '금액', '결제수단', '비고', '관리'];
  const body = rows.map(t => {
    const isTx = tab === 'transactions';
    const cell = (v, empty) => (v ? esc(v) : empty);
    return `<tr><td>${esc(t.date)}${t.dateInferred ? ' *' : ''}${t.inherited ? ' <span class="muted" title="지난달에서 자동 적용">↻</span>' : ''}</td>`
      + `<td>${t.category ? `<span class="tag">${esc(t.category)}</span>` : NA}</td>`
      + `<td>${cell(t.detail, isTx ? NA : '')}</td>`
      + `<td>${t.amount == null ? NA : won(t.amount)}</td>`
      + (isTx ? `<td>${won(t.discount || 0)}</td><td><b>${t.amount == null ? NA : won(net(t))}</b></td>` : '')
      + `<td>${cell(t.card, isTx ? NA : '—')}</td>`
      + (isTx ? `<td>${cell(t.account, NA)}</td>` : tab === 'income' ? `<td>${cell(t.account, '—')}</td>` : '')
      + `<td>${cell(t.note, '—')}</td>`
      + `<td><button data-edit="${esc(t.id)}">수정</button><button data-delete="${esc(t.id)}">삭제</button></td></tr>`;
  }).join('');
  let filterBar = `<div class="filters"><input id="search" placeholder="내역, 카드, 비고 검색" value="${esc(search)}" aria-label="내역 검색"><select id="filter" aria-label="분류 필터">${filterOptions}</select></div>`;
  if (isTx) {
    const choices = (field, label) => {
      const values = [...new Set(all.map(t => t[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
      return `<select data-extra="${field}" aria-label="${label} 필터"><option value="">전체 ${label}</option>${values.map(v => `<option value="${esc(v)}" ${extra[field] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}${all.some(t => !t[field]) ? `<option value="${EMPTY}" ${extra[field] === EMPTY ? 'selected' : ''}>${label} NA</option>` : ''}</select>`;
    };
    const [start, end] = range(key()).split(' – ').map(x => x.replaceAll('.', '-'));
    filterBar += `<div class="filters extra-filters">${choices('card', '카드')}${choices('account', '계좌')}`
      + `<label>날짜<input type="date" data-extra="from" value="${esc(extra.from)}" min="${start}" max="${end}" aria-label="시작 날짜"><span>~</span><input type="date" data-extra="to" value="${esc(extra.to)}" min="${start}" max="${end}" aria-label="끝 날짜"></label>`
      + `<label>실지출<input type="number" min="0" step="1000" data-extra="min" value="${esc(extra.min)}" placeholder="최소" aria-label="최소 실지출"><span>~</span><input type="number" min="0" step="1000" data-extra="max" value="${esc(extra.max)}" placeholder="최대" aria-label="최대 실지출"></label>`
      + `<select data-extra="sort" aria-label="정렬">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}" ${extra.sort === k ? 'selected' : ''}>${label}</option>`).join('')}</select>`
      + (extraActive() || filter || search ? `<button data-action="reset-filters">필터 초기화</button>` : '') + `</div>`;
  }
  html += panel(nav[2] + ' 내역', filterBar + table(head, body),
    tab === 'fixed' ? `현재 조회 ${rows.length}건 · ${won(sum(rows))} · ↻ 표시는 지난달에서 자동 적용된 항목이에요.` : '* 원본 날짜가 없는 항목은 해당 시트 시작일로 배정했습니다.', `<button data-action="import-rows">📋 엑셀 가져오기</button>`);
  return html;
}

function renderCards(s) {
  const b = budgetsFor(data, key()), budgets = b.list;
  // 수입에 계좌 구분을 넣으면(예: 출장비 → 기타) 그 계좌에 들어온 돈으로 함께 계산
  const incomeIn = acc => sum(s.income.filter(t => t.account === acc));
  const incomeOnly = [...new Set(s.income.map(t => t.account).filter(a => a && !budgets.some(x => x.account === a)))];
  const known = acc => budgets.some(x => x.account === acc) || incomeOnly.includes(acc);
  const missing = s.tx.filter(t => !known(t.account));
  let html = `<div class="notice">엑셀과 동일하게 <b>계좌 구분</b>으로 합산합니다. 이월·기타는 거래의 분류를 기준으로 자동 계산하며, 전월 잔여 예산을 자동으로 더하지 않습니다. 출장비·부수입처럼 <b>계좌 구분을 ‘기타’로 넣은 수입</b>은 기타 계좌의 쓸 수 있는 돈으로 잡혀요.</div>`;
  if (!b.own && b.from) html += `<div class="notice"><b>${monthLabel(b.from)}</b> 예산을 이 달에도 그대로 적용하고 있어요. 수정·삭제·추가하면 이 달부터 바뀐 예산이 적용되고 다음 달에도 이어져요.</div>`;
  else if (b.own && budgets.length) html += `<div class="notice">이 달 예산은 다음 달에도 그대로 이어서 적용돼요. 바뀌는 달에만 그 달에서 수정하면 돼요.</div>`;
  const row = (account, amount, manage) => {
    const r = budgetStats(s.tx, account, amount), inc = incomeIn(account), remaining = r.remaining + inc;
    return `<tr><td><b>${esc(account)}</b></td><td>${won(amount)}</td><td>${inc ? won(inc) : '<span class="muted">-</span>'}</td><td>${won(r.used)}</td><td>${won(r.carry)}</td><td class="${remaining < 0 ? 'negative' : ''}"><b>${won(remaining)}</b></td><td>${manage}</td></tr>`;
  };
  html += panel('카드·계좌별 예산', table(['계좌 / 결제수단', '배정 예산', '수입 입금', '이번 달 사용', '이월·기타', '잔여 예산', '관리'],
    budgets.map(x => row(x.account, x.amount, `<button data-edit="${esc(x.id)}">수정</button><button data-delete="${esc(x.id)}">삭제</button>`)).join('')
    + incomeOnly.map(a => row(a, 0, '<span class="muted">수입으로 충당</span>')).join('')),
  '잔여 예산 = 배정 예산 + 수입 입금 − 이번 달 사용 − 이월·기타');
  if (missing.length) html += `<div class="notice">예산에 연결되지 않은 거래 ${missing.length}건 · ${won(sum(missing))}. 거래의 계좌 구분을 수정하거나 해당 계좌의 예산을 추가해 주세요.</div>`;
  html += panel('실제 카드별 사용 내역', table(['카드', '건수', '실지출'], [...new Set(s.tx.map(t => t.card || ''))].map(c => {
    const rows = s.tx.filter(t => (t.card || '') === c);
    return `<tr><td>${c ? esc(c) : NA}</td><td>${rows.length}건</td><td>${won(sum(rows))}</td></tr>`;
  }).join('')), '입력된 카드 구분으로 자동 집계');
  return html;
}

// ---------- 세부지출내역: 월간·연간 비교 ----------
// 비교는 변동지출 기준(적금 분류 제외 · 고정지출 제외), 그래프와 같은 기준
let compareBase = 'avg12';
const addMonths = (k, n) => { const [y, m] = k.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
function monthCats(k) {
  const rows = monthStats(k).tx.filter(t => t.category !== '적금'), cats = {};
  rows.forEach(t => { const c = t.category || 'NA'; cats[c] = (cats[c] || 0) + net(t); });
  return { key: k, total: sum(rows), cats, has: rows.length > 0 };
}
const BASES = {
  prev: ['지난달', k => [addMonths(k, -1)]],
  avg3: ['최근 3개월 평균', k => [1, 2, 3].map(i => addMonths(k, -i))],
  avg12: ['최근 12개월 평균', k => Array.from({ length: 12 }, (_, i) => addMonths(k, -i - 1))],
  lastyear: ['작년 같은 달', k => [addMonths(k, -12)]],
};
/** 비교 기준: 평균은 기록이 있는 달만으로 계산(가계부 시작 전 빈 달은 제외) */
function baseline(name, k) {
  const months = BASES[name][1](k).map(monthCats).filter(m => m.has), n = months.length, cats = {};
  months.forEach(m => Object.entries(m.cats).forEach(([c, v]) => { cats[c] = (cats[c] || 0) + v / n; }));
  return { label: BASES[name][0], n, total: n ? months.reduce((a, m) => a + m.total, 0) / n : null, cats };
}
function diffText(now, base) {
  if (base == null) return '<span class="muted">비교할 기록 없음</span>';
  const d = now - base, pct = base ? Math.round(d / base * 100) : null;
  if (Math.round(d) === 0) return '차이 없음';
  return `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${won(Math.abs(d))}${pct == null ? '' : ` (${Math.abs(pct)}%)`}</span> ${d > 0 ? '더 씀' : '덜 씀'}`;
}
function compareCards(cur) {
  const b = Object.keys(BASES).filter(x => x !== 'avg3').map(x => [x, baseline(x, key())]);
  return `<div class="cards">${metric(`${Number(key().slice(5))}월 변동지출`, cur.total, '적금·고정지출 제외', true)}${b.map(([, v]) =>
    metric(v.label, v.total ?? 0, `이번 달은 ${diffText(cur.total, v.total)}${v.n > 1 ? ` · ${v.n}개월 기준` : ''}`)).join('')}</div>`;
}
function trendChart(cur) {
  const months = Array.from({ length: 12 }, (_, i) => monthCats(addMonths(key(), i - 11)));
  const avg = baseline('avg12', key()).total;   // 위 카드의 '최근 12개월 평균'과 같은 값
  const max = Math.max(1, avg || 0, ...months.map(m => m.total));
  return `<div class="legend"><span><i class="dot" style="background:#38785d"></i>이번 달</span><span><i class="dot" style="background:#a8c78b"></i>이전 달</span>${avg != null ? `<span><i class="avg-key"></i>최근 12개월 평균 ${won(avg)}</span>` : ''}</div>`
    + `<div class="chart">${months.map((m, i) => `<div class="bar-col"><div class="bars">${avg != null ? `<i class="avg-mark" style="bottom:${avg / max * 150}px"></i>` : ''}<div class="bar" title="${m.key.replace('-', '년 ')}월 ${won(m.total)}" style="height:${m.total / max * 150}px;background:${i === 11 ? '#38785d' : '#a8c78b'}"></div></div><span>${Number(m.key.slice(5))}월</span></div>`).join('')}</div>`;
}
function categoryCompare(cur) {
  const b = baseline(compareBase, key());
  const select = `<select id="compareBase" aria-label="비교 기준">${Object.entries(BASES).map(([k, [label]]) => `<option value="${k}" ${compareBase === k ? 'selected' : ''}>${label}과 비교</option>`).join('')}</select>`;
  const cats = [...new Set([...Object.keys(cur.cats), ...Object.keys(b.cats)])].sort((x, y) => (cur.cats[y] || 0) - (cur.cats[x] || 0) || (b.cats[y] || 0) - (b.cats[x] || 0));
  const max = Math.max(1, ...cats.flatMap(c => [cur.cats[c] || 0, b.cats[c] || 0]));
  const rows = b.n ? cats.map(c => {
    const now = cur.cats[c] || 0, base = b.cats[c] || 0;
    return `<tr><td>${c === 'NA' ? NA : `<span class="tag">${esc(c)}</span>`}</td><td><b>${won(now)}</b></td><td>${won(base)}</td><td>${diffText(now, base)}</td>`
      + `<td class="compare-bars"><div class="cbar now" style="width:${now / max * 100}%"></div><div class="cbar base" style="width:${base / max * 100}%"></div></td></tr>`;
  }).join('') + `<tr class="totals"><td>합계</td><td>${won(cur.total)}</td><td>${won(b.total)}</td><td>${diffText(cur.total, b.total)}</td><td></td></tr>` : '';
  const body = b.n ? table(['분류', '이번 달', b.label, '차이', '<span class="cbar-key now"></span>이번 달 <span class="cbar-key base"></span>비교'], rows)
    : `<p class="empty">${b.label}에 해당하는 이전 기록이 아직 없어요. 다른 비교 기준을 골라 보세요.</p>`;
  return panel('분류별 비교', body, `이번 달과 ${b.label}${b.n > 1 ? `(${b.n}개월)` : ''}을 분류별로 비교 · 평균은 기록이 있는 달만 계산`, select);
}

// ---------- 세부 지출 내역 (엑셀 표 형식) ----------
// 분류 → 세부 사용 내역 기본 목록. 기록에 새 세부 내역이 생기면 자동으로 아래에 추가됨
const DETAIL_TEMPLATE = [
  ['교통', ['기름', '대중교통', '하이패스', '주차', '기타']],
  ['데이트', ['식비', '카페', '여행', '기타']],
  ['통신', ['휴대폰']],
  ['생활', ['식비', '카페', '병원', '공부', '운동', '편의점', '친목', '기타', '생활용품', '여행', '선물']],
  ['회사', ['식비', '카페', '편의점', '간식', '기타']],
  ['이벤트', ['결혼', '장례식', '생일', '주디', '차량정비', '기타']],
  ['이월', ['할부', '기타']],
  ['기타', ['기타']],
];
const dash = v => (Math.round(v) ? won(v) : '<span class="muted">-</span>');
function detailCategories(rows, deposits) {
  const list = DETAIL_TEMPLATE.map(([c, d]) => [c, [...d]]);
  const find = c => list.find(x => x[0] === c);
  for (const t of rows) {
    const c = t.category || 'NA', d = t.detail || 'NA';
    if (!find(c)) list.push([c, []]);
    if (!find(c)[1].includes(d)) find(c)[1].push(d);
  }
  for (const c of Object.keys(deposits)) if (!find(c)) list.push([c, ['기타']]);
  return list;
}
function detailTable(s) {
  const dep = depositsFor(data, key()), deposits = dep.map;
  const cats = detailCategories(s.tx, deposits);
  const inCat = (c, d) => s.tx.filter(t => (t.category || 'NA') === c && (d == null || (t.detail || 'NA') === d));
  const spent = (c, d) => sum(inCat(c, d));
  // 분류 합계는 계좌 구분이 '기타'(출장비 등 수입으로 충당)인 기록을 뺀 금액
  let totalSpent = 0, totalDeposit = 0, totalNet = 0;
  const body = cats.map(([c, details]) => {
    const refund = sum(inCat(c).filter(t => t.account === SIDE_ACCOUNT)), catSpent = spent(c) - refund;
    const deposit = Number(deposits[c] || 0), pct = deposit ? catSpent / deposit * 100 : 0;
    totalSpent += spent(c); totalNet += catSpent; totalDeposit += deposit;
    return details.map((d, i) => `<tr class="${i === 0 ? 'cat-first' : ''}">`
      + (i === 0 ? `<td rowspan="${details.length}" class="cat-cell">${c === 'NA' ? NA : `<span class="tag">${esc(c)}</span>`}</td>` : '')
      + `<td>${d === 'NA' ? NA : esc(d)}</td><td class="num">${dash(spent(c, d))}</td>`
      + (i === 0 ? `<td rowspan="${details.length}" class="num cat-cell">${dash(deposit)}</td><td rowspan="${details.length}" class="num cat-cell"><b>${dash(catSpent)}</b>${refund ? `<div class="muted refund-note">계좌 기타 ${won(refund)} 제외</div>` : ''}${deposit ? `<div class="progress${catSpent > deposit ? ' over' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div><span class="muted ${catSpent > deposit ? 'up' : ''}">${Math.round(pct)}% 사용</span>` : ''}</td>` : '')
      + `</tr>`).join('');
  }).join('') + `<tr class="totals"><td colspan="2">합계</td><td class="num">${won(totalSpent)}</td><td class="num">${won(totalDeposit)}</td><td class="num">${won(totalNet)}</td></tr>`;
  const note = !dep.own && dep.from ? ` · 입금 금액은 ${monthLabel(dep.from)} 값을 이어서 적용 중` : '';
  return panel('세부 지출 내역', `<div class="table-wrap"><table class="detail-table"><thead><tr><th>사용 내역</th><th>세부 사용 내역</th><th class="num">지출 금액</th><th class="num">입금 금액</th><th class="num">지출 금액 (분류 합계)</th></tr></thead><tbody>${body}</tbody></table></div>`,
    `지출 금액은 변동지출 기록에서 자동 합산 · 분류 합계는 계좌 구분 ‘기타’(출장비 등 수입으로 충당) 제외 · 입금 금액은 직접 입력(다음 달에도 이어서 적용)${note}`, `<button data-action="deposit">입금 금액 편집</button>`);
}

function renderDetails(s) {
  const cur = monthCats(key());
  let html = detailTable(s);
  html += compareCards(cur);
  html += `<div class="grid">${panel('월별 추이', trendChart(cur), '최근 12개월 변동지출 · 점선은 지난 12개월 평균')}${panel('분류별 지출 비중', donut(s.tx), '변동지출 기준 · 적금 제외')}</div>`;
  html += categoryCompare(cur);
  return html;
}

function render() {
  const nav = navs.find(n => n[0] === tab);
  $('title').textContent = nav[2];
  $('subtitle').textContent = tab === 'dashboard' ? '기록은 간단하게, 돈의 흐름은 한눈에.' : range(key()) + ' · 입력 즉시 모든 현황에 반영됩니다.';
  $('nav').innerHTML = navs.map(([id, icon, label]) => `<button data-tab="${id}" class="${id === tab ? 'active' : ''}">${icon}　${label}</button>`).join('');
  $('add').textContent = tab === 'cards' ? '＋ 계좌 예산' : tab === 'fixed' ? '＋ 고정지출' : tab === 'income' ? '＋ 수입 기록' : '＋ 지출 기록';
  const s = monthStats(key());
  let html = '';
  if (!data.transactions.length && !data.fixed.length && !data.income.length) html += `<div class="notice"><b>나의 가계부를 시작해 보세요.</b> ‘데이터 불러오기’에서 백업 JSON 파일을 선택하면 기존 기록이 연결됩니다. <button data-action="import">불러오기</button></div>`;
  if (tab === 'dashboard') html += renderDashboard(s);
  else if (['transactions', 'fixed', 'income'].includes(tab)) html += renderList(s, nav);
  else if (tab === 'cards') html += renderCards(s);
  else html += renderDetails(s);
  $('content').innerHTML = html;
}

// ---------- 이 달 내역으로 고정(materialize) ----------
// 지난달에서 이어받아 보이는 고정지출·예산을 수정하려면, 먼저 이 달 내역으로 복사한다.
function ownFixedMonth() {
  const k = key(), src = fixedSource(data, k, day(), nowKey());
  if (!src.own) {
    for (const t of fixedFor(data, k, day(), nowKey())) {
      const { inherited, ...row } = t;
      data.fixed.push(row);
    }
  }
  (data.fixedMonths ??= {})[k] = true;
}
function ownBudgets() {
  const k = key(), b = budgetsFor(data, k);
  if (!b.own) data.budgets[k] = JSON.parse(JSON.stringify(b.list));
  return data.budgets[k];
}

// ---------- 입력 폼 ----------
const SUGGEST = {
  transactions: ['생활', '교통', '데이트', '회사', '통신', '이벤트', '이월', '기타'],
  fixed: ['적금', '주식', '모임', '통신', '보험', '월세', '구독'],
  income: ['급여', '출장비', '부수입', '용돈', '이자', '환급', '기타'],
};
function openDepositForm() {
  editing = { id: null, type: 'deposit' };
  const s = monthStats(key()), deposits = depositsFor(data, key()).map;
  $('dialogTitle').textContent = `입금 금액 · ${monthLabel(key())}`;
  $('fields').innerHTML = detailCategories(s.tx, deposits).filter(([c]) => c !== 'NA').map(([c]) =>
    `<label>${esc(c)}<input name="dep:${esc(c)}" type="number" min="0" step="1" value="${Number(deposits[c] || 0)}"></label>`).join('')
    + `<p class="muted" style="grid-column:1/-1">이 달부터 적용되고, 다음 달에도 같은 금액이 이어서 적용돼요. 이전 달은 바뀌지 않아요.</p>`;
  $('formError').textContent = '';
  $('dialog').showModal();
}
function openForm(id = null, type = tab) {
  if (type === 'deposit') return openDepositForm();
  if (!['transactions', 'fixed', 'income', 'cards'].includes(type)) type = 'transactions';
  editing = { id, type };
  const s = monthStats(key());
  let row = type === 'cards' ? budgetsFor(data, key()).list.find(x => x.id === id)
    : type === 'fixed' ? s.fixed.find(x => x.id === id)
      : data[type].find(x => x.id === id);
  row = row || {};
  const tx = type === 'transactions';
  $('dialogTitle').textContent = (id ? '수정' : '추가') + ' · ' + ({ transactions: '변동지출', fixed: '고정지출', income: '수입', cards: '계좌 예산' }[type]);
  // 변동지출은 날짜 외에 모두 비워 둘 수 있음(NA) → 나중에 수정해서 채우기
  const f = (name, label, t = 'text', v = '', { list = '', required = false, placeholder = '' } = {}) =>
    `<label>${label}<input name="${name}" type="${t}" value="${esc(v)}" ${required ? 'required' : ''} ${t === 'number' ? 'min="0" step="1"' : ''} ${list ? `list="${list}"` : ''} ${placeholder ? `placeholder="${placeholder}"` : ''}></label>`;
  const opt = { placeholder: tx ? 'NA (나중에 입력)' : '' };
  let fields = '';
  if (type === 'cards') fields = f('account', '계좌명', 'text', row.account || '', { required: true }) + f('amount', '배정 예산', 'number', row.amount ?? 0, { required: true });
  else {
    fields = f('date', '날짜', 'date', row.date || `${key()}-${pad(day())}`, { required: true })
      + f('category', '구분', 'text', row.category || '', { list: 'categories', required: !tx, ...opt })
      + f('detail', '세부 내역', 'text', row.detail || '', opt)
      + f('amount', tx ? '결제 금액' : '금액', 'number', id ? (row.amount ?? '') : (tx ? '' : 0), { required: !tx, ...opt });
    if (tx) fields += f('discount', '할인 및 엔빵', 'number', row.discount || 0);
    fields += f('card', '카드 / 결제수단', 'text', row.card || '', { list: 'cardsList', ...opt });
    if (tx) fields += f('account', '계좌 구분', 'text', row.account || '', { list: 'accounts', ...opt });
    if (type === 'income') fields += f('account', '계좌 구분 (출장비·부수입은 기타)', 'text', row.account || '', { list: 'accounts' });
    fields += f('note', '비고', 'text', row.note || '');
  }
  const cats = type === 'cards' ? [] : [...new Set([...SUGGEST[type], ...data[type].map(t => t.category).filter(Boolean)])];
  fields += `<datalist id="categories">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist><datalist id="accounts">${[...new Set([...budgetsFor(data, key()).list.map(b => b.account), SIDE_ACCOUNT])].map(a => `<option value="${esc(a)}">`).join('')}</datalist><datalist id="cardsList">${[...new Set(data.transactions.map(t => t.card).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  $('fields').innerHTML = fields;
  $('formError').textContent = '';
  $('dialog').showModal();
}

$('form').onsubmit = e => {
  e.preventDefault();
  const { id, type } = editing, tx = type === 'transactions';
  const values = Object.fromEntries(new FormData(e.target));
  if (type === 'deposit') {
    const next = {};
    for (const [k, v] of Object.entries(values)) if (k.startsWith('dep:') && +v > 0) next[k.slice(4)] = Math.round(+v);
    if (Object.values(values).some(v => v !== '' && (!Number.isFinite(+v) || +v < 0))) return void ($('formError').textContent = '입금 금액은 0 이상의 숫자로 입력해 주세요.');
    data.categoryBudgets[key()] = next;
    save(); $('dialog').close(); render(); toast('입금 금액을 저장했어요. 다음 달에도 이어서 적용돼요.');
    return;
  }
  for (const k of ['category', 'account', 'detail', 'card', 'note']) if (k in values) values[k] = values[k].trim();
  if ('amount' in values) values.amount = values.amount === '' ? (tx ? null : 0) : +values.amount;
  if ('discount' in values) values.discount = values.discount === '' ? 0 : +values.discount;
  if (type === 'cards' && !values.account) return void ($('formError').textContent = '계좌명은 공백일 수 없습니다.');
  if (!tx && type !== 'cards' && !values.category) return void ($('formError').textContent = '구분은 공백일 수 없습니다.');
  if (values.amount != null && values.discount > values.amount) return void ($('formError').textContent = '할인 및 엔빵은 결제 금액을 초과할 수 없습니다.');
  if (type === 'cards') {
    const arr = ownBudgets();
    if (arr.some(b => b.account === values.account && b.id !== id)) return void ($('formError').textContent = '같은 계좌의 예산이 이미 있습니다.');
    const index = arr.findIndex(x => x.id === id);
    if (index >= 0) arr[index] = { ...arr[index], ...values }; else arr.push({ ...values, id: uid() });
  } else {
    if (type === 'fixed') ownFixedMonth();
    const arr = data[type], index = arr.findIndex(x => x.id === id);
    if (index >= 0) arr[index] = { ...arr[index], ...values, dateInferred: false };
    else arr.push({ ...values, id: uid() });
  }
  save();
  $('dialog').close();
  render();
  toast(tx && incomplete(values) ? '저장했어요. 비어 있는 칸은 NA로 남겨 두었어요.' : '저장했습니다.');
};

$('close').onclick = () => $('dialog').close();
$('add').onclick = () => openForm();
$('nav').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; search = ''; filter = ''; extra = noExtra(); render(); } };
$('content').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) { mode = b.dataset.mode; render(); }
  if (b.dataset.edit) openForm(b.dataset.edit);
  if (b.dataset.delete && confirm('이 내역을 삭제할까요?')) {
    let arr;
    if (tab === 'cards') arr = ownBudgets();
    else { if (tab === 'fixed') ownFixedMonth(); arr = data[tab]; }
    const index = arr.findIndex(x => x.id === b.dataset.delete);
    if (index >= 0) arr.splice(index, 1);
    save();
    render();
  }
  if (b.dataset.action === 'show-na') { filter = NA_FILTER; render(); }
  if (b.dataset.action === 'deposit') openForm(null, 'deposit');
  if (b.dataset.action === 'import-rows') window.ChagogImport?.open(tab);
  if (b.dataset.action === 'reset-filters') { search = ''; filter = ''; extra = noExtra(); render(); }
  if (b.dataset.action === 'import') $('file').click();
};
$('content').oninput = e => { if (e.target.id === 'search') { const pos = e.target.selectionStart; search = e.target.value; render(); $('search').focus(); $('search').setSelectionRange(pos, pos); } };
$('content').onchange = e => {
  if (e.target.id === 'filter') { filter = e.target.value; render(); }
  if (e.target.id === 'compareBase') { compareBase = e.target.value; render(); }
  const field = e.target.dataset.extra;
  if (field) { extra[field] = e.target.value; render(); $('content').querySelector(`[data-extra="${field}"]`)?.focus(); }
};
$('month').onchange = () => { if (!/^\d{4}-\d{2}$/.test(key())) $('month').value = nowKey(); extra.from = extra.to = ''; render(); };
$('basis').onchange = () => { data.cycleDay = day(); save(); render(); };
for (const [id, offset] of [['prev', -1], ['next', 1]]) $(id).onclick = () => {
  const [y, m] = key().split('-').map(Number), d = new Date(y, m - 1 + offset, 1);
  $('month').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  extra.from = extra.to = '';
  render();
};
$('backup').onclick = () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `차곡-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  toast('백업을 다운로드했습니다.');
};
$('restore').onclick = () => $('file').click();

function validate(d) {
  if (d.version !== 1 || ![1, 21].includes(d.cycleDay) || !d.budgets || typeof d.budgets !== 'object' || Array.isArray(d.budgets) || !d.categoryBudgets || typeof d.categoryBudgets !== 'object') throw Error('지원하지 않는 백업 형식입니다.');
  const dateOK = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  for (const k of ['transactions', 'fixed', 'income']) {
    if (!Array.isArray(d[k])) throw Error('거래 목록이 없습니다.');
    const ids = new Set();
    for (const t of d[k]) {
      // 변동지출은 금액을 비워 둘 수 있음(NA = null)
      const amountOK = Number.isFinite(t.amount) && t.amount >= 0 || (k === 'transactions' && t.amount === null);
      const discountOK = t.discount == null || (Number.isFinite(t.discount) && t.discount >= 0 && (t.amount === null || t.discount <= t.amount));
      if (typeof t.id !== 'string' || ids.has(t.id) || !dateOK(t.date) || typeof t.category !== 'string' || !amountOK || !discountOK) throw Error('날짜, 금액 또는 ID가 잘못된 거래가 있습니다.');
      ids.add(t.id);
      for (const f of ['detail', 'card', 'note', 'account']) if (t[f] != null && typeof t[f] !== 'string') throw Error('문자 필드 형식이 잘못되었습니다.');
      delete t.reimburse;   // 예전 버전의 '환급 예정' 표시는 더 이상 쓰지 않음
    }
  }
  for (const [k, rows] of Object.entries(d.budgets)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k) || !Array.isArray(rows)) throw Error('예산 형식 오류');
    const names = new Set();
    for (const b of rows) {
      if (typeof b.id !== 'string' || typeof b.account !== 'string' || names.has(b.account) || !Number.isFinite(b.amount) || b.amount < 0) throw Error('계좌 예산 오류');
      names.add(b.account);
    }
  }
  for (const [k, rows] of Object.entries(d.categoryBudgets)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k) || !rows || typeof rows !== 'object' || Object.values(rows).some(v => !Number.isFinite(v) || v < 0)) throw Error('분류 예산 오류');
  }
  if (d.fixedMonths == null) d.fixedMonths = {};
  if (typeof d.fixedMonths !== 'object' || Array.isArray(d.fixedMonths) || Object.entries(d.fixedMonths).some(([k, v]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(k) || typeof v !== 'boolean')) throw Error('고정지출 월 정보 오류');
  return d;
}
$('file').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = validate(JSON.parse(await f.text()));
    if ((data.transactions.length || data.fixed.length || data.income.length) && !confirm('현재 데이터를 백업 파일 내용으로 교체할까요? 먼저 데이터 백업을 권장합니다.')) return;
    data = d;
    $('basis').value = data.cycleDay;
    save();
    render();
    toast('백업 파일의 기록을 불러왔습니다.');
  } catch (err) { alert('불러오기 실패: ' + err.message); } finally { e.target.value = ''; }
};
render();

window.LedgerApp = {
  empty: blank,
  snapshot: () => JSON.parse(JSON.stringify(data)),
  replace: d => { data = validate(d); $('basis').value = data.cycleDay; render(); },
  // 엑셀 가져오기(importer.js)용
  context: () => ({ key: key(), day: day() }),
  existing: type => JSON.parse(JSON.stringify(data[type] || [])),
  importRows(type, rows) {
    const next = JSON.parse(JSON.stringify(data));
    next[type].push(...rows.map(r => ({ ...r, id: uid() })));
    data = validate(next);   // 형식이 맞는지 한 번 더 확인한 뒤 반영
    save();
    render();
    const months = [...new Set(rows.map(r => period(r.date, day())))].sort();
    toast(`${rows.length}건을 가져왔어요${months.length ? ` (${months.map(monthLabel).join(', ')})` : ''}.`);
  },
};
