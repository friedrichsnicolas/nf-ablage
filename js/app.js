/* NF · Dokumentenablage – private, clientseitig verschlüsselte Dokumentenverwaltung. */
import * as C from "./crypto.js";
import * as DB from "./db.js";
import * as Sync from "./sync.js";

const APP_VERSION = "1.1";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const root = $("#app");

const CATS = [
  ["ausweise", "Ausweise & Urkunden"], ["versicherung", "Versicherungen"], ["steuern", "Steuern & Finanzen"],
  ["vertraege", "Verträge & Abos"], ["wohnen", "Wohnen & Haus"], ["auto", "Auto & Mobilität"],
  ["gesundheit", "Gesundheit"], ["arbeit", "Arbeit & Bildung"], ["rechnungen", "Rechnungen & Garantien"],
  ["sonstiges", "Sonstiges"],
];
const catName = id => (CATS.find(c => c[0] === id) || CATS.at(-1))[1];

const I = { // schlichte Linien-Icons
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="4.5" y="11" width="15" height="10" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  note: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.3 1.5A3.75 3.75 0 0 1 17.5 18z"/>',
};
const ico = (n, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;

/* ---------------- Zustand ---------------- */
const S = {
  key: null, meta: null, prefs: {}, docs: [],
  view: "ablage", cat: "alle", q: "", sort: "neu",
  urls: [], lastActive: Date.now(), hiddenAt: 0, picking: false,
};
const DEFAULT_PREFS = { lockMin: 5, lastBackup: null, fails: 0, failUntil: 0 };
const savePrefs = () => DB.setMeta("prefs", S.prefs);

/* ---------------- Hilfen ---------------- */
const fmtDate = d => d ? new Date(d.length === 10 ? d + "T00:00" : d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const daysUntil = d => Math.round((new Date(d + "T00:00") - today()) / 864e5);
const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1).replace(".", ",") + " MB";
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function dueInfo(doc) {
  if (!doc.deadline) return null;
  const n = daysUntil(doc.deadline), warn = doc.remindDays ?? 30;
  const label = n < 0 ? `seit ${plural(-n, "Tag", "Tagen")} abgelaufen` : n === 0 ? "heute fällig" : n === 1 ? "morgen fällig" : `in ${n} Tagen`;
  return { n, label, cls: n < 0 ? "over" : n <= warn ? "soon" : "later", soon: n <= warn };
}

function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.append(t); setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}

/* Modaler Dialog. Liefert Eingabewert, true oder null (abgebrochen). */
function ask({ title, text = "", input = null, placeholder = "", ok = "OK", cancel = "Abbrechen", danger = false }) {
  return new Promise(resolve => {
    const o = document.createElement("div"); o.className = "overlay";
    o.innerHTML = `<form class="dialog" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ""}
      ${input ? `<input name="v" type="${input}" placeholder="${esc(placeholder)}" autocomplete="off" required>` : ""}
      <div class="row end">${cancel ? `<button type="button" class="btn ghost" data-x>${esc(cancel)}</button>` : ""}
      <button class="btn ${danger ? "danger" : "primary"}">${esc(ok)}</button></div></form>`;
    document.body.append(o);
    const f = $("form", o), close = v => { o.remove(); resolve(v); };
    f.onsubmit = e => { e.preventDefault(); close(input ? f.v.value : true); };
    $("[data-x]", o)?.addEventListener("click", () => close(null));
    (input ? f.v : $("button.btn:last-child", f)).focus();
  });
}

function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/* Auf Mobilgeräten über das Teilen-Menü (z. B. „In Dateien sichern“), sonst als Download. */
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  download(blob, name);
}

async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return c.toDataURL("image/jpeg", 0.72);
  } catch { return null; }
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* ---------------- Automatische Sperre ---------------- */
function lock() {
  S.key = null; S.docs = [];
  S.urls.forEach(u => URL.revokeObjectURL(u));
  root.innerHTML = "";
  location.reload(); // verwirft sicher alle entschlüsselten Daten im Arbeitsspeicher
}
const activity = () => { S.lastActive = Date.now(); };
["pointerdown", "keydown", "wheel", "touchstart", "input"].forEach(ev => addEventListener(ev, activity, { passive: true, capture: true }));
setInterval(() => { if (S.key && !S.picking && Date.now() - S.lastActive > S.prefs.lockMin * 60e3) lock(); }, 10e3);
document.addEventListener("visibilitychange", () => {
  if (!S.key) return;
  if (document.hidden) S.hiddenAt = Date.now();
  else {
    // Beim Wegwechseln: nach 1 Minute sperren (5 Minuten, solange Kamera/Dateiauswahl offen ist)
    const limit = S.picking ? 5 * 60e3 : 60e3;
    if (S.hiddenAt && Date.now() - S.hiddenAt > limit) lock();
    S.hiddenAt = 0;
  }
});
addEventListener("focus", () => setTimeout(() => { S.picking = false; }, 1500));

/* ---------------- Start ---------------- */
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!window.crypto?.subtle || !window.indexedDB) {
    root.innerHTML = `<main class="gate"><h1>Nicht unterstützt</h1><p class="gate-sub">Dieser Browser bietet keine sichere Verschlüsselung (HTTPS erforderlich).</p></main>`;
    return;
  }
  if (Sync.enabled() && Sync.handleCallback(renderCallback)) return;
  S.meta = await DB.getMeta("vault");
  S.prefs = { ...DEFAULT_PREFS, ...(await DB.getMeta("prefs")) };
  await Sync.init(S, { onStatus: renderSyncStatus, onRemoteChange: () => { if (S.key && $("#view")) renderView(); } });
  S.meta ? renderLock() : renderWelcome();
}

function gate(inner) {
  root.innerHTML = `<main class="gate"><img class="gate-logo" src="assets/img/NF_Monogramm_champagner.svg" alt="NF">${inner}</main>`;
}

