/* NF · Haushaltsbuch – Bereich der Ablage-App.
 *
 * Alle Daten liegen als verschlüsselte Datensätze im selben Tresor wie die Dokumente und laufen damit
 * automatisch durch Backup und Dropbox-Abgleich:
 *   fin-cfg          Konten, Kategorien, Budgets, Sparziele, Regeln, Gelerntes, KI-Einstellungen
 *   fin-m-JJJJ-MM    alle Buchungen eines Monats (Beträge in Cent, negativ = Ausgabe)
 * Belege sind normale Ablage-Dokumente; eine Buchung verweist nur auf deren IDs.
 */
import * as KI from "./ki.js";
import * as CSV from "./csv.js";
import * as Ch from "./charts.js";

let X; // Hilfen aus app.js
const F = { month: null, q: "", fMonth: "alle", fCat: "alle", fAcc: "alle", fCheck: false, limit: 150 };
let pendingCfg = null;

export function init(ctx) { X = ctx; F.month = curYM(); }

/* ---------------- Hilfen ---------------- */
const pad = n => String(n).padStart(2, "0");
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDay(new Date());
const curYM = () => todayISO().slice(0, 7);
const addMonth = (ym, n) => { const d = new Date(ym + "-01T12:00"); d.setMonth(d.getMonth() + n); return isoDay(d).slice(0, 7); };
const daysIn = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const monthName = (ym, short = false) => new Date(ym + "-01T12:00").toLocaleDateString("de-DE", short ? { month: "short" } : { month: "long", year: "numeric" });
const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const EUR0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const eur = c => EUR.format((c || 0) / 100);
const eur0 = c => EUR0.format(Math.round((c || 0) / 100));
const eurIn = c => c ? (Math.abs(c) / 100).toFixed(2).replace(".", ",") : "";
const pct = v => Number.isFinite(v) ? Math.round(v * 100) + " %" : "–";
const dayLabel = d => {
  const t = todayISO(), y = isoDay(new Date(Date.now() - 864e5));
  if (d === t) return "Heute"; if (d === y) return "Gestern";
  return new Date(d + "T12:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" });
};

/* ---------------- Daten ---------------- */
function defaultCfg() {
  return {
    id: "fin-cfg", kind: "fin-cfg", files: [], created: new Date().toISOString(),
    accounts: [{ id: "giro", name: "Girokonto", start: 0 }, { id: "bar", name: "Bargeld", start: 0 }],
    cats: KI.DEFAULT_CATS.map(c => ({ ...c })),
    budgets: { def: {}, m: {} }, income: { def: 0, m: {} },
    goals: [], rules: [], learned: {},
    ki: { enabled: false, apiKey: "", model: KI.MODELS[0][0] },
  };
}
export function cfg() {
  const c = X.S.docs.find(d => d.id === "fin-cfg");
  if (c) { pendingCfg = null; return c; }
  return pendingCfg || (pendingCfg = defaultCfg());
}
async function saveCfg() { const c = cfg(); await X.saveDoc(c, [], []); pendingCfg = null; }

const monthRecs = () => X.S.docs.filter(d => d.kind === "fin-month");
export function allTx() { return monthRecs().flatMap(m => m.tx || []); }
const txOf = ym => (X.S.docs.find(d => d.id === "fin-m-" + ym)?.tx || []);
const catOf = id => cfg().cats.find(c => c.id === id);
const catName = id => catOf(id)?.name || "Ohne Kategorie";
const typeOf = t => catOf(t.cat)?.type || (t.amount < 0 ? "aus" : "ein");
const accName = id => cfg().accounts.find(a => a.id === id)?.name || "–";
const label = t => t.merchant || t.payee || t.purpose || "Buchung";

/* Buchungen anlegen/ändern – je Monat ein Datensatz. Verschiebt bei Datumsänderung in den neuen Monat. */
async function putTx(list) {
  const now = new Date().toISOString(), touched = new Map();
  const rec = ym => {
    if (touched.has(ym)) return touched.get(ym);
    const r = X.S.docs.find(d => d.id === "fin-m-" + ym) || { id: "fin-m-" + ym, kind: "fin-month", month: ym, tx: [], del: {}, files: [], created: now };
    touched.set(ym, r); return r;
  };
  for (const t of list) {
    t.updated = now;
    const ym = t.date.slice(0, 7);
    for (const m of monthRecs()) if (m.month !== ym && m.tx.some(x => x.id === t.id)) {
      const r = rec(m.month); r.tx = r.tx.filter(x => x.id !== t.id); (r.del ||= {})[t.id] = now;
    }
    const r = rec(ym), i = r.tx.findIndex(x => x.id === t.id);
    i >= 0 ? (r.tx[i] = t) : r.tx.push(t);
    if (r.del) delete r.del[t.id];
  }
  for (const r of touched.values()) await X.saveDoc(r, [], []);
}
async function delTx(ids) {
  const now = new Date().toISOString();
  for (const m of monthRecs()) {
    if (!m.tx.some(t => ids.includes(t.id))) continue;
    m.tx = m.tx.filter(t => !ids.includes(t.id)); m.del ||= {};
    ids.forEach(id => m.del[id] = now);
    await X.saveDoc(m, [], []);
  }
}

/* Zusammenführen bei gleichzeitiger Änderung auf zwei Geräten (Dropbox) oder beim Backup-Import. */
export function merge(a, b) {
  if (a.kind === "fin-month" && b.kind === "fin-month") {
    const del = { ...(a.del || {}) };
    for (const [k, v] of Object.entries(b.del || {})) if (!del[k] || v > del[k]) del[k] = v;
    const map = new Map();
    for (const t of [...(a.tx || []), ...(b.tx || [])]) { const o = map.get(t.id); if (!o || (t.updated || "") > (o.updated || "")) map.set(t.id, t); }
    const tx = [...map.values()].filter(t => !del[t.id] || (t.updated || "") > del[t.id]);
    return { ...a, tx, del };
  }
  if (a.kind === "fin-cfg" && b.kind === "fin-cfg") {
    const [n, o] = (a.updated || "") >= (b.updated || "") ? [a, b] : [b, a];
    return { ...n, learned: { ...(o.learned || {}), ...(n.learned || {}) } };
  }
  return (a.updated || "") >= (b.updated || "") ? a : b;
}

function stats(txs) {
  let ein = 0, aus = 0; const byCat = new Map();
  for (const t of txs) {
    const ty = typeOf(t); if (ty === "neutral") continue;
    if (ty === "ein") ein += t.amount;
    else { aus -= t.amount; byCat.set(t.cat || "", (byCat.get(t.cat || "") || 0) - t.amount); }
  }
  return { ein, aus, saldo: ein - aus, byCat };
}
const planOf = (ym, catId) => { const b = cfg().budgets; return b.m?.[ym]?.[catId] ?? b.def?.[catId] ?? 0; };
const incomePlan = ym => cfg().income?.m?.[ym] ?? cfg().income?.def ?? 0;
const expenseCats = () => cfg().cats.filter(c => c.type === "aus");
const totalPlan = ym => expenseCats().reduce((a, c) => a + planOf(ym, c.id), 0);
const toCheck = () => allTx().filter(t => t.check);

