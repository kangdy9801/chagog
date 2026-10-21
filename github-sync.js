// 차곡 · 비공개 GitHub 저장소 동기화
// 기록은 비밀번호로 암호화된 뒤 비공개 저장소의 파일 하나(ledger.enc.json)에 저장됩니다.
(() => {
  const el = id => document.getElementById(id);
  const V = window.ChagogVault;
  const empty = () => window.LedgerApp.empty();
  const clone = value => JSON.parse(JSON.stringify(value));
  const readyText = '🔒 암호화 저장 완료';
  const POLL_MS = 15000, SAVE_DELAY_MS = 700, IDLE_LOCK_MS = 30 * 60 * 1000;
  const FILE_AAD = 'chagog-ledger-v1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const D = window.ChagogDevice;

  let secret = null, dataKey = null;          // 잠금 해제 동안 메모리에만 존재
  let ready = false, sha = null, rev = 0, baseDoc = empty(), dirty = false;
  let saving = false, conflict = false, seq = 0, reading = false, saveTimer = null;
  let lastActive = Date.now();
  const status = text => { el('saveState').textContent = text; };

  // ---------- GitHub API ----------
  function api(path, options = {}) {
    return fetch(`https://api.github.com/repos/${encodeURIComponent(secret.owner)}/${encodeURIComponent(secret.repo)}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${secret.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    }).catch(() => { throw Error('NETWORK'); });
  }
  function failure(response) {
    if (response.status === 401) return Error('TOKEN_INVALID');
    if (response.status === 403 || response.status === 429) {
      return Error(response.headers.get('x-ratelimit-remaining') === '0' || response.status === 429 ? 'RATE_LIMIT' : 'TOKEN_FORBIDDEN');
    }
    if (response.status === 404) return Error('REPO_NOT_FOUND');
    return Error('GITHUB_ERROR');
  }
  const filePath = () => `/contents/${secret.path.split('/').map(encodeURIComponent).join('/')}`;

  async function read() {
    const response = await api(filePath());
    if (response.status === 404) {
      // 파일이 아직 없는 것인지, 저장소 자체에 접근할 수 없는 것인지 구분
      const repo = await api('');
      if (!repo.ok) throw failure(repo);
      return { document: null, sha: null, rev: 0 };
    }
    if (!response.ok) throw failure(response);
    const meta = await response.json();
    let text;
    if (meta.encoding === 'base64' && meta.content) text = V.b64ToText(meta.content);
    else {
      // 1MB가 넘는 파일은 원문을 따로 받아야 함
      const raw = await api(filePath(), { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!raw.ok) throw failure(raw);
      text = await raw.text();
    }
    let plain;
    try {
      const envelope = JSON.parse(text);
      if (envelope.format !== FILE_AAD) throw Error();
      plain = await V.open(dataKey, envelope, FILE_AAD);
    } catch { throw Error('DECRYPT_FAILED'); }
    if (!Number.isSafeInteger(plain.rev) || !plain.doc) throw Error('DECRYPT_FAILED');
    return { document: plain.doc, sha: meta.sha, rev: plain.rev };
  }

  async function write(document, nextRev) {
    const envelope = { format: FILE_AAD, ...(await V.seal(dataKey, { rev: nextRev, savedAt: new Date().toISOString(), doc: document }, FILE_AAD)) };
    const body = { message: `chagog: 저장 #${nextRev}`, content: V.textToB64(JSON.stringify(envelope)) };
    if (sha) body.sha = sha;
    const response = await api(filePath(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status === 409 || response.status === 422) return { conflict: true };
    if (!response.ok) throw failure(response);
    const result = await response.json();
    return { sha: result.content.sha };
  }

  // ---------- 잠금 화면 ----------
  const MESSAGES = {
    NOT_CONFIGURED: '아직 설정되지 않았어요. 아래 ‘처음 설정 / 토큰·비밀번호 변경’에서 설정을 먼저 해 주세요.',
    WRONG_PASSWORD: '긴 비밀번호가 맞지 않아요.',
    PIN_MISMATCH: 'PIN 4자리 확인이 일치하지 않아요.',
    PIN_FORMAT: 'PIN은 숫자 4자리로 정해 주세요.',
    PIN_LOCKED_OUT: `PIN을 ${D.MAX_FAILS}번 틀려서 이 기기 등록을 지웠어요. 긴 비밀번호로 다시 등록해 주세요.`,
    TOKEN_INVALID: 'GitHub 토큰이 만료되었거나 취소됐어요. 아래 설정 화면에서 새 토큰으로 바꿔 주세요.',
    TOKEN_FORBIDDEN: 'GitHub 토큰에 기록 저장소 권한이 없어요. 토큰의 Contents 권한(Read and write)을 확인해 주세요.',
    REPO_NOT_FOUND: '기록 저장소에 접근할 수 없어요. 저장소 이름과 토큰의 저장소 선택을 확인해 주세요.',
    DECRYPT_FAILED: '기록 파일을 열 수 없어요. 다른 설정으로 암호화된 파일일 수 있어요. 파일을 덮어쓰지 않고 멈췄습니다.',
    RATE_LIMIT: 'GitHub 요청 한도에 잠시 걸렸어요. 몇 분 뒤 다시 시도해 주세요.',
    NETWORK: '인터넷 연결을 확인해 주세요.',
  };
  // mode: 'pin' | 'register' | 'none'
  function gate(message, { mode = 'none' } = {}) {
    ready = false;
    el('lockScreen').hidden = false;
    el('lockMessage').textContent = message;
    el('pinForm').hidden = mode !== 'pin';
    el('registerForm').hidden = mode !== 'register';
    el('retryConnection').hidden = mode !== 'none' || !window.CHAGOG_CONFIG;
    document.querySelector('main').inert = true;
    document.querySelector('aside').inert = true;
    const focus = mode === 'pin' ? 'pin' : mode === 'register' ? 'password' : null;
    if (focus) setTimeout(() => el(focus).focus(), 0);
  }
  /** 이 기기가 등록돼 있으면 PIN 화면, 아니면 등록 화면 */
  async function lockedGate(message) {
    if (!window.CHAGOG_CONFIG) return gate(MESSAGES.NOT_CONFIGURED);
    if (await D.isRegistered()) gate(message || 'PIN 4자리를 입력하면 열려요.', { mode: 'pin' });
    else gate(message || '이 기기는 처음이에요. 설정할 때 정한 긴 비밀번호로 한 번 등록하면, 다음부터는 PIN 4자리로 열 수 있어요.', { mode: 'register' });
  }
  function unlockUI() {
    el('lockScreen').hidden = true;
    document.querySelector('main').inert = false;
    document.querySelector('aside').inert = false;
    for (const id of ['pin', 'password', 'newPin', 'newPin2']) el(id).value = '';
    ready = true;
  }
  function lock(message) {
    clearTimeout(saveTimer);
    secret = null; dataKey = null; sha = null; rev = 0; dirty = false; conflict = false;
    window.LedgerApp.replace(empty());
    baseDoc = empty();
    el('currentUser').textContent = '';
    el('syncWarning').hidden = true;
    status('잠겨 있음');
    gate(message || '잠겼어요.');   // 화면을 바로 가린 뒤, PIN/등록 화면으로 전환
    return lockedGate(message);
  }

  const FATAL = ['TOKEN_INVALID', 'TOKEN_FORBIDDEN', 'REPO_NOT_FOUND', 'DECRYPT_FAILED'];
  async function reload() {
    if (saving || !secret) return false;
    try {
      const result = await read();
      const document = result.document || empty();
      window.LedgerApp.replace(document);
      baseDoc = clone(document);
      sha = result.sha; rev = result.rev;
      dirty = false; conflict = false;
      el('currentUser').textContent = `저장소: ${secret.owner}/${secret.repo}`;
      el('syncWarning').hidden = true;
      el('localMigration').hidden = !localStorage.getItem('chagog-ledger-v1');
      unlockUI();
      lastActive = Date.now();
      status(result.document ? readyText : '새 가계부 · 첫 기록을 저장하거나 백업을 불러와 주세요');
      checkRepoIsPrivate();
      return true;
    } catch (error) {
      const code = error?.message;
      if (FATAL.includes(code)) {
        // 이 기기에 저장된 열쇠로는 더 이상 열 수 없음 → 등록을 지우고 새 설정의 긴 비밀번호로 다시 등록
        secret = null; dataKey = null;
        await D.forget();
        await lockedGate(`${MESSAGES[code]} 설정을 바꿨다면 긴 비밀번호로 이 기기를 다시 등록해 주세요.`);
      } else gate(MESSAGES[code] || '기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return false;
    }
  }
  async function checkRepoIsPrivate() {
    try {
      const response = await api('');
      if (response.ok && (await response.json()).private === false) {
        el('syncWarning').hidden = false;
        el('syncWarning').textContent = `⚠️ 기록 저장소(${secret.owner}/${secret.repo})가 공개 상태예요. 기록은 암호화되어 있지만, GitHub 저장소 Settings에서 Private으로 바꿔 주세요.`;
      }
    } catch { /* 경고 확인 실패는 무시 */ }
  }

  // ---------- 저장 ----------
  async function freshRemote() {
    // 방금 저장된 내용이 GitHub에 반영되기까지 잠깐 걸릴 수 있어, 새 버전이 보일 때까지 기다린다.
    for (let attempt = 0; attempt < 6; attempt++) {
      const latest = await read();
      if (latest.sha !== sha) return latest;
      await sleep(1500);
    }
    throw Error('CONFLICT');
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!ready || saving || !dirty || conflict || !secret) return;
    saving = true;
    status('↻ 암호화해서 저장 중…');
    let mergeAttempts = 0, code = '';
    try {
      while (dirty) {
        const version = seq;
        const snapshot = window.LedgerApp.snapshot();
        const result = await write(snapshot, rev + 1);
        if (result.conflict) {
          // 다른 기기에서 먼저 저장함 → 서로 다른 항목만 자동 병합, 같은 칸을 고쳤으면 멈춤
          if (++mergeAttempts > 3) { conflict = true; throw Error('CONFLICT'); }
          const latest = await freshRemote();
          const remote = latest.document || empty();
          const merged = window.LedgerMerge.mergeDocuments(baseDoc, window.LedgerApp.snapshot(), remote);
          if (!merged) { conflict = true; throw Error('CONFLICT'); }
          window.LedgerApp.replace(merged);
          baseDoc = clone(remote);
          sha = latest.sha; rev = latest.rev;
          seq++;
          status('↻ 다른 기기의 변경 내역과 자동 병합 중…');
          continue;
        }
        baseDoc = clone(snapshot);
        sha = result.sha; rev += 1;
        if (version === seq) dirty = false;
      }
      status(readyText);
      el('syncWarning').hidden = true;
    } catch (error) {
      code = error?.message;
      if (code === 'CONFLICT') conflict = true;
      status(conflict ? '충돌 감지 · 수동 확인 필요' : '저장 실패 · 백업 필요');
      el('syncWarning').hidden = false;
      el('syncWarning').textContent = conflict
        ? '다른 기기에서 같은 항목을 동시에 수정했습니다. 덮어쓰지 않고 중단했습니다. 먼저 데이터 백업을 받은 뒤 ‘최신 기록 불러오기’를 눌러 주세요.'
        : `${MESSAGES[code] || '저장하지 못했습니다.'} 저장 재시도를 누르거나, 페이지를 닫기 전에 데이터 백업을 받아 주세요.`;
    } finally { saving = false; }
  }

  window.CloudLedger = {
    configured: true,
    save() {
      if (!ready || !secret) return false;
      dirty = true;
      seq++;
      lastActive = Date.now();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DELAY_MS);
      return true;
    },
  };

  // ---------- 버튼 ----------
  async function openWith(getSecret, form, onSuccess) {
    const buttons = form.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    el('lockMessage').textContent = '여는 중…';
    try {
      secret = await getSecret();
      dataKey = await V.importDataKey(secret.dataKey);
      if (await reload() && onSuccess) await onSuccess(secret);
    } catch (error) {
      secret = null; dataKey = null;
      const code = error?.message;
      await sleep(400);
      if (code === 'WRONG_PIN') gate(`PIN이 맞지 않아요. (남은 기회 ${error.left}번)`, { mode: 'pin' });
      else await lockedGate(MESSAGES[code] || MESSAGES.WRONG_PASSWORD);
    } finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  el('pinForm').onsubmit = event => {
    event.preventDefault();
    const pin = el('pin').value;
    el('pin').value = '';
    if (!/^\d{4}$/.test(pin)) return gate(MESSAGES.PIN_FORMAT, { mode: 'pin' });
    openWith(() => D.unlock(pin), el('pinForm'));
  };
  el('pin').addEventListener('input', () => {
    el('pin').value = el('pin').value.replace(/\D/g, '').slice(0, 4);
    if (el('pin').value.length === 4) el('pinForm').requestSubmit();
  });
  el('registerForm').onsubmit = event => {
    event.preventDefault();
    const password = el('password').value, pin = el('newPin').value;
    if (!/^\d{4}$/.test(pin)) return void (el('lockMessage').textContent = MESSAGES.PIN_FORMAT);
    if (pin !== el('newPin2').value) return void (el('lockMessage').textContent = MESSAGES.PIN_MISMATCH);
    // 긴 비밀번호로 연 뒤 기록을 실제로 불러오는 데 성공하면 이 기기를 등록
    openWith(() => V.unlockConfig(password, window.CHAGOG_CONFIG), el('registerForm'), found => D.register(pin, found));
  };
  el('forgetDevice').onclick = async () => {
    if (!confirm('이 기기의 PIN 등록을 지울까요? 기록은 지워지지 않고, 긴 비밀번호로 다시 등록하면 돼요.')) return;
    await D.forget();
    lockedGate();
  };
  el('retrySave').onclick = flush;
  el('reloadServer').onclick = () => {
    if (!dirty || confirm('미저장 내용을 버리고 최신 기록을 불러올까요? 먼저 백업하세요.')) reload();
  };
  el('retryConnection').onclick = () => (secret ? reload() : lockedGate());
  el('localMigration').onclick = () => {
    if (!ready) return;
    if (!confirm('이 브라우저에 남아 있던 예전 기록으로 가계부를 교체할까요? 먼저 백업을 권장합니다.')) return;
    try {
      window.LedgerApp.replace(JSON.parse(localStorage.getItem('chagog-ledger-v1')));
      window.CloudLedger.save();
    } catch { alert('데이터를 읽지 못했습니다. JSON 백업 파일로 불러와 주세요.'); }
  };
  el('lockNow').onclick = () => {
    if (saving) return alert('저장이 끝난 뒤 잠가 주세요.');
    if (dirty) return alert('아직 저장되지 않은 내용이 있습니다. 저장을 재시도하거나 백업해 주세요.');
    lock();
  };
  window.addEventListener('beforeunload', event => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });

  // ---------- 다른 기기 변경 확인 / 자동 잠금 ----------
  async function poll() {
    if (!ready || dirty || saving || reading || document.hidden || el('dialog').open) return;
    reading = true;
    try {
      const latest = await read();
      // 더 새로운 버전일 때만 반영(방금 저장한 것보다 오래된 응답은 무시)
      if (!dirty && !saving && !el('dialog').open && ready && latest.rev > rev) {
        const document = latest.document || empty();
        window.LedgerApp.replace(document);
        baseDoc = clone(document);
        sha = latest.sha; rev = latest.rev;
      }
      if (!conflict) status(readyText);
    } catch (error) {
      const code = error?.message;
      if (['TOKEN_INVALID', 'TOKEN_FORBIDDEN', 'REPO_NOT_FOUND'].includes(code)) { await D.forget(); lock(`${MESSAGES[code]} 그 다음 긴 비밀번호로 이 기기를 다시 등록해 주세요.`); }
      else status('연결 확인 필요');
    } finally { reading = false; }
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(name =>
    window.addEventListener(name, () => { lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (ready && !dirty && !saving && Date.now() - lastActive > IDLE_LOCK_MS) lock('30분 동안 사용하지 않아 자동으로 잠갔어요.');
  }, 60000);
  window.addEventListener('focus', poll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  setInterval(poll, POLL_MS);

  window.ChagogSync = { lock, flush, poll, state: () => ({ ready, sha, rev, dirty, conflict }) };
  status('잠겨 있음');
  gate('확인 중…');
  lockedGate();
})();
