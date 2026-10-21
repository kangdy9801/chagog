(() => {
  const $ = id => document.getElementById(id);
  const V = window.ChagogVault;
  const DATA_PATH = 'ledger.enc.json';
  const current = window.CHAGOG_CONFIG;

  const say = (text, kind = 'error') => { $('msg').textContent = text; $('msg').className = `msg ${kind}`; };
  function show(mode) {
    $('newForm').hidden = mode !== 'new';
    $('changeForm').hidden = mode !== 'change';
    $('tabNew').classList.toggle('active', mode === 'new');
    $('tabChange').classList.toggle('active', mode === 'change');
    $('result').hidden = true;
    say('');
  }
  $('tabNew').onclick = () => show('new');
  $('tabChange').onclick = () => (current ? show('change') : say('아직 만든 설정이 없어요. ‘처음 설정’을 먼저 해 주세요.'));
  show(current ? 'change' : 'new');

  async function gh(token, owner, repo, path = '') {
    try {
      return await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch { throw Error('인터넷 연결을 확인해 주세요.'); }
  }
  /** 저장소 접근·비공개 여부 확인. 기록 파일이 있으면 true */
  async function checkRepo(token, owner, repo) {
    const r = await gh(token, owner, repo);
    if (r.status === 401) throw Error('토큰이 올바르지 않거나 만료됐어요.');
    if (r.status === 404 || r.status === 403) throw Error(`${owner}/${repo} 저장소에 접근할 수 없어요. 아이디·저장소 이름과, 토큰을 만들 때 이 저장소를 선택했는지 확인해 주세요.`);
    if (!r.ok) throw Error('GitHub 확인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    const info = await r.json();
    if (info.private !== true) throw Error(`${owner}/${repo} 저장소가 공개(Public) 상태예요. 저장소 Settings에서 Private으로 바꾼 뒤 다시 시도해 주세요.`);
    const f = await gh(token, owner, repo, `/contents/${DATA_PATH}`);
    if (f.status === 404) return false;
    if (f.status === 401 || f.status === 403) throw Error('토큰에 저장소 내용(Contents) 읽기 권한이 없어요.');
    if (!f.ok) throw Error('GitHub 확인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    return true;
  }
  function output(config) {
    $('output').value = `// 차곡 설정 (setup.html 에서 ${new Date().toLocaleString('ko-KR')} 에 생성)\n// 비밀번호로 잠겨 있어요. 이 파일만으로는 기록을 열 수 없어요.\nwindow.CHAGOG_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
    $('result').hidden = false;
    say('설정을 만들었어요. 아래 순서대로 config.js 에 넣어 주세요.', 'ok');
    $('result').scrollIntoView({ behavior: 'smooth' });
  }
  async function busy(form, task) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    say('확인 중…', 'ok');
    try { await task(); } catch (error) { say(error.message || '실패했어요.'); } finally { button.disabled = false; }
  }

  $('newForm').onsubmit = event => {
    event.preventDefault();
    busy($('newForm'), async () => {
      const owner = $('owner').value.trim(), repo = $('repo').value.trim(), token = $('token').value.trim();
      const pw = $('pw1').value;
      if (pw.length < 10) throw Error('긴 비밀번호는 10자 이상으로 정해 주세요. PIN 4자리는 각 기기에서 따로 정해요.');
      if (pw !== $('pw2').value) throw Error('비밀번호 확인이 일치하지 않아요.');
      if (await checkRepo(token, owner, repo)) {
        throw Error(`${owner}/${repo} 에 이미 기록 파일(${DATA_PATH})이 있어요. 새 설정으로는 기존 파일을 열 수 없어서 멈췄어요. 비밀번호를 기억한다면 ‘토큰·비밀번호 변경’을 쓰고, 처음부터 다시 하려면 백업 JSON을 받아 둔 뒤 그 파일을 지우고 다시 시도해 주세요.`);
      }
      output(await V.lockConfig(pw, { owner, repo, token, path: DATA_PATH, dataKey: V.newDataKey() }));
      $('token').value = $('pw1').value = $('pw2').value = '';
    });
  };

  $('changeForm').onsubmit = event => {
    event.preventDefault();
    busy($('changeForm'), async () => {
      let secret;
      try { secret = await V.unlockConfig($('curPw').value, current); } catch { throw Error('현재 긴 비밀번호가 맞지 않아요.'); }
      const newToken = $('newToken').value.trim(), newPw = $('newPw1').value;
      if (!newToken && !newPw) throw Error('새 토큰이나 새 비밀번호 중 하나는 입력해 주세요.');
      if (newPw && newPw.length < 10) throw Error('새 비밀번호는 10자 이상으로 정해 주세요.');
      if (newPw && newPw !== $('newPw2').value) throw Error('새 비밀번호 확인이 일치하지 않아요.');
      if (newToken) secret.token = newToken;
      await checkRepo(secret.token, secret.owner, secret.repo);
      // 기록을 암호화한 키(dataKey)는 그대로 두고, 그 키를 감싸는 비밀번호만 바꾼다 → 기존 기록 그대로 열림
      output(await V.lockConfig(newPw || $('curPw').value, secret));
      $('curPw').value = $('newToken').value = $('newPw1').value = $('newPw2').value = '';
    });
  };

  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('output').value); say('복사했어요. 이제 config.js 에 붙여넣어 주세요.', 'ok'); }
    catch { $('output').select(); say('자동 복사가 안 돼요. 선택된 내용을 직접 복사해 주세요.'); }
  };
})();