/* Wiederkehrende Zahlungen (Fixkosten & Abos) erkennen. */
function recurring() {
  const groups = new Map();
  for (const t of allTx()) {
    if (t.amount >= 0 || typeOf(t) === "neutral" || t.cat === "bargeld") continue;
    const k = KI.normPayee(t.merchant || t.payee || t.purpose); if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(t);
  }
  const out = [], now = Date.now();
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amts = list.map(t => -t.amount).sort((a, b) => a - b), med = amts[Math.floor(amts.length / 2)];
    const close = list.filter(t => Math.abs(-t.amount - med) <= Math.max(med * 0.15, 200));
    if (close.length < Math.max(2, Math.ceil(list.length * 0.6))) continue;
    const gaps = [];
    for (let i = 1; i < close.length; i++) gaps.push((new Date(close[i].date) - new Date(close[i - 1].date)) / 864e5);
    const g = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const freq = g >= 25 && g <= 35 && close.length >= 3 ? ["monatlich", 1] : g >= 84 && g <= 98 ? ["vierteljährlich", 3] : g >= 170 && g <= 195 ? ["halbjährlich", 6] : g >= 350 && g <= 380 ? ["jährlich", 12] : null;
    if (!freq) continue;
    // Abstände müssen regelmäßig sein, sonst ist es nur ein häufiger Händler (z. B. Lieferdienst)
    const tol = freq[1] === 1 ? 6 : 15;
    if (gaps.filter(x => Math.abs(x - g) <= tol).length < Math.ceil(gaps.length * 0.75)) continue;
    const last = close.at(-1);
    if ((now - new Date(last.date)) / 864e5 > g * 1.6) continue; // nicht mehr aktiv
    const next = new Date(last.date + "T12:00"); next.setMonth(next.getMonth() + freq[1]);
    out.push({ key, name: label(last), amount: med, freq: freq[0], monthly: Math.round(med / freq[1]), last: last.date, next: isoDay(next), cat: last.cat, n: close.length });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/* ---------------- Automatische Zuordnung ---------------- */
/* Ordnet Buchungen ohne (bestätigte) Kategorie zu: lokal, dann optional per Claude. */
async function autoAssign(list, { ki = true, status } = {}) {
  const c = cfg(); let local = 0, viaKi = 0;
  const open = [];
  for (const t of list) {
    if (t.cat && t.catBy === "hand") continue;
    const s = KI.suggest(t, c);
    if (s) { t.cat = s.cat; t.catBy = s.by; t.check = false; local++; }
    else { open.push(t); t.check = true; }
  }
  let error = null;
  if (ki && open.length && c.ki?.enabled && c.ki.apiKey) {
    status?.(`KI ordnet ${open.length} Buchungen zu …`);
    try {
      const res = await KI.categorize(c.ki, c.cats, open);
      for (const t of open) {
        const r = res.get(t.id); if (!r) continue;
        t.cat = r.cat; t.catBy = "ki"; t.check = r.sicher !== "hoch"; viaKi++;
        if (r.haendler && r.haendler.length < 40) t.merchant = r.haendler;
      }
    } catch (e) { error = e.message; }
  }
  return { local, viaKi, open: list.filter(t => t.check && !t.cat).length, error };
}

/* Korrektur merken: gleicher Empfänger → gleiche Kategorie. */
function learn(t) {
  const k = KI.normPayee(t.payee || t.purpose);
  if (k && t.cat) cfg().learned[k] = t.cat;
  return k;
}

/* ---------------- Oberfläche: Navigation ---------------- */
export const TABS = [["uebersicht", "chart", "Übersicht"], ["buchungen", "list", "Buchungen"], ["budget", "wallet", "Budget"], ["tracker", "target", "Tracker"], ["einstellungen", "gear", "Einstellungen"]];
export function tabsHtml() {
  return TABS.map(([v, i, n]) => `<button data-v="${v}">${X.ico(i)}<span>${n}</span>${v === "buchungen" ? `<b class="badge" id="badge" hidden></b>` : ""}</button>`).join("");
}
export function badgeCount() { return toCheck().length; }

export function render(view) {
  const v = X.$("#view"); Ch.hideTip();
  const r = ({ uebersicht: renderOverview, buchungen: renderTx, budget: renderBudget, tracker: renderTracker, einstellungen: renderSettings }[view] || renderOverview)(v);
  Promise.resolve(r).then(() => Ch.paint(v));
}

function monthNav(ym, id = "mn") {
  return `<div class="monthnav" id="${id}"><button class="icon-btn" data-d="-1" aria-label="Vormonat">${X.ico("back")}</button>
    <h2>${monthName(ym)}</h2><button class="icon-btn flip" data-d="1" aria-label="Nächster Monat" ${ym >= curYM() ? "disabled" : ""}>${X.ico("back")}</button></div>`;
}
function bindMonthNav(v, rerender) {
  X.$$("#mn [data-d]", v).forEach(b => b.onclick = () => { F.month = addMonth(F.month, +b.dataset.d); rerender(v); Ch.paint(v); });
}

/* ---------------- Übersicht (Dashboard) ---------------- */
function renderOverview(v) {
  const ym = F.month, txs = txOf(ym), s = stats(txs), c = cfg();
  const any = allTx().length;
  if (!any) {
    v.innerHTML = `<div class="empty fin-empty">${X.ico("wallet", "ico huge")}<h2>Dein Haushaltsbuch</h2>
      <p>Importiere einen Kontoauszug als CSV aus deinem Online-Banking oder erfasse die erste Ausgabe. Kategorien werden automatisch zugeordnet und lernen aus deinen Korrekturen.</p>
      <div class="row center wrap"><button class="btn primary" id="e-imp">${X.ico("upload")} Kontoauszug importieren</button>
      <button class="btn ghost" id="e-new">${X.ico("plus")} Buchung erfassen</button><button class="btn ghost" id="e-bel">${X.ico("camera")} Beleg fotografieren</button></div>
      <p class="hint">Tipp: Lege im Tab <b>Budget</b> fest, wie viel du pro Kategorie ausgeben möchtest.</p></div>`;
    X.$("#e-imp").onclick = importCsv; X.$("#e-new").onclick = () => openTx(null); X.$("#e-bel").onclick = receiptFlow;
    return;
  }
  const plan = totalPlan(ym), days = daysIn(ym), isCur = ym === curYM();
  const cw = Math.max(320, Math.min(640, (v.clientWidth || 640) - 40)); // Diagrammbreite = echte Breite, damit Schrift lesbar bleibt
  const dayIdx = isCur ? new Date().getDate() - 1 : ym < curYM() ? days - 1 : -1;
  const perDay = new Array(days).fill(0);
  for (const t of txs) if (typeOf(t) === "aus") perDay[+t.date.slice(8, 10) - 1] -= t.amount;
  const expected = plan ? Math.round(plan * (dayIdx + 1) / days) : 0;
  const diff = expected - s.aus, rest = plan - s.aus, leftDays = isCur ? days - dayIdx - 1 : 0;
  const pace = !plan ? `<p class="hint">Noch kein Budget für diesen Monat. <button class="link-in" data-go="budget">Budget planen</button></p>`
    : `<p class="pace ${s.aus > plan ? "over" : diff < 0 ? "warn" : "ok"}"><b>${s.aus > plan ? `Budget um ${eur0(-rest)} überschritten` : diff >= 0 ? `${eur0(diff)} unter Plan` : `${eur0(-diff)} über Plan`}</b>
       ${isCur && rest > 0 ? ` · noch ${eur0(rest)} für ${leftDays + 1} Tage, also ${eur(Math.floor(rest / (leftDays + 1)))} pro Tag` : ` · ${eur0(s.aus)} von ${eur0(plan)} ausgegeben`}</p>`;
  const cats = [...s.byCat.entries()].filter(([, val]) => val > 0).sort((a, b) => b[1] - a[1]);
  const top = cats.slice(0, 8), restSum = cats.slice(8).reduce((a, [, val]) => a + val, 0);
  const rows = top.map(([id, val]) => {
    const p = planOf(ym, id);
    return { name: catName(id), value: val, mark: p || 0, sub: p ? `Budget ${eur0(p)} · ${pct(val / p)} genutzt` : `${pct(val / s.aus)} der Ausgaben`, tip: `${catName(id)}: ${eur(val)}${p ? ` von ${eur(p)} Budget` : ""}` };
  });
  if (restSum) rows.push({ name: "Weitere Kategorien", value: restSum, sub: `${pct(restSum / s.aus)} der Ausgaben`, tip: `Weitere: ${eur(restSum)}` });
  const months = Array.from({ length: 12 }, (_, i) => addMonth(ym, i - 11));
  const mrows = months.map(m => { const st = stats(txOf(m)); return { label: monthName(m, true).replace(".", ""), ein: Math.max(0, st.ein), aus: Math.max(0, st.aus), on: m === ym, tip: `${monthName(m)} · Einnahmen ${eur(st.ein)} · Ausgaben ${eur(st.aus)} · Saldo ${eur(st.saldo)}` }; });
  const all = allTx();
  const bal = c.accounts.map(a => ({ a, v: (a.start || 0) + all.filter(t => t.account === a.id).reduce((x, t) => x + t.amount, 0) }));
  const rec = recurring(), fix = rec.reduce((a, r) => a + r.monthly, 0);
  const chk = toCheck().length;
  v.innerHTML = `${monthNav(ym)}
    ${chk ? `<button class="todo-bar" data-check>${X.ico("spark")}<span><b>${X.plural(chk, "Buchung", "Buchungen")} prüfen</b> – automatisch zugeordnet oder noch ohne Kategorie</span><span>›</span></button>` : ""}
    <div class="kpis">
      <div class="kpi"><span>Einnahmen</span><b>${eur0(s.ein)}</b>${incomePlan(ym) ? `<small>Plan ${eur0(incomePlan(ym))}</small>` : ""}</div>
      <div class="kpi"><span>Ausgaben</span><b>${eur0(s.aus)}</b>${plan ? `<small>Budget ${eur0(plan)}</small>` : ""}</div>
      <div class="kpi"><span>Saldo</span><b class="${s.saldo < 0 ? "neg" : ""}">${s.saldo < 0 ? "−" : ""}${eur0(Math.abs(s.saldo))}</b><small>Einnahmen − Ausgaben</small></div>
      <div class="kpi"><span>Sparquote</span><b>${s.ein > 0 ? pct(s.saldo / s.ein) : "–"}</b><small>vom Einkommen übrig</small></div>
    </div>
    <section class="panel chart-panel"><h2>Budget-Tracker</h2>${pace}${Ch.paceLine(perDay, plan, dayIdx, eur, cw)}</section>
    <div class="grid-2">
      <section class="panel"><h2>Ausgaben nach Kategorie</h2>${rows.length ? Ch.hbars(rows, eur0) : `<p class="hint">Keine Ausgaben in diesem Monat.</p>`}</section>
      <div>
        <section class="panel"><h2>Konten</h2><ul class="bal">${bal.map(({ a, v: val }) => `<li><span>${X.esc(a.name)}</span><b class="${val < 0 ? "neg" : ""}">${eur(val)}</b></li>`).join("")}</ul>
          <p class="hint small">Startsaldo + alle erfassten Buchungen. Konten in den Einstellungen.</p></section>
        <section class="panel link-panel" data-go="tracker"><h2>Fixkosten & Abos</h2>
          ${rec.length ? `<p class="big-num">${eur0(fix)} <small>pro Monat</small></p><p class="hint">${X.plural(rec.length, "wiederkehrende Zahlung", "wiederkehrende Zahlungen")} erkannt · ${eur0(fix * 12)} im Jahr</p>` : `<p class="hint">Wiederkehrende Zahlungen werden erkannt, sobald sie mindestens zweimal vorkommen.</p>`}
          <span class="more">Zum Tracker ›</span></section>
      </div>
    </div>
    <section class="panel chart-panel"><h2>Die letzten 12 Monate</h2>${Ch.monthBars(mrows, cw)}</section>
    ${c.goals.length ? `<section class="panel link-panel" data-go="tracker"><h2>Sparziele</h2>${goalsMini()}<span class="more">Alle Sparziele ›</span></section>` : ""}`;
  bindMonthNav(v, renderOverview);
  X.$$("[data-go]", v).forEach(b => b.onclick = () => X.go(b.dataset.go));
  X.$("[data-check]", v)?.addEventListener("click", () => { F.fCheck = true; F.fMonth = "alle"; X.go("buchungen"); });
  Ch.bindTips(v);
}

function goalsMini() {
  return `<ul class="goals mini">${cfg().goals.map(g => { const saved = goalSaved(g); return `<li><span>${X.esc(g.name)}</span><small>${eur0(saved)} von ${eur0(g.target)}</small>${Ch.progress(Math.min(saved, g.target), g.target).replace('class="pg', 'class="pg goal')}</li>`; }).join("")}</ul>`;
}
const goalSaved = g => (g.history || []).reduce((a, h) => a + h.a, 0);

/* ---------------- Buchungen ---------------- */
function renderTx(v) {
  const c = cfg(), all = allTx();
  const months = [...new Set(all.map(t => t.date.slice(0, 7)))].sort().reverse();
  const nCheck = toCheck().length;
  if (F.fCheck && !nCheck) F.fCheck = false;
  v.innerHTML = `<div class="searchbar">${X.ico("search")}<input type="search" id="fq" placeholder="Empfänger, Zweck, Betrag …" value="${X.esc(F.q)}" aria-label="Suchen">
      <select id="fm" aria-label="Monat"><option value="alle">Alle Monate</option>${months.map(m => `<option value="${m}">${monthName(m)}</option>`).join("")}</select></div>
    <div class="chips">
      <button class="chip ${F.fCheck ? "on" : ""}" id="fc">${X.ico("spark", "ico tiny")} Zu prüfen <small>${nCheck}</small></button>
      <select class="chip-sel" id="fk" aria-label="Kategorie"><option value="alle">Alle Kategorien</option><option value="_none">Ohne Kategorie</option>${catOptions()}</select>
      ${c.accounts.length > 1 ? `<select class="chip-sel" id="fa" aria-label="Konto"><option value="alle">Alle Konten</option>${c.accounts.map(a => `<option value="${a.id}">${X.esc(a.name)}</option>`).join("")}</select>` : ""}
    </div>
    <div class="row wrap actions">
      <button class="btn small primary" id="t-new">${X.ico("plus")} Buchung</button>
      <button class="btn small ghost" id="t-imp">${X.ico("upload")} Import (CSV, Excel, Amex)</button>
      <button class="btn small ghost" id="t-bel">${X.ico("camera")} Beleg</button>
      <button class="btn small ghost" id="t-auto">${X.ico("spark")} Automatisch zuordnen</button>
    </div>
    <div id="tlist"></div>`;
  X.$("#fm", v).value = months.includes(F.fMonth) ? F.fMonth : "alle";
  X.$("#fk", v).value = F.fCat; if (X.$("#fa", v)) X.$("#fa", v).value = F.fAcc;
  X.$("#fq", v).oninput = e => { F.q = e.target.value; F.limit = 150; drawTxList(); };
  X.$("#fm", v).onchange = e => { F.fMonth = e.target.value; drawTxList(); };
  X.$("#fk", v).onchange = e => { F.fCat = e.target.value; drawTxList(); };
  X.$("#fa", v)?.addEventListener("change", e => { F.fAcc = e.target.value; drawTxList(); });
  X.$("#fc", v).onclick = () => { F.fCheck = !F.fCheck; renderTx(v); };
  X.$("#t-new", v).onclick = () => openTx(null);
  X.$("#t-imp", v).onclick = importCsv;
  X.$("#t-bel", v).onclick = receiptFlow;
  X.$("#t-auto", v).onclick = runAutoAll;
  drawTxList();
}

function catOptions(sel = null, amount = null) {
  const groups = [["aus", "Ausgaben"], ["ein", "Einnahmen"], ["neutral", "Neutral"]];
  return groups.map(([ty, n]) => `<optgroup label="${n}">${cfg().cats.filter(c => c.type === ty).map(c => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${X.esc(c.name)}</option>`).join("")}</optgroup>`).join("");
}

function filtered() {
  const words = F.q.toLowerCase().split(/\s+/).filter(Boolean);
  return allTx().filter(t => {
    if (F.fCheck && !t.check) return false;
    if (F.fMonth !== "alle" && !t.date.startsWith(F.fMonth)) return false;
    if (F.fCat === "_none" ? t.cat : F.fCat !== "alle" && t.cat !== F.fCat) return false;
    if (F.fAcc !== "alle" && t.account !== F.fAcc) return false;
    if (words.length) {
      const hay = `${t.payee} ${t.merchant || ""} ${t.purpose} ${catName(t.cat)} ${eurIn(t.amount)} ${t.note || ""}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.updated || "").localeCompare(a.updated || ""));
}