/* ---------------- Ersteinrichtung ---------------- */
function renderWelcome() {
  gate(`<h1>Deine private Dokumentenablage</h1>
    <ul class="facts">
      <li>${ico("shield")}<span>Alles wird <b>auf diesem Gerät</b> mit AES-256 verschlüsselt, bevor es gespeichert wird.</span></li>
      <li>${ico("lock")}<span>Kein Server, keine Cloud, kein Konto. Nur dein Master-Passwort öffnet den Tresor.</span></li>
      <li>${ico("note")}<span>Es gibt keine Hintertür: Ohne Passwort und Wiederherstellungsschlüssel sind die Daten verloren.</span></li>
    </ul>
    <form id="f" class="gate-form">
      <input type="text" name="username" value="NF Dokumentenablage" autocomplete="username" hidden>
      <label>Master-Passwort<input type="password" name="pw" autocomplete="new-password" minlength="10" required></label>
      <div class="meter" aria-hidden="true"><i></i></div><p class="hint" id="sh">Mindestens 10 Zeichen. Tipp: ein Satz aus 4–5 Wörtern.</p>
      <label>Passwort wiederholen<input type="password" name="pw2" autocomplete="new-password" required></label>
      <label class="check"><input type="checkbox" name="ok" required><span>Ich habe verstanden, dass niemand mein Passwort zurücksetzen kann.</span></label>
      <button class="btn gold">Tresor anlegen</button>
      <p class="msg" role="alert"></p>
    </form>
    ${Sync.enabled() ? `<button class="btn ghost-light od" id="od">${ico("cloud")} Ablage von OneDrive übernehmen</button>` : ""}
    <button class="link" id="restore">Ich habe ein Backup – wiederherstellen</button>`);
  $("#od")?.addEventListener("click", connectNewDevice);
  const f = $("#f"), msg = $(".msg", f), meter = $(".meter", f);
  const words = ["", "schwach", "mittel", "gut", "sehr gut"];
  f.pw.oninput = () => {
    const s = C.strength(f.pw.value); meter.dataset.s = s;
    $("#sh").textContent = f.pw.value ? `Stärke: ${words[s]}` + (f.pw.value.length < 10 ? " · mindestens 10 Zeichen" : "") : "Mindestens 10 Zeichen. Tipp: ein Satz aus 4–5 Wörtern.";
  };
  f.onsubmit = async e => {
    e.preventDefault(); msg.textContent = "";
    if (f.pw.value !== f.pw2.value) return msg.textContent = "Die Passwörter stimmen nicht überein.";
    if (C.strength(f.pw.value) < 2) return msg.textContent = "Bitte ein stärkeres Passwort wählen.";
    const btn = $("button.btn", f); busy(btn, true, "Tresor wird angelegt …");
    try {
      const { meta, key, recoveryKey } = await C.createVault(f.pw.value);
      await DB.setMeta("vault", meta); S.meta = meta; S.key = key;
      navigator.storage?.persist?.();
      renderRecoveryKey(recoveryKey, true);
    } catch (err) { busy(btn, false); msg.textContent = "Fehler: " + err.message; }
  };
  $("#restore").onclick = () => restoreBackupAtSetup();
}

function renderRecoveryKey(recoveryKey, first) {
  gate(`<h1>Dein Wiederherstellungsschlüssel</h1>
    <p class="gate-sub wide">Damit öffnest du den Tresor, falls du dein Passwort vergisst. Drucke ihn aus oder schreib ihn ab und verwahre ihn <b>getrennt vom Gerät</b>, zum Beispiel bei deinen wichtigen Unterlagen. Er wird nur jetzt angezeigt.</p>
    <div class="reckey" id="rk">${esc(recoveryKey)}</div>
    <div class="row center"><button class="btn ghost-light" id="pr">Drucken</button><button class="btn ghost-light" id="cp">Kopieren</button></div>
    <form id="f" class="gate-form">
      <label class="check"><input type="checkbox" required><span>Ich habe den Schlüssel sicher notiert.</span></label>
      <button class="btn gold">${first ? "Zur Ablage" : "Fertig"}</button>
    </form>`);
  $("#print").innerHTML = `<div class="print-sheet"><img src="assets/img/NF_Wortbildmarke_quer_gruen.svg" alt="">
    <h1>Wiederherstellungsschlüssel</h1><p>NF · Dokumentenablage – erstellt am ${fmtDate(new Date().toISOString())}</p>
    <div class="print-key">${esc(recoveryKey)}</div>
    <p>Mit diesem Schlüssel lässt sich der Tresor öffnen, wenn das Master-Passwort vergessen wurde. Sicher und getrennt vom Gerät aufbewahren. Wer diesen Schlüssel und Zugriff auf das Gerät oder ein Backup hat, kann die Dokumente lesen.</p></div>`;
  $("#pr").onclick = () => window.print();
  $("#cp").onclick = async () => { try { await navigator.clipboard.writeText(recoveryKey); toast("Kopiert – bitte nicht in Notizen-Apps speichern"); } catch { toast("Kopieren nicht möglich"); } };
  $("#f").onsubmit = async e => {
    e.preventDefault(); $("#print").innerHTML = "";
    if (first) await afterUnlock(); else { renderMain(); S.view = "einstellungen"; renderView(); }
  };
}

/* ---------------- Entsperren ---------------- */
function renderLock() {
  gate(`<h1>Dokumentenablage</h1><p class="gate-sub">Privat · verschlüsselt · nur auf diesem Gerät</p>
    <form id="f" class="gate-form">
      <input type="text" name="username" value="NF Dokumentenablage" autocomplete="username" hidden>
      <label>Master-Passwort<input type="password" name="pw" autocomplete="current-password" required></label>
      <button class="btn gold">Entsperren</button>
      <p class="msg" role="alert"></p>
    </form>
    <button class="link" id="rec">Passwort vergessen? Wiederherstellungsschlüssel verwenden</button>`);
  const f = $("#f"), msg = $(".msg", f), btn = $("button.btn", f);
  setTimeout(() => f.pw.focus(), 50);
  // Passwort auf anderem Gerät geändert? Neueren Tresor-Schlüssel aus OneDrive holen (nur verschlüsselt).
  if (Sync.connected() && navigator.onLine) Sync.remoteVault().then(async rv => {
    if (rv?.vid && rv.vid === S.meta.vid && (rv.changed || "") > (S.meta.changed || "")) { S.meta = rv; await DB.setMeta("vault", rv); }
  }).catch(() => {});
  f.onsubmit = async e => {
    e.preventDefault(); msg.textContent = "";
    const wait = Math.ceil((S.prefs.failUntil - Date.now()) / 1000);
    if (wait > 0) return msg.textContent = `Zu viele Fehlversuche. Bitte ${wait} s warten.`;
    busy(btn, true, "Entschlüssele …");
    try {
      S.key = await C.unlockWithPassword(S.meta, f.pw.value);
      f.pw.value = ""; S.prefs.fails = 0; S.prefs.failUntil = 0; await savePrefs();
      await afterUnlock();
    } catch {
      busy(btn, false); f.pw.select();
      S.prefs.fails++;
      if (S.prefs.fails >= 3) S.prefs.failUntil = Date.now() + Math.min(300, 2 ** (S.prefs.fails - 2) * 5) * 1000;
      await savePrefs();
      msg.textContent = "Passwort falsch.";
    }
  };
  $("#rec").onclick = renderRecoveryUnlock;
}

