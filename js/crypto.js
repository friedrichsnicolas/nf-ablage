/* Verschlüsselung der Ablage – ausschließlich Web Crypto API des Browsers.
 *
 * Schlüsselhierarchie:
 *   Datenschlüssel (DEK)  zufällige 256 Bit, verschlüsselt alle Dokumente (AES-256-GCM)
 *   ├─ verpackt mit Master-Passwort       PBKDF2-SHA-256, 600.000 Runden, 16 Byte Salt
 *   └─ verpackt mit Wiederherstellungsschl. 160 Bit Zufall, PBKDF2 100.000 Runden
 * Der DEK liegt im Betrieb nur als nicht exportierbarer CryptoKey im Arbeitsspeicher.
 * Jeder Datensatz bekommt einen eigenen Zufalls-IV; seine ID ist als AAD gebunden,
 * damit verschlüsselte Datensätze nicht unbemerkt vertauscht werden können.
 */
const te = new TextEncoder(), td = new TextDecoder();
const subtle = crypto.subtle;

export const PW_ITER = 600_000;
const REC_ITER = 100_000;
const WRAP_AAD = te.encode("nf-ablage/schluessel/v1");

export const rand = n => crypto.getRandomValues(new Uint8Array(n));
export const newId = () => [...rand(12)].map(b => b.toString(16).padStart(2, "0")).join("");

export function b64(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKek(secret, salt, iterations) {
  const base = await subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function wrapRaw(raw, secret, iterations) {
  const salt = rand(16), iv = rand(12);
  const kek = await deriveKek(secret, salt, iterations);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: WRAP_AAD }, kek, raw);
  return { salt: b64(salt), iv: b64(iv), iter: iterations, ct: b64(ct) };
}

/* Wirft bei falschem Passwort (GCM-Authentifizierung schlägt fehl). */
async function unwrapRaw(w, secret) {
  const kek = await deriveKek(secret, unb64(w.salt), w.iter);
  return new Uint8Array(await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(w.iv), additionalData: WRAP_AAD }, kek, unb64(w.ct)));
}

const importDek = raw => subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

/* ---- Wiederherstellungsschlüssel: 32 Zeichen Base32 ohne verwechselbare Zeichen ---- */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRecoveryKey() {
  const bytes = rand(20); let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join("-");
}
export const normRecovery = s => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/* ---- Tresor anlegen / öffnen ---- */
export async function createVault(password) {
  const raw = rand(32);
  const recoveryKey = makeRecoveryKey();
  const meta = {
    format: "nf-ablage", v: 1, created: new Date().toISOString(),
    pw: await wrapRaw(raw, password, PW_ITER),
    rec: await wrapRaw(raw, normRecovery(recoveryKey), REC_ITER),
  };
  const key = await importDek(raw); raw.fill(0);
  return { meta, key, recoveryKey };
}

export async function unlockWithPassword(meta, password) {
  const raw = await unwrapRaw(meta.pw, password);
  const key = await importDek(raw); raw.fill(0);
  return key;
}

/* Liefert zusätzlich den Rohschlüssel, damit direkt ein neues Passwort gesetzt werden kann. */
export async function unlockWithRecovery(meta, recoveryKey) {
  const raw = await unwrapRaw(meta.rec, normRecovery(recoveryKey));
  return { key: await importDek(raw), raw };
}

export async function rewrapPassword(meta, raw, newPassword) {
  return { ...meta, pw: await wrapRaw(raw, newPassword, PW_ITER) };
}

export async function changePassword(meta, oldPassword, newPassword) {
  const raw = await unwrapRaw(meta.pw, oldPassword);
  try { return await rewrapPassword(meta, raw, newPassword); } finally { raw.fill(0); }
}

export async function newRecoveryKey(meta, password) {
  const raw = await unwrapRaw(meta.pw, password);
  try {
    const recoveryKey = makeRecoveryKey();
    return { meta: { ...meta, rec: await wrapRaw(raw, normRecovery(recoveryKey), REC_ITER) }, recoveryKey };
  } finally { raw.fill(0); }
}

/* ---- Datensätze ---- */
export async function encryptBytes(key, data, id) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(id) }, key, data);
  return { id, iv, ct: new Uint8Array(ct) };
}
export async function decryptBytes(key, rec) {
  return subtle.decrypt({ name: "AES-GCM", iv: rec.iv, additionalData: te.encode(rec.id) }, key, rec.ct);
}
export const encryptJSON = (key, obj, id) => encryptBytes(key, te.encode(JSON.stringify(obj)), id);
export const decryptJSON = async (key, rec) => JSON.parse(td.decode(await decryptBytes(key, rec)));

/* Grobe Passwortstärke (0–4) ohne externe Bibliothek. */
export function strength(pw) {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-zäöüß]/.test(pw)) pool += 30;
  if (/[A-ZÄÖÜ]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9äöüßÄÖÜ]/.test(pw)) pool += 33;
  const uniq = new Set(pw).size;
  const bits = Math.min(pw.length, uniq * 2) * Math.log2(Math.max(pool, 2));
  return bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
}
