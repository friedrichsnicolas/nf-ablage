/* Geräte-Abgleich über Dropbox – Ende-zu-Ende-verschlüsselt.
 *
 * Dropbox sieht nur bereits verschlüsselte Pakete im App-Ordner „Apps/<App-Name>“:
 *   vault.json        verpackter Datenschlüssel (wie lokal, ohne Passwort wertlos)
 *   docs/<id>.json    {iv, ct}  verschlüsselte Angaben eines Dokuments
 *   files/<id>.bin    IV (12 Byte) + verschlüsselter Dateiinhalt
 * Die Dropbox-App ist als „App folder“ angelegt: kein Zugriff auf den Rest der Dropbox.
 *
 * Konflikte: Wurde ein Dokument auf zwei Geräten zugleich geändert, gewinnt die jüngere Änderung.
 */
import * as C from "./crypto.js";
import * as DB from "./db.js";
import { DROPBOX } from "./config.js";

const API = "https://api.dropboxapi.com", CONTENT = "https://content.dropboxapi.com";
const te = new TextEncoder(), td = new TextDecoder();
const b64url = u8 => C.b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const enabled = () => !!DROPBOX.appKey;

let S, hooks, st = null, access = null, accessExp = 0, running = null, again = false, timer = null;
const status = { state: "off", text: "" };
const DEFAULT = () => ({ provider: "dropbox", refresh: null, account: "", revs: {}, up: {}, dirty: {}, gone: {}, gfiles: [], lastSync: null, needsLogin: false });

export async function init(state, h) {
  S = state; hooks = h;
  st = await DB.getMeta("sync");
  if (st) setStatus(st.needsLogin ? "login" : "idle");
}
export const connected = () => !!st?.refresh || !!st?.needsLogin;
export const info = () => ({ ...status, account: st?.account || "", lastSync: st?.lastSync || null, needsLogin: !!st?.needsLogin });
const save = () => DB.setMeta("sync", st);
function setStatus(state, text = "") { status.state = state; status.text = text; hooks?.onStatus?.(info()); }

/* ---------------- Anmeldung (OAuth 2.0 Autorisierungscode + PKCE, ohne Server) ----------------
 * Dropbox zeigt nach der Freigabe einen Code an, der in der App eingefügt wird. Das funktioniert
 * überall gleich, auch in der iPhone-Home-Bildschirm-App (getrennter Speicher von Safari). */
export async function authUrl() {
  const verifier = b64url(C.rand(32));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(verifier))));
  await DB.setMeta("oauth", { verifier, t: Date.now() });
  const q = new URLSearchParams({
    client_id: DROPBOX.appKey, response_type: "code", token_access_type: "offline",
    code_challenge: challenge, code_challenge_method: "S256",
  });
  return `https://www.dropbox.com/oauth2/authorize?${q}`;
}