function renderRecoveryUnlock() {
  gate(`<h1>Wiederherstellen</h1><p class="gate-sub wide">Gib deinen 32-stelligen Wiederherstellungsschlüssel ein. Danach legst du ein neues Master-Passwort fest.</p>
    <form id="f" class="gate-form">
      <label>Wiederherstellungsschlüssel<input name="rk" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-…" required></label>
      <button class="btn gold">Weiter</button><p class="msg" role="alert"></p>
    </form><button class="link" id="back">Zurück</button>`);
  const f = $("#f"), btn = $("button.btn", f);
  $("#back").onclick = renderLock;
  f.onsubmit = async e => {
    e.preventDefault(); busy(btn, true, "Prüfe …");
    try {
      const { key, raw } = await C.unlockWithRecovery(S.meta, f.rk.value);
      renderNewPassword(key, raw);
    } catch { busy(btn, false); $(".msg", f).textContent = "Schlüssel ungültig."; }
  };
}

function renderNewPassword(key, raw) {
  gate(`<h1>Neues Master-Passwort</h1>
    <form id="f" class="gate-form">
      <input type="text" name="username" value="NF Dokumentenablage" autocomplete="username" hidden>
      <label>Neues Passwort<input type="password" name="pw" autocomplete="new-password" minlength="10" required></label>
      <label>Wiederholen<input type="password" name="pw2" autocomplete="new-password" required></label>
      <button class="btn gold">Speichern</button><p class="msg" role="alert"></p>
    </form>`);
  const f = $("#f");
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.pw.value !== f.pw2.value) return $(".msg", f).textContent = "Die Passwörter stimmen nicht überein.";
    if (C.strength(f.pw.value) < 2) return $(".msg", f).textContent = "Bitte ein stärkeres Passwort wählen.";
    busy($("button.btn", f), true, "Speichere …");
    S.meta = await C.rewrapPassword(S.meta, raw, f.pw.value); raw.fill(0);
    await DB.setMeta("vault", S.meta);
    S.key = key; S.prefs.fails = 0; S.prefs.failUntil = 0; await savePrefs();
    Sync.pushVault().catch(() => {});
    await afterUnlock(); toast("Neues Passwort gespeichert");
  };
}

/* ---------------- Daten ---------------- */
async function afterUnlock() {
  await loadDocs(); renderMain();
  Sync.syncNow();
}
setInterval(() => { if (S.key && !document.hidden) Sync.syncNow(); }, 90e3);
addEventListener("online", () => S.key && Sync.syncNow());
document.addEventListener("visibilitychange", () => { if (S.key && !document.hidden) Sync.schedule(500); });

async function loadDocs() {
  const recs = await DB.all("docs");
  S.docs = (await Promise.all(recs.map(async r => {
    try { return { id: r.id, ...(await C.decryptJSON(S.key, r)) }; } catch { return null; }
  }))).filter(Boolean);
}

async function saveDoc(doc, newFiles, removedFileIds) {
  const files = [];
  for (const f of newFiles) {
    const id = C.newId();
    const buf = await f.blob.arrayBuffer();
    files.push(await C.encryptBytes(S.key, buf, id));
    doc.files.push({ id, name: f.name, type: f.blob.type || "application/octet-stream", size: f.blob.size });
    if (!doc.thumb && f.blob.type.startsWith("image/")) doc.thumb = await makeThumb(f.blob);
  }
  doc.files = doc.files.filter(x => !removedFileIds.includes(x.id));
  if (removedFileIds.length && doc.thumb && !doc.files.some(x => x.type.startsWith("image/"))) doc.thumb = null;
  doc.updated = new Date().toISOString();
  const { id, ...body } = doc;
  const rec = await C.encryptJSON(S.key, body, id);
  await DB.write({ docs: [rec], files, deleteFiles: removedFileIds });
  const i = S.docs.findIndex(d => d.id === id);
  i >= 0 ? (S.docs[i] = doc) : S.docs.push(doc);
  await Sync.markRemovedFiles(removedFileIds);
  await Sync.markDirty(id);
}

async function deleteDoc(doc) {
  await DB.write({ deleteDocs: [doc.id], deleteFiles: doc.files.map(f => f.id) });
  S.docs = S.docs.filter(d => d.id !== doc.id);
  await Sync.markDeleted(doc);
}

async function fileBlob(f) {
  const rec = (await DB.get("files", f.id)) || (await Sync.fetchFile(f.id));
  if (!rec) throw new Error("Datei fehlt");
  return new Blob([await C.decryptBytes(S.key, rec)], { type: f.type });
}

/* ---------------- Hauptansicht ---------------- */
function renderMain() {
  root.innerHTML = `
    <header class="top">
      <img class="wordmark" src="assets/img/NF_Wortbildmarke_quer_gruen.svg" alt="Nicolas Friedrichs">
      <span class="top-title">Dokumentenablage</span>
      <button class="icon-btn sync" id="syncbtn" hidden>${ico("cloud")}</button>
      <button class="icon-btn" id="lockbtn" title="Jetzt sperren" aria-label="Jetzt sperren">${ico("lock")}</button>
    </header>
    <div id="banner"></div>
    <main id="view" class="view"></main>
    <button class="fab" id="add" aria-label="Dokument hinzufügen">${ico("plus")}<span>Dokument</span></button>
    <nav class="tabs">
      <button data-v="ablage">${ico("folder")}<span>Ablage</span></button>
      <button data-v="fristen">${ico("cal")}<span>Fristen</span><b class="badge" id="badge" hidden></b></button>
      <button data-v="einstellungen">${ico("gear")}<span>Einstellungen</span></button>
    </nav>`;
  $("#lockbtn").onclick = lock;
  $("#syncbtn").onclick = () => {
    const i = Sync.info();
    if (i.state === "login") return reconnectOneDrive();
    Sync.syncNow(); if (i.text && i.state === "error") toast(i.text);
  };
  renderSyncStatus(Sync.info());
  $("#add").onclick = () => openEditor(null);
  $$(".tabs button").forEach(b => b.onclick = () => { S.view = b.dataset.v; renderView(); });
  renderView();
}

function renderBanner() {
  const b = $("#banner"); if (!b) return;
  if (Sync.info().needsLogin) {
    b.innerHTML = `<div class="banner">${ico("cloud")}<span>Die OneDrive-Anmeldung ist abgelaufen. Bitte kurz erneuern, damit deine Geräte weiter abgleichen.</span><button class="btn small" id="rc">Erneuern</button></div>`;
    $("#rc").onclick = reconnectOneDrive; return;
  }
  const last = S.prefs.lastBackup, days = last ? Math.floor((Date.now() - new Date(last)) / 864e5) : null;
  const synced = Sync.connected() && Sync.info().lastSync;
  if (S.docs.length && !synced && (days === null || days > 30)) {
    b.innerHTML = `<div class="banner">${ico("shield")}<span>${days === null ? "Noch kein Backup erstellt." : `Letztes Backup vor ${days} Tagen.`} Ein verschlüsseltes Backup schützt vor Geräteverlust.</span><button class="btn small" id="bk">Backup</button></div>`;
    $("#bk").onclick = exportBackup;
  } else b.innerHTML = "";
}

