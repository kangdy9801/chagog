import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
// 실행: npm i jsdom@24 fake-indexeddb@6 후 node tests/e2e.test.mjs (Node 22+)
const dir = new URL('../', import.meta.url).pathname;
const snap = app => JSON.parse(JSON.stringify(app.w.LedgerApp.snapshot()));
const settle = (ms = 200) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw Error('timeout'); await settle(50); } };

// ---- fake GitHub (one private repo) ----
const gh = { token: 'github_pat_GOOD', owner: 'ekdus', repo: 'chagog-data', private: true, file: null, history: [], stale: 0, calls: [], requests: 0 };
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
async function fakeFetch(url, opts = {}) {
  gh.requests++;
  const u = new URL(url); const h = opts.headers || {}; const method = opts.method || 'GET';
  const res = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  if (h.Authorization !== `Bearer ${gh.token}`) return res(401, { message: 'Bad credentials' });
  const base = `/repos/${gh.owner}/${gh.repo}`;
  if (!u.pathname.startsWith(base)) return res(404, { message: 'Not Found' });
  const rest = u.pathname.slice(base.length);
  if (rest === '') return res(200, { private: gh.private, permissions: { push: true } });
  if (rest !== '/contents/ledger.enc.json') return res(404, {});
  if (method === 'GET') {
    // simulate CDN staleness: return previous version for `stale` reads
    const f = gh.stale > 0 && gh.history.length > 1 ? (gh.stale--, gh.history.at(-2)) : gh.file;
    if (!f) return res(404, { message: 'Not Found' });
    if (h.Accept === 'application/vnd.github.raw+json') return res(200, f.text);
    return f.text.length > 1000000 ? res(200, { sha: f.sha, encoding: 'none', content: '' }) : res(200, { sha: f.sha, encoding: 'base64', content: b64(f.text).replace(/(.{60})/g, '$1\n') });
  }
  if (method === 'PUT') {
    const body = JSON.parse(opts.body);
    if (gh.file && body.sha !== gh.file.sha) return res(gh.file && !body.sha ? 422 : 409, { message: 'conflict' });
    if (!gh.file && body.sha) return res(409, {});
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    gh.file = { text, sha: createHash('sha1').update(text + Math.random()).digest('hex') };
    gh.history.push(gh.file); gh.calls.push(body.message);
    return res(200, { content: { sha: gh.file.sha } });
  }
}