function txRow(t) {
  const ty = typeOf(t);
  const by = t.check ? `<span class="due soon">${t.cat && t.catBy === "ki" ? "KI-Vorschlag" : "prüfen"}</span>` : t.catBy === "ki" ? `<span class="due later">KI</span>` : "";
  return `<li class="tx" data-id="${t.id}">
    <button class="tx-main" data-open><span class="tx-ico ${ty}">${X.ico(ty === "ein" ? "in" : ty === "neutral" ? "swap" : "out")}</span>
      <span class="tx-body"><span class="tx-title">${X.esc(label(t))}</span>
      <span class="tx-meta">${X.esc(catName(t.cat))}${cfg().accounts.length > 1 ? " · " + X.esc(accName(t.account)) : ""}${t.belege?.length ? ` · ${X.ico("clip", "ico tiny")}` : ""} ${by}</span></span>
      <span class="tx-amt ${t.amount > 0 ? "pos" : ""}">${t.amount > 0 ? "+" : "−"}${eur(Math.abs(t.amount)).replace("-", "")}</span></button>
    ${t.check && t.cat ? `<button class="icon-btn small ok-btn" data-ok aria-label="Zuordnung bestätigen" title="Bestätigen">${X.ico("check")}</button>` : ""}
  </li>`;
}

function drawTxList() {
  const el = X.$("#tlist"); if (!el) return;
  const list = filtered(), shown = list.slice(0, F.limit);
  if (!list.length) { el.innerHTML = `<div class="empty"><p>${allTx().length ? "Keine passenden Buchungen." : "Noch keine Buchungen. Importiere einen Kontoauszug oder erfasse eine Ausgabe."}</p></div>`; return; }
  const sum = list.reduce((a, t) => a + t.amount, 0);
  let html = `<p class="lead">${X.plural(list.length, "Buchung", "Buchungen")} · Summe ${eur(sum)}</p>`, day = null;
  for (const t of shown) {
    if (t.date !== day) { if (day) html += "</ul>"; day = t.date; html += `<h3 class="day">${dayLabel(day)}</h3><ul class="txlist">`; }
    html += txRow(t);
  }
  html += "</ul>";
  if (list.length > shown.length) html += `<div class="center"><button class="btn ghost" id="more">Weitere ${Math.min(150, list.length - shown.length)} anzeigen</button></div>`;
  el.innerHTML = html;
  X.$$(".tx", el).forEach(li => {
    const t = allTx().find(x => x.id === li.dataset.id);
    X.$("[data-open]", li).onclick = () => openTx(t);
    X.$("[data-ok]", li)?.addEventListener("click", async () => { t.check = false; t.catBy = t.catBy === "ki" ? "ki" : t.catBy; learn(t); await putTx([t]); await saveCfg(); X.refresh(); });
  });
  X.$("#more", el)?.addEventListener("click", () => { F.limit += 150; drawTxList(); });
}

async function runAutoAll() {
  const list = allTx().filter(t => !t.cat || t.check);
  if (!list.length) return X.toast("Alle Buchungen sind schon zugeordnet");
  const c = cfg();
  if (!c.ki?.enabled && !(await X.ask({ title: "Automatisch zuordnen", text: `${X.plural(list.length, "Buchung wird", "Buchungen werden")} mit deinen Regeln, dem Gelernten und dem Händler-Wörterbuch zugeordnet – lokal auf diesem Gerät.<br><br>Mit der <b>KI-Zuordnung</b> (Einstellungen) werden auch unbekannte Händler erkannt.`, ok: "Zuordnen" }))) return;
  X.toast("Ordne zu …");
  const r = await autoAssign(list, { status: X.toast });
  await putTx(list); await saveCfg();
  X.refresh();
  X.ask({ title: "Zuordnung abgeschlossen", text: `${r.local} lokal zugeordnet${r.viaKi ? `, ${r.viaKi} per KI` : ""}${r.open ? `, ${r.open} ohne Kategorie` : ""}.${r.error ? `<br><br>KI: ${X.esc(r.error)}` : ""}<br><br>Unsichere Vorschläge stehen unter <b>Zu prüfen</b>. Jede Korrektur merkt sich die App für diesen Empfänger.`, cancel: null });
}