function renderView() {
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === S.view));
  $("#add").hidden = S.view === "einstellungen";
  const due = S.docs.filter(d => dueInfo(d)?.soon).length, badge = $("#badge");
  badge.hidden = !due; badge.textContent = due;
  renderBanner();
  ({ ablage: renderAblage, fristen: renderFristen, einstellungen: renderSettings })[S.view]();
  window.scrollTo(0, 0);
}

function card(d) {
  const due = dueInfo(d);
  const thumb = d.thumb ? `<img src="${d.thumb}" alt="">` : ico(d.files.length ? "file" : "note", "ico big");
  const meta = [catName(d.category), d.docDate && fmtDate(d.docDate), d.files.length && plural(d.files.length, "Datei", "Dateien")].filter(Boolean).join(" · ");
  return `<li><button class="card" data-id="${d.id}"><span class="thumb">${thumb}</span>
    <span class="card-body"><span class="card-title">${esc(d.title)}</span><span class="card-meta">${esc(meta)}</span>
    ${due || d.tags?.length ? `<span class="tags">${due ? `<span class="due ${due.cls}">${esc(due.label)}</span>` : ""}${(d.tags || []).map(t => `<i>${esc(t)}</i>`).join("")}</span>` : ""}</span></button></li>`;
}
const bindCards = el => $$(".card", el).forEach(c => c.onclick = () => openDetail(S.docs.find(d => d.id === c.dataset.id)));

function renderAblage() {
  const v = $("#view");
  v.innerHTML = `<div class="searchbar">${ico("search")}<input type="search" id="q" placeholder="Suchen …" value="${esc(S.q)}" aria-label="Suchen">
      <select id="sort" aria-label="Sortierung"><option value="neu">Neueste</option><option value="datum">Datum</option><option value="titel">A–Z</option></select></div>
    <div class="chips" id="chips"></div><ul class="list" id="list"></ul>`;
  $("#sort").value = S.sort;
  $("#q").oninput = e => { S.q = e.target.value; renderList(); };
  $("#sort").onchange = e => { S.sort = e.target.value; renderList(); };
  renderList();
}

function renderList() {
  const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = d => [d.title, d.notes, catName(d.category), ...(d.tags || []), ...d.files.map(f => f.name), fmtDate(d.docDate)].join(" ").toLowerCase();
  const matching = S.docs.filter(d => words.every(w => hay(d).includes(w)));
  const counts = {}; matching.forEach(d => counts[d.category] = (counts[d.category] || 0) + 1);
  if (S.cat !== "alle" && !counts[S.cat]) S.cat = "alle";
  $("#chips").innerHTML = [["alle", "Alle", matching.length], ...CATS.filter(c => counts[c[0]]).map(c => [c[0], c[1], counts[c[0]]])]
    .map(([id, n, k]) => `<button class="chip ${S.cat === id ? "on" : ""}" data-c="${id}">${esc(n)} <small>${k}</small></button>`).join("");
  $$("#chips .chip").forEach(c => c.onclick = () => { S.cat = c.dataset.c; renderList(); });
  const list = matching.filter(d => S.cat === "alle" || d.category === S.cat);
  const sorters = {
    neu: (a, b) => (b.updated || "").localeCompare(a.updated || ""),
    datum: (a, b) => (b.docDate || "").localeCompare(a.docDate || ""),
    titel: (a, b) => a.title.localeCompare(b.title, "de"),
  };
  list.sort(sorters[S.sort]);
  const el = $("#list");
  if (!S.docs.length) el.innerHTML = `<li class="empty">${ico("folder", "ico huge")}<h2>Noch leer</h2><p>Lege dein erstes Dokument ab, zum Beispiel deinen Personalausweis, die Kfz-Versicherung oder den letzten Steuerbescheid.</p></li>`;
  else if (!list.length) el.innerHTML = `<li class="empty"><p>Keine Treffer für „${esc(S.q)}“.</p></li>`;
  else { el.innerHTML = list.map(card).join(""); bindCards(el); }
}

function renderFristen() {
  const v = $("#view");
  const withDue = S.docs.filter(d => d.deadline).map(d => ({ d, i: dueInfo(d) })).sort((a, b) => a.i.n - b.i.n);
  const group = (title, items) => items.length ? `<h2 class="sec">${title}</h2><ul class="list">${items.map(x => card(x.d)).join("")}</ul>` : "";
  v.innerHTML = `<p class="lead">Ablaufdaten, Kündigungs- und Abgabefristen deiner Dokumente. Fristen werden hervorgehoben, sobald die eingestellte Vorwarnzeit beginnt.</p>` +
    (withDue.length
      ? group("Abgelaufen", withDue.filter(x => x.i.n < 0)) + group("Jetzt im Blick", withDue.filter(x => x.i.n >= 0 && x.i.soon)) + group("Später", withDue.filter(x => !x.i.soon))
      : `<div class="empty">${ico("cal", "ico huge")}<h2>Keine Fristen</h2><p>Trage beim Bearbeiten eines Dokuments eine Frist oder ein Ablaufdatum ein, etwa für den Reisepass oder die Kündigung eines Vertrags.</p></div>`);
  bindCards(v);
}

/* ---------------- Detailansicht ---------------- */
function sheet(html) {
  const el = document.createElement("div"); el.className = "sheet"; el.innerHTML = html;
  document.body.append(el); document.body.classList.add("noscroll");
  const close = () => { el.remove(); document.body.classList.remove("noscroll"); };
  return { el, close };
}

