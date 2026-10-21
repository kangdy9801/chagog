// 차곡 · 기기 등록 + 4자리 PIN
// 긴 비밀번호로 이 기기를 한 번 등록하면, 이후에는 이 기기에서만 4자리 PIN으로 엽니다.
// - 기기 열쇠는 이 브라우저 안에서 만들어지고 밖으로 꺼낼 수 없는 형태(non-extractable)로 저장됩니다.
// - PIN을 5번 틀리면 이 기기 등록이 지워지고, 긴 비밀번호로 다시 등록해야 합니다.
(function (root) {
  const V = root.ChagogVault;
  const DB = 'chagog-device', STORE = 'kv', KEY = 'registration', MAX_FAILS = 5;

  function db() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function run(mode, action) {
    const conn = await db();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => { conn.close(); resolve(request ? request.result : undefined); };
      tx.onerror = tx.onabort = () => { conn.close(); reject(tx.error); };
    });
  }
  const read = () => run('readonly', s => s.get(KEY)).catch(() => null);
  const write = value => run('readwrite', s => s.put(value, KEY));
  const forget = () => run('readwrite', s => s.delete(KEY)).catch(() => {});

  async function register(pin, secret) {
    const deviceKey = await root.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const salt = V.random16();
    const pinKey = await V.passwordKey(pin, salt);
    const inner = await V.seal(pinKey, secret, 'chagog-pin-v1');
    const box = await V.seal(deviceKey, inner, 'chagog-device-v1');
    await write({ version: 1, deviceKey, salt, iterations: V.ITERATIONS, box, fails: 0 });
    try { await root.navigator.storage?.persist?.(); } catch { /* 선택 사항 */ }
  }

  /** 맞으면 secret, 틀리면 Error('WRONG_PIN') (error.left = 남은 횟수), 5번째면 Error('PIN_LOCKED_OUT') */
  async function unlock(pin) {
    const record = await read();
    if (!record) throw Error('NOT_REGISTERED');
    try {
      const inner = await V.open(record.deviceKey, record.box, 'chagog-device-v1');
      const pinKey = await V.passwordKey(pin, record.salt, record.iterations);
      const secret = await V.open(pinKey, inner, 'chagog-pin-v1');
      if (record.fails) await write({ ...record, fails: 0 });
      return secret;
    } catch {
      const fails = (record.fails || 0) + 1;
      if (fails >= MAX_FAILS) { await forget(); throw Error('PIN_LOCKED_OUT'); }
      await write({ ...record, fails });
      const error = Error('WRONG_PIN');
      error.left = MAX_FAILS - fails;
      throw error;
    }
  }

  root.ChagogDevice = { register, unlock, forget, isRegistered: async () => !!(await read()), MAX_FAILS };
})(window);