/* ---------------- Buchung bearbeiten ---------------- */
export function openTx(tx, preset = {}) {
  const c = cfg(), isNew = !tx;
  const t = tx ? structuredClone(tx) : { id: X.newId(), date: todayISO(), amount: -0, payee: "", purpose: "", cat: "", account: c.accounts[0]?.id || "", belege: [], note: "", src: "hand", ...preset };
  t.belege ||= [];
  let manualCat = !!(tx && tx.catBy === "hand");
  const out = (t.amount ?? 0) <= 0 && !(preset.amount > 0);
  const { el, close } = X.sheet(`
    <header class="sheet-top"><button class="icon-btn" data-close aria-label="Abbrechen">${X.ico("x")}</button>
      <h1>${isNew ? "Neue Buchung" : "Buchung"}</h1><span></span></header>
    <form class="sheet-body form" id="tf">
      <div class="seg wide" role="radiogroup"><button type="button" data-t="aus" class="${out ? "on" : ""}">Ausgabe</button><button type="button" data-t="ein" class="${out ? "" : "on"}">Einnahme</button></div>
      <label class="amount">Betrag in Euro<input name="amount" inputmode="decimal" autocomplete="off" required placeholder="0,00" value="${eurIn(t.amount)}"></label>
      <div class="grid2">
        <label>Datum<input type="date" name="date" required value="${t.date}"></label>
        <label>Konto<select name="account">${c.accounts.map(a => `<option value="${a.id}" ${a.id === t.account ? "selected" : ""}>${X.esc(a.name)}</option>`).join("")}</select></label>
      </div>
      <label>Empfänger / Händler<input name="payee" maxlength="120" value="${X.esc(t.merchant || t.payee)}" placeholder="z. B. REWE, Stadtwerke, Arbeitgeber" autocomplete="off"></label>
      <label>Kategorie <small id="catHint"></small><select name="cat"><option value="">– bitte wählen –</option>${catOptions(t.cat)}</select></label>
      <label>Verwendungszweck / Notiz<textarea name="purpose" rows="2" placeholder="optional">${X.esc([t.purpose, t.note].filter(Boolean).join("\n"))}</textarea></label>
      <div class="belege"><div class="row between"><b>Belege</b><span class="hint small">aus deiner Dokumentenablage</span></div>
        <ul class="flist" id="bl"></ul>
        <div class="row wrap">
          <button type="button" class="btn small ghost" id="b-pick">${X.ico("folder")} Aus Ablage wählen</button>
          <label class="btn small ghost">${X.ico("camera")} Foto / Datei<input type="file" id="b-file" accept="image/*,application/pdf" hidden></label>
          <button type="button" class="btn small ghost" id="b-ki" ${c.ki?.enabled && c.ki.apiKey ? "" : "hidden"}>${X.ico("spark")} Beleg per KI auslesen</button>
        </div></div>
      <button class="btn primary block" id="save">Verschlüsselt speichern</button>
      ${isNew ? "" : `<button type="button" class="btn ghost danger-text block" id="del">${X.ico("trash")} Buchung löschen</button>
        <p class="hint small center">${t.src === "csv" ? "Aus Kontoauszug importiert" : "Von Hand erfasst"}${t.catBy ? ` · Kategorie: ${{ hand: "von dir", regel: "Regel", gelernt: "gelernt", "wörterbuch": "Händler-Wörterbuch", ki: "KI" }[t.catBy] || t.catBy}` : ""}</p>`}
    </form>`);
  const f = X.$("#tf", el);
  let sign = out ? -1 : 1;
  X.$$(".seg [data-t]", el).forEach(b => b.onclick = () => { sign = b.dataset.t === "aus" ? -1 : 1; X.$$(".seg [data-t]", el).forEach(x => x.classList.toggle("on", x === b)); hint(); });
  const hint = () => {
    if (manualCat) return;
    const amount = sign * (Math.abs(CSV.parseAmount(f.amount.value) || 1));
    const s = KI.suggest({ payee: f.payee.value, purpose: f.purpose.value, amount }, c);
    if (s) { f.cat.value = s.cat; X.$("#catHint", el).textContent = `· Vorschlag (${s.by})`; }
    else X.$("#catHint", el).textContent = "";
  };
  let tm; f.payee.oninput = () => { clearTimeout(tm); tm = setTimeout(hint, 250); };
  f.cat.onchange = () => { manualCat = true; X.$("#catHint", el).textContent = ""; };
  const drawBelege = () => {
    const docs = t.belege.map(id => X.S.docs.find(d => d.id === id)).filter(Boolean);
    X.$("#bl", el).innerHTML = docs.length ? docs.map(d => `<li><span class="mini-thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : X.ico("file")}</span><span>${X.esc(d.title)} <small>${X.fmtDate(d.docDate)}</small></span>
        <button type="button" class="icon-btn small" data-show="${d.id}" aria-label="Öffnen">${X.ico("search")}</button><button type="button" class="icon-btn small" data-un="${d.id}" aria-label="Verknüpfung lösen">${X.ico("x")}</button></li>`).join("")
      : `<li class="none">Noch kein Beleg verknüpft.</li>`;
    X.$$("[data-show]", el).forEach(b => b.onclick = () => X.openDetail(X.S.docs.find(d => d.id === b.dataset.show)));
    X.$$("[data-un]", el).forEach(b => b.onclick = () => { t.belege = t.belege.filter(x => x !== b.dataset.un); drawBelege(); });
  };
  drawBelege();
  X.$("#b-pick", el).onclick = async () => { const id = await pickDoc(t); if (id && !t.belege.includes(id)) { t.belege.push(id); drawBelege(); } };
  const fi = X.$("#b-file", el);
  fi.onclick = () => { X.S.picking = true; };
  fi.onchange = async () => {
    X.S.picking = false; const file = fi.files[0]; fi.value = ""; if (!file) return;
    const d = await storeReceipt(file, f.payee.value, f.date.value);
    t.belege.push(d.id); drawBelege();
    if (c.ki?.enabled && c.ki.apiKey) readWithKi(d);
  };
  const readWithKi = async d => {
    const btn = X.$("#b-ki", el); X.busy(btn, true, "KI liest den Beleg …");
    try {
      const r = await receiptData(d);
      if (r.gesamtbetrag) { f.amount.value = r.gesamtbetrag.toFixed(2).replace(".", ","); sign = r.gutschrift ? 1 : -1; X.$$(".seg [data-t]", el).forEach(x => x.classList.toggle("on", x.dataset.t === (sign < 0 ? "aus" : "ein"))); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(r.datum)) f.date.value = r.datum;
      if (r.haendler) f.payee.value = r.haendler;
      if (r.kategorie && !manualCat) { f.cat.value = r.kategorie; X.$("#catHint", el).textContent = "· Vorschlag (KI)"; t.catBy = "ki"; }
      if (r.notiz && !f.purpose.value) f.purpose.value = r.notiz;
      // Belegtitel in der Ablage aussagekräftig machen
      if (r.haendler && /^Beleg( |$)/.test(d.title)) { d.title = `Beleg ${r.haendler}`; if (/^\d{4}-\d{2}-\d{2}$/.test(r.datum)) d.docDate = r.datum; await X.saveDoc(d, [], []); drawBelege(); }
      X.toast("Beleg ausgelesen – bitte kurz prüfen");
    } catch (e) { X.ask({ title: "Auslesen fehlgeschlagen", text: X.esc(e.message), cancel: null }); }
    X.busy(btn, false);
  };
  X.$("#b-ki", el).onclick = () => {
    const d = t.belege.map(id => X.S.docs.find(x => x.id === id)).find(x => x?.files?.some(fl => fl.type.startsWith("image/") || fl.type === "application/pdf"));
    if (!d) return X.toast("Zuerst einen Beleg mit Foto oder PDF verknüpfen");
    readWithKi(d);
  };
  X.$("[data-close]", el).onclick = close;
  X.$("#del", el)?.addEventListener("click", async () => {
    if (!(await X.ask({ title: "Buchung löschen?", text: "Verknüpfte Belege bleiben in der Ablage erhalten.", ok: "Löschen", danger: true }))) return;
    await delTx([t.id]); close(); X.refresh(); X.toast("Gelöscht");
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const a = CSV.parseAmount(f.amount.value);
    if (!a) return X.toast("Bitte einen Betrag eingeben");
    const btn = X.$("#save", el); X.busy(btn, true, "Speichere …");
    const lines = f.purpose.value.trim();
    const payee = f.payee.value.trim();
    if (payee !== (t.merchant || t.payee)) { t.payee = payee; delete t.merchant; }
    Object.assign(t, { amount: sign * Math.abs(a), date: f.date.value, account: f.account.value, purpose: lines, note: "" });
    const before = tx?.cat, newCat = f.cat.value;
    t.cat = newCat;
    if (newCat) {
      if (manualCat || (tx?.check && newCat)) { t.catBy = "hand"; t.check = false; }
      else if (!t.catBy) t.catBy = "hand";
      if (t.catBy !== "ki") t.check = false;
      else t.check = false; // gespeichert = vom Nutzer gesehen
    } else t.check = true;
    let others = [];
    if (newCat && (manualCat || isNew)) {
      const k = learn(t);
      if (k && before !== newCat) others = allTx().filter(o => o.id !== t.id && o.catBy !== "hand" && o.cat !== newCat && KI.normPayee(o.payee || o.purpose) === k && Math.sign(o.amount) === Math.sign(t.amount));
      await saveCfg();
    }
    try {
      await putTx([t]);
      if (others.length && await X.ask({ title: "Auch die anderen zuordnen?", text: `Es gibt ${X.plural(others.length, "weitere Buchung", "weitere Buchungen")} von „${X.esc(label(t))}“. Ebenfalls <b>${X.esc(catName(newCat))}</b> zuordnen?`, ok: "Ja, alle", cancel: "Nur diese" })) {
        others.forEach(o => { o.cat = newCat; o.catBy = "gelernt"; o.check = false; }); await putTx(others);
      }
      close(); X.refresh(); X.toast(isNew ? "Buchung gespeichert" : "Gespeichert");
    } catch (err) { X.busy(btn, false); X.toast("Fehler: " + err.message); }
  };
  if (isNew && !preset.belege?.length) setTimeout(() => f.amount.focus(), 60);
  if (preset.autoKi) setTimeout(() => X.$("#b-ki", el).click(), 80);
}

/* Beleg als Ablage-Dokument speichern (Ordner Finanzen › Belege & Quittungen). */
async function storeReceipt(file, payee, date) {
  const name = file.name && file.name !== "image.jpg" ? file.name : `Beleg_${todayISO()}.jpg`;
  const d = { id: X.newId(), title: `Beleg${payee ? " " + payee : ""}`, category: "finanzen/belege", tags: ["Beleg"], notes: "", docDate: date || todayISO(), deadline: "", remindDays: 30, files: [], thumb: null, created: new Date().toISOString() };
  await X.saveDoc(d, [{ name, blob: file }], []);
  return d;
}

/* Datei für die KI vorbereiten: Fotos verkleinern (spart Kosten), PDFs direkt. */
async function receiptData(d) {
  const fm = d.files.find(fl => fl.type.startsWith("image/")) || d.files.find(fl => fl.type === "application/pdf");
  if (!fm) throw new Error("Der Beleg enthält kein Foto oder PDF.");
  const blob = await X.fileBlob(fm);
  let b64, type = fm.type;
  if (type === "application/pdf") {
    if (blob.size > 8 * 1048576) throw new Error("PDF ist zu groß (max. 8 MB).");
    b64 = await toB64(blob);
  } else {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
    b64 = cv.toDataURL("image/jpeg", 0.85).split(",")[1]; type = "image/jpeg";
  }
  return KI.readReceipt(cfg().ki, cfg().cats, { b64, type });
}
const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

/* Neuer Beleg per Kamera → Ablage → Buchung (mit KI-Auslesen, falls eingeschaltet). */
export function receiptFlow() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,application/pdf"; inp.setAttribute("capture", "environment");
  X.S.picking = true;
  inp.onchange = async () => {
    X.S.picking = false; const file = inp.files[0]; if (!file) return;
    X.toast("Beleg wird verschlüsselt abgelegt …");
    const d = await storeReceipt(file, "", todayISO());
    const c = cfg();
    openTx(null, { belege: [d.id], autoKi: !!(c.ki?.enabled && c.ki.apiKey) });
  };
  inp.click();
}