async function openDetail(doc) {
  const due = dueInfo(doc);
  const { el, close } = sheet(`
    <header class="sheet-top"><button class="icon-btn" data-close aria-label="Zurück">${ico("back")}</button>
      <h1>${esc(doc.title)}</h1><button class="icon-btn" id="ed" aria-label="Bearbeiten">${ico("edit")}</button></header>
    <div class="sheet-body">
      <dl class="facts-grid">
        <div><dt>Kategorie</dt><dd>${esc(catName(doc.category))}</dd></div>
        ${doc.docDate ? `<div><dt>Dokumentdatum</dt><dd>${fmtDate(doc.docDate)}</dd></div>` : ""}
        ${due ? `<div><dt>Frist</dt><dd>${fmtDate(doc.deadline)} <span class="due ${due.cls}">${esc(due.label)}</span></dd></div>` : ""}
        ${doc.tags?.length ? `<div><dt>Tags</dt><dd class="tags">${doc.tags.map(t => `<i>${esc(t)}</i>`).join("")}</dd></div>` : ""}
      </dl>
      ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ""}
      <div id="files" class="files">${doc.files.length ? '<p class="hint">Entschlüssele …</p>' : ""}</div>
      <div class="row wrap">
        ${due ? `<button class="btn ghost" id="ics">${ico("cal")} In Kalender eintragen</button>` : ""}
        <button class="btn ghost danger-text" id="del">${ico("trash")} Löschen</button>
      </div>
      <p class="hint small">Hinzugefügt am ${fmtDate(doc.created)} · zuletzt geändert am ${fmtDate(doc.updated)}</p>
    </div>`);
  const urls = [];
  const done = () => { urls.forEach(u => URL.revokeObjectURL(u)); S.urls = S.urls.filter(u => !urls.includes(u)); close(); };
  $("[data-close]", el).onclick = done;
  $("#ed", el).onclick = () => { done(); openEditor(doc); };
  $("#del", el).onclick = async () => {
    if (await ask({ title: "Dokument löschen?", text: `„${esc(doc.title)}“ und alle zugehörigen Dateien werden endgültig gelöscht.`, ok: "Löschen", danger: true })) {
      await deleteDoc(doc); done(); renderView(); toast("Gelöscht");
    }
  };
  $("#ics", el)?.addEventListener("click", () => exportIcs(doc));

  const box = $("#files", el); box.innerHTML = "";
  for (const f of doc.files) {
    const item = document.createElement("figure"); item.className = "file"; box.append(item);
    try {
      const blob = await fileBlob(f), url = URL.createObjectURL(blob); urls.push(url); S.urls.push(url);
      const isImg = f.type.startsWith("image/"), isPdf = f.type === "application/pdf";
      item.innerHTML = `${isImg ? `<img src="${url}" alt="${esc(f.name)}">` : isPdf ? `<iframe src="${url}" title="${esc(f.name)}"></iframe>` : `<div class="file-ph">${ico("file", "ico huge")}</div>`}
        <figcaption><span>${esc(f.name)} · ${fmtSize(f.size)}</span>
        <span class="row">${isImg || isPdf ? `<button class="btn small ghost" data-open>Öffnen</button>` : ""}<button class="btn small ghost" data-dl>${ico("down")} Sichern</button></span></figcaption>`;
      $("[data-open]", item)?.addEventListener("click", () => window.open(url, "_blank", "noopener"));
      $("[data-dl]", item).onclick = async () => {
        if (await ask({ title: "Unverschlüsselt sichern?", text: "Die Datei wird <b>entschlüsselt</b> außerhalb der Ablage gespeichert. Bitte danach dort löschen, wenn du sie nicht mehr brauchst.", ok: "Sichern" }))
          saveFile(blob, f.name);
      };
    } catch { item.innerHTML = `<figcaption>${esc(f.name)}: konnte nicht entschlüsselt werden.</figcaption>`; }
  }
}

