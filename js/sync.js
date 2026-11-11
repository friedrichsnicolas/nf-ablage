/* Geräte-Abgleich über OneDrive (Microsoft Graph) – Ende-zu-Ende-verschlüsselt.
 *
 * OneDrive sieht nur bereits verschlüsselte Pakete im App-Ordner „Apps/NF-Ablage“:
 *   vault.json        verpackter Datenschlüssel (wie lokal, ohne Passwort wertlos)
 *   docs/<id>.json    {iv, ct}  verschlüsselte Angaben eines Dokuments
 *   files/<id>.bin    IV (12 Byte) + verschlüsselter Dateiinhalt
 * Die App hat nur das Recht „Files.ReadWrite.AppFolder“: kein Zugriff auf den Rest des OneDrive.
 *
 * Konflikte: Wurde ein Dokument auf zwei Geräten zugleich geändert, gewinnt die jüngere Änderung.
 */
import * as C from "./crypto.js";
import * as DB from "./db.js";
import { ONEDRIVE } from "./config.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SMALL = 4 * 1024 * 1024, CHUNK = 32 * 320 * 1024; // Upload-Sitzung in 10-MiB-Stücken
const te = new TextEncoder(), td = new TextDecoder();
const b64url = u8 => C.b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");
export const enabled = () => !!ONEDRIVE.clientId;

let S, hooks, st = null, access = null, accessExp = 0, running = null, again = false, timer = null;
const status = { state: "off", text: "" };
const DEFAULT = () => ({ provider: "onedrive", refresh: null, account: "", revs: {}, up: {}, dirty: {}, gone: {}, gfiles: [], lastSync: null, needsLogin: false });

export async function init(state, h) {
  S = state; hooks = h;
  st = await DB.getMeta("sync");
  if (st) setStatus(st.needsLogin ? "login" : "idle");
}
export const connected = () => !!st?.refresh || !!st?.needsLogin;
export const info = () => ({ ...status, account: st?.account || "", lastSync: st?.lastSync || null, needsLogin: !!st?.needsLogin });
const save = () => DB.setMeta("sync", st);
function setStatus(state, text = "") { status.state = state; status.text = text; hooks?.onStatus?.(info()); }

/* ---------------- Anmeldung (OAuth 2.0 Autorisierungscode + PKCE) ---------------- */
export async function authUrl() {
  const verifier = b64url(C.rand(32)), state = b64url(C.rand(16));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(verifier))));
  await DB.setMeta("oauth", { verifier, state, t: Date.now() });
  const q = new URLSearchParams({
    client_id: ONEDRIVE.clientId, response_type: "code", redirect_uri: redirectUri(), response_mode: "query",
    scope: ONEDRIVE.scopes, code_challenge: challenge, code_challenge_method: "S256", state,
  });
  return `${ONEDRIVE.authority}/oauth2/v2.0/authorize?${q}`;
}

/* Wartet auf den Code aus dem Anmeldefenster (gleicher Browser) – alternativ wird er eingefügt. */
export function waitForCode() {
  return new Promise(resolve => {
    const bc = "BroadcastChannel" in window ? new BroadcastChannel("nf-ablage-auth") : null;
    const done = code => { bc?.close(); removeEventListener("message", onMsg); resolve(code); };
    const onMsg = e => { if (e.origin === location.origin && e.data?.nfAuthCode) done(e.data.nfAuthCode); };
    if (bc) bc.onmessage = e => e.data?.nfAuthCode && done(e.data.nfAuthCode);
    addEventListener("message", onMsg);
    waitForCode.cancel = () => { bc?.close(); removeEventListener("message", onMsg); };
  });
}

/* Läuft auf der Rücksprungseite. Gibt true zurück, wenn es ein Anmelde-Rücksprung war. */
export function handleCallback(render) {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return false;
  history.replaceState(null, "", redirectUri());
  if (q.get("error")) { render({ error: q.get("error_description") || q.get("error") }); return true; }
  const code = q.get("code");
  try { new BroadcastChannel("nf-ablage-auth").postMessage({ nfAuthCode: code }); } catch {}
  try { window.opener?.postMessage({ nfAuthCode: code }, location.origin); } catch {}
  render({ code });
  return true;
}

