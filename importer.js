// 차곡 · 엑셀 가져오기 (복사·붙여넣기 / 파일 업로드)
// 엑셀 표를 읽어 → 열을 자동으로 맞추고 → 미리 보기로 확인한 뒤 → 한 번에 추가합니다.
(() => {
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
  const TITLES = { transactions: '변동지출', fixed: '고정지출', income: '수입' };
  const FIELDS = {
    transactions: [['date', '날짜'], ['category', '구분'], ['detail', '지출 내역'], ['amount', '결제 금액'], ['discount', '할인 및 엔빵'], ['net', '실지출'], ['card', '카드'], ['account', '계좌 구분'], ['note', '비고']],
    fixed: [['date', '날짜'], ['category', '구분'], ['detail', '내역'], ['amount', '금액'], ['card', '결제수단'], ['note', '비고']],
    income: [['date', '날짜'], ['category', '구분'], ['detail', '내역'], ['amount', '금액'], ['card', '입금 수단'], ['account', '계좌 구분'], ['note', '비고']],
  };
  // 엑셀 제목 줄의 여러 표현 → 항목 (위에 있을수록 먼저 맞춤)
  const SYNONYMS = [
    ['date', ['날짜', '일자', '사용일', '결제일', '거래일', '입금일', 'date']],
    ['net', ['실지출', '실지출금액', '실사용', '실사용금액', '실결제']],
    ['discount', ['할인엔빵', '할인', '엔빵', '할인금액']],
    ['detail', ['지출내역', '세부내역', '세부사용내역', '내역', '사용처', '내용', '수입내역', '상세', '상세내역']],
    ['category', ['구분', '분류', '사용내역', '카테고리', '항목', '수입구분']],
    ['amount', ['결제금액', '금액', '지출금액', '사용금액', '입금금액', '수입금액', '수입']],
    ['card', ['카드', '결제수단', '카드구분', '입금수단', '수단']],
    ['account', ['계좌구분', '계좌', '통장']],
    ['note', ['비고', '메모', '참고']],
  ];
  const norm = v => String(v ?? '').toLowerCase().replace(/및/g, '').replace(/[\s·・.\-_()/]/g, '');
  const pad = n => String(n).padStart(2, '0');
  const isDate = v => Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = v => Math.round(v).toLocaleString('ko-KR') + '원';

  // ---------- 값 읽기 ----------
  function parseMoney(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : NaN;
    const s = String(v ?? '').replace(/[₩￦원,\s]/g, '').replace(/^\\/, '');
    if (s === '') return null;
    if (/^-+$/.test(s)) return 0;               // 엑셀 회계 서식의 '-' = 0원
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
  }
  const ymd = (y, m, d) => {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  /** 'YYYY-MM-DD' / '' (비어 있음) / null (읽을 수 없음) */
  function parseDate(v, baseKey) {
    if (isDate(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
      return null;
    }
    const s = String(v ?? '').trim();
    if (!s) return '';
    let m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (m) return ymd(2000 + +m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (m) {
      // 연도가 없으면 지금 보고 있는 달과 가장 가까운 연도로
      const [by, bm] = baseKey.split('-').map(Number), month = +m[1];
      const year = [by - 1, by, by + 1].sort((a, b) => Math.abs((a * 12 + month) - (by * 12 + bm)) - Math.abs((b * 12 + month) - (by * 12 + bm)))[0];
      return ymd(year, month, +m[2]);
    }
    return null;
  }
  /** 붙여넣은 글자(엑셀=탭 구분) 또는 CSV → 2차원 배열 */
  function parseText(text) {
    const sep = text.includes('\t') ? '\t' : ',';
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------- 열 맞추기 ----------
  function fieldFor(header, allowed, used) {
    const h = norm(header);
    if (!h) return '';
    for (const exact of [true, false]) {
      for (const [field, words] of SYNONYMS) {
        if (!allowed.includes(field) || used.has(field)) continue;
        if (words.some(w => (exact ? h === norm(w) : h.includes(norm(w))))) return field;
      }
    }
    return '';
  }
  function detect(rows, type) {
    const allowed = FIELDS[type].map(f => f[0]);
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const used = new Set(), mapping = rows[r].map(h => { const f = fieldFor(h, allowed, used); if (f) used.add(f); return f; });
      if (used.size >= 2) return { headerRow: r, mapping };
    }
    // 제목 줄이 없으면 차곡 표와 같은 순서로 가정
    const width = Math.max(0, ...rows.map(r => r.length));
    return { headerRow: -1, mapping: Array.from({ length: width }, (_, i) => allowed[i] || '') };
  }

  // ---------- 기록 만들기 ----------
  function build(state) {
    const { rows, headerRow, mapping, type, baseKey, defaultDate, existing } = state;
    const out = { records: [], errors: [], totals: 0, dups: 0, empty: 0 };
    const seen = new Set(existing.map(dupKey));
    rows.slice(headerRow + 1).forEach((cells, i) => {
      const line = headerRow + 2 + i, get = f => { const c = mapping.indexOf(f); return c < 0 ? '' : cells[c]; };
      const text = f => String(get(f) ?? '').trim();
      if (cells.every(c => String(c ?? '').trim() === '')) { out.empty++; return; }
      const texts = ['category', 'detail', 'card', 'account', 'note'].map(text);
      if (texts.some(t => /합계|총계|소계|^total$/i.test(t)) || (texts.every(t => !t) && !text('date'))) { out.totals++; return; }
      const fail = msg => out.errors.push(`${line}번째 줄: ${msg}`);
      let date = parseDate(get('date'), baseKey), inferred = false;
      if (date === null) return fail(`날짜를 읽을 수 없어요 (${esc(get('date'))})`);
      if (date === '') { date = defaultDate; inferred = true; }
      const amount = parseMoney(get('amount')), discount = parseMoney(get('discount')), net = parseMoney(get('net'));
      if ([amount, discount, net].some(Number.isNaN)) return fail('금액을 숫자로 읽을 수 없어요');
      const rec = { date, category: text('category'), detail: text('detail'), card: text('card'), note: text('note') };
      if (type === 'transactions') {
        rec.amount = amount ?? (net != null ? net + (discount || 0) : null);   // 비어 있으면 NA
        rec.discount = discount ?? (rec.amount != null && net != null ? Math.max(0, rec.amount - net) : 0);
        if (rec.amount != null && rec.discount > rec.amount) return fail('할인 및 엔빵이 결제 금액보다 커요');
        rec.account = text('account');
      } else {
        if (amount == null) return fail('금액이 비어 있어요');
        if (!rec.category) return fail('구분이 비어 있어요');
        rec.amount = amount;
        if (type === 'income') rec.account = text('account');
      }
      if (inferred) rec.dateInferred = true;
      if (state.skipDup && seen.has(dupKey(rec))) { out.dups++; return; }
      out.records.push(rec);
    });
    return out;
  }
  const dupKey = t => [t.date, t.category || '', t.detail || '', t.amount ?? '', t.discount || 0, t.card || ''].join('|');

  // ---------- 화면 ----------
  let state = null, workbook = null;
  function dialog() {
    let d = document.getElementById('importDialog');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'importDialog';
    d.className = 'import-dialog';
    d.innerHTML = `<div class="dialog-head"><h2 id="importTitle"></h2><button type="button" id="importClose" aria-label="닫기">✕</button></div>
      <p class="muted">엑셀에서 표를 <b>제목 줄까지 포함해</b> 드래그해서 복사(Ctrl+C)한 뒤 아래 칸에 붙여넣기(Ctrl+V) 하세요. 엑셀 파일(.xlsx)이나 CSV를 바로 골라도 돼요.</p>
      <textarea id="importPaste" aria-label="엑셀 붙여넣기" placeholder="여기에 붙여넣기 (Ctrl+V)"></textarea>
      <div class="import-file"><label class="file-btn">📄 엑셀 파일 선택<input type="file" id="importFile" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden></label><span id="importFileName" class="muted"></span><select id="importSheet" hidden aria-label="시트 선택"></select></div>
      <div id="importPreview"></div>
      <p id="importError" class="import-error" role="alert"></p>
      <div class="import-actions"><label><input type="checkbox" id="importSkipDup" checked> 이미 있는 같은 기록은 건너뛰기</label><button type="button" class="primary" id="importGo" disabled>가져오기</button></div>`;
    document.body.appendChild(d);
    d.querySelector('#importClose').onclick = () => d.close();
    d.querySelector('#importPaste').oninput = e => load(parseText(e.target.value), '붙여넣은 내용');
    d.querySelector('#importFile').onchange = e => readFile(e.target.files[0]);
    d.querySelector('#importSheet').onchange = e => loadSheet(e.target.value);
    d.querySelector('#importSkipDup').onchange = e => { if (state) { state.skipDup = e.target.checked; preview(); } };
    d.querySelector('#importPreview').onchange = e => {
      const col = e.target.dataset.col;
      if (col == null || !state) return;
      const f = e.target.value;
      if (f) state.mapping = state.mapping.map(x => (x === f ? '' : x));   // 한 항목은 한 열에만
      state.mapping[+col] = f;
      preview();
    };
    d.querySelector('#importGo').onclick = () => {
      const result = build(state);
      if (!result.records.length) return;
      window.LedgerApp.importRows(state.type, result.records);
      d.close();
    };
    return d;
  }
  function open(type) {
    if (!FIELDS[type]) type = 'transactions';
    const d = dialog(), ctx = window.LedgerApp.context();
    state = { type, rows: [], headerRow: -1, mapping: [], baseKey: ctx.key, defaultDate: `${ctx.key}-${pad(ctx.day)}`, skipDup: true, existing: [] };
    workbook = null;
    d.querySelector('#importTitle').textContent = `엑셀 가져오기 · ${TITLES[type]}`;
    d.querySelector('#importPaste').value = '';
    d.querySelector('#importFile').value = '';
    d.querySelector('#importFileName').textContent = '';
    d.querySelector('#importSheet').hidden = true;
    d.querySelector('#importSkipDup').checked = true;
    d.querySelector('#importPreview').innerHTML = '';
    d.querySelector('#importError').textContent = '';
    d.querySelector('#importGo').disabled = true;
    d.querySelector('#importGo').textContent = '가져오기';
    d.showModal();
  }
  function load(rows, source) {
    const cleaned = rows.map(r => r.map(c => (isDate(c) ? c : typeof c === 'number' ? c : String(c ?? '').trim())));
    while (cleaned.length && cleaned.at(-1).every(c => c === '')) cleaned.pop();
    const { headerRow, mapping } = detect(cleaned, state.type);
    Object.assign(state, { rows: cleaned, headerRow, mapping, source, existing: window.LedgerApp.existing(state.type) });
    preview();
  }
  function preview() {
    const d = dialog(), fields = FIELDS[state.type], result = build(state);
    const header = state.headerRow >= 0 ? state.rows[state.headerRow] : [];
    const width = Math.max(0, ...state.rows.map(r => r.length));
    const select = col => `<select data-col="${col}" aria-label="${col + 1}번째 열"><option value="">가져오지 않음</option>${fields.map(([f, label]) => `<option value="${f}" ${state.mapping[col] === f ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
    const mapTable = width ? `<h3>열 맞추기</h3><p class="muted">${state.headerRow >= 0 ? '제목 줄을 보고 자동으로 맞췄어요.' : '제목 줄을 찾지 못해 차곡 표 순서로 맞췄어요.'} 잘못된 열이 있으면 고쳐 주세요.</p>
      <div class="table-wrap"><table class="import-map"><thead><tr>${Array.from({ length: width }, (_, c) => `<th>${esc(header[c] || `${c + 1}번째 열`)}</th>`).join('')}</tr></thead>
      <tbody><tr>${Array.from({ length: width }, (_, c) => `<td>${select(c)}</td>`).join('')}</tr>
      ${state.rows.slice(state.headerRow + 1, state.headerRow + 4).map(r => `<tr class="raw">${Array.from({ length: width }, (_, c) => `<td>${esc(isDate(r[c]) ? r[c].toLocaleDateString('ko-KR') : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    const isTx = state.type === 'transactions', show = result.records.slice(0, 8);
    const cols = isTx ? ['날짜', '구분', '내역', '결제 금액', '할인', '카드', '계좌', '비고'] : ['날짜', '구분', '내역', '금액', state.type === 'income' ? '입금 수단' : '결제수단', ...(state.type === 'income' ? ['계좌'] : []), '비고'];
    const na = v => (v ? esc(v) : '<span class="na">NA</span>');
    const resultTable = show.length ? `<h3>가져올 내용 미리 보기</h3><div class="table-wrap"><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${show.map(t => `<tr><td>${t.date}${t.dateInferred ? ' *' : ''}</td><td>${na(t.category)}</td><td>${na(t.detail)}</td><td>${t.amount == null ? '<span class="na">NA</span>' : won(t.amount)}</td>${isTx ? `<td>${won(t.discount)}</td>` : ''}<td>${na(t.card)}</td>${isTx || state.type === 'income' ? `<td>${t.account ? esc(t.account) : isTx ? '<span class="na">NA</span>' : '—'}</td>` : ''}<td>${esc(t.note) || '—'}</td></tr>`).join('')}</tbody></table></div>${result.records.length > show.length ? `<p class="muted">외 ${result.records.length - show.length}건</p>` : ''}` : '';
    const summary = `<div class="notice import-summary">가져올 기록 <b>${result.records.length}건</b>${result.dups ? ` · 이미 있어서 건너뜀 ${result.dups}건` : ''}${result.totals ? ` · 합계 줄 등 건너뜀 ${result.totals}건` : ''}${result.errors.length ? ` · <span class="negative">읽지 못한 줄 ${result.errors.length}건</span>` : ''}${result.records.some(r => r.dateInferred) ? `<br>* 날짜가 비어 있는 줄은 ${state.defaultDate}(선택한 달의 시작일)로 넣어요.` : ''}</div>`;
    d.querySelector('#importPreview').innerHTML = state.rows.length ? summary + mapTable + resultTable : '';
    d.querySelector('#importError').innerHTML = result.errors.slice(0, 5).join('<br>') + (result.errors.length > 5 ? `<br>외 ${result.errors.length - 5}건` : '');
    d.querySelector('#importGo').disabled = !result.records.length;
    d.querySelector('#importGo').textContent = result.records.length ? `${result.records.length}건 가져오기` : '가져오기';
  }

  // ---------- 파일 ----------
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_URL; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous';
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(Error('load')));
      s.onerror = () => reject(Error('load'));
      document.head.appendChild(s);
    });
  }
  async function readFile(file) {
    if (!file) return;
    const d = dialog();
    d.querySelector('#importFileName').textContent = file.name;
    d.querySelector('#importError').textContent = '';
    d.querySelector('#importSheet').hidden = true;
    try {
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        let text = await file.text();
        if (text.includes('\uFFFD')) text = new TextDecoder('euc-kr').decode(await file.arrayBuffer());   // 한글 엑셀 CSV
        return load(parseText(text.replace(/^\uFEFF/, '')), file.name);
      }
      d.querySelector('#importError').textContent = '엑셀 파일을 읽는 중…';
      const XLSX = await loadXLSX();
      workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
      const names = workbook.SheetNames, month = Number(state.baseKey.slice(5));
      const pick = names.find(n => new RegExp(`(^|\\D)${month}\\s*월`).test(n)) || names[0];
      const sheet = d.querySelector('#importSheet');
      sheet.innerHTML = names.map(n => `<option ${n === pick ? 'selected' : ''}>${esc(n)}</option>`).join('');
      sheet.hidden = names.length < 2;
      d.querySelector('#importError').textContent = '';
      loadSheet(pick);
    } catch (error) {
      d.querySelector('#importError').textContent = error?.message === 'load'
        ? '엑셀 파일을 여는 도구를 불러오지 못했어요. 인터넷 연결을 확인하거나, 엑셀에서 표를 복사해 붙여넣기로 가져와 주세요.'
        : '파일을 읽지 못했어요. 엑셀에서 표를 복사해 붙여넣기로 가져와 주세요.';
    }
  }
  function loadSheet(name) {
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    load(rows, name);
  }

  window.ChagogImport = { open, readFile, parseText, parseMoney, parseDate, detect, build };
})();
