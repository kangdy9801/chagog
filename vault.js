// 차곡 · 암호화 도구
// 비밀번호 → PBKDF2(SHA-256) → AES-GCM 256 키. 모든 암호화는 브라우저 안에서만 일어납니다.
(function (root) {
  const subtle = root.crypto.subtle;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const ITERATIONS = 600000;

  const toB64 = bytes => {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const random = n => root.crypto.getRandomValues(new Uint8Array(n));
  // UTF-8 text <-> base64 (GitHub API needs base64 file content)
  const textToB64 = text => toB64(enc.encode(text));
  const b64ToText = b64 => dec.decode(fromB64(b64.replace(/\s/g, '')));

  async function passwordKey(password, saltB64, iterations = ITERATIONS) {
    const material = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const importDataKey = rawB64 => subtle.importKey('raw', fromB64(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function seal(key, value, aad) {
    const iv = random(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value)));
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function open(key, box, aad) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv), additionalData: enc.encode(aad) }, key, fromB64(box.ct));
    return JSON.parse(dec.decode(pt));
  }

  /** config.js 에 들어갈 잠금 묶음을 만든다. secret = { token, owner, repo, path, dataKey } */
  async function lockConfig(password, secret) {
    const salt = toB64(random(16));
    const key = await passwordKey(password, salt);
    return { format: 'chagog-config-v1', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, box: await seal(key, secret, 'chagog-config-v1') };
  }
  /** 비밀번호가 틀리면 Error('WRONG_PASSWORD') */
  async function unlockConfig(password, config) {
    if (!config || config.format !== 'chagog-config-v1') throw Error('NOT_CONFIGURED');
    try {
      const key = await passwordKey(password, config.salt, config.iterations);
      return await open(key, config.box, 'chagog-config-v1');
    } catch { throw Error('WRONG_PASSWORD'); }
  }
  const newDataKey = () => toB64(random(32));

  const random16 = () => toB64(random(16));
  const api = { passwordKey, random16, toB64, fromB64, textToB64, b64ToText, lockConfig, unlockConfig, newDataKey, importDataKey, seal, open, ITERATIONS };
  if (typeof module !== 'undefined') module.exports = api; else root.ChagogVault = api;
})(typeof window !== 'undefined' ? window : globalThis);