function exportIcs(doc) {
  const e = s => s.replace(/[\\,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const d = doc.deadline.replace(/-/g, "");
  const next = new Date(doc.deadline + "T12:00"); next.setDate(next.getDate() + 1);
  const d2 = next.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NF//Dokumentenablage//DE", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${doc.id}@nf-ablage`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
    `SUMMARY:${e("Frist: " + doc.title)}`, "DESCRIPTION:Details in der NF Dokumentenablage.",
    "BEGIN:VALARM", `TRIGGER:-P${doc.remindDays ?? 30}D`, "ACTION:DISPLAY", `DESCRIPTION:${e("Frist: " + doc.title)}`, "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", `DESCRIPTION:${e("Heute: " + doc.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  saveFile(new Blob([ics], { type: "text/calendar" }), `Frist_${doc.title.replace(/[^\wäöüÄÖÜß-]+/g, "_")}.ics`);
}

/* ---------------- Bearbeiten / Neu ---------------- */
function openEditor(doc) {
  const isNew = !doc;
  const d = doc ? structuredClone(doc) : { id: C.newId(), title: "", category: S.cat !== "alle" ? S.cat : "sonstiges", tags: [], notes: "", docDate: "", deadline: "", remindDays: 30, files: [], thumb: null, created: new Date().toISOString() };
  const pending = [], removed = [];
  const { el, close } = sheet(`
    <header class="sheet-top"><button class="icon-btn" data-close aria-label="Abbrechen">${ico("x")}</button>
      <h1>${isNew ? "Neues Dokument" : "Bearbeiten"}</h1><span></span></header>
    <form class="sheet-body form" id="ef">
      <div class="drop" id="drop">
        <p>Dateien hierher ziehen oder</p>
        <div class="row center wrap">
          <label class="btn ghost">${ico("file")} Datei wählen<input type="file" id="pick" accept="application/pdf,image/*" multiple hidden></label>
          <label class="btn ghost">${ico("camera")} Foto aufnehmen<input type="file" id="cam" accept="image/*" capture="environment" hidden></label>
        </div>
        <ul class="flist" id="flist"></ul>
      </div>
      <label>Titel<input name="title" required maxlength="120" value="${esc(d.title)}" placeholder="z. B. Personalausweis"></label>
      <div class="grid2">
        <label>Kategorie<select name="category">${CATS.map(c => `<option value="${c[0]}" ${c[0] === d.category ? "selected" : ""}>${esc(c[1])}</option>`).join("")}</select></label>
        <label>Dokumentdatum<input type="date" name="docDate" value="${esc(d.docDate)}"></label>
      </div>
      <label>Tags <small>(durch Komma getrennt)</small><input name="tags" value="${esc(d.tags.join(", "))}" placeholder="z. B. HUK, Kfz, 2025"></label>
      <div class="grid2">
        <label>Frist / Ablaufdatum<input type="date" name="deadline" value="${esc(d.deadline)}"></label>
        <label>Vorwarnung<select name="remindDays">${[7, 14, 30, 60, 90, 180].map(n => `<option value="${n}" ${n === d.remindDays ? "selected" : ""}>${n} Tage vorher</option>`).join("")}</select></label>
      </div>
      <label>Notizen<textarea name="notes" rows="4" placeholder="z. B. Vertragsnummer, Kündigungsbedingungen, Ansprechpartner">${esc(d.notes)}</textarea></label>
      <button class="btn primary block" id="save">Verschlüsselt speichern</button>
    </form>`);
  const f = $("#ef", el);
  const renderFiles = () => {
    $("#flist", el).innerHTML =
      d.files.filter(x => !removed.includes(x.id)).map(x => `<li>${ico("file")}<span>${esc(x.name)} <small>${fmtSize(x.size)}</small></span><button type="button" class="icon-btn small" data-rm="${x.id}" aria-label="Entfernen">${ico("x")}</button></li>`).join("") +
      pending.map((x, i) => `<li class="new">${ico("file")}<span>${esc(x.name)} <small>${fmtSize(x.blob.size)} · neu</small></span><button type="button" class="icon-btn small" data-rp="${i}" aria-label="Entfernen">${ico("x")}</button></li>`).join("");
    $$("[data-rm]", el).forEach(b => b.onclick = () => { removed.push(b.dataset.rm); renderFiles(); });
    $$("[data-rp]", el).forEach(b => b.onclick = () => { pending.splice(+b.dataset.rp, 1); renderFiles(); });
  };
  const add = list => {
    for (const file of list) {
      if (file.size > 200 * 1048576) { toast(`${file.name} ist größer als 200 MB`); continue; }
      const name = file.name && file.name !== "image.jpg" ? file.name : `Foto_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.jpg`;
      pending.push({ name, blob: file });
      if (!f.title.value) f.title.value = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    }
    renderFiles();
  };
  ["pick", "cam"].forEach(id => {
    const inp = $("#" + id, el);
    inp.onclick = () => { S.picking = true; };
    inp.onchange = () => { S.picking = false; add(inp.files); inp.value = ""; };
  });
  const drop = $("#drop", el);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); };
  renderFiles();
  $("[data-close]", el).onclick = close;
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = $("#save", el); busy(btn, true, "Verschlüssele …");
    Object.assign(d, {
      title: f.title.value.trim(), category: f.category.value, docDate: f.docDate.value, deadline: f.deadline.value,
      remindDays: +f.remindDays.value, notes: f.notes.value.trim(),
      tags: [...new Set(f.tags.value.split(",").map(t => t.trim()).filter(Boolean))],
    });
    try {
      await saveDoc(d, pending, removed);
      close(); renderView(); toast(isNew ? "Dokument abgelegt" : "Gespeichert");
    } catch (err) {
      busy(btn, false);
      toast(err.name === "QuotaExceededError" ? "Speicher voll – bitte Platz schaffen" : "Fehler: " + err.message);
    }
  };
  if (isNew) setTimeout(() => f.title.focus(), 50);
}

/* ---------------- Einstellungen ---------------- */
async function renderSettings() {
  const v = $("#view");
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const nFiles = S.docs.reduce((a, d) => a + d.files.length, 0);
  const si = Sync.info();
  const syncPanel = !Sync.enabled() ? "" : `<section class="panel"><h2>Geräte-Abgleich (OneDrive)</h2>
      ${Sync.connected() ? `<p>Verbunden${si.account ? ` mit dem OneDrive von <b>${esc(si.account)}</b>` : ""}. ${si.lastSync ? `Zuletzt abgeglichen: ${new Date(si.lastSync).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}.` : ""}</p>
        ${si.state === "error" ? `<p class="hint">Letzter Fehler: ${esc(si.text)}</p>` : ""}
        <div class="row wrap">${si.needsLogin ? `<button class="btn primary" id="odre">${ico("cloud")} Anmeldung erneuern</button>` : `<button class="btn primary" id="odsync">${ico("cloud")} Jetzt abgleichen</button>`}
        <button class="btn ghost" id="oddis">Verbindung trennen</button></div>`
      : `<p>Gleicht deine Ablage über einen eigenen Ordner <b>Apps/NF-Ablage</b> in deinem OneDrive zwischen deinen Geräten ab. Dort liegen nur verschlüsselte Pakete, Microsoft kann nichts lesen. Die App erhält keinen Zugriff auf deine übrigen OneDrive-Dateien.</p>
        <button class="btn primary" id="odcon">${ico("cloud")} Mit OneDrive verbinden</button>`}
    </section>`;
  v.innerHTML = syncPanel + `
    <section class="panel"><h2>Backup</h2>
      <p>Das Backup ist eine einzelne, <b>verschlüsselte</b> Datei. Lege sie z. B. in iCloud Drive, OneDrive oder auf einen USB-Stick. Ohne dein Passwort ist sie wertlos. So überträgst du die Ablage auch auf ein anderes Gerät.</p>
      <p class="hint">${S.prefs.lastBackup ? `Letztes Backup: ${fmtDate(S.prefs.lastBackup)}` : "Noch kein Backup erstellt."}</p>
      <div class="row wrap"><button class="btn primary" id="exp">${ico("down")} Backup erstellen</button>
      <label class="btn ghost">Backup einspielen<input type="file" id="imp" accept=".nfablage,application/json" hidden></label></div>
    </section>
    <section class="panel"><h2>Sicherheit</h2>
      <label>Automatisch sperren nach<select id="lockMin">${[1, 2, 5, 10, 15].map(n => `<option value="${n}" ${n === S.prefs.lockMin ? "selected" : ""}>${n} ${n === 1 ? "Minute" : "Minuten"} ohne Aktivität</option>`).join("")}</select></label>
      <p class="hint">Zusätzlich sperrt die App, wenn sie länger als eine Minute im Hintergrund war.</p>
      <div class="row wrap"><button class="btn ghost" id="chpw">Passwort ändern</button><button class="btn ghost" id="newrk">Neuer Wiederherstellungsschlüssel</button></div>
    </section>
    <section class="panel"><h2>Speicher</h2>
      <p>${plural(S.docs.length, "Dokument", "Dokumente")} · ${plural(nFiles, "Datei", "Dateien")}${est ? ` · ${fmtSize(est.usage || 0)} belegt` : ""}</p>
      <p class="hint">${persisted ? "Dauerhafter Speicher ist aktiv: der Browser löscht die Daten nicht von selbst." : "Tipp: Installiere die App auf dem Homescreen, damit der Browser den Speicher nicht aufräumt. Erstelle trotzdem regelmäßig Backups."}</p>
    </section>
    <section class="panel"><h2>So schützt die App deine Daten</h2>
      <ul class="plain">
        <li>Dateien und Angaben werden mit <b>AES-256-GCM</b> verschlüsselt, bevor sie gespeichert werden.</li>
        <li>Der Schlüssel wird aus deinem Master-Passwort abgeleitet (PBKDF2, 600.000 Runden) und existiert nur, solange die App entsperrt ist.</li>
        <li>Die App hat keinen eigenen Server. Verbindungen sind nur zu Microsoft (OneDrive-Abgleich, falls eingeschaltet) erlaubt, alle anderen blockiert eine strenge Sicherheitsrichtlinie. Zu OneDrive gelangen nur verschlüsselte Pakete.</li>
        <li>Wer dein Gerät entsperrt in den Händen hält, während die Ablage offen ist, sieht die Dokumente. Darum sperrt sie sich automatisch.</li>
      </ul>
    </section>
    <section class="panel danger-zone"><h2>Tresor löschen</h2>
      <p>Löscht alle Dokumente auf diesem Gerät unwiderruflich. Backups und die Kopie in OneDrive bleiben unberührt.</p>
      <button class="btn danger" id="wipe">${ico("trash")} Alles löschen</button>
    </section>
    <p class="hint center">NF · Dokumentenablage ${APP_VERSION}</p>`;
  $("#exp").onclick = exportBackup;
  $("#odcon")?.addEventListener("click", connectOneDrive);
  $("#odre")?.addEventListener("click", reconnectOneDrive);
  $("#odsync")?.addEventListener("click", async () => { await Sync.syncNow(); renderSettings(); });
  $("#oddis")?.addEventListener("click", async () => {
    if (await ask({ title: "Verbindung trennen?", text: "Dieses Gerät gleicht dann nicht mehr ab. Die Dokumente bleiben hier und in OneDrive erhalten.", ok: "Trennen" })) { await Sync.disconnect(); renderSettings(); renderSyncStatus(Sync.info()); }
  });
  const imp = $("#imp"); imp.onclick = () => { S.picking = true; };
  imp.onchange = () => { S.picking = false; if (imp.files[0]) importBackup(imp.files[0]); imp.value = ""; };
  $("#lockMin").onchange = async e => { S.prefs.lockMin = +e.target.value; await savePrefs(); toast("Gespeichert"); };
  $("#chpw").onclick = async () => {
    const old = await ask({ title: "Passwort ändern", text: "Aktuelles Master-Passwort:", input: "password", ok: "Weiter" }); if (!old) return;
    const nw = await ask({ title: "Neues Passwort", text: "Mindestens 10 Zeichen, am besten ein Satz aus mehreren Wörtern.", input: "password", ok: "Weiter" }); if (!nw) return;
    if (C.strength(nw) < 2 || nw.length < 10) return ask({ title: "Zu schwach", text: "Bitte ein längeres Passwort wählen.", cancel: null });
    const nw2 = await ask({ title: "Neues Passwort wiederholen", input: "password", ok: "Speichern" }); if (nw2 === null) return;
    if (nw !== nw2) return ask({ title: "Stimmt nicht überein", text: "Die Passwörter waren verschieden.", cancel: null });
    try { S.meta = await C.changePassword(S.meta, old, nw); await DB.setMeta("vault", S.meta); Sync.pushVault().catch(() => {}); toast("Passwort geändert" + (Sync.connected() ? " – gilt auch auf deinen anderen Geräten" : "")); }
    catch { ask({ title: "Falsches Passwort", text: "Das aktuelle Passwort war nicht korrekt.", cancel: null }); }
  };
  $("#newrk").onclick = async () => {
    const pw = await ask({ title: "Neuer Wiederherstellungsschlüssel", text: "Der alte Schlüssel wird ungültig (gilt aber weiterhin für ältere Backups). Bitte Master-Passwort eingeben:", input: "password", ok: "Erzeugen" });
    if (!pw) return;
    try {
      const r = await C.newRecoveryKey(S.meta, pw); S.meta = r.meta; await DB.setMeta("vault", S.meta); Sync.pushVault().catch(() => {});
      renderRecoveryKey(r.recoveryKey, false);
    } catch { ask({ title: "Falsches Passwort", cancel: null }); }
  };
  $("#wipe").onclick = async () => {
    const t = await ask({ title: "Wirklich alles löschen?", text: "Tippe <b>LÖSCHEN</b>, um alle Dokumente auf diesem Gerät zu entfernen.", input: "text", ok: "Endgültig löschen", danger: true });
    if (t?.trim().toUpperCase() !== "LÖSCHEN") return;
    await DB.destroy(); localStorage.clear(); location.reload();
  };
}

/* ---------------- Backup ---------------- */
const ser = r => ({ id: r.id, iv: C.b64(r.iv), ct: C.b64(r.ct) });
const deser = r => ({ id: r.id, iv: C.unb64(r.iv), ct: C.unb64(r.ct) });

async function exportBackup() {
  toast("Backup wird erstellt …");
  const [docs, files] = await Promise.all([DB.all("docs"), DB.all("files")]);
  const parts = [`{"format":"nf-ablage-backup","v":1,"exported":"${new Date().toISOString()}","vault":${JSON.stringify(S.meta)},"docs":${JSON.stringify(docs.map(ser))},"files":[`];
  files.forEach((f, i) => parts.push((i ? "," : "") + JSON.stringify(ser(f)))); // stückweise, schont den Speicher
  parts.push("]}");
  const blob = new Blob(parts, { type: "application/octet-stream" });
  await saveFile(blob, `NF-Ablage-Backup_${new Date().toISOString().slice(0, 10)}.nfablage`);
  S.prefs.lastBackup = new Date().toISOString(); await savePrefs();
  renderBanner(); if (S.view === "einstellungen") renderSettings();
}

async function readBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== "nf-ablage-backup" || !data.vault?.pw) throw new Error("Keine gültige Backup-Datei.");
  return data;
}

async function askBackupKey(data) {
  for (;;) {
    const pw = await ask({ title: "Backup entschlüsseln", text: `Backup vom ${fmtDate(data.exported)} mit ${plural(data.docs.length, "Dokument", "Dokumenten")}. Passwort, das beim Erstellen des Backups galt:`, input: "password", ok: "Entschlüsseln" });
    if (pw === null) return null;
    try { return await C.unlockWithPassword(data.vault, pw); }
    catch { toast("Passwort falsch"); }
  }
}

/* Backup in den bestehenden Tresor übernehmen (umverschlüsseln, vorhandene überspringen). */
async function importBackup(file) {
  let data; try { data = await readBackup(file); } catch (e) { return ask({ title: "Import fehlgeschlagen", text: esc(e.message), cancel: null }); }
  const keyB = await askBackupKey(data); if (!keyB) return;
  toast("Importiere …");
  let added = 0;
  const fileMap = new Map(data.files.map(f => [f.id, f]));
  for (const r of data.docs) {
    if (S.docs.some(d => d.id === r.id)) continue;
    const doc = { id: r.id, ...(await C.decryptJSON(keyB, deser(r))) };
    const files = [];
    for (const fm of doc.files) {
      const fr = fileMap.get(fm.id); if (!fr) continue;
      files.push(await C.encryptBytes(S.key, await C.decryptBytes(keyB, deser(fr)), fm.id));
    }
    const { id, ...body } = doc;
    await DB.write({ docs: [await C.encryptJSON(S.key, body, id)], files });
    S.docs.push(doc); added++;
    await Sync.markDirty(id);
  }
  renderView();
  ask({ title: "Import abgeschlossen", text: `${plural(added, "Dokument", "Dokumente")} übernommen${data.docs.length - added ? `, ${data.docs.length - added} bereits vorhanden` : ""}.`, cancel: null });
}

/* Backup auf einem neuen Gerät als kompletten Tresor einspielen. */
function restoreBackupAtSetup() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".nfablage,application/json";
  inp.onchange = async () => {
    let data; try { data = await readBackup(inp.files[0]); } catch (e) { return ask({ title: "Wiederherstellung fehlgeschlagen", text: esc(e.message), cancel: null }); }
    const key = await askBackupKey(data); if (!key) return;
    await DB.write({ docs: data.docs.map(deser), files: data.files.map(deser) });
    await DB.setMeta("vault", data.vault); S.meta = data.vault; S.key = key;
    S.prefs.lastBackup = data.exported; await savePrefs();
    navigator.storage?.persist?.();
    await loadDocs(); renderMain(); toast("Backup wiederhergestellt");
  };
  inp.click();
}

/* ---------------- OneDrive ---------------- */
function renderSyncStatus(i) {
  const b = $("#syncbtn"); if (!b) return;
  b.hidden = !Sync.connected();
  b.dataset.s = i.state;
  const t = { busy: "Gleiche ab …", ok: "Abgeglichen", idle: "OneDrive verbunden", login: "OneDrive-Anmeldung erneuern", error: "Abgleich fehlgeschlagen – tippen für Details", offline: "Offline – gleicht später ab" }[i.state] || "";
  b.title = t; b.setAttribute("aria-label", t);
  renderBanner();
}

function renderCallback({ code, error }) {
  gate(error
    ? `<h1>Anmeldung fehlgeschlagen</h1><p class="gate-sub wide">${esc(error)}</p>`
    : `<h1>Anmeldung erfolgreich</h1><p class="gate-sub wide">Wechsle zurück zur Ablage. Geht es dort nicht von selbst weiter (z. B. am iPhone), kopiere diesen Code und füge ihn dort ein. Der Code ist nur wenige Minuten gültig und funktioniert nur auf dem Gerät, das die Anmeldung gestartet hat.</p>
       <div class="reckey code">${esc(code)}</div><div class="row center"><button class="btn gold" id="cp">Code kopieren</button></div>`);
  $("#cp")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(code); toast("Kopiert – jetzt zurück zur Ablage"); } catch { toast("Bitte den Code markieren und kopieren"); } });
}

/* Anmeldedialog: Link öffnet Microsoft in neuem Fenster; Code kommt automatisch oder wird eingefügt. */
async function oneDriveLogin() {
  const url = await Sync.authUrl();
  S.picking = true;
  const code = await new Promise(resolve => {
    const o = document.createElement("div"); o.className = "overlay";
    o.innerHTML = `<form class="dialog" role="dialog" aria-modal="true"><h2>Mit OneDrive verbinden</h2>
      <p>1. Bei Microsoft mit deinem Konto anmelden und den Zugriff auf den App-Ordner erlauben.</p>
      <a class="btn primary" href="${esc(url)}" target="_blank">${ico("cloud")} Bei Microsoft anmelden</a>
      <p>2. Danach geht es hier automatisch weiter. Am iPhone kopierst du stattdessen den angezeigten Code und fügst ihn hier ein:</p>
      <input name="c" placeholder="Code einfügen" autocomplete="off" spellcheck="false">
      <div class="row end"><button type="button" class="btn ghost" data-x>Abbrechen</button><button class="btn primary">Weiter</button></div></form>`;
    document.body.append(o);
    const f = $("form", o), done = v => { Sync.waitForCode.cancel?.(); o.remove(); resolve(v); };
    Sync.waitForCode().then(done);
    f.onsubmit = e => { e.preventDefault(); if (f.c.value.trim()) done(f.c.value.trim()); };
    $("[data-x]", o).onclick = () => done(null);
  });
  S.picking = false; activity();
  if (!code) return false;
  toast("Verbinde mit OneDrive …");
  try { await Sync.exchangeCode(code); return true; }
  catch (e) { await ask({ title: "Anmeldung fehlgeschlagen", text: esc(e.message), cancel: null }); return false; }
}

async function askVaultPassword(rv, text) {
  for (;;) {
    const pw = await ask({ title: "Master-Passwort", text, input: "password", ok: "Entsperren" });
    if (pw === null) return null;
    try { return await C.unlockWithPassword(rv, pw); } catch { toast("Passwort falsch"); }
  }
}

async function connectOneDrive() {
  if (!(await oneDriveLogin())) return;
  try {
    const r = await Sync.attach();
    if (r.status === "other") {
      const key = await askVaultPassword(r.vault, "In deinem OneDrive liegt bereits eine Ablage von einem anderen Gerät. Gib <b>deren</b> Master-Passwort ein, um beide zusammenzuführen. Danach gilt dieses Passwort auch hier.");
      if (!key) { await Sync.disconnect(); return renderSettings(); }
      await Sync.adoptRemoteVault(r.vault, key);
    }
    await Sync.syncNow();
    toast(r.status === "uploaded" ? "Verbunden – Ablage wird hochgeladen" : "Verbunden und abgeglichen");
  } catch (e) { ask({ title: "Verbinden fehlgeschlagen", text: esc(e.message), cancel: null }); }
  renderView();
}

async function reconnectOneDrive() {
  if (await oneDriveLogin()) { await Sync.syncNow(); renderView(); toast("OneDrive wieder verbunden"); }
}

/* Neues Gerät: Tresor aus OneDrive übernehmen. */
async function connectNewDevice() {
  if (!(await oneDriveLogin())) return;
  let rv;
  try { rv = await Sync.remoteVault(); } catch (e) { return ask({ title: "Fehler", text: esc(e.message), cancel: null }); }
  if (!rv) {
    await Sync.disconnect();
    return ask({ title: "Keine Ablage gefunden", text: "In diesem OneDrive liegt noch keine Ablage. Lege zuerst hier einen Tresor an und verbinde ihn dann in den Einstellungen mit OneDrive.", cancel: null });
  }
  const key = await askVaultPassword(rv, "Master-Passwort deiner Ablage:");
  if (!key) { await Sync.disconnect(); return; }
  await DB.setMeta("vault", rv); S.meta = rv; S.key = key;
  navigator.storage?.persist?.();
  await afterUnlock();
  toast("Ablage wird geladen …");
}

boot();