async function tokenRequest(params) {
  const r = await fetch(`${ONEDRIVE.authority}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ONEDRIVE.clientId, scope: ONEDRIVE.scopes, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || "Anmeldung fehlgeschlagen"); e.code = j.error; throw e; }
  access = j.access_token; accessExp = Date.now() + (j.expires_in - 120) * 1000;
  return j;
}

export async function exchangeCode(code) {
  const o = await DB.getMeta("oauth");
  if (!o) throw new Error("Anmeldung abgelaufen – bitte erneut verbinden.");
  const j = await tokenRequest({ grant_type: "authorization_code", code: code.trim(), redirect_uri: redirectUri(), code_verifier: o.verifier });
  await DB.setMeta("oauth", null);
  st = { ...(st || DEFAULT()), refresh: j.refresh_token, needsLogin: false };
  try {
    const d = await (await graph("/me/drive?$select=owner")).json();
    st.account = d.owner?.user?.displayName || "";
  } catch {}
  await save(); setStatus("idle");
}

async function token() {
  if (access && Date.now() < accessExp) return access;
  if (!st?.refresh) throw Object.assign(new Error("Nicht verbunden"), { login: true });
  try {
    const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: st.refresh });
    if (j.refresh_token) { st.refresh = j.refresh_token; await save(); }
    return access;
  } catch (e) {
    if (e.code) { // z. B. invalid_grant: Anmeldung abgelaufen (bei Web-Apps nach spätestens 24 h)
      st.refresh = null; st.needsLogin = true; await save(); setStatus("login");
      throw Object.assign(e, { login: true });
    }
    throw e;
  }
}

async function graph(path, opt = {}, retry = true) {
  const r = await fetch(path.startsWith("http") ? path : GRAPH + path,
    { ...opt, headers: { Authorization: "Bearer " + (await token()), ...(opt.headers || {}) } });
  if (r.status === 401 && retry) { access = null; return graph(path, opt, false); }
  if (r.status === 429 || r.status === 503) {
    const wait = Math.min(30, +(r.headers.get("Retry-After") || 3));
    await new Promise(res => setTimeout(res, wait * 1000));
    if (retry) return graph(path, opt, false);
  }
  return r;
}
const P = p => `/me/drive/special/approot:/${p}:`;
async function fail(r, what) { const t = await r.text().catch(() => ""); throw new Error(`${what}: ${r.status} ${t.slice(0, 160)}`); }

async function listFolder(folder) {
  const out = new Map();
  let url = `${P(folder)}/children?$select=name,eTag&$top=999`;
  while (url) {
    const r = await graph(url);
    if (r.status === 404) return out;
    if (!r.ok) await fail(r, "Liste");
    const j = await r.json();
    j.value.forEach(i => out.set(i.name, i.eTag));
    url = j["@odata.nextLink"] || null;
  }
  return out;
}
async function download(path) {
  const r = await graph(`${P(path)}/content`);
  if (r.status === 404) return null;
  if (!r.ok) await fail(r, "Download");
  return new Uint8Array(await r.arrayBuffer());
}
/* match: eTag (nur überschreiben, wenn unverändert) | "new" (nur anlegen) | null (immer überschreiben) */
async function upload(path, data, match = null) {
  if (data.byteLength <= SMALL) {
    const headers = { "Content-Type": "application/octet-stream" };
    if (match && match !== "new") headers["If-Match"] = match;
    const qs = match === "new" ? "?@microsoft.graph.conflictBehavior=fail" : "";
    const r = await graph(`${P(path)}/content${qs}`, { method: "PUT", headers, body: data });
    if (r.status === 412 || r.status === 409) return { conflict: true };
    if (!r.ok) await fail(r, "Upload");
    return { etag: (await r.json()).eTag };
  }
  const s = await graph(`${P(path)}/createUploadSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  if (!s.ok) await fail(s, "Upload-Sitzung");
  const { uploadUrl } = await s.json();
  let res;
  for (let i = 0; i < data.byteLength; i += CHUNK) {
    const end = Math.min(i + CHUNK, data.byteLength);
    res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${i}-${end - 1}/${data.byteLength}` }, body: data.slice(i, end) });
    if (!res.ok && res.status !== 202) await fail(res, "Upload-Teil");
  }
  return { etag: (await res.json().catch(() => ({}))).eTag };
}
async function remove(path) {
  const r = await graph(P(path), { method: "DELETE" });
  if (!r.ok && r.status !== 404) await fail(r, "Löschen");
}

const packDoc = rec => te.encode(JSON.stringify({ iv: C.b64(rec.iv), ct: C.b64(rec.ct) }));
const unpackDoc = (id, u8) => { const j = JSON.parse(td.decode(u8)); return { id, iv: C.unb64(j.iv), ct: C.unb64(j.ct) }; };
const packFile = rec => { const u = new Uint8Array(12 + rec.ct.byteLength); u.set(rec.iv); u.set(new Uint8Array(rec.ct), 12); return u; };
const unpackFile = (id, u8) => ({ id, iv: u8.slice(0, 12), ct: u8.slice(12) });

/* ---------------- Tresor in OneDrive ---------------- */
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

/* Lokale Dokumente in den Tresor aus OneDrive übernehmen (umverschlüsseln). */
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
    else if (rv.vid !== S.meta.vid) throw new Error("In OneDrive liegt ein anderer Tresor. Bitte in den Einstellungen neu verbinden.");
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
