/* Diagramme als schlichtes SVG – ohne Bibliothek, passend zur strengen Sicherheitsrichtlinie.
 * Farben: Einnahmen #0F7D5C, Ausgaben #B07D22 (geprüft auf Farbfehlsichtigkeit vor #FFFDF9).
 * Jedes Diagramm hat Hover-/Tipp-Hinweise (data-tip) und eine Legende bzw. direkte Beschriftung. */
export const COL = { ein: "#0F7D5C", aus: "#B07D22", ink: "#1D2B27", muted: "#5E6B66", grid: "#E6DDD0", green: "#0E3A32", rust: "#9A3B2E", champ: "#C6A86A" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const short = c => { // kompakte Achsenbeschriftung in Euro (Cent-Eingabe)
  const v = Math.abs(c / 100);
  return (c < 0 ? "−" : "") + (v >= 10000 ? Math.round(v / 1000) + " Tsd." : v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",") + " Tsd." : Math.round(v) + " €");
};

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/* Abgerundete Säule, nur das Datenende gerundet (4px), Basis bündig an der Nulllinie. */
function bar(x, y, w, h, fill, tip) {
  if (h <= 0.5) return "";
  const r = Math.min(4, w / 2, h);
  return `<path d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z" fill="${fill}" data-tip="${esc(tip)}"/>`;
}

/* Gruppierte Monatssäulen: Einnahmen und Ausgaben je Monat. rows: [{label, ein, aus, tip}] (Cent) */
export function monthBars(rows, W = 640) {
  const H = W < 500 ? 200 : 230, L = 52, R = 8, T = 14, B = 28;
  const max = niceMax(Math.max(1, ...rows.flatMap(r => [r.ein, r.aus])));
  const pw = W - L - R, ph = H - T - B, gw = pw / rows.length, bw = Math.max(4, Math.min(16, gw / 2 - 4));
  const y = v => T + ph - (v / max) * ph;
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${COL.grid}" stroke-width="1"/>`
      + `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${short(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const cx = L + gw * i + gw / 2;
    g += `<rect x="${L + gw * i}" y="${T}" width="${gw}" height="${ph}" fill="transparent" data-tip="${esc(r.tip)}"/>`;
    g += bar(cx - bw - 1, y(r.ein), bw, T + ph - y(r.ein), COL.ein, r.tip);
    g += bar(cx + 1, y(r.aus), bw, T + ph - y(r.aus), COL.aus, r.tip);
    g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax${r.on ? " on" : ""}">${esc(r.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Einnahmen und Ausgaben der letzten Monate">${g}</svg>
    <div class="legend"><span><i data-bg="${COL.ein}"></i>Einnahmen</span><span><i data-bg="${COL.aus}"></i>Ausgaben</span></div>`;
}