/* Beleg aus der Ablage auswählen. */
function pickDoc(t) {
  return new Promise(resolve => {
    const docs = X.adocs();
    const amt = t ? Math.abs(t.amount) : 0;
    const { el, close } = X.sheet(`<header class="sheet-top"><button class="icon-btn" data-close aria-label="Abbrechen">${X.ico("x")}</button><h1>Beleg wählen</h1><span></span></header>
      <div class="sheet-body"><div class="searchbar">${X.ico("search")}<input type="search" id="pq" placeholder="In der Ablage suchen …" aria-label="Suchen"></div>
      <p class="hint">Belege, Kaufbelege und Rechnungen zuerst. Neue Belege landen im Ordner <b>Finanzen & Steuern › Belege & Quittungen</b>.</p><ul class="list" id="pl"></ul></div>`);
    const prio = d => (/^finanzen\/belege|^kauf\//.test(d.category) ? 0 : /rechnung|beleg|quittung|kassenbon/i.test(d.title) ? 1 : 2);
    const near = d => t && d.docDate && Math.abs(new Date(d.docDate) - new Date(t.date)) < 5 * 864e5 ? 0 : 1;
    const draw = () => {
      const q = X.$("#pq", el).value.toLowerCase();
      const list = docs.filter(d => !q || `${d.title} ${d.notes} ${(d.tags || []).join(" ")}`.toLowerCase().includes(q))
        .sort((a, b) => near(a) - near(b) || prio(a) - prio(b) || (b.docDate || b.updated || "").localeCompare(a.docDate || a.updated || "")).slice(0, 80);
      X.$("#pl", el).innerHTML = list.length ? list.map(d => `<li><button class="card" data-id="${d.id}"><span class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : X.ico("file", "ico big")}</span>
        <span class="card-body"><span class="card-title">${X.esc(d.title)}</span><span class="card-meta">${X.esc(X.catName(d))}${d.docDate ? " · " + X.fmtDate(d.docDate) : ""}</span></span></button></li>`).join("")
        : `<li class="empty"><p>Keine Dokumente gefunden.</p></li>`;
      X.$$("[data-id]", el).forEach(b => b.onclick = () => { close(); resolve(b.dataset.id); });
    };
    X.$("#pq", el).oninput = draw; draw();
    X.$("[data-close]", el).onclick = () => { close(); resolve(null); };
  });
}

/* In der Dokument-Detailansicht: verknüpfte Buchungen + „Als Buchung erfassen“. */
export function docLinks(doc) {
  const linked = allTx().filter(t => t.belege?.includes(doc.id));
  return `<section class="doc-fin"><h2 class="sec">${X.ico("wallet")} Haushaltsbuch</h2>
    ${linked.length ? `<ul class="txlist">${linked.map(txRow).join("")}</ul>` : `<p class="hint">Mit keiner Buchung verknüpft.</p>`}
    <button class="btn ghost small" id="asTx">${X.ico("plus")} Als Buchung erfassen</button></section>`;
}
export function bindDocLinks(el, doc, closeDetail) {
  X.$$(".doc-fin .tx", el).forEach(li => X.$("[data-open]", li).onclick = () => { closeDetail(); openTx(allTx().find(t => t.id === li.dataset.id)); });
  X.$("#asTx", el)?.addEventListener("click", () => {
    closeDetail(); const c = cfg();
    const hasImg = doc.files?.some(f => f.type.startsWith("image/") || f.type === "application/pdf");
    openTx(null, { belege: [doc.id], date: doc.docDate || todayISO(), payee: doc.title.replace(/^Beleg\s*/, ""), autoKi: !!(hasImg && c.ki?.enabled && c.ki.apiKey) });
  });
}

/* ---------------- Import: CSV / Excel aus dem Online-Banking, PDF-Abrechnungen per KI ---------------- */
export function importCsv() {
  const inp = document.createElement("input"); inp.type = "file";
  inp.accept = ".csv,.txt,.xlsx,.pdf,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  X.S.picking = true;
  inp.onchange = async () => {
    X.S.picking = false; const file = inp.files[0]; if (!file) return;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return importPdf(file);
    let parsed;
    try {
      parsed = /\.xlsx$/i.test(file.name) ? CSV.parseRows(await CSV.readXlsx(file), file.name) : CSV.parse(await CSV.readText(file), file.name);
    } catch (e) { return X.ask({ title: "Datei nicht lesbar", text: X.esc(e.message), cancel: null }); }
    if (!parsed.head.length || !parsed.rows.length) return X.ask({ title: "Keine Umsätze gefunden", text: "Bitte im Online-Banking die Umsätze als CSV oder Excel exportieren. PDF-Abrechnungen liest die KI-Zuordnung aus.", cancel: null });
    csvDialog(file.name, parsed);
  };
  inp.click();
}

const AMEX_NEW = "__amex";
const amexAcc = () => cfg().accounts.find(a => /amex|american express/i.test(a.name));
function accSelect(issuer) {
  const c = cfg(), am = issuer === "amex" ? amexAcc() : null;
  return `<label>In Konto<select id="acc">${c.accounts.map(a => `<option value="${a.id}" ${am?.id === a.id ? "selected" : ""}>${X.esc(a.name)}</option>`).join("")}
    ${issuer === "amex" && !am ? `<option value="${AMEX_NEW}" selected>Neues Konto: American Express</option>` : ""}</select></label>`;
}
async function resolveAcc(v) {
  if (v !== AMEX_NEW) return v;
  const a = { id: X.newId(), name: "American Express", start: 0 }; cfg().accounts.push(a); await saveCfg(); return a.id;
}

/* Gemeinsamer Abschluss: doppelte überspringen, zuordnen, speichern, Ergebnis zeigen. */
async function finishImport(fresh, { useKi, status }) {
  const r = await autoAssign(fresh, { ki: useKi, status });
  status?.("Verschlüssele …");
  await putTx(fresh); await saveCfg();
  F.month = fresh.map(t => t.date).sort().at(-1).slice(0, 7);
  F.fCheck = fresh.some(t => t.check); F.fMonth = "alle"; X.go(F.fCheck ? "buchungen" : "uebersicht");
  X.ask({ title: "Import abgeschlossen", text: `${X.plural(fresh.length, "Buchung", "Buchungen")} übernommen. ${r.local} automatisch zugeordnet${r.viaKi ? `, ${r.viaKi} per KI` : ""}${r.open ? `, ${r.open} noch ohne Kategorie` : ""}.${r.error ? `<br><br>KI: ${X.esc(r.error)}` : ""}${F.fCheck ? "<br><br>Bitte die Einträge unter <b>Zu prüfen</b> kurz ansehen – jede Korrektur macht die Zuordnung besser." : ""}`, cancel: null });
}

function csvDialog(name, parsed) {
  const c = cfg(), m = { ...parsed.map };
  const sel = (key, labelTxt, opt = false) => `<label>${labelTxt}<select data-k="${key}">${opt ? `<option value="-1">– keine –</option>` : ""}${parsed.head.map((h, i) => `<option value="${i}" ${m[key] === i ? "selected" : ""}>${X.esc(h || `Spalte ${i + 1}`)}</option>`).join("")}</select></label>`;
  const { el, close } = X.sheet(`<header class="sheet-top"><button class="icon-btn" data-close aria-label="Abbrechen">${X.ico("x")}</button><h1>${parsed.issuer === "amex" ? "Amex-Umsätze importieren" : "Kontoauszug importieren"}</h1><span></span></header>
    <div class="sheet-body form">
      <p class="lead">${X.esc(name)} · ${X.plural(parsed.rows.length, "Zeile", "Zeilen")}.${parsed.issuer === "amex" ? " <b>American Express erkannt.</b>" : ""} Die Spalten wurden automatisch erkannt – bitte kurz prüfen.</p>
      <div class="grid2">${sel("date", "Datum")}${sel("payee", "Empfänger / Händler", true)}</div>
      <div class="grid2">${sel("amount", "Betrag", true)}${sel("purpose", "Verwendungszweck / Details", true)}</div>
      <details ${m.amount < 0 ? "open" : ""}><summary class="hint">Getrennte Soll-/Haben-Spalten?</summary><div class="grid2">${sel("debit", "Soll (Ausgang)", true)}${sel("credit", "Haben (Eingang)", true)}</div></details>
      <label class="check-row"><input type="checkbox" id="inv" ${parsed.invert ? "checked" : ""}><span>Vorzeichen umkehren – Kreditkarten-Export, in dem Einkäufe positiv stehen (z. B. Amex)</span></label>
      ${accSelect(parsed.issuer)}
      <div id="prev"></div>
      <label class="check-row"><input type="checkbox" id="useKi" ${c.ki?.enabled && c.ki.apiKey ? "checked" : "disabled"}><span>Unbekannte Händler per KI zuordnen${c.ki?.enabled && c.ki.apiKey ? "" : " (in den Einstellungen einschalten)"}</span></label>
      <button class="btn primary block" id="go">Importieren</button>
    </div>`);
  const prev = () => {
    X.$$("[data-k]", el).forEach(s => m[s.dataset.k] = +s.value);
    const { tx, skipped } = CSV.toTx(parsed, m, X.$("#inv", el).checked);
    const have = new Set(allTx().map(t => t.hash));
    const dup = tx.filter(t => have.has(CSV.fingerprint(t))).length;
    const out = tx.filter(t => t.amount < 0 && !have.has(CSV.fingerprint(t))).reduce((a, t) => a - t.amount, 0);
    X.$("#prev", el).innerHTML = `<p class="hint">${X.plural(tx.length - dup, "neue Buchung", "neue Buchungen")}${out ? ` · Ausgaben ${eur(out)}` : ""}${dup ? ` · ${dup} schon vorhanden (werden übersprungen)` : ""}${skipped.length ? ` · ${skipped.length} Zeilen ohne Datum/Betrag` : ""}</p>
      <ul class="txlist preview">${tx.slice(0, 4).map(t => `<li class="tx"><span class="tx-main"><span class="tx-body"><span class="tx-title">${X.esc(t.payee || t.purpose || "–")}</span><span class="tx-meta">${X.fmtDate(t.date)} · ${X.esc(t.purpose.slice(0, 60))}</span></span><span class="tx-amt ${t.amount > 0 ? "pos" : ""}">${eur(t.amount)}</span></span></li>`).join("")}</ul>`;
    return { tx, have };
  };
  X.$$("[data-k]", el).forEach(s => s.onchange = prev); X.$("#inv", el).onchange = prev; prev();
  X.$("[data-close]", el).onclick = close;
  X.$("#go", el).onclick = async () => {
    const { tx, have } = prev();
    const fresh0 = tx.map(t => ({ ...t, hash: CSV.fingerprint(t) })).filter(t => !have.has(t.hash));
    if (!fresh0.length) return X.toast("Keine neuen Buchungen");
    const btn = X.$("#go", el); X.busy(btn, true, "Ordne zu …");
    const acc = await resolveAcc(X.$("#acc", el).value);
    const fresh = fresh0.map(t => ({ id: X.newId(), ...t, account: acc, belege: [], src: "csv", cat: "" }));
    await finishImport(fresh, { useKi: X.$("#useKi", el).checked, status: s => { btn.textContent = s; } });
    close();
  };
}

/* PDF-Abrechnung (z. B. Amex-Monatsabrechnung): in der Ablage speichern und per KI in Buchungen zerlegen. */
async function importPdf(file) {
  const c = cfg(), kiOn = c.ki?.enabled && c.ki.apiKey;
  if (!kiOn) {
    const keep = await X.ask({ title: "PDF-Abrechnung", text: "PDF-Abrechnungen kann nur die <b>KI-Zuordnung</b> in einzelne Buchungen zerlegen (Einstellungen → KI-Zuordnung).<br><br>Ohne KI: Bei American Express unter <i>Umsätze → Herunterladen</i> die Umsätze als <b>CSV</b> oder <b>Excel</b> exportieren und hier importieren.<br><br>Soll die Abrechnung trotzdem schon in der Ablage gespeichert werden?", ok: "In Ablage speichern", cancel: "Abbrechen" });
    if (keep) { const d = await storeStatement(file, ""); X.toast(`„${d.title}“ in der Ablage gespeichert`); }
    return;
  }
  if (file.size > 20 * 1048576) return X.ask({ title: "Datei zu groß", text: "Bitte eine PDF-Abrechnung bis 20 MB wählen.", cancel: null });
  X.toast("Abrechnung wird gelesen – das dauert etwa eine halbe Minute …");
  let data;
  try { data = await KI.readStatement(c.ki, c.cats, await toB64(file)); }
  catch (e) { return X.ask({ title: "Auslesen fehlgeschlagen", text: X.esc(e.message), cancel: null }); }
  const tx = (data.buchungen || []).filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.datum) && b.betrag_eur)
    .map(b => ({ date: b.datum, amount: Math.round(Math.abs(b.betrag_eur) * 100) * (b.art === "gutschrift" ? 1 : -1), payee: b.haendler || b.beschreibung, purpose: b.beschreibung && b.beschreibung !== b.haendler ? b.beschreibung : "", kiCat: b.kategorie }));
  if (!tx.length) return X.ask({ title: "Keine Umsätze erkannt", text: "In dieser PDF wurden keine einzelnen Umsätze gefunden.", cancel: null });
  const issuer = /american express|amex/i.test(data.aussteller || "") || /amex|american/i.test(file.name) ? "amex" : "";
  // Doppelte erkennen: gleicher Tag, gleicher Betrag, gleiches Konto (z. B. vorher schon per CSV importiert)
  const { el, close } = X.sheet(`<header class="sheet-top"><button class="icon-btn" data-close aria-label="Abbrechen">${X.ico("x")}</button><h1>Abrechnung importieren</h1><span></span></header>
    <div class="sheet-body form">
      <p class="lead"><b>${X.esc(data.aussteller || "Abrechnung")}</b>${data.zeitraum ? ` · ${X.esc(data.zeitraum)}` : ""} · ${X.plural(tx.length, "Umsatz", "Umsätze")} erkannt, bereits per KI kategorisiert.</p>
      ${accSelect(issuer)}
      <div id="prev"></div>
      <p class="hint small">Die PDF wird verschlüsselt in der Ablage unter <b>Finanzen & Steuern › Bank & Konten</b> gespeichert und mit jeder Buchung als Beleg verknüpft. Bitte die Summe mit der Abrechnung vergleichen.</p>
      <button class="btn primary block" id="go">Importieren</button>
    </div>`);
  const prev = () => {
    const acc = X.$("#acc", el).value, existing = new Set(allTx().filter(t => t.account === acc).map(t => `${t.date}|${t.amount}`));
    const isDup = t => existing.has(`${t.date}|${t.amount}`);
    const out = tx.filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0), inn = tx.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    const dup = tx.filter(isDup).length;
    X.$("#prev", el).innerHTML = `<p class="hint">Belastungen ${eur(out)} · Gutschriften ${eur(inn)}${dup ? ` · ${dup} schon vorhanden (gleicher Tag und Betrag, werden übersprungen)` : ""}</p>
      <ul class="txlist preview">${tx.slice(0, 6).map(t => `<li class="tx"><span class="tx-main"><span class="tx-body"><span class="tx-title">${X.esc(t.payee)}</span><span class="tx-meta">${X.fmtDate(t.date)} · ${X.esc(catName(t.kiCat))}${isDup(t) ? " · vorhanden" : ""}</span></span><span class="tx-amt ${t.amount > 0 ? "pos" : ""}">${eur(t.amount)}</span></span></li>`).join("")}</ul>
      ${tx.length > 6 ? `<p class="hint small">… und ${tx.length - 6} weitere</p>` : ""}`;
    return isDup;
  };
  X.$("#acc", el).onchange = prev; prev();
  X.$("[data-close]", el).onclick = close;
  X.$("#go", el).onclick = async () => {
    const btn = X.$("#go", el); X.busy(btn, true, "Speichere Abrechnung …");
    const isDup = prev();
    const acc = await resolveAcc(X.$("#acc", el).value);
    const doc = await storeStatement(file, [data.aussteller, data.zeitraum].filter(Boolean).join(" "));
    const fresh = tx.filter(t => !isDup(t)).map(({ kiCat, ...t }) => {
      const n = { id: X.newId(), ...t, hash: CSV.fingerprint(t), account: acc, belege: [doc.id], src: "pdf", cat: "" };
      const local = KI.suggest(n, cfg());
      // Eigene Regeln und Gelerntes haben Vorrang, sonst die Kategorie aus der Abrechnung
      if (local && local.by !== "wörterbuch") Object.assign(n, { cat: local.cat, catBy: local.by, check: false });
      else Object.assign(n, { cat: kiCat, catBy: "ki", check: false });
      return n;
    });
    if (!fresh.length) { close(); return X.toast("Alle Umsätze waren schon vorhanden – Abrechnung in der Ablage gespeichert"); }
    await putTx(fresh); await saveCfg(); close();
    F.month = fresh.map(t => t.date).sort().at(-1).slice(0, 7); F.fMonth = "alle"; F.fCheck = false; X.go("buchungen");
    X.ask({ title: "Abrechnung importiert", text: `${X.plural(fresh.length, "Buchung", "Buchungen")} übernommen und kategorisiert. Die PDF liegt als „${X.esc(doc.title)}“ in deiner Ablage.`, cancel: null });
  };
}

