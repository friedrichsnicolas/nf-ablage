/* Kontoauszug-Import (CSV) für deutsche Banken: Sparkasse, Volksbank, ING, DKB, comdirect, Commerzbank,
 * Deutsche Bank, N26, Postbank, Consorsbank, C24, Trade Republic u. a.
 * Erkennt Trennzeichen, Zeichensatz, Kopfzeile, Datums- und Betragsformat; Zuordnung im Dialog änderbar. */

export async function readText(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf); // ältere Exporte (Sparkasse, Volksbank)
  return t.replace(/^﻿/, "");
}

function splitLine(line, sep) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/* Zeilen trennen, ohne Zeilenumbrüche innerhalb von Anführungszeichen zu zerreißen. */
function lines(text) {
  const out = []; let cur = "", q = false;
  for (const ch of text) {
    if (ch === '"') q = !q;
    if ((ch === "\n" || ch === "\r") && !q) { if (cur.trim()) out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const H = {
  date: /^(buchungs(tag|datum)|buchung|datum|date|booking date|wertstellung|valuta(datum)?|valutadatum)$/i,
  amount: /^(betrag|betrag \(?eur\)?|betrag \(€\)|umsatz|umsatz in eur|amount|amount \(eur\)|betrag in eur|wert)$/i,
  debit: /^(soll|ausgang|belastung|debit|soll \(eur\))$/i,
  credit: /^(haben|eingang|gutschrift|credit|haben \(eur\))$/i,
  sh: /^(soll\/haben|s\/h|kennzeichen)$/i,
  payee: /^(beg(ü|ue)nstigter\/zahlungspflichtiger|name zahlungsbeteiligter|auftraggeber ?\/ ?beg(ü|ue)nstigter|beg(ü|ue)nstigter ?\/ ?auftraggeber|zahlungsempf(ä|ae)nger.*|empf(ä|ae)nger.*|payee|partner name|gegenkonto ?name|name|auftraggeber|beg(ü|ue)nstigter|counterparty|zahlungspflichtige.*)$/i,
  purpose: /^(verwendungszweck|buchungstext|beschreibung|description|text|reference|zahlungsreferenz|vorgang\/verwendungszweck|umsatzart|transaction type|buchungsdetails)$/i,
};

export function parse(text, fileName = "") {
  const ls = lines(text);
  const sample = ls.slice(0, 40).join("\n");
  const sep = [";", ",", "\t", "|"].map(s => [s, (sample.match(new RegExp(s === "|" ? "\\|" : s, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  return parseRows(ls.map(l => splitLine(l, sep)), fileName, sep);
}

/* Gemeinsamer Teil für CSV und Excel: Kopfzeile finden, Spalten zuordnen, Kartenanbieter erkennen. */
export function parseRows(rows, fileName = "", sep = ";") {
  rows = rows.map(r => r.map(c => String(c ?? "").trim()));
  // Kopfzeile: erste Zeile mit erkennbarer Datums- und Betragsspalte
  let hi = rows.findIndex(r => r.some(c => H.date.test(c)) && r.some(c => H.amount.test(c) || H.debit.test(c)));
  if (hi < 0) hi = rows.findIndex(r => r.length >= 3);
  const head = rows[hi] || [];
  const body = rows.slice(hi + 1).filter(r => r.length >= Math.min(3, head.length) && r.some(Boolean));
  const find = (re, not = []) => head.findIndex((c, i) => re.test(c) && !not.includes(i));
  const map = {};
  map.date = find(H.date);
  map.amount = find(H.amount);
  map.debit = map.amount < 0 ? find(H.debit) : -1;
  map.credit = map.amount < 0 ? find(H.credit) : -1;
  map.sh = find(H.sh);
  map.payee = find(H.payee);
  map.purpose = find(H.purpose, [map.payee]);
  // Zweiter Zweck (z. B. Buchungstext + Verwendungszweck) zusammenführen
  const second = head.findIndex((c, i) => H.purpose.test(c) && i !== map.purpose && i !== map.payee);
  map.purpose2 = second;
  // American Express: „Beschreibung“ ist der Händler, Belastungen stehen POSITIV im Export.
  const joined = head.join("|").toLowerCase();
  const amex = /erscheint auf ihrer abrechnung|karteninhaber|kartenmitglied|appears on your statement|card member/.test(joined) || /amex|american.?express|aktivit/i.test(fileName);
  if (amex) {
    const d = head.findIndex(c => /^beschreibung$|^description$/i.test(c));
    if (d >= 0) map.payee = d;
    const det = head.findIndex(c => /weitere details|extended details|erscheint auf ihrer abrechnung als|appears on your statement as/i.test(c));
    map.purpose = det >= 0 ? det : -1; map.purpose2 = -1;
  }
  const dayFirst = detectDayFirst(body.map(r => r[map.date]));
  return { sep, head, rows: body, map, issuer: amex ? "amex" : "", invert: amex, dayFirst };
}

/* 03/04/2026: Tag zuerst (deutsch/Amex DE) oder Monat zuerst (US-Export)? */
function detectDayFirst(vals) {
  for (const v of vals) {
    const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) return false;
  }
  return true;
}

/* ---------------- Excel (.xlsx) ohne Bibliothek: ZIP lesen, XML auswerten ---------------- */
export async function readXlsx(file) {
  const u8 = new Uint8Array(await file.arrayBuffer()), dv = new DataView(u8.buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Keine gültige Excel-Datei.");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const entries = new Map(), td = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    entries.set(td.decode(u8.subarray(p + 46, p + 46 + nl)), { method, csize, off });
    p += 46 + nl + xl + cl;
  }
  const read = async name => {
    const e = entries.get(name); if (!e) return null;
    const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
    const data = u8.subarray(start, start + e.csize);
    if (e.method === 0) return td.decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return td.decode(await new Response(stream).arrayBuffer());
  };
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const ss = await read("xl/sharedStrings.xml");
  const strings = ss ? [...xml(ss).getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].map(t => t.textContent).join("")) : [];
  const sheetName = [...entries.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const sheet = xml(await read(sheetName));
  const col = ref => { let c = 0; for (const ch of ref.replace(/\d+/g, "")) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  return [...sheet.getElementsByTagName("row")].map(row => {
    const out = [];
    for (const c of row.getElementsByTagName("c")) {
      const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let val = t === "s" ? strings[+v] ?? "" : t === "inlineStr" ? c.getElementsByTagName("t")[0]?.textContent ?? "" : v;
      out[col(c.getAttribute("r") || "A1")] = val;
    }
    return Array.from(out, x => x ?? "");
  });
}
const fromSerial = n => { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return d.toISOString().slice(0, 10); };

export function parseDate(s, dayFirst = true) {
  s = String(s || "").trim();
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 70000) return fromSerial(Math.floor(+s)); // Excel-Datum
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3], [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]]; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  return null;
}

/* „-1.234,56“, „1.234,56 €“, „-12.50“, „12,5-“ → Cent */
export function parseAmount(s) {
  s = String(s || "").replace(/\s|€|EUR/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^-|^−/.test(s)) neg = true;
  if (/-$/.test(s)) neg = true;
  s = s.replace(/^[-−+]|[-+]$/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{1,2}$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/[.,]/g, "");
  const v = Math.round(parseFloat(s) * 100);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

/* Wandelt Zeilen anhand der Spaltenzuordnung in Buchungen um. */
export function toTx(parsed, map, invert = false) {
  const out = [], skipped = [];
  for (const r of parsed.rows) {
    const date = parseDate(r[map.date], parsed.dayFirst !== false);
    let amount = null;
    if (map.amount >= 0) amount = parseAmount(r[map.amount]);
    else if (map.debit >= 0 || map.credit >= 0) {
      const d = parseAmount(r[map.debit]), c = parseAmount(r[map.credit]);
      amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (amount !== null && map.sh >= 0 && /^s/i.test(r[map.sh] || "")) amount = -Math.abs(amount);
    if (!date || amount === null || amount === 0) { skipped.push(r); continue; }
    if (invert) amount = -amount; // Kreditkarten-Export: Belastungen positiv
    const purpose = [r[map.purpose], map.purpose2 >= 0 ? r[map.purpose2] : ""].filter(Boolean).join(" · ");
    out.push({ date, amount, payee: (r[map.payee] || "").replace(/\s+/g, " ").trim(), purpose: purpose.replace(/\s+/g, " ").trim() });
  }
  return { tx: out, skipped };
}

/* Fingerabdruck gegen doppelte Importe. */
export function fingerprint(t) {
  const s = `${t.date}|${t.amount}|${(t.payee || "").toLowerCase().replace(/\s+/g, "")}|${(t.purpose || "").toLowerCase().replace(/\s+/g, "").slice(0, 60)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