function makeWindow(page, configJs, device = new IDBFactory()) {
  const html = fs.readFileSync(dir + page, 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://ekdus.github.io/chagog/' + (page === 'index.html' ? '' : page), runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.fetch = fakeFetch; w.Response = Response; w.indexedDB = device;
  w.HTMLDialogElement.prototype.showModal ||= function () { this.open = true; };
  w.HTMLDialogElement.prototype.close ||= function () { this.open = false; };
  w.alert = () => {}; w.confirm = () => true;
  w.eval(configJs ?? fs.readFileSync(dir + 'config.js', 'utf8'));
  const scripts = page === 'index.html' ? ['vault.js', 'device.js', 'core.js', 'app.js', 'merge.js', 'github-sync.js'] : ['vault.js', 'setup.js'];
  for (const f of scripts) w.eval(fs.readFileSync(dir + f, 'utf8'));
  return { w, device, $: id => w.document.getElementById(id) };
}
const submit = (app, id) => app.$(id).dispatchEvent(new app.w.Event('submit', { cancelable: true }));
const PW = 'correct horse battery';
const register = async (app, pw = PW, pin = '1234', pin2 = pin) => {
  await until(() => !app.$('registerForm').hidden);
  app.$('password').value = pw; app.$('newPin').value = pin; app.$('newPin2').value = pin2; submit(app, 'registerForm');
};
const typePin = async (app, pin) => {
  await until(() => !app.$('pinForm').hidden);
  app.$('pin').value = pin; app.$('pin').dispatchEvent(new app.w.Event('input'));   // 4자리면 자동 제출
};

// ---- 0. unconfigured index ----
let app = makeWindow('index.html');
await until(() => /설정되지/.test(app.$('lockMessage').textContent));

// ---- 1. setup: public repo refused, bad token refused, then OK ----
let s = makeWindow('setup.html');
assert.equal(s.$('newForm').hidden, false);
const fillNew = (token, pw = 'correct horse battery', pw2 = pw) => { s.$('owner').value = 'ekdus'; s.$('repo').value = 'chagog-data'; s.$('token').value = token; s.$('pw1').value = pw; s.$('pw2').value = pw2; submit(s, 'newForm'); };
fillNew(gh.token, 'short'); await settle(); assert.match(s.$('msg').textContent, /10자/);
fillNew(gh.token, 'correct horse battery', 'nope nope nope'); await settle(); assert.match(s.$('msg').textContent, /일치/);
fillNew('github_pat_BAD'); await settle(); assert.match(s.$('msg').textContent, /토큰/);
gh.private = false; fillNew(gh.token); await settle(); assert.match(s.$('msg').textContent, /Private/); gh.private = true;
fillNew(gh.token); await until(() => !s.$('result').hidden);
const configJs = s.$('output').value;
assert.ok(!configJs.includes('github_pat_GOOD'), 'token must not be in plaintext');
assert.match(configJs, /window\.CHAGOG_CONFIG = \{/);

// ---- 2. device A: wrong password, then unlock, empty ledger, import ----
const A = makeWindow('index.html', configJs);
await register(A, PW, '1234', '1243'); await until(() => /일치하지/.test(A.$('lockMessage').textContent));
await register(A, PW, '12a4'); await until(() => /숫자 4자리/.test(A.$('lockMessage').textContent));
await register(A, 'wrong password!!'); await until(() => /맞지 않아요/.test(A.$('lockMessage').textContent));
assert.equal(A.$('registerForm').hidden, false);
await register(A); await until(() => A.$('lockScreen').hidden);
assert.match(A.$('saveState').textContent, /새 가계부/);
const addTx = (app, id, amount) => { const d = snap(app); d.transactions.push({ id, date: '2026-10-21', category: '생활', detail: id, amount, discount: 0, card: '카드', account: '국민', note: '' }); app.w.LedgerApp.replace(d); app.w.CloudLedger.save(); };
addTx(A, 'imported', 1200); addTx(A, 'second', 50);   // debounced into one commit
await until(() => gh.file && !A.w.ChagogSync.state().dirty);
assert.equal(gh.calls.length, 1);
assert.ok(!gh.file.text.includes('imported'), 'data must be encrypted in the repo');

// ---- 3. setup again refuses to overwrite existing data file ----
s = makeWindow('setup.html'); fillNew(gh.token); await settle(1500); assert.match(s.$('msg').textContent, /이미 기록 파일/);

// ---- 4. device B sees same data ----
const B = makeWindow('index.html', configJs);
await register(B, PW, '9999'); await until(() => B.$('lockScreen').hidden);
assert.deepEqual(snap(B).transactions.map(t => t.id), ['imported', 'second']);

// ---- 5. both edit different rows at once -> merged; with CDN staleness ----
addTx(A, 'from-A', 10); await until(() => !A.w.ChagogSync.state().dirty);
gh.stale = 2;                       // B's conflict re-read first sees the old version
addTx(B, 'from-B', 20); await until(() => !B.w.ChagogSync.state().dirty, 20000);
await A.w.ChagogSync.poll(); await settle();
for (const d of [A, B]) assert.deepEqual(snap(d).transactions.map(t => t.id).sort(), ['from-A', 'from-B', 'imported', 'second']);

// ---- 6. stale poll must not roll back ----
const revBefore = A.w.ChagogSync.state().rev;
gh.stale = 1; await A.w.ChagogSync.poll();
assert.equal(A.w.ChagogSync.state().rev, revBefore);
assert.equal(snap(A).transactions.length, 4);

// ---- 7. same field conflict -> stop, no overwrite ----
const edit = (app, amount) => { const d = snap(app); d.transactions.find(t => t.id === 'imported').amount = amount; app.w.LedgerApp.replace(d); app.w.CloudLedger.save(); };
edit(A, 1); await until(() => !A.w.ChagogSync.state().dirty);
edit(B, 2); await until(() => B.w.ChagogSync.state().conflict, 20000);
assert.equal(B.$('syncWarning').hidden, false);

// ---- 8. password change keeps data readable; old password stops working ----
s = makeWindow('setup.html', configJs);
assert.equal(s.$('changeForm').hidden, false);
s.$('curPw').value = 'correct horse battery'; s.$('newPw1').value = s.$('newPw2').value = 'a brand new passphrase'; submit(s, 'changeForm');
await until(() => !s.$('result').hidden);
const config2 = s.$('output').value;
const C = makeWindow('index.html', config2);
await register(C, PW); await until(() => /맞지 않아요/.test(C.$('lockMessage').textContent));
await register(C, 'a brand new passphrase', '5555'); await until(() => C.$('lockScreen').hidden);
// 이미 등록된 기기 A는 새 설정이 올라와도 PIN 그대로 열림
const A2 = makeWindow('index.html', config2, A.device);
await typePin(A2, '1234'); await until(() => A2.$('lockScreen').hidden);
A2.$('lockNow').click();
assert.equal(snap(C).transactions.find(t => t.id === 'imported').amount, 1);

// ---- 9. expired token -> locked with message ----
gh.token = 'github_pat_ROTATED';
await C.w.ChagogSync.poll(); await until(() => !C.$('lockScreen').hidden && /만료/.test(C.$('lockMessage').textContent) && !C.$('registerForm').hidden);
assert.equal(snap(C).transactions.length, 0, 'data cleared from screen when locked');

// ---- 10. lock button clears data ----
gh.token = 'github_pat_GOOD';
A.$('reloadServer').click(); await settle(400);
A.$('lockNow').click(); assert.equal(A.$('lockScreen').hidden, false); assert.equal(snap(A).transactions.length, 0);
// 같은 기기 다시 열기: PIN 화면, 틀리면 남은 횟수, 맞으면 열림
await until(() => !A.$('pinForm').hidden);
await typePin(A, '0000'); await until(() => /남은 기회 4번/.test(A.$('lockMessage').textContent));
await typePin(A, '1234'); await until(() => A.$('lockScreen').hidden);
A.$('lockNow').click();
// 5번 틀리면 이 기기 등록 삭제 → 긴 비밀번호로 재등록
for (let i = 0; i < 5; i++) { await typePin(A, '0000'); await until(() => /남은 기회|5번 틀려서/.test(A.$('lockMessage').textContent)); if (i < 4) await until(() => !A.$('pinForm').querySelector('button').disabled); }
await until(() => !A.$('registerForm').hidden); assert.match(A.$('lockMessage').textContent, /5번 틀려서/);
await register(A, PW, '4321'); await until(() => A.$('lockScreen').hidden);
// 장치 열쇠는 꺼낼 수 없는 형태로 저장
await until(() => !A.$('registerForm').querySelector('button').disabled);
const rec = await new Promise(r => { const q = A.device.open('chagog-device'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('registration'); g.onsuccess = () => r(g.result); }; });
assert.equal(rec.deviceKey.extractable, false); assert.ok(!JSON.stringify(rec.box).includes('github_pat'));

// ---- 11. large (>1MB) file path ----
const D = makeWindow('index.html', configJs);
await register(D); await until(() => D.$('lockScreen').hidden);
const big = snap(D); for (let i = 0; i < 6000; i++) big.transactions.push({ id: 'b' + i, date: '2026-10-21', category: '생활', detail: '대용량 테스트 '.repeat(5), amount: i, discount: 0, card: '카드', account: '국민', note: '' });
D.w.LedgerApp.replace(big); D.w.CloudLedger.save(); await until(() => !D.w.ChagogSync.state().dirty);
assert.ok(gh.file.text.length > 1000000);
const E = makeWindow('index.html', configJs);
await register(E); await until(() => E.$('lockScreen').hidden, 20000);
assert.equal(snap(E).transactions.length, big.transactions.length);

console.log('PASS solo e2e: setup checks, device registration + 4-digit PIN (lockout after 5), encryption at rest, password unlock, cross-device sync, merge with stale reads, conflict stop, password change, token expiry, lock, >1MB file');
process.exit(0);