async function storeStatement(file, title) {
  const d = { id: X.newId(), title: title ? `Abrechnung ${title}` : (file.name || "Abrechnung").replace(/\.pdf$/i, ""), category: "finanzen/bank", tags: ["Abrechnung"], notes: "", docDate: todayISO(), deadline: "", remindDays: 30, files: [], thumb: null, created: new Date().toISOString() };
  await X.saveDoc(d, [{ name: file.name || "Abrechnung.pdf", blob: file }], []);
  return d;
}

/* ---------------- Budgetplaner ---------------- */
function renderBudget(v) {
  const ym = F.month, c = cfg(), s = stats(txOf(ym));
  const inc = incomePlan(ym), plan = totalPlan(ym), free = inc - plan;
  const cats = expenseCats();
  const isOverride = id => cfg().budgets.m?.[ym]?.[id] !== undefined;
  const unplanned = [...s.byCat.entries()].filter(([id, val]) => val > 0 && !planOf(ym, id)).reduce((a, [, val]) => a + val, 0);
  v.innerHTML = `${monthNav(ym)}
    <section class="panel budget-head">
      <div class="bh-row"><span>Geplante Einnahmen</span><button class="amt-btn" id="b-inc">${inc ? eur0(inc) : "festlegen"}</button></div>
      <div class="bh-row"><span>Geplante Ausgaben</span><b>${eur0(plan)}</b></div>
      <div class="bh-row total ${free < 0 ? "neg" : ""}"><span>${free >= 0 ? "Frei zum Sparen" : "Überplant"}</span><b>${eur0(Math.abs(free))}</b></div>
      ${inc ? `<p class="hint small">${free >= 0 ? `Das entspricht einer geplanten Sparquote von ${pct(free / inc)}.` : "Die geplanten Ausgaben übersteigen die Einnahmen."} Ist bisher: Einnahmen ${eur0(s.ein)}, Ausgaben ${eur0(s.aus)}.</p>` : `<p class="hint small">Trage dein monatliches Netto-Einkommen ein, dann zeigt der Planer, wie viel zum Sparen bleibt.</p>`}
      <div class="row wrap"><button class="btn small ghost" id="b-avg">${X.ico("spark")} Vorschlag aus den letzten 3 Monaten</button>
        <button class="btn small ghost" id="b-prev">Vormonat übernehmen</button></div>
    </section>
    <ul class="budget">${cats.map(cat => {
      const p = planOf(ym, cat.id), used = s.byCat.get(cat.id) || 0, r = p - used;
      if (!p && !used) return "";
      return `<li data-c="${cat.id}"><button class="b-row">
        <span class="b-name">${X.esc(cat.name)}${isOverride(cat.id) ? ` <small class="tag-m">nur ${monthName(ym, true).replace(".", "")}</small>` : ""}</span>
        <span class="b-nums">${eur0(used)} <small>von</small> ${p ? eur0(p) : "–"}</span>
        ${Ch.progress(used, p)}
        <span class="b-rest ${r < 0 ? "neg" : ""}">${p ? (r >= 0 ? `noch ${eur0(r)}` : `${eur0(-r)} drüber`) : "ohne Budget"}</span></button></li>`;
    }).join("")}</ul>
    ${unplanned ? `<p class="hint">${eur0(unplanned)} Ausgaben in Kategorien ohne Budget.</p>` : ""}
    <details class="panel more-cats"><summary>Budget für weitere Kategorien festlegen</summary>
      <ul class="plain-list">${cats.filter(cat => !planOf(ym, cat.id) && !(s.byCat.get(cat.id) > 0)).map(cat => `<li><button class="link-in" data-c="${cat.id}">${X.esc(cat.name)}</button></li>`).join("")}</ul></details>`;
  bindMonthNav(v, renderBudget);
  X.$$("[data-c]", v).forEach(b => b.onclick = () => editBudget(b.dataset.c ?? b.closest("[data-c]").dataset.c));
  X.$("#b-inc", v).onclick = async () => {
    const val = await amountDialog("Geplante Einnahmen", "Netto pro Monat, z. B. Gehalt und regelmäßige Nebeneinkünfte.", inc, ym);
    if (!val) return;
    const ci = cfg().income; if (val.all) { ci.def = val.c; if (ci.m) delete ci.m[ym]; } else (ci.m ||= {})[ym] = val.c;
    await saveCfg(); renderBudget(v); Ch.paint(v);
  };
  X.$("#b-avg", v).onclick = async () => {
    const ms = [1, 2, 3].map(i => addMonth(ym, -i)), sums = new Map();
    ms.forEach(m => stats(txOf(m)).byCat.forEach((val, id) => id && sums.set(id, (sums.get(id) || 0) + val)));
    if (!sums.size) return X.toast("Für die letzten 3 Monate liegen keine Ausgaben vor");
    if (!(await X.ask({ title: "Budget vorschlagen", text: `Setzt das Standard-Budget je Kategorie auf den Durchschnitt von ${ms.map(m => monthName(m, true)).reverse().join(", ")}, auf 10 € gerundet. Danach kannst du jede Kategorie anpassen.`, ok: "Übernehmen" }))) return;
    const b = cfg().budgets;
    sums.forEach((val, id) => { if (catOf(id)?.type === "aus" && val > 0) b.def[id] = Math.ceil(val / 3 / 1000) * 1000; });
    const ein = ms.reduce((a, m) => a + Math.max(0, stats(txOf(m)).ein), 0);
    if (ein && !cfg().income.def) cfg().income.def = Math.floor(ein / 3 / 1000) * 1000;
    await saveCfg(); renderBudget(v); Ch.paint(v); X.toast("Budget vorgeschlagen");
  };
  X.$("#b-prev", v).onclick = async () => {
    const pm = addMonth(ym, -1), b = cfg().budgets;
    b.m ||= {}; b.m[ym] = {}; expenseCats().forEach(cat => { const p = planOf(pm, cat.id); if (p) b.m[ym][cat.id] = p; });
    await saveCfg(); renderBudget(v); Ch.paint(v); X.toast(`Budget aus ${monthName(pm)} übernommen`);
  };
}

