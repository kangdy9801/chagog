const APP_VERSION = '2026.10.22-5';   // core.js · importer.js 와 같은 값이어야 함
const $ = id => document.getElementById(id);
const { net, period, sum, stats, budgetStats, fixedFor, fixedSource, budgetsFor, depositsFor } = Ledger;
const blank = () => ({ version: 1, transactions: [], fixed: [], income: [], budgets: {}, categoryBudgets: {}, fixedMonths: {}, notes: {}, cycleDay: 21 });
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
// 오늘 날짜(YYYY-MM-DD, 로컬 시간 기준)
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nowKey() { return period(todayStr(), day()); }
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
// 분류별 색: 전체 기록에서 많이 쓴 순서대로 고정 → 어느 달·어느 그래프에서도 같은 분류는 같은 색
const palette = [...colors, '#5f8f9e', '#c99b7c', '#9fb8a0', '#b3a46f', '#a07f9e', '#6f8b6b'];
let colorOrder = null;
function categoryColor(c) {
  if (!colorOrder) colorOrder = groups(data.transactions.filter(t => t.category !== '적금')).map(([k]) => k);
  let i = colorOrder.indexOf(c);
  if (i < 0) { colorOrder.push(c); i = colorOrder.length - 1; }
  return palette[i % palette.length];
}
/** 도넛 그래프 공통: entries = [[이름, 금액], ...] (큰 순서) */
function donutChart(entries, center, colorOf, showAmount = false) {
  const g = entries.filter(x => x[1] > 0), total = g.reduce((a, x) => a + x[1], 0);
  let at = 0;
  const gradient = g.map(([k, n], i) => { const start = at; at += n / total * 100; return `${colorOf(k, i)} ${start}% ${at}%`; }).join(',');
  return `<div class="donut-wrap"><div class="donut" style="background:${total ? `conic-gradient(${gradient})` : '#edf1ea'}"><div><span>${esc(center)}</span><strong>${money(total)}</strong><span>원</span></div></div><div class="donut-key${showAmount ? ' with-amount' : ''}">${g.map(([k, n], i) => `<div class="key-row"><span><i class="dot" style="background:${colorOf(k, i)}"></i>${esc(k)}</span>${showAmount ? `<small>${won(n)}</small>` : ''}<b>${(n / total * 100).toFixed(1)}%</b></div>`).join('') || '<p>기록을 추가하면<br>지출 비중이 표시돼요.</p>'}</div></div>`;
}
function donut(rows) {
  const g = groups(rows.filter(t => t.category !== '적금')).filter(x => x[1] > 0), total = g.reduce((a, x) => a + x[1], 0);
  let at = 0;
  const gradient = g.map(([, n], i) => { const start = at; at += n / total * 100; return `${categoryColor(g[i][0])} ${start}% ${at}%`; }).join(',');
  return `<div class="donut-wrap"><div class="donut" style="background:${total ? `conic-gradient(${gradient})` : '#edf1ea'}"><div><span>변동지출</span><strong>${money(total)}</strong><span>원</span></div></div><div class="donut-key">${g.map(([k, n], i) => `<div class="key-row"><span><i class="dot" style="background:${categoryColor(k)}"></i>${esc(k)}</span><b>${(n / total * 100).toFixed(1)}%</b></div>`).join('') || '<p>기록을 추가하면<br>지출 비중이 표시돼요.</p>'}</div></div>`;
}
let selSeg = null;   // 월별 지출 흐름에서 누른 색: { k: 'YYYY-MM', c: 분류 }
function segmentInfo() {
  if (!selSeg || !yearKeys().includes(selSeg.k)) return '<p class="muted seg-hint">막대의 색을 누르면 그 달 그 분류에 얼마를 썼는지 나와요.</p>';
  const all = monthStats(selSeg.k).tx.filter(t => t.category !== '적금'), rows = all.filter(t => (t.category || 'NA') === selSeg.c);
  const total = sum(rows), monthTotal = sum(all), details = {};
  rows.forEach(t => { const d = t.detail || 'NA'; details[d] = (details[d] || 0) + net(t); });
  const top = Object.entries(details).sort((a, b) => b[1] - a[1]);
  return `<div class="seg-info"><span class="dot" style="background:${categoryColor(selSeg.c)}"></span><div><b>${Number(selSeg.k.slice(5))}월 · ${esc(selSeg.c)} ${won(total)}</b> <span class="muted">그 달 변동지출의 ${monthTotal ? (total / monthTotal * 100).toFixed(1) : 0}% · ${rows.length}건</span>`
    + `<p>${top.slice(0, 5).map(([d, n]) => `${esc(d)} ${won(n)}`).join(' · ')}${top.length > 5 ? ` 외 ${top.length - 5}개` : ''}</p></div><button data-action="seg-close" aria-label="닫기">✕</button></div>`;
}
function annualChart() {
  // 월별 막대를 분류별 색으로 쌓아서 표시 (지출 비중과 같은 색)
  const months = yearKeys().map(k => groups(monthStats(k).tx.filter(t => t.category !== '적금')).filter(x => x[1] > 0));
  const totals = months.map(g => g.reduce((a, x) => a + x[1], 0)), max = Math.max(1, ...totals);
  const order = c => { categoryColor(c); return colorOrder.indexOf(c); };
  const present = [...new Set(months.flatMap(g => g.map(x => x[0])))].sort((a, b) => order(a) - order(b));
  const legend = present.length ? present.map(c => `<span><i class="dot" style="background:${categoryColor(c)}"></i>${esc(c)}</span>`).join('') : '<span>변동지출 · 고정지출 제외</span>';
  return `<div class="legend wrap">${legend}</div><div class="chart">${months.map((g, i) => {
    const segs = [...g].sort((a, b) => order(a[0]) - order(b[0]));
    return `<div class="bar-col"><div class="bars"><div class="bar stack" title="${i + 1}월 변동지출 ${won(totals[i])}" style="height:${totals[i] / max * 150}px">${segs.map(([c, n]) => `<i data-seg="${yearKeys()[i]}|${esc(c)}" class="${selSeg && selSeg.k === yearKeys()[i] && selSeg.c === c ? 'sel' : ''}" title="${i + 1}월 ${esc(c)} ${won(n)}" style="height:${n / totals[i] * 100}%;background:${categoryColor(c)}"></i>`).join('')}</div></div><span>${i + 1}월</span></div>`;
  }).join('')}</div>${segmentInfo()}`;
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

// ---------- 대시보드: 이번 달 한눈에 ----------
/** 집계 기간 안에서 얼마나 지났는지 (0~1), 남은 일수 */
function periodPace(k) {
  const now = nowKey();
  if (k < now) return { pace: 1, left: 0, done: true };
  if (k > now) return { pace: 0, left: null, done: false };
  const [y, m] = k.split('-').map(Number), start = new Date(y, m - 1, day()), end = new Date(y, m, day());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const total = Math.round((end - start) / 864e5), passed = Math.round((today - start) / 864e5) + 1;
  return { pace: Math.min(1, passed / total), left: Math.max(0, total - passed), done: false };
}
/** 분류별: 이번 달 사용(계좌 기타 제외) · 입금 금액(예산) · 평소(최근 12개월 평균) · 상태 */
function categoryHealth(k) {
  const st = monthStats(k), deposits = depositsFor(data, k).map, avg = baseline('avg12', k).cats, { pace } = periodPace(k);
  const spentOf = c => sum(st.tx.filter(t => (t.category || 'NA') === c && t.account !== SIDE_ACCOUNT && t.category !== '적금'));
  const cats = [...new Set([...Object.keys(deposits).filter(c => Number(deposits[c]) > 0), ...st.tx.filter(t => t.category !== '적금').map(t => t.category || 'NA')])];
  return cats.map(c => {
    const spent = spentOf(c), budget = Number(deposits[c] || 0), usual = avg[c] || 0, ratio = budget ? spent / budget : null;
    let status = 'ok';
    if (budget) {
      if (ratio > 1) status = 'over';
      else if (ratio > 0.9 || (pace < 1 && ratio > pace + 0.2)) status = 'warn';
      else if (pace >= 0.5 && ratio < pace - 0.3) status = 'spare';
    } else if (usual && spent > usual * 1.3 && spent - usual > 10000) status = 'warn';
    return { c, spent, budget, usual, ratio, status };
  }).filter(x => x.spent || x.budget).sort((a, b) => ['over', 'warn', 'ok', 'spare'].indexOf(a.status) - ['over', 'warn', 'ok', 'spare'].indexOf(b.status) || b.spent - a.spent);
}
/** 계좌별 잔액 (카드·계좌 예산과 같은 계산) */
function accountHealth(st, k) {
  const budgets = budgetsFor(data, k).list, sideIn = sum(st.income.filter(t => t.account === SIDE_ACCOUNT));
  const rows = budgets.map(x => ({ account: x.account, amount: Number(x.amount || 0) }));
  if (sideIn && !rows.some(r => r.account === SIDE_ACCOUNT)) rows.push({ account: SIDE_ACCOUNT, amount: 0 });
  const allocated = sum(budgets, x => Number(x.amount || 0)), mainIncome = sum(st.income) - sideIn;
  return {
    rows: rows.map(r => { const b = budgetStats(st.tx, r.account, r.amount), money = r.amount + (r.account === SIDE_ACCOUNT ? sideIn : 0); return { ...r, money, spent: b.used + b.carry, remaining: money - b.used - b.carry }; }),
    leftover: mainIncome - allocated - st.fixedTotal, mainIncome,
  };
}
const josa = (word, a, b) => { const ch = word.charCodeAt(word.length - 1) - 0xac00; return ch >= 0 && ch <= 11171 && ch % 28 ? a : b; };
/** 한 줄 조언 */
function adviceLine(k) {
  const health = categoryHealth(k), acc = accountHealth(monthStats(k), k), { left, done } = periodPace(k);
  const names = list => list.map(x => x.c).slice(0, 3).join('·');
  const over = health.filter(x => x.status === 'over'), warn = health.filter(x => x.status === 'warn'), spare = health.filter(x => x.status === 'spare');
  const minus = acc.rows.filter(r => r.remaining < 0);
  const parts = [];
  if (over.length) parts.push(`${names(over)}${josa(names(over), '이', '가')} 예산을 넘었어요`);
  if (warn.length) parts.push(done ? `${names(warn)}${josa(names(warn), '은', '는')} 거의 다 썼어요` : `${names(warn)}${josa(names(warn), '은', '는')} 쓰는 속도가 빨라요${left ? ` — 남은 ${left}일은 줄여 보세요` : ''}`);
  if (minus.length) parts.push(`${minus.map(r => r.account).join('·')} 계좌 잔액이 마이너스예요`);
  if (spare.length) parts.push(`${names(spare)}${josa(names(spare), '은', '는')} 여유가 있어요${over.length || warn.length ? ' — 그쪽 예산을 옮겨 써도 돼요' : ''}`);
  if (acc.leftover < 0) parts.push(`수입보다 배정·고정지출이 ${won(-acc.leftover)} 많아요`);
  if (!parts.length) {
    if (!health.length) return { tone: 'calm', text: '아직 이 달 기록이 없어요. 첫 지출을 기록해 보세요.' };
    return { tone: 'good', text: health.some(x => x.budget) ? '모든 분류가 예산 안에서 잘 가고 있어요. 지금처럼만 쓰면 돼요 👍' : '분류별 입금 금액(세부지출내역)을 넣으면 예산 대비 조언을 드릴 수 있어요.' };
  }
  return { tone: over.length || minus.length || acc.leftover < 0 ? 'bad' : warn.length ? 'warn' : 'good', text: parts.join(' · ') + '.' };
}
/** 지난달 돌아보기 (새 달이 시작되는 21일부터 자동으로 지난달 기준) */
function reviewLine(k) {
  const prev = addMonths(k, -1), cur = monthCats(prev);
  if (!cur.has) return '';
  const avg = baseline('avg12', prev), h = categoryHealth(prev), over = h.filter(x => x.status === 'over'), top = h.slice().sort((a, b) => b.spent - a.spent)[0];
  const vs = avg.total ? ` (평소 대비 ${cur.total >= avg.total ? '▲' : '▼'}${Math.abs(Math.round((cur.total - avg.total) / avg.total * 100))}%)` : '';
  return `${Number(prev.slice(5))}월 변동지출 ${won(cur.total)}${vs} · 가장 많이 쓴 분류는 ${top ? `${top.c} ${won(top.spent)}` : '-'}${over.length ? ` · 예산 초과: ${over.map(x => x.c).join(', ')}` : ' · 예산 초과 없음'}`;
}
const STATUS = { over: ['초과', 'bad'], warn: ['주의', 'warn'], ok: ['적정', 'ok'], spare: ['여유', 'good'] };
function glancePanel(s) {
  const k = key(), advice = adviceLine(k), health = categoryHealth(k), acc = accountHealth(s, k), { pace, done, left } = periodPace(k);
  const paceText = done ? '지난 달' : pace === 0 ? '시작 전' : `기간 ${Math.round(pace * 100)}% 지남 · ${left}일 남음`;
  const catRows = health.map(x => {
    const pct = x.budget ? x.spent / x.budget * 100 : null, [label, cls] = STATUS[x.status];
    return `<div class="g-row"><span class="tag">${x.c === 'NA' ? 'NA' : esc(x.c)}</span><div class="g-bar">${x.budget ? `<i class="${cls}" style="width:${Math.min(100, pct)}%"></i>${!done && pace > 0 ? `<em style="left:${pace * 100}%" title="지금까지 지난 기간"></em>` : ''}` : `<i class="none" style="width:${x.usual ? Math.min(100, x.spent / x.usual * 50) : 0}%"></i>`}</div>`
      + `<span class="g-num">${won(x.spent)}<small>${x.budget ? ` / ${won(x.budget)}` : x.usual ? ` · 평소 ${won(x.usual)}` : ''}</small></span><span class="pill ${cls}">${x.budget ? `${label} ${Math.round(pct)}%` : x.status === 'warn' ? '평소보다 많음' : '예산 없음'}</span></div>`;
  }).join('') || '<p class="muted">이 달 변동지출이 아직 없어요.</p>';
  const accRows = acc.rows.map(r => {
    const used = r.money ? r.spent / r.money * 100 : (r.spent ? 100 : 0), cls = r.remaining < 0 ? 'bad' : used > 90 ? 'warn' : 'ok';
    return `<div class="g-row"><b class="g-acc">${esc(r.account)}</b><div class="g-bar"><i class="${cls}" style="width:${Math.min(100, used)}%"></i></div><span class="g-num ${r.remaining < 0 ? 'negative' : ''}">${won(r.remaining)}<small> 남음</small></span></div>`;
  }).join('') || '<p class="muted">카드·계좌 예산을 넣으면 계좌별 잔액이 보여요.</p>';
  const note = data.notes?.[k] || '', review = reviewLine(k);
  return `<section class="panel glance"><div class="panel-head"><div><h2>이번 달 한눈에</h2><p>${range(k)} · ${paceText}</p></div></div>`
    + `<div class="advice ${advice.tone}"><span>💡</span><p>${esc(advice.text)}</p></div>`
    + `<div class="glance-grid"><div><h3>분류별 예산 사용</h3><p class="muted">세부지출내역의 입금 금액 기준 · 세로선은 지금까지 지난 기간</p>${catRows}</div>`
    + `<div><h3>계좌별 잔액</h3><p class="muted">카드·계좌 예산 기준</p>${accRows}<div class="g-left ${acc.leftover < 0 ? 'negative' : ''}">${acc.leftover < 0 ? '부족한 금액' : '남는 금액 · 용돈'} <b>${won(Math.abs(acc.leftover))}</b><small>수입 − 계좌 예산 − 고정지출</small></div></div></div>`
    + `<div class="memo"><div class="memo-head"><h3>📝 ${Number(k.slice(5))}월 특이사항</h3><button data-action="note">${note ? '메모 수정' : '메모 쓰기'}</button></div>`
    + `${note ? `<p class="memo-text">${esc(note).replace(/\n/g, '<br>')}</p>` : `<p class="muted">매달 21일 새 달이 시작되면 지난달을 돌아보며 이번 달 특이사항을 적어 두세요.</p>`}`
    + `${review ? `<p class="review">↩ 지난달 돌아보기 · ${esc(review)}</p>` : ''}</div></section>`;
}

function renderDashboard(s) {
  const a = mode === 'year' ? aggregate() : s;
  let html = `<div class="panel-head"><div><h2>${mode === 'year' ? key().slice(0, 4) + '년 한눈에 보기' : Number(key().slice(5)) + '월의 흐름'}</h2><p>${mode === 'year' ? '1월~12월 · 선택한 집계 기준 적용' : range(key())}</p></div><div><button data-mode="month" class="${mode === 'month' ? 'primary' : ''}">월간</button> <button data-mode="year" class="${mode === 'year' ? 'primary' : ''}">연간</button></div></div>`;
  html += `<div class="cards">${metric('총 수입', a.incomeTotal, '수입 내역 자동 합산')}${metric('변동지출', a.variable, '결제 금액 − 할인 및 엔빵')}${metric('고정지출', a.fixedTotal, fixedPartsText(fixedParts(a.fixed)))}${metric('남은 금액', a.incomeTotal - a.variable - a.fixedTotal, '수입 − 변동지출 − 고정지출', true)}</div>`;
  if (mode === 'month') html += glancePanel(s);
  html += `<div class="grid">${panel('월별 지출 흐름', annualChart(), key().slice(0, 4) + '년 · 변동지출 기준 (고정지출·적금 제외) · 색을 누르면 내역')}${panel('지출 비중', donut(a.tx), '변동지출 기준 · 고정지출 제외')}</div>`;
  if (mode === 'year') html += panel('연간 현황표', annualTable(), '월은 집계 기간의 시작 월로 표시합니다.');
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

/** 지금 달보다 뒤에 예산을 처음 입력한 달 (앞선 달로 가져오기용) */
function laterBudgetMonth() {
  return Object.keys(data.budgets).filter(k => k > key() && Array.isArray(data.budgets[k]) && data.budgets[k].length).sort()[0] || null;
}
function renderCards(s) {
  const b = budgetsFor(data, key()), budgets = b.list;
  // 월급 등 수입(예: 농협 입금)은 국민·CMA·농협 예산으로 나눠 쓰는 돈 → 예산 배분 확인에만 사용
  // 계좌 구분을 '기타'로 넣은 수입(출장비·부수입)만 '기타' 계좌의 쓸 수 있는 돈으로 더함
  const side = s.income.filter(t => t.account === SIDE_ACCOUNT), sideIn = sum(side);
  const incomeIn = acc => (acc === SIDE_ACCOUNT ? sideIn : 0);
  const incomeOnly = side.length && !budgets.some(x => x.account === SIDE_ACCOUNT) ? [SIDE_ACCOUNT] : [];
  const mainIncome = sum(s.income) - sideIn, allocated = sum(budgets, x => Number(x.amount || 0));
  // 남는 금액(용돈) = 수입 − 계좌 예산 배정 − 고정지출(모임·적금·주식 등)
  const leftover = mainIncome - allocated - s.fixedTotal;
  const known = acc => budgets.some(x => x.account === acc) || incomeOnly.includes(acc);
  const missing = s.tx.filter(t => !known(t.account));
  let html = `<div class="cards">${metric('이번 달 수입', mainIncome, sideIn ? `출장비·부수입 ${won(sideIn)} 제외` : '출장비·부수입(계좌 기타) 제외')}${metric('계좌 예산 배정', allocated, budgets.map(x => `${esc(x.account)} ${won(x.amount)}`).join(' · ') || '아직 배정 없음')}${metric('고정지출', s.fixedTotal, fixedPartsText(fixedParts(s.fixed)))}${metric(leftover < 0 ? '부족한 금액' : '남는 금액 · 용돈', Math.abs(leftover), leftover < 0 ? '수입보다 배정·고정지출이 많아요' : '수입 − 계좌 예산 − 고정지출', true)}</div>`;
  html += `<div class="notice">월급처럼 들어온 수입을 <b>계좌별 예산으로 나눠</b> 관리합니다. 사용 금액은 지출의 <b>계좌 구분</b>으로 합산하고, 이월·기타는 거래의 분류를 기준으로 자동 계산하며, 전월 잔여 예산을 자동으로 더하지 않습니다. 출장비·부수입은 수입에서 <b>계좌 구분을 ‘기타’</b>로 넣으면 기타 계좌의 쓸 수 있는 돈으로 잡혀요.</div>`;
  if (!b.own && b.from) html += `<div class="notice"><b>${monthLabel(b.from)}</b> 예산을 이 달에도 그대로 적용하고 있어요. 수정·삭제·추가하면 이 달부터 바뀐 예산이 적용되고 다음 달에도 이어져요.</div>`;
  else if (b.own && budgets.length) html += `<div class="notice">이 달 예산은 다음 달에도 그대로 이어서 적용돼요. 바뀌는 달에만 그 달에서 수정하면 돼요.</div>`;
  const later = laterBudgetMonth();
  if (!b.own && !b.from) html += `<div class="notice">이 달에는 아직 계좌 예산이 없어요. 예산은 입력한 달부터 <b>다음 달로</b> 이어지기 때문에, 그보다 앞선 달은 비어 있어요.${later ? ` <button data-action="copy-budgets">${monthLabel(later)} 예산 그대로 가져오기</button>` : ''} 오른쪽 위 <b>＋ 계좌 예산</b>으로 직접 추가해도 돼요.</div>`;
  const row = (account, amount, manage) => {
    const r = budgetStats(s.tx, account, amount), inc = incomeIn(account), remaining = r.remaining + inc;
    return `<tr><td><b>${esc(account)}</b></td><td>${won(amount)}</td><td>${inc ? won(inc) : '<span class="muted">-</span>'}</td><td>${won(r.used)}</td><td>${won(r.carry)}</td><td class="${remaining < 0 ? 'negative' : ''}"><b>${won(remaining)}</b></td><td>${manage}</td></tr>`;
  };
  html += panel('카드·계좌별 예산', table(['계좌 / 결제수단', '배정 예산', '출장비·부수입', '이번 달 사용', '이월·기타', '잔여 예산', '관리'],
    budgets.map(x => row(x.account, x.amount, `<button data-edit="${esc(x.id)}">수정</button><button data-delete="${esc(x.id)}">삭제</button>`)).join('')
    + incomeOnly.map(a => row(a, 0, '<span class="muted">출장비·부수입으로 충당</span>')).join('')),
  '잔여 예산 = 배정 예산 − 이번 달 사용 − 이월·기타 · 기타 계좌는 출장비·부수입을 더해 계산');
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

let donutMonth = '';   // 세부지출내역의 분류별 지출 비중: '' = 보고 있는 달, 'YYYY-MM' = 다른 달, 'year' = 최근 12개월 합계
function donutSource(s) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(key(), -i));
  const chosen = donutMonth === 'year' || months.includes(donutMonth) ? donutMonth : key();
  const rows = chosen === 'year' ? months.flatMap(k => monthStats(k).tx) : chosen === key() ? s.tx : monthStats(chosen).tx;
  return { months, chosen, rows, label: chosen === 'year' ? '최근 12개월 합계' : monthLabel(chosen) };
}
function donutPanel(s) {
  const { months, chosen, rows, label } = donutSource(s);
  const select = `<select id="donutMonth" aria-label="지출 비중 볼 달">${months.map(k => `<option value="${k}" ${chosen === k ? 'selected' : ''}>${monthLabel(k)}${k === key() ? ' (이번 달)' : ''}</option>`).join('')}<option value="year" ${chosen === 'year' ? 'selected' : ''}>최근 12개월 합계</option></select>`;
  return panel('분류별 지출 비중', donut(rows), `${label} · 변동지출 기준 · 적금 제외`, select);
}
// 세부 사용 내역 비중: 분류를 고르면 그 분류의 세부 내역, '전체'면 분류·세부 내역 묶음 (분류별 지출 비중과 같은 달)
let detailCat = '';
const DETAIL_SLICES = 9;
function detailDonutPanel(s) {
  const { rows, label } = donutSource(s), base = rows.filter(t => t.category !== '적금');
  const cats = groups(base).filter(x => x[1] > 0).map(([c]) => c);
  const cat = cats.includes(detailCat) ? detailCat : '';
  const picked = cat ? base.filter(t => (t.category || 'NA') === cat) : base, sums = {};
  picked.forEach(t => { const k = cat ? (t.detail || 'NA') : `${t.category || 'NA'} · ${t.detail || 'NA'}`; sums[k] = (sums[k] || 0) + net(t); });
  let entries = Object.entries(sums).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length > DETAIL_SLICES + 1) entries = [...entries.slice(0, DETAIL_SLICES), ['그 외', entries.slice(DETAIL_SLICES).reduce((a, x) => a + x[1], 0)]];
  const select = `<select id="detailCat" aria-label="세부 내역 볼 분류"><option value="">전체 분류</option>${cats.map(c => `<option value="${esc(c)}" ${cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  const colorOf = (k, i) => (k === '그 외' ? '#d5ddd3' : palette[i % palette.length]);
  return panel('세부 사용 내역 비중', donutChart(entries, cat || '세부 내역', colorOf, true),
    `${label} · ${cat ? `${cat}의 세부 사용 내역` : '분류 · 세부 사용 내역 기준'} · 적금 제외${entries.some(x => x[0] === '그 외') ? ` · 상위 ${DETAIL_SLICES}개 외는 ‘그 외’` : ''}`, select);
}
function renderDetails(s) {
  const cur = monthCats(key());
  let html = detailTable(s);
  html += compareCards(cur);
  html += `<div class="grid">${panel('월별 추이', trendChart(cur), '최근 12개월 변동지출 · 점선은 지난 12개월 평균')}${donutPanel(s)}</div>`;
  html += detailDonutPanel(s);
  html += categoryCompare(cur);
  return html;
}

function render() {
  colorOrder = null;
  const nav = navs.find(n => n[0] === tab);
  $('title').textContent = nav[2];
  $('subtitle').textContent = tab === 'dashboard' ? '기록은 간단하게, 돈의 흐름은 한눈에.' : range(key()) + ' · 입력 즉시 모든 현황에 반영됩니다.';
  $('nav').innerHTML = navs.map(([id, icon, label]) => `<button data-tab="${id}" class="${id === tab ? 'active' : ''}">${icon}　${label}</button>`).join('');
  $('add').textContent = tab === 'cards' ? '＋ 계좌 예산' : tab === 'fixed' ? '＋ 고정지출' : tab === 'income' ? '＋ 수입 기록' : '＋ 지출 기록';
  let html = '';
  // GitHub에 일부 파일만 올라가 예전 파일과 섞이면 화면이 깨질 수 있어 먼저 확인
  const stale = [['core.js', Ledger.version], ['importer.js', window.ChagogImport?.version]].filter(([, v]) => v !== APP_VERSION).map(([f]) => f);
  if (stale.length) html += `<div class="notice error-notice"><b>${stale.join(', ')}</b> 파일이 예전 버전이에요. 바뀐 파일을 GitHub에 함께 올린 뒤 Ctrl+Shift+R로 새로고침해 주세요.</div>`;
  if ($('appVersion')) $('appVersion').textContent = `버전 ${APP_VERSION}`;
  try {
  const s = monthStats(key());
  if (!data.transactions.length && !data.fixed.length && !data.income.length) html += `<div class="notice"><b>나의 가계부를 시작해 보세요.</b> ‘데이터 불러오기’에서 백업 JSON 파일을 선택하면 기존 기록이 연결됩니다. <button data-action="import">불러오기</button></div>`;
  if (tab === 'dashboard') html += renderDashboard(s);
  else if (['transactions', 'fixed', 'income'].includes(tab)) html += renderList(s, nav);
  else if (tab === 'cards') html += renderCards(s);
  else html += renderDetails(s);
  } catch (error) {
    // 화면을 그리다 문제가 생기면 이전 탭 내용이 남지 않도록 안내를 대신 보여 줌
    console.error(error);
    html += `<div class="notice error-notice">이 화면을 그리는 중 문제가 생겼어요. 바뀐 파일이 모두 GitHub에 올라갔는지 확인하고 Ctrl+Shift+R로 새로고침해 주세요. 계속되면 이 문구를 캡처해서 알려 주세요.<br><span class="muted">${esc(error?.message || error)}</span></div>`;
  }
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
function openNoteForm() {
  editing = { id: null, type: 'note' };
  $('dialogTitle').textContent = `${monthLabel(key())} 특이사항`;
  $('fields').innerHTML = `<label class="wide">이번 달에 있었던 일, 다음 달에 신경 쓸 점<textarea name="note" rows="7" maxlength="3000" placeholder="예) 9월은 추석·결혼식으로 이벤트 지출이 많았음. 10월은 생활비를 40만원 안으로.">${esc(data.notes?.[key()] || '')}</textarea></label><p class="muted wide">↩ ${esc(reviewLine(key()) || '지난달 기록이 없어요.')}</p>`;
  $('formError').textContent = '';
  $('dialog').showModal();
}
function openForm(id = null, type = tab, prefill = {}) {
  if (type === 'deposit') return openDepositForm();
  if (type === 'note') return openNoteForm();
  if (!['transactions', 'fixed', 'income', 'cards'].includes(type)) type = 'transactions';
  editing = { id, type };
  const s = monthStats(key());
  let row = type === 'cards' ? budgetsFor(data, key()).list.find(x => x.id === id)
    : type === 'fixed' ? s.fixed.find(x => x.id === id)
      : data[type].find(x => x.id === id);
  row = row || { ...prefill };
  const tx = type === 'transactions';
  $('dialogTitle').textContent = (id ? '수정' : '추가') + ' · ' + ({ transactions: '변동지출', fixed: '고정지출', income: '수입', cards: '계좌 예산' }[type]);
  // 변동지출을 새로 추가할 때는 날짜 기본값이 오늘
  // 변동지출은 날짜 외에 모두 비워 둘 수 있음(NA) → 나중에 수정해서 채우기
  const f = (name, label, t = 'text', v = '', { list = '', required = false, placeholder = '' } = {}) =>
    `<label>${label}<input name="${name}" type="${t}" value="${esc(v)}" ${required ? 'required' : ''} ${t === 'number' ? 'min="0" step="1"' : ''} ${list ? `list="${list}"` : ''} ${placeholder ? `placeholder="${placeholder}"` : ''}></label>`;
  const opt = { placeholder: tx ? 'NA (나중에 입력)' : '' };
  let fields = '';
  if (type === 'cards') fields = f('account', '계좌명', 'text', row.account || '', { required: true }) + f('amount', '배정 예산', 'number', row.amount ?? 0, { required: true });
  else {
    fields = f('date', '날짜', 'date', row.date || (tx ? todayStr() : `${key()}-${pad(day())}`), { required: true })
      + f('category', '구분', 'text', row.category || '', { list: 'categories', required: !tx, ...opt })
      + f('detail', '세부 내역', 'text', row.detail || '', opt)
      + f('amount', tx ? '결제 금액' : '금액', 'number', id ? (row.amount ?? '') : (tx ? '' : 0), { required: !tx, ...opt });
    if (tx) fields += f('discount', '할인 및 엔빵', 'number', row.discount || 0);
    fields += f('card', '카드 / 결제수단', 'text', row.card || '', { list: 'cardsList', ...opt });
    if (tx) fields += f('account', '계좌 구분', 'text', row.account || '', { list: 'accounts', ...opt });
    if (type === 'income') fields += f('account', '계좌 구분 (월급은 입금 계좌, 출장비·부수입은 기타)', 'text', row.account || '', { list: 'incomeAccounts' });
    fields += f('note', '비고', 'text', row.note || '');
  }
  const cats = type === 'cards' ? [] : [...new Set([...SUGGEST[type], ...data[type].map(t => t.category).filter(Boolean)])];
  fields += `<datalist id="categories">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist><datalist id="incomeAccounts">${[...new Set([...data.income.map(t => t.account).filter(a => a && a !== SIDE_ACCOUNT), SIDE_ACCOUNT])].map(a => `<option value="${esc(a)}">`).join('')}</datalist><datalist id="accounts">${[...new Set([...budgetsFor(data, key()).list.map(b => b.account), SIDE_ACCOUNT])].map(a => `<option value="${esc(a)}">`).join('')}</datalist><datalist id="cardsList">${[...new Set(data.transactions.map(t => t.card).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  $('fields').innerHTML = fields;
  $('formError').textContent = '';
  $('dialog').showModal();
}

$('form').onsubmit = e => {
  e.preventDefault();
  const { id, type } = editing, tx = type === 'transactions';
  const values = Object.fromEntries(new FormData(e.target));
  if (type === 'note') {
    const text = String(values.note || '').trim();
    data.notes ??= {};
    if (text) data.notes[key()] = text; else delete data.notes[key()];
    save(); $('dialog').close(); render(); toast(text ? '특이사항을 저장했어요.' : '특이사항을 지웠어요.');
    return;
  }
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
  const seg = e.target.closest('[data-seg]');
  if (seg) {
    const [k, ...c] = seg.dataset.seg.split('|'), cat = c.join('|');
    selSeg = selSeg && selSeg.k === k && selSeg.c === cat ? null : { k, c: cat };
    return render();
  }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.action === 'seg-close') { selSeg = null; render(); }
  if (b.dataset.action === 'note') openForm(null, 'note');
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
  if (b.dataset.addBudget) openForm(null, 'cards', { account: b.dataset.addBudget });
  if (b.dataset.action === 'copy-budgets') {
    const from = laterBudgetMonth();
    if (from) { data.budgets[key()] = JSON.parse(JSON.stringify(data.budgets[from])); save(); render(); toast(`${monthLabel(from)} 예산을 가져왔어요. 이 달에서 고치면 이 달부터 적용돼요.`); }
  }
  if (b.dataset.action === 'import-rows') window.ChagogImport?.open(tab);
  if (b.dataset.action === 'reset-filters') { search = ''; filter = ''; extra = noExtra(); render(); }
  if (b.dataset.action === 'import') $('file').click();
};
$('content').oninput = e => { if (e.target.id === 'search') { const pos = e.target.selectionStart; search = e.target.value; render(); $('search').focus(); $('search').setSelectionRange(pos, pos); } };
$('content').onchange = e => {
  if (e.target.id === 'filter') { filter = e.target.value; render(); }
  if (e.target.id === 'compareBase') { compareBase = e.target.value; render(); }
  if (e.target.id === 'donutMonth') { donutMonth = e.target.value === key() ? '' : e.target.value; render(); }
  if (e.target.id === 'detailCat') { detailCat = e.target.value; render(); }
  const field = e.target.dataset.extra;
  if (field) { extra[field] = e.target.value; render(); $('content').querySelector(`[data-extra="${field}"]`)?.focus(); }
};
$('month').onchange = () => { if (!/^\d{4}-\d{2}$/.test(key())) $('month').value = nowKey(); extra.from = extra.to = ''; donutMonth = ''; render(); };
$('basis').onchange = () => { data.cycleDay = day(); save(); render(); };
for (const [id, offset] of [['prev', -1], ['next', 1]]) $(id).onclick = () => {
  const [y, m] = key().split('-').map(Number), d = new Date(y, m - 1 + offset, 1);
  $('month').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  extra.from = extra.to = '';
  donutMonth = '';
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
  if (d.notes == null) d.notes = {};
  if (typeof d.notes !== 'object' || Array.isArray(d.notes) || Object.entries(d.notes).some(([k, v]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(k) || typeof v !== 'string' || v.length > 3000)) throw Error('월별 메모 형식 오류');
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
