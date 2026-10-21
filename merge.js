/* Three-way merge for independent edits made on two signed-in devices.
 * Never guess if both users changed/deleted the same item differently.
 */
(() => {
  const MISSING = Symbol('missing');
  const object = v => v !== MISSING && v !== null && typeof v === 'object' && !Array.isArray(v);
  const copy = v => v === MISSING ? MISSING : JSON.parse(JSON.stringify(v));
  function equal(a, b) {
    if (a === b) return true;
    if (a === MISSING || b === MISSING) return false;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
    if (object(a) && object(b)) {
      const ak = Object.keys(a), bk = Object.keys(b);
      return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]));
    }
    return false;
  }
  function asIdMap(value) {
    if (!Array.isArray(value)) throw Error('not an array');
    const result = new Map();
    for (const item of value) {
      if (!object(item) || typeof item.id !== 'string' || result.has(item.id)) throw Error('invalid item id');
      result.set(item.id, item);
    }
    return result;
  }
  function mergeValue(base, local, remote) {
    if (equal(local, remote)) return copy(local);
    if (equal(local, base)) return copy(remote);
    if (equal(remote, base)) return copy(local);

    if (Array.isArray(local) && Array.isArray(remote) && (Array.isArray(base) || base === MISSING)) {
      const baseMap = asIdMap(base === MISSING ? [] : base);
      const localMap = asIdMap(local), remoteMap = asIdMap(remote);
      const ids = new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()]);
      const result = [];
      for (const id of ids) {
        const item = mergeValue(baseMap.get(id) ?? MISSING, localMap.get(id) ?? MISSING, remoteMap.get(id) ?? MISSING);
        if (item !== MISSING) result.push(item);
      }
      return result;
    }

    if (object(local) && object(remote) && (object(base) || base === MISSING)) {
      const result = Object.create(null);
      const keys = new Set([
        ...Object.keys(base === MISSING ? {} : base),
        ...Object.keys(remote),
        ...Object.keys(local),
      ]);
      for (const key of keys) {
        const field = mergeValue(
          base !== MISSING && Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
          Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
          Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING,
        );
        if (field !== MISSING) result[key] = field;
      }
      return result;
    }
    throw Error('simultaneous change to the same field');
  }

  function mergeDocuments(base, local, remote) {
    try {
      if (!base || !local || !remote) return null;
      const merged = mergeValue(base, local, remote);
      if (merged === MISSING || !object(merged)) return null;
      // Two accounts may independently add the same account name with different
      // IDs. A combined duplicate is invalid; report a conflict instead.
      for (const list of Object.values(merged.budgets || {})) {
        if (!Array.isArray(list)) return null;
        const accounts = new Set();
        for (const entry of list) {
          if (!object(entry) || typeof entry.account !== 'string' || accounts.has(entry.account)) return null;
          accounts.add(entry.account);
        }
      }
      return merged;
    } catch {
      return null;
    }
  }
  window.LedgerMerge = { mergeDocuments };
})();