function amountDialog(title, text, cents, ym) {
  return new Promise(resolve => {
    const o = document.createElement("div"); o.className = "overlay";
    o.innerHTML = `<form class="dialog" role="dialog" aria-modal="true"><h2>${X.esc(title)}</h2>${text ? `<p>${text}</p>` : ""}
      <input name="v" inputmode="decimal" placeholder="0,00 €" value="${eurIn(cents)}" autocomplete="off">
      <label class="check-row"><input type="radio" name="sc" value="all" checked><span>Für alle Monate (Standard)</span></label>
      <label class="check-row"><input type="radio" name="sc" value="one"><span>Nur für ${monthName(ym)}</span></label>
      <div class="row end"><button type="button" class="btn ghost" data-x>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`;
    document.body.append(o);
    const f = X.$("form", o), done = v => { o.remove(); resolve(v); };
    f.onsubmit = e => { e.preventDefault(); done({ c: Math.abs(CSV.parseAmount(f.v.value) || 0), all: f.sc.value === "all" }); };
    X.$("[data-x]", o).onclick = () => done(null);
    f.v.focus(); f.v.select();
  });
}

async function editBudget(catId) {
  const ym = F.month, cat = catOf(catId); if (!cat) return;
  const avg = Math.round([1, 2, 3].reduce((a, i) => a + (stats(txOf(addMonth(ym, -i))).byCat.get(catId) || 0), 0) / 3);
  const val = await amountDialog(`Budget: ${cat.name}`, avg ? `Durchschnitt der letzten 3 Monate: ${eur(avg)}. 0 = kein Budget.` : "Wie viel möchtest du pro Monat höchstens ausgeben? 0 = kein Budget.", planOf(ym, catId), ym);
  if (!val) return;
  const b = cfg().budgets;
  if (val.all) { if (val.c) b.def[catId] = val.c; else delete b.def[catId]; if (b.m?.[ym]) delete b.m[ym][catId]; }
  else (b.m[ym] ||= {})[catId] = val.c;
  await saveCfg(); X.refresh();
}

/* ---------------- Tracker: Sparziele, Fixkosten & Abos, fehlende Belege ---------------- */
function renderTracker(v) {
  const c = cfg(), rec = recurring(), fix = rec.reduce((a, r) => a + r.monthly, 0);
  const since = addMonth(curYM(), -11) + "-01";
  const fixed = new Set(rec.map(r => r.key)); // Fixkosten (Miete, Versicherung …) brauchen keinen Einzelbeleg
  const noBeleg = allTx().filter(t => t.amount <= -10000 && t.date >= since && !t.belege?.length && typeOf(t) === "aus"
    && !["wohnen", "versicherung", "steuern", "bargeld"].includes(t.cat) && !fixed.has(KI.normPayee(t.merchant || t.payee || t.purpose)))
    .sort((a, b) => a.amount - b.amount).slice(0, 12);
  v.innerHTML = `
    <section class="panel"><div class="row between"><h2>Sparziele</h2><button class="btn small primary" id="g-new">${X.ico("plus")} Ziel</button></div>
      ${c.goals.length ? `<ul class="goals">${c.goals.map(g => {
        const saved = goalSaved(g), left = Math.max(0, g.target - saved);
        const ml = g.deadline ? Math.max(1, (new Date(g.deadline).getFullYear() - new Date().getFullYear()) * 12 + new Date(g.deadline).getMonth() - new Date().getMonth()) : 0;
        return `<li data-g="${g.id}"><div class="row between"><b>${X.esc(g.name)}</b><span>${eur0(saved)} <small>von</small> ${eur0(g.target)}</span></div>
          ${Ch.progress(Math.min(saved, g.target), g.target).replace('class="pg', 'class="pg goal')}
          <div class="row between"><small class="hint">${saved >= g.target ? "Ziel erreicht" : g.deadline ? `bis ${X.fmtDate(g.deadline)} · ${eur0(Math.ceil(left / ml))} pro Monat nötig` : `noch ${eur0(left)}`}</small>
          <span class="row"><button class="btn small ghost" data-in>${X.ico("plus")} Einzahlen</button><button class="icon-btn small" data-ed aria-label="Bearbeiten">${X.ico("edit")}</button></span></div></li>`;
      }).join("")}</ul>` : `<p class="hint">Lege Ziele an – etwa Notgroschen, Urlaub oder ein neues Fahrrad – und verfolge, wie viel schon zurückgelegt ist.</p>`}
    </section>
    <section class="panel"><h2>Fixkosten & Abos</h2>
      ${rec.length ? `<p class="big-num">${eur0(fix)} <small>pro Monat · ${eur0(fix * 12)} im Jahr</small></p>
        <ul class="rec">${rec.map(r => `<li data-tip="${X.esc(`${r.n}× erkannt, zuletzt am ${X.fmtDate(r.last)}`)}"><span class="r-name">${X.esc(r.name)}<small>${X.esc(catName(r.cat))} · ${r.freq}</small></span>
          <span class="r-amt">${eur(r.amount)}<small>nächste ca. ${X.fmtDate(r.next)}</small></span></li>`).join("")}</ul>
        <p class="hint small">Automatisch erkannt: gleicher Empfänger, ähnlicher Betrag, regelmäßiger Abstand. Gut geeignet, um vergessene Abos zu finden.</p>`
      : `<p class="hint">Sobald Zahlungen regelmäßig wiederkehren (Miete, Versicherungen, Streaming …), erscheinen sie hier mit Monats- und Jahressumme.</p>`}
    </section>
    <section class="panel"><h2>Belege fehlen</h2>
      <p class="hint">Einkäufe ab 100 € der letzten 12 Monate ohne verknüpften Beleg – wichtig für Garantie, Gewährleistung und Steuer. Fixkosten sind ausgenommen.</p>
      ${noBeleg.length ? `<ul class="txlist">${noBeleg.map(txRow).join("")}</ul>` : `<p class="hint"><b>Alles belegt.</b></p>`}
    </section>`;
  X.$("#g-new", v).onclick = () => editGoal(null);
  X.$$("[data-g]", v).forEach(li => {
    const g = c.goals.find(x => x.id === li.dataset.g);
    X.$("[data-ed]", li).onclick = () => editGoal(g);
    X.$("[data-in]", li).onclick = async () => {
      const a = await X.ask({ title: `Einzahlen: ${g.name}`, text: "Betrag in Euro (negativ = Entnahme):", input: "text", ok: "Buchen" });
      const cents = CSV.parseAmount(a || "");
      if (!cents) return;
      (g.history ||= []).push({ d: todayISO(), a: cents }); await saveCfg(); renderTracker(v); Ch.paint(v);
    };
  });
  X.$$(".tx", v).forEach(li => X.$("[data-open]", li).onclick = () => openTx(allTx().find(t => t.id === li.dataset.id)));
  Ch.bindTips(v);
}

function editGoal(g) {
  const isNew = !g;
  const o = document.createElement("div"); o.className = "overlay";
  o.innerHTML = `<form class="dialog form" role="dialog" aria-modal="true"><h2>${isNew ? "Neues Sparziel" : "Sparziel bearbeiten"}</h2>
    <label>Name<input name="n" required maxlength="60" value="${X.esc(g?.name || "")}" placeholder="z. B. Notgroschen"></label>
    <div class="grid2"><label>Zielbetrag<input name="t" inputmode="decimal" required value="${eurIn(g?.target)}" placeholder="0,00"></label>
    <label>Bis (optional)<input type="date" name="d" value="${g?.deadline || ""}"></label></div>
    ${isNew ? `<label>Bereits gespart<input name="s" inputmode="decimal" placeholder="0,00"></label>` : ""}
    <div class="row end">${isNew ? "" : `<button type="button" class="btn ghost danger-text" data-del>Löschen</button>`}<button type="button" class="btn ghost" data-x>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`;
  document.body.append(o);
  const f = X.$("form", o), close = () => o.remove();
  X.$("[data-x]", o).onclick = close;
  X.$("[data-del]", o)?.addEventListener("click", async () => { cfg().goals = cfg().goals.filter(x => x.id !== g.id); await saveCfg(); close(); X.refresh(); });
  f.onsubmit = async e => {
    e.preventDefault();
    const target = Math.abs(CSV.parseAmount(f.t.value) || 0); if (!target) return X.toast("Bitte einen Zielbetrag angeben");
    if (isNew) { const s = CSV.parseAmount(f.s.value || ""); cfg().goals.push({ id: X.newId(), name: f.n.value.trim(), target, deadline: f.d.value, history: s ? [{ d: todayISO(), a: s }] : [] }); }
    else Object.assign(g, { name: f.n.value.trim(), target, deadline: f.d.value });
    await saveCfg(); close(); X.refresh();
  };
  f.n.focus();
}