async function tokenRequest(params) {
  const r = await fetch(`${API}/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: DROPBOX.appKey, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || "Anmeldung fehlgeschlagen"); e.code = j.error; throw e; }
  access = j.access_token; accessExp = Date.now() + ((j.expires_in || 14400) - 120) * 1000;
  return j;
}

export async function exchangeCode(code) {
  const o = await DB.getMeta("oauth");
  if (!o) throw new Error("Anmeldung abgelaufen – bitte erneut verbinden.");
  const j = await tokenRequest({ grant_type: "authorization_code", code: code.trim(), code_verifier: o.verifier });
  await DB.setMeta("oauth", null);
  st = { ...(st || DEFAULT()), refresh: j.refresh_token, needsLogin: false };
  try {
    const r = await api("/2/users/get_current_account", null);
    st.account = (await r.json()).name?.display_name || "";
  } catch {}
  await save(); setStatus("idle");
}

async function token() {
  if (access && Date.now() < accessExp) return access;
  if (!st?.refresh) throw Object.assign(new Error("Nicht verbunden"), { login: true });
  try { await tokenRequest({ grant_type: "refresh_token", refresh_token: st.refresh }); return access; }
  catch (e) {
    if (e.code) { // Zugriff in Dropbox widerrufen o. Ä.
      st.refresh = null; st.needsLogin = true; await save(); setStatus("login");
      throw Object.assign(e, { login: true });
    }
    throw e;
  }
}

/* Dropbox-API-Aufruf. arg = JSON-Argument (RPC: Body, Content: Header). */
async function call(host, path, { arg, body, rpc = true } = {}, retry = true) {
  const headers = { Authorization: "Bearer " + (await token()) };
  let payload;
  if (rpc) { if (arg !== null && arg !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(arg); } }
  else { headers["Dropbox-API-Arg"] = JSON.stringify(arg); if (body) { headers["Content-Type"] = "application/octet-stream"; payload = body; } }
  const r = await fetch(host + path, { method: "POST", headers, body: payload });
  if (r.status === 401 && retry) { access = null; return call(host, path, { arg, body, rpc }, false); }
  if ((r.status === 429 || r.status === 503) && retry) {
    await new Promise(res => setTimeout(res, Math.min(30, +(r.headers.get("Retry-After") || 3)) * 1000));
    return call(host, path, { arg, body, rpc }, false);
  }
  return r;
}
const api = (path, arg) => call(API, path, { arg });
async function errOf(r) { const t = await r.text().catch(() => ""); try { return JSON.parse(t).error_summary || t; } catch { return t; } }
async function fail(r, what) { throw new Error(`${what}: ${r.status} ${(await errOf(r)).slice(0, 160)}`); }

async function listFolder(folder) {
  const out = new Map();
  let r = await api("/2/files/list_folder", { path: "/" + folder, limit: 2000 });
  for (;;) {
    if (r.status === 409) { if ((await errOf(r)).includes("not_found")) return out; await fail(r, "Liste"); }
    if (!r.ok) await fail(r, "Liste");
    const j = await r.json();
    j.entries.filter(e => e[".tag"] === "file").forEach(e => out.set(e.name, e.rev));
    if (!j.has_more) return out;
    r = await api("/2/files/list_folder/continue", { cursor: j.cursor });
  }
}
async function download(path) {
  const r = await call(CONTENT, "/2/files/download", { arg: { path: "/" + path }, rpc: false });
  if (r.status === 409) { if ((await errOf(r)).includes("not_found")) return null; await fail(r, "Download"); }
  if (!r.ok) await fail(r, "Download");
  return new Uint8Array(await r.arrayBuffer());
}
/* match: rev (nur überschreiben, wenn unverändert) | "new" (nur anlegen) | null (immer überschreiben) */
async function upload(path, data, match = null) {
  const mode = match === "new" ? "add" : match ? { ".tag": "update", update: match } : "overwrite";
  const r = await call(CONTENT, "/2/files/upload", { arg: { path: "/" + path, mode, autorename: false, mute: true, strict_conflict: true }, body: data, rpc: false });
  if (r.status === 409) { const e = await errOf(r); if (e.includes("conflict")) return { conflict: true }; throw new Error("Upload: " + e); }
  if (!r.ok) await fail(r, "Upload");
  return { etag: (await r.json()).rev };
}
async function remove(path) {
  const r = await api("/2/files/delete_v2", { path: "/" + path });
  if (r.status === 409 && (await errOf(r)).includes("not_found")) return;
  if (!r.ok) await fail(r, "Löschen");
}

const packDoc = rec => te.encode(JSON.stringify({ iv: C.b64(rec.iv), ct: C.b64(rec.ct) }));
const unpackDoc = (id, u8) => { const j = JSON.parse(td.decode(u8)); return { id, iv: C.unb64(j.iv), ct: C.unb64(j.ct) }; };
const packFile = rec => { const u = new Uint8Array(12 + rec.ct.byteLength); u.set(rec.iv); u.set(new Uint8Array(rec.ct), 12); return u; };
const unpackFile = (id, u8) => ({ id, iv: u8.slice(0, 12), ct: u8.slice(12) });

/* ---------------- Tresor in Dropbox ---------------- */
export async function remoteVault() {
  const u8 = await download("vault.json");
  return u8 ? JSON.parse(td.decode(u8)) : null;
}
export async function pushVault() {
  if (!st?.refresh) return;
  await upload("vault.json", te.encode(JSON.stringify(S.meta)));
}

/* Nach dem Verbinden: eigenen Tresor hochladen oder feststellen, dass schon ein anderer existiert. */
export async function attach() {
  const rv = await remoteVault();
  if (!rv) {
    if (!S.meta.vid) { S.meta = { ...S.meta, vid: C.newId(), changed: S.meta.changed || S.meta.created }; await DB.setMeta("vault", S.meta); }
    await pushVault();
    st.revs = {}; st.up = {}; S.docs.forEach(d => st.dirty[d.id] = true); await save();
    return { status: "uploaded" };
  }
  if (rv.vid && rv.vid === S.meta.vid) return { status: "same" };
  return { status: "other", vault: rv };
}

/* Lokale Dokumente in den Tresor aus Dropbox übernehmen (umverschlüsseln). */
export async function adoptRemoteVault(rv, remoteKey) {
  const [docs, files] = await Promise.all([DB.all("docs"), DB.all("files")]);
  const newDocs = [], newFiles = [];
  for (const r of docs) newDocs.push(await C.encryptBytes(remoteKey, await C.decryptBytes(S.key, r), r.id));
  for (const r of files) newFiles.push(await C.encryptBytes(remoteKey, await C.decryptBytes(S.key, r), r.id));
  await DB.write({ docs: newDocs, files: newFiles });
  S.meta = rv; S.key = remoteKey; await DB.setMeta("vault", rv);
  st.revs = {}; st.up = {}; S.docs.forEach(d => st.dirty[d.id] = true); await save();
}

export async function disconnect() { st = null; access = null; await DB.setMeta("sync", null); setStatus("off"); }

/* ---------------- Änderungen vormerken ---------------- */
export async function markDirty(id) { if (!st) return; st.dirty[id] = true; await save(); schedule(); }
export async function markRemovedFiles(ids) { if (!st || !ids.length) return; st.gfiles.push(...ids); await save(); }
export async function markDeleted(doc) {
  if (!st) return;
  delete st.dirty[doc.id];
  if (st.revs[doc.id]) st.gone[doc.id] = doc.files.map(f => f.id);
  else st.gfiles.push(...doc.files.map(f => f.id).filter(f => st.up[f]));
  await save(); schedule();
}
export function schedule(ms = 1500) { clearTimeout(timer); timer = setTimeout(() => syncNow(), ms); }

/* Datei nachladen, die auf diesem Gerät noch fehlt. */
export async function fetchFile(id) {
  if (!st?.refresh) return null;
  const u8 = await download(`files/${id}.bin`);
  if (!u8) return null;
  const rec = unpackFile(id, u8);
  await DB.write({ files: [rec] });
  return rec;
}

/* ---------------- Abgleich ---------------- */
export function syncNow() {
  if (!st?.refresh || !S.key) return Promise.resolve();
  if (running) { again = true; return running; }
  running = run().finally(() => { running = null; if (again) { again = false; schedule(300); } });
  return running;
}

async function run() {
  setStatus("busy", "Gleiche ab …");
  let changed = false;
  try {
    // 1) Tresor (z. B. Passwort auf anderem Gerät geändert)
    const rv = await remoteVault();
    if (!rv) await pushVault();
    else if (rv.vid !== S.meta.vid) throw new Error("In Dropbox liegt ein anderer Tresor. Bitte in den Einstellungen neu verbinden.");
    else if ((rv.changed || "") > (S.meta.changed || "")) { S.meta = rv; await DB.setMeta("vault", rv); }
    else if ((rv.changed || "") < (S.meta.changed || "")) await pushVault();

    // 2) Entfernte Änderungen holen
    const remote = new Map([...(await listFolder("docs"))].filter(([n]) => n.endsWith(".json")).map(([n, e]) => [n.slice(0, -5), e]));
    for (const [id, etag] of remote) {
      if (st.dirty[id] || st.gone[id] || st.revs[id] === etag) continue;
      const u8 = await download(`docs/${id}.json`); if (!u8) continue;
      const rec = unpackDoc(id, u8);
      const body = await C.decryptJSON(S.key, rec);
      await applyRemote(rec, body);
      st.revs[id] = etag; changed = true;
    }
    // 3) Auf anderem Gerät gelöscht
    for (const id of Object.keys(st.revs)) {
      if (remote.has(id) || st.dirty[id]) continue;
      const doc = S.docs.find(d => d.id === id);
      await DB.write({ deleteDocs: [id], deleteFiles: doc ? doc.files.map(f => f.id) : [] });
      S.docs = S.docs.filter(d => d.id !== id);
      delete st.revs[id]; changed = true;
    }
    await save();

    // 4) Eigene Löschungen hochladen
    for (const [id, fids] of Object.entries(st.gone)) {
      await remove(`docs/${id}.json`);
      for (const f of fids) { await remove(`files/${f}.bin`); delete st.up[f]; }
      delete st.gone[id]; delete st.revs[id]; await save();
    }
    while (st.gfiles.length) { const f = st.gfiles[0]; await remove(`files/${f}.bin`); delete st.up[f]; st.gfiles.shift(); await save(); }

    // 5) Eigene Änderungen hochladen
    for (const id of Object.keys(st.dirty)) {
      const doc = S.docs.find(d => d.id === id);
      const rec = await DB.get("docs", id);
      if (!doc || !rec) { delete st.dirty[id]; continue; }
      for (const f of doc.files) {
        if (st.up[f.id]) continue;
        const fr = await DB.get("files", f.id); if (!fr) continue;
        await upload(`files/${f.id}.bin`, packFile(fr)); st.up[f.id] = true; await save();
      }
      let res = await upload(`docs/${id}.json`, packDoc(rec), st.revs[id] || "new");
      if (res.conflict) { // gleichzeitig woanders geändert: jüngere Fassung gewinnt
        const u8 = await download(`docs/${id}.json`);
        const rrec = u8 && unpackDoc(id, u8), rbody = rrec && await C.decryptJSON(S.key, rrec);
        if (rbody && (rbody.updated || "") > (doc.updated || "")) {
          await applyRemote(rrec, rbody); changed = true;
          res = { etag: (await listFolder("docs")).get(`${id}.json`) };
        } else res = await upload(`docs/${id}.json`, packDoc(rec), null);
      }
      st.revs[id] = res.etag; delete st.dirty[id]; await save();
    }
    st.lastSync = new Date().toISOString(); await save();
    setStatus("ok");
  } catch (e) {
    if (e.login) setStatus("login");
    else setStatus(navigator.onLine ? "error" : "offline", navigator.onLine ? e.message : "Offline");
  }
  if (changed) hooks?.onRemoteChange?.();
}

async function applyRemote(rec, body) {
  await DB.write({ docs: [rec] });
  body.files.forEach(f => st.up[f.id] = true);
  const doc = { id: rec.id, ...body }, i = S.docs.findIndex(d => d.id === rec.id);
  const old = i >= 0 ? S.docs[i] : null;
  if (old) { // Dateien, die es in der neuen Fassung nicht mehr gibt, lokal entfernen
    const gone = old.files.filter(f => !body.files.some(n => n.id === f.id)).map(f => f.id);
    if (gone.length) await DB.write({ deleteFiles: gone });
    S.docs[i] = doc;
  } else S.docs.push(doc);
}
