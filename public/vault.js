const key = "khat.workspace.v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let connection;

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("khat-vault", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("profiles", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function store(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("profiles", mode);
    const request = operation(transaction.objectStore("profiles"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function profiles() {
  const records = await store("readonly", db => db.getAll());
  return records.map(({ id, name }) => ({ id, name }));
}

async function derive(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256",
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function session(record, secret) {
  let pending = Promise.resolve();
  return {
    name: record.name,
    save(value) {
      const snapshot = encoder.encode(JSON.stringify(value));
      const save = pending.catch(() => {}).then(async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({
          name: "AES-GCM", iv, additionalData: encoder.encode(record.id),
        }, secret, snapshot);
        await store("readwrite", db => db.put({ ...record, iv, ciphertext }));
      });
      pending = save;
      return save;
    },
    flush() { return pending; },
  };
}

async function lease(id) {
  if (!navigator.locks) throw new Error("profileUnavailable");
  return new Promise((resolve, reject) => {
    navigator.locks.request(`khat-vault-${id}`, { ifAvailable: true }, lock => {
      if (!lock) throw new Error("profileBusy");
      return new Promise(release => resolve(release));
    }).catch(reject);
  });
}

export async function unlock(id, password) {
  const release = await lease(id);
  try {
    const record = await store("readonly", db => db.get(id));
    if (!record) throw new Error("profileUnavailable");
    const secret = await derive(password, record.salt);
    let data;
    try {
      data = await crypto.subtle.decrypt({
        name: "AES-GCM", iv: record.iv, additionalData: encoder.encode(id),
      }, secret, record.ciphertext);
    } catch {
      throw new Error("wrongPassword");
    }
    return { ...session(record, secret), data: JSON.parse(decoder.decode(data)), release };
  } catch (error) {
    release();
    throw error;
  }
}

export async function createProfile(name, password, defaults, importLegacy) {
  const id = crypto.randomUUID();
  const release = await lease(id);
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const secret = await derive(password, salt);
    const profile = session({ id, name, salt }, secret);
    const previous = importLegacy ? localStorage.getItem(key) : null;
    const data = previous ? { ...defaults, ...JSON.parse(previous), memoryEnabled: false } : defaults;
    await profile.save(data);
    if (previous) localStorage.removeItem(key);
    return { ...profile, data, release };
  } catch (error) {
    release();
    throw error;
  }
}

export function canImportLegacy() {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}