/* ---------------- Einstellungen ---------------- */
async function renderSettings(v) {
  await X.renderSettings(); // allgemeine Einstellungen (Backup, Sicherheit …) darunter
  const c = cfg(), ki = c.ki || {};
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <section class="panel"><h2>${X.ico("spark")} KI-Zuordnung</h2>
      <p>Neue Buchungen werden zuerst <b>lokal</b> zugeordnet: deine Regeln, das Gelernte aus deinen Korrekturen und ein Wörterbuch mit über 500 deutschen Händlern. Das funktioniert offline und ohne dass Daten das Gerät verlassen.</p>
      <p>Optional erkennt <b>Claude</b> (Anthropic) zusätzlich unbekannte Händler und liest Kassenbons und Rechnungen aus. Dafür brauchst du einen eigenen API-Schlüssel aus der <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Claude Console</a>. Kosten: Bruchteile eines Cents pro Buchung, wenige Cent pro Beleg.</p>
      <label class="check-row"><input type="checkbox" id="k-on" ${ki.enabled ? "checked" : ""}><span>KI-Zuordnung einschalten</span></label>
      <label>API-Schlüssel<input type="password" id="k-key" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${X.esc(ki.apiKey || "")}"></label>
      <label>Modell<select id="k-model">${KI.MODELS.map(([id, n]) => `<option value="${id}" ${id === ki.model ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <div class="row wrap"><button class="btn primary" id="k-save">Speichern</button><button class="btn ghost" id="k-test">Verbindung testen</button></div>
      <p class="hint small">Der Schlüssel liegt verschlüsselt im Tresor. An Anthropic gehen nur Datum, Betrag, Empfänger und ein gekürzter Verwendungszweck (IBANs, Mandats- und Referenznummern werden vorher entfernt) bzw. das Belegfoto, das du auslesen lässt. Anthropic nutzt API-Daten nicht zum Training.</p>
    </section>
    <section class="panel"><h2>Konten</h2>
      <ul class="plain-list edit">${c.accounts.map(a => `<li><span>${X.esc(a.name)} <small>Startsaldo ${eur(a.start || 0)}</small></span><button class="icon-btn small" data-acc="${a.id}" aria-label="Bearbeiten">${X.ico("edit")}</button></li>`).join("")}</ul>
      <button class="btn small ghost" id="a-new">${X.ico("plus")} Konto hinzufügen</button>
    </section>
    <section class="panel"><h2>Kategorien</h2>
      <details><summary class="hint">${X.plural(c.cats.length, "Kategorie", "Kategorien")} anzeigen und bearbeiten</summary>
      <ul class="plain-list edit">${c.cats.map(cat => `<li><span>${X.esc(cat.name)} <small>${{ aus: "Ausgabe", ein: "Einnahme", neutral: "neutral" }[cat.type]}</small></span><button class="icon-btn small" data-cat="${cat.id}" aria-label="Bearbeiten">${X.ico("edit")}</button></li>`).join("")}</ul></details>
      <button class="btn small ghost" id="c-new">${X.ico("plus")} Kategorie hinzufügen</button>
    </section>
    <section class="panel"><h2>Regeln</h2>
      <p class="hint">Regeln haben Vorrang vor allem anderen. Beispiel: enthält „Mustermann“ → Miete & Wohnen.</p>
      <ul class="plain-list edit">${(c.rules || []).map(r => `<li><span>enthält „${X.esc(r.match)}“ → ${X.esc(catName(r.cat))}</span><button class="icon-btn small" data-rule="${r.id}" aria-label="Löschen">${X.ico("trash")}</button></li>`).join("") || `<li class="hint">Noch keine Regeln.</li>`}</ul>
      <button class="btn small ghost" id="r-new">${X.ico("plus")} Regel hinzufügen</button>
      <p class="hint small">Gelernt aus deinen Korrekturen: ${X.plural(Object.keys(c.learned || {}).length, "Empfänger", "Empfänger")}. ${Object.keys(c.learned || {}).length ? `<button class="link-in" id="l-reset">Zurücksetzen</button>` : ""}</p>
    </section>
    <section class="panel"><h2>Export</h2>
      <p>Alle Buchungen als CSV, z. B. für Excel oder die Steuererklärung. Die Datei ist <b>nicht verschlüsselt</b>.</p>
      <button class="btn ghost" id="x-csv">${X.ico("down")} Buchungen exportieren</button>
    </section>`;
  v.prepend(...wrap.children);
  const saveKi = async () => { c.ki = { enabled: X.$("#k-on", v).checked, apiKey: X.$("#k-key", v).value.trim(), model: X.$("#k-model", v).value }; await saveCfg(); };
  X.$("#k-save", v).onclick = async () => { await saveKi(); X.toast(c.ki.enabled && !c.ki.apiKey ? "Bitte noch den API-Schlüssel eintragen" : "Gespeichert"); };
  X.$("#k-test", v).onclick = async e => {
    await saveKi(); X.busy(e.target, true, "Teste …");
    try { const r = await KI.testKey(c.ki); X.ask({ title: "Verbindung steht", text: `Antwort von ${X.esc(r.model)} erhalten. Die KI-Zuordnung ist bereit.`, cancel: null }); }
    catch (err) { X.ask({ title: "Test fehlgeschlagen", text: X.esc(err.message), cancel: null }); }
    X.busy(e.target, false);
  };
  X.$$("[data-acc]", v).forEach(b => b.onclick = () => editAccount(c.accounts.find(a => a.id === b.dataset.acc)));
  X.$("#a-new", v).onclick = () => editAccount(null);
  X.$$("[data-cat]", v).forEach(b => b.onclick = () => editCat(c.cats.find(x => x.id === b.dataset.cat)));
  X.$("#c-new", v).onclick = () => editCat(null);
  X.$$("[data-rule]", v).forEach(b => b.onclick = async () => { c.rules = c.rules.filter(r => r.id !== b.dataset.rule); await saveCfg(); X.refresh(); });
  X.$("#r-new", v).onclick = editRule;
  X.$("#l-reset", v)?.addEventListener("click", async () => { if (await X.ask({ title: "Gelerntes zurücksetzen?", text: "Die App vergisst, welche Empfänger du welchen Kategorien zugeordnet hast. Bestehende Buchungen bleiben unverändert.", ok: "Zurücksetzen", danger: true })) { c.learned = {}; await saveCfg(); X.refresh(); } });
  X.$("#x-csv", v).onclick = exportCsv;
}

function formDialog(title, fields, { del } = {}) {
  return new Promise(resolve => {
    const o = document.createElement("div"); o.className = "overlay";
    o.innerHTML = `<form class="dialog form" role="dialog" aria-modal="true"><h2>${X.esc(title)}</h2>${fields}
      <div class="row end">${del ? `<button type="button" class="btn ghost danger-text" data-del>Löschen</button>` : ""}<button type="button" class="btn ghost" data-x>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`;
    document.body.append(o);
    const f = X.$("form", o), done = v => { o.remove(); resolve(v); };
    f.onsubmit = e => { e.preventDefault(); done(f); };
    X.$("[data-x]", o).onclick = () => done(null);
    X.$("[data-del]", o)?.addEventListener("click", () => done("del"));
    X.$("input", f)?.focus();
  });
}

async function editAccount(a) {
  const c = cfg();
  const f = await formDialog(a ? "Konto bearbeiten" : "Neues Konto", `<label>Name<input name="n" required maxlength="40" value="${X.esc(a?.name || "")}" placeholder="z. B. Tagesgeld, Kreditkarte"></label>
    <label>Startsaldo (Kontostand vor der ersten erfassten Buchung)<input name="s" inputmode="decimal" value="${a ? ((a.start || 0) / 100).toFixed(2).replace(".", ",") : ""}" placeholder="0,00"></label>`, { del: a && c.accounts.length > 1 });
  if (!f) return;
  if (f === "del") {
    const n = allTx().filter(t => t.account === a.id).length;
    if (n && !(await X.ask({ title: "Konto löschen?", text: `${X.plural(n, "Buchung wird", "Buchungen werden")} dem Konto „${X.esc(c.accounts.find(x => x.id !== a.id).name)}“ zugeordnet.`, ok: "Löschen", danger: true }))) return;
    const other = c.accounts.find(x => x.id !== a.id).id;
    const moved = allTx().filter(t => t.account === a.id); moved.forEach(t => t.account = other);
    c.accounts = c.accounts.filter(x => x.id !== a.id); await saveCfg(); if (moved.length) await putTx(moved);
  } else {
    const start = CSV.parseAmount(f.s.value || "0") || 0;
    if (a) Object.assign(a, { name: f.n.value.trim(), start }); else c.accounts.push({ id: X.newId(), name: f.n.value.trim(), start });
    await saveCfg();
  }
  X.refresh();
}

async function editCat(cat) {
  const c = cfg();
  const f = await formDialog(cat ? "Kategorie bearbeiten" : "Neue Kategorie", `<label>Name<input name="n" required maxlength="40" value="${X.esc(cat?.name || "")}"></label>
    <label>Art<select name="t">${[["aus", "Ausgabe"], ["ein", "Einnahme"], ["neutral", "Neutral (zählt nicht als Ein-/Ausgabe)"]].map(([v, n]) => `<option value="${v}" ${cat?.type === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>`, { del: !!cat });
  if (!f) return;
  if (f === "del") {
    const used = allTx().filter(t => t.cat === cat.id);
    if (!(await X.ask({ title: "Kategorie löschen?", text: used.length ? `${X.plural(used.length, "Buchung verliert", "Buchungen verlieren")} ihre Kategorie und erscheinen unter „Zu prüfen“.` : "Die Kategorie wird entfernt.", ok: "Löschen", danger: true }))) return;
    c.cats = c.cats.filter(x => x.id !== cat.id); delete c.budgets.def[cat.id];
    used.forEach(t => { t.cat = ""; t.check = true; }); await saveCfg(); if (used.length) await putTx(used);
  } else {
    if (cat) Object.assign(cat, { name: f.n.value.trim(), type: f.t.value });
    else c.cats.push({ id: "k-" + X.newId().slice(0, 8), name: f.n.value.trim(), type: f.t.value });
    await saveCfg();
  }
  X.refresh();
}

async function editRule() {
  const c = cfg();
  const f = await formDialog("Neue Regel", `<label>Wenn Empfänger oder Verwendungszweck enthält<input name="m" required maxlength="60" placeholder="z. B. Mustermann Hausverwaltung"></label>
    <label>dann Kategorie<select name="c">${catOptions()}</select></label>
    <label class="check-row"><input type="checkbox" name="apply" checked><span>Auf vorhandene Buchungen anwenden</span></label>`);
  if (!f || f === "del") return;
  const r = { id: X.newId(), match: f.m.value.trim(), cat: f.c.value };
  (c.rules ||= []).push(r);
  await saveCfg();
  if (f.apply.checked) {
    const hit = allTx().filter(t => `${t.payee} ${t.purpose}`.toLowerCase().includes(r.match.toLowerCase()) && t.cat !== r.cat);
    hit.forEach(t => { t.cat = r.cat; t.catBy = "regel"; t.check = false; });
    if (hit.length) { await putTx(hit); X.toast(`${X.plural(hit.length, "Buchung", "Buchungen")} angepasst`); }
  }
  X.refresh();
}

function exportCsv() {
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["Datum", "Betrag", "Empfänger", "Verwendungszweck", "Kategorie", "Konto", "Belege"].map(q).join(";")];
  allTx().sort((a, b) => a.date.localeCompare(b.date)).forEach(t => rows.push([X.fmtDate(t.date), (t.amount / 100).toFixed(2).replace(".", ","), label(t), t.purpose, catName(t.cat), accName(t.account),
    (t.belege || []).map(id => X.S.docs.find(d => d.id === id)?.title).filter(Boolean).join(", ")].map(q).join(";")));
  X.saveFile(new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv" }), `NF-Haushaltsbuch_${todayISO()}.csv`);
}

/* Schnellaktionen für den Plus-Knopf. */
export function addMenu() {
  const o = document.createElement("div"); o.className = "overlay";
  o.innerHTML = `<div class="dialog menu" role="dialog" aria-modal="true"><h2>Hinzufügen</h2>
    <button class="menu-item" data-a="new">${X.ico("plus")}<span><b>Buchung erfassen</b><small>Ausgabe oder Einnahme von Hand</small></span></button>
    <button class="menu-item" data-a="bel">${X.ico("camera")}<span><b>Beleg fotografieren</b><small>wird in der Ablage gespeichert${cfg().ki?.enabled ? " und per KI ausgelesen" : ""}</small></span></button>
    <button class="menu-item" data-a="imp">${X.ico("upload")}<span><b>Kontoauszug / Amex importieren</b><small>CSV oder Excel aus dem Online-Banking, PDF-Abrechnung per KI</small></span></button>
    <div class="row end"><button class="btn ghost" data-x>Abbrechen</button></div></div>`;
  document.body.append(o);
  const close = () => o.remove();
  o.onclick = e => { if (e.target === o) close(); };
  X.$("[data-x]", o).onclick = close;
  X.$$("[data-a]", o).forEach(b => b.onclick = () => { close(); ({ new: () => openTx(null), bel: receiptFlow, imp: importCsv })[b.dataset.a](); });
}