/* Kumulierte Ausgaben im Monat gegen die Budgetlinie. days: Cent je Tag (Index 0 = Tag 1). */
export function paceLine(days, budget, todayIdx, fmt, W = 640) {
  const H = W < 500 ? 190 : 210, L = 52, R = 12, T = 14, B = 26, n = days.length;
  const cum = []; days.reduce((a, v, i) => (cum[i] = a + v), 0);
  const shown = todayIdx >= 0 ? cum.slice(0, todayIdx + 1) : cum;
  const max = niceMax(Math.max(budget || 0, ...shown, 1));
  const pw = W - L - R, ph = H - T - B;
  const x = i => L + (n === 1 ? 0 : (i / (n - 1)) * pw), y = v => T + ph - (v / max) * ph;
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${COL.grid}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${short(v)}</text>`;
  }
  [0, 9, 19, n - 1].forEach(i => { g += `<text x="${x(i)}" y="${H - 7}" text-anchor="middle" class="ax">${i + 1}.</text>`; });
  if (budget) g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(n - 1)}" y2="${y(budget)}" stroke="${COL.muted}" stroke-width="1.5" stroke-dasharray="5 5"/>`
    + `<text x="${x(n - 1) - 2}" y="${y(budget) - 7}" text-anchor="end" class="ax">Budget ${short(budget)}</text>`;
  if (shown.length) {
    const pts = shown.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    g += `<polygon points="${x(0)},${y(0)} ${pts} ${x(shown.length - 1)},${y(0)}" fill="${COL.aus}" opacity=".12"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${COL.aus}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const li = shown.length - 1;
    g += `<circle cx="${x(li)}" cy="${y(shown[li])}" r="4.5" fill="${COL.aus}" stroke="#FFFDF9" stroke-width="2"/>`;
  }
  // Unsichtbare Spalten für den Hinweis je Tag
  shown.forEach((v, i) => {
    const plan = budget ? Math.round(budget * (i + 1) / n) : null;
    g += `<rect x="${x(i) - pw / n / 2}" y="${T}" width="${pw / n}" height="${ph}" fill="transparent" data-tip="${esc(`${i + 1}. des Monats · ausgegeben ${fmt(v)}${plan !== null ? ` · Plan bis hier ${fmt(plan)}` : ""}`)}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ausgaben im Monatsverlauf gegen Budget">${g}</svg>
    <div class="legend"><span><i data-bg="${COL.aus}"></i>Ausgaben kumuliert</span>${budget ? `<span><i class="dash"></i>gleichmäßiges Budget</span>` : ""}</div>`;
}

/* Horizontale Balken je Kategorie (eine Reihe → eine Farbe, Beschriftung direkt). rows: [{name, value, sub, tip}] */
export function hbars(rows, fmt) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<ul class="hbars">${rows.map(r => `<li data-tip="${esc(r.tip || "")}">
      <span class="hb-name">${esc(r.name)}</span><span class="hb-val">${fmt(r.value)}</span>
      <span class="hb-track"><i data-w="${Math.max(1.5, (r.value / max) * 100).toFixed(1)}"></i>${r.mark ? `<b data-l="${Math.min(100, (r.mark / max) * 100).toFixed(1)}" title="Budget"></b>` : ""}</span>
      ${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</li>`).join("")}</ul>`;
}

/* Fortschrittsbalken mit Status (ok / knapp / drüber) – Status immer auch als Text. */
export function progress(used, plan) {
  if (!plan) return `<span class="pg"><i data-w="0"></i></span>`;
  const p = used / plan, cls = p > 1 ? "over" : p > 0.85 ? "warn" : "ok";
  return `<span class="pg ${cls}"><i data-w="${Math.min(100, p * 100).toFixed(1)}"></i></span>`;
}

/* Breiten/Farben per CSSOM setzen – die Sicherheitsrichtlinie verbietet style-Attribute im HTML. */
export function paint(root) {
  root.querySelectorAll("[data-w]").forEach(el => { el.style.width = el.dataset.w + "%"; });
  root.querySelectorAll("[data-l]").forEach(el => { el.style.left = el.dataset.l + "%"; });
  root.querySelectorAll("[data-bg]").forEach(el => { el.style.background = el.dataset.bg; });
}

/* Ein gemeinsamer Hinweis-Layer für alle Elemente mit data-tip. */
let tipEl;
export function bindTips(root) {
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.hidden = true; document.body.append(tipEl); }
  const show = (e, t) => {
    tipEl.textContent = t; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 12;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y < 8) y = e.clientY + 18;
    tipEl.style.left = Math.max(8, x) + "px"; tipEl.style.top = y + "px";
  };
  root.addEventListener("pointermove", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el && el.dataset.tip && root.contains(el)) show(e, el.dataset.tip); else tipEl.hidden = true;
  });
  root.addEventListener("pointerleave", () => { tipEl.hidden = true; });
  root.addEventListener("pointerdown", e => { const el = e.target.closest?.("[data-tip]"); if (el?.dataset.tip) show(e, el.dataset.tip); });
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }
