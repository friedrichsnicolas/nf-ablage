/* Automatische Zuordnung von Buchungen.
 *
 * Stufe 1 – lokal, offline, nichts verlässt das Gerät:
 *   eigene Regeln  →  Gelerntes (aus deinen Korrekturen)  →  eingebautes Händler-Wörterbuch
 * Stufe 2 – optional: Claude (Anthropic) für alles, was lokal nicht sicher zuzuordnen ist,
 *   und zum Auslesen von Belegfotos. Nur mit eigenem API-Schlüssel und erst nach Einschalten.
 *   Gesendet werden nur Datum, Betrag, Empfänger und gekürzter Verwendungszweck
 *   (IBANs und lange Ziffernfolgen werden vorher entfernt) bzw. das gewählte Belegbild.
 */

export const DEFAULT_CATS = [
  // Einnahmen
  ["gehalt", "Gehalt & Lohn", "ein"], ["neben", "Nebeneinkünfte", "ein"], ["erstattung", "Erstattungen & Rückzahlungen", "ein"],
  ["kapital", "Zinsen & Kapitalerträge", "ein"], ["sonst-ein", "Sonstige Einnahmen", "ein"],
  // Ausgaben
  ["wohnen", "Miete & Wohnen", "aus"], ["energie", "Strom, Gas & Wasser", "aus"], ["internet", "Telefon, Internet & TV", "aus"],
  ["lebensmittel", "Lebensmittel & Drogerie", "aus"], ["essen", "Restaurant, Café & Lieferdienst", "aus"],
  ["auto", "Auto & Tanken", "aus"], ["mobil", "Bus, Bahn & Taxi", "aus"], ["reisen", "Urlaub & Reisen", "aus"],
  ["versicherung", "Versicherungen", "aus"], ["gesundheit", "Gesundheit & Apotheke", "aus"], ["shopping", "Kleidung & Shopping", "aus"],
  ["haushalt", "Haushalt & Einrichtung", "aus"], ["freizeit", "Freizeit, Sport & Hobby", "aus"], ["abos", "Abos & Streaming", "aus"],
  ["bildung", "Bildung & Bücher", "aus"], ["geschenke", "Geschenke & Spenden", "aus"], ["gebuehren", "Bank & Gebühren", "aus"],
  ["steuern", "Steuern & Abgaben", "aus"], ["bargeld", "Bargeld", "aus"], ["sonstiges", "Sonstige Ausgaben", "aus"],
  // Neutral (zählen weder als Einnahme noch als Ausgabe)
  ["sparen", "Sparen & Anlegen", "neutral"], ["umbuchung", "Umbuchung zwischen Konten", "neutral"],
].map(([id, name, type]) => ({ id, name, type }));

/* Händler-Wörterbuch (deutscher Alltag). Wörter werden als ganze Wörter gesucht. */
const DICT = {
  lebensmittel: "rewe,edeka,aldi,aldi süd,aldi nord,lidl,netto,penny,kaufland,globus,dm,dm-drogerie,dm drogerie,rossmann,denns,alnatura,hit,combi,famila,tegut,norma,bäckerei,baeckerei,backhaus,metzgerei,fleischerei,getränke,trinkgut,hofladen,wochenmarkt,marktkauf,nahkauf,biomarkt,bio company,flaschenpost,picnic,knuspr",
  essen: "restaurant,ristorante,trattoria,pizzeria,cafe,café,coffee,lieferando,wolt,uber eats,mcdonalds,mcdonald's,burger king,starbucks,subway,kfc,vapiano,imbiss,döner,doener,sushi,bistro,brauhaus,gaststätte,eiscafe,backwerk,kamps,dean&david,too good to go",
  auto: "shell,aral,esso,jet,totalenergies,avia,star,tankstelle,agip,westfalen,adac,atu,a.t.u,kfz-werkstatt,autohaus,werkstatt,parkhaus,parken,easypark,parkster,apcoa,contipark,tüv,tuev,dekra,gtü,waschstraße,waschanlage,mr. wash,autowäsche,reifen",
  mobil: "deutsche bahn,db vertrieb,db fernverkehr,db regio,bahn.de,vrr,rheinbahn,kvb,niag,flixbus,flixtrain,uber,free now,freenow,taxi,bvg,mvv,hvv,rmv,vbb,deutschlandticket,d-ticket,tier,lime,bolt,nextbike,call a bike,miles,share now",
  reisen: "lufthansa,eurowings,ryanair,easyjet,condor,booking.com,booking,airbnb,hotel,expedia,tui,hrs,trivago,ferienwohnung,fewo,check24 reisen,holidaycheck,ab-in-den-urlaub,flughafen",
  wohnen: "miete,kaltmiete,warmmiete,hausverwaltung,wohnungsbau,vonovia,leg,vivawest,hausgeld,wohnungsgenossenschaft,baugenossenschaft,grundbesitz",
  energie: "stadtwerke,swk,e.on,eon,rwe,vattenfall,enbw,innogy,westenergie,tibber,lichtblick,naturstrom,yello,strom,gas,erdgas,wasser,abwasser,wasserwerk,fernwärme,heizöl,ista,techem,brunata",
  internet: "telekom,deutsche telekom,vodafone,o2,telefonica,telefónica,1&1,congstar,unitymedia,freenet,mobilcom,mobilcom-debitel,netcologne,deutsche glasfaser,pyur,aldi talk,fraenk,beitragsservice,rundfunk,ard zdf,waipu,zattoo",
  versicherung: "versicherung,versicherungen,allianz,huk,huk-coburg,huk24,axa,ergo,generali,debeka,devk,provinzial,signal iduna,hdi,gothaer,r+v,lvm,wgv,cosmosdirekt,hansemerkur,barmenia,continentale,arag,roland,check24 versicherung,krankenkasse,aok,techniker krankenkasse,tk,barmer,dak,ikk,bkk,haftpflicht,hausrat",
  gesundheit: "apotheke,arzt,ärztin,praxis,zahnarzt,zahnärztin,kieferorthopäde,klinik,krankenhaus,optiker,fielmann,apollo,physio,physiotherapie,docmorris,shop apotheke,medpex,labor,heilpraktiker,hörgeräte,sanitätshaus",
  shopping: "zalando,h&m,hm,zara,c&a,primark,about you,otto,amazon,amzn,ebay,mediamarkt,media markt,saturn,apple store,cyberport,notebooksbilliger,tk maxx,deichmann,snipes,peek & cloppenburg,breuninger,galeria,esprit,tchibo,douglas,flaconi,kleinanzeigen,vinted,shein,temu,aliexpress",
  haushalt: "ikea,obi,bauhaus,hornbach,toom,hagebau,jysk,poco,roller,depot,tedi,action,xxxlutz,porta,möbel,moebel,baumarkt,dänisches bettenlager,westwing,home24,butlers,kodi,woolworth,nanu-nana",
  freizeit: "kino,cinemaxx,uci,cineplex,fitness,fitnessstudio,mcfit,clever fit,fitx,urban sports,eventim,ticketmaster,sportverein,verein,schwimmbad,freibad,decathlon,intersport,sportscheck,steam,playstation,nintendo,xbox,museum,zoo,theater,konzert,golf,tennis,reitstall,fressnapf,zooplus,tierarzt",
  abos: "netflix,spotify,disney,disney+,disney plus,amazon prime,prime video,dazn,sky,wow,youtube premium,apple.com/bill,apple.com,itunes,google play,google one,audible,icloud,microsoft 365,office 365,adobe,chatgpt,openai,anthropic,claude.ai,dropbox,rtl+,joyn,paramount,deezer,kindle unlimited,zeit abo,spiegel+,faz+,readly",
  bildung: "thalia,hugendubel,mayersche,buchhandlung,bücher,udemy,coursera,linkedin learning,volkshochschule,vhs,hochschule,universität,ihk,fernuni,studiengebühr,semesterbeitrag,weiterbildung,seminar",
  geschenke: "spende,spenden,unicef,greenpeace,caritas,diakonie,ärzte ohne grenzen,welthungerhilfe,wwf,nabu,geschenk,blumen,fleurop,blume2000,kirche",
  gebuehren: "kontoführung,kontofuehrung,kontoführungsgebühr,entgelt,entgelte,gebühr,gebühren,sollzinsen,sollzins,dispozinsen,überziehungszinsen,kartenpreis,jahresgebühr,auslandseinsatz,fremdwährung",
  steuern: "finanzamt,steuer,kfz-steuer,bundeskasse,stadtkasse,gemeindekasse,kreiskasse,grundsteuer,hundesteuer,zoll,bußgeld,verwarnungsgeld,gebührenbescheid",
  bargeld: "bargeld,geldautomat,atm,auszahlung,bargeldauszahlung,bargeldabhebung,ga-auszahlung,cash,cashback",
  sparen: "sparplan,wertpapier,wertpapiere,depot,trade republic,scalable,scalable capital,comdirect depot,flatex,smartbroker,sparkonto,tagesgeld,festgeld,etf,bausparkasse,bausparvertrag,wüstenrot,schwäbisch hall,lbs,riester,vermögenswirksame,vl-sparen",
  umbuchung: "american express,amex,american express europe,zahlung erhalten,besten dank,kreditkartenzahlung,umbuchung,übertrag,uebertrag,eigenes konto,eigene überweisung,kreditkartenabrechnung,kreditkarte abrechnung,ausgleich kreditkarte",
  gehalt: "gehalt,lohn,bezüge,bezuege,entgeltabrechnung,besoldung,lohn/gehalt,gehaltszahlung,arbeitslohn",
  erstattung: "erstattung,rückerstattung,rueckerstattung,gutschrift,rückzahlung,refund,steuererstattung,retoure,erstattet,storno",
  kapital: "zinsen,zinsgutschrift,dividende,ausschüttung,ausschuettung,kapitalertrag,habenzinsen",
  neben: "honorar,nebenjob,minijob,vinted auszahlung,kleinanzeigen zahlung",
};

const WORD = "a-zäöüß0-9";
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DICT_RE = Object.entries(DICT).map(([cat, list]) => [cat,
  list.split(",").map(w => w.trim().replace(/\?$/, "")).filter(Boolean)
    .map(w => new RegExp(`(^|[^${WORD}])${escRe(w)}($|[^${WORD}])`, "i"))]);

const LEGAL = /\b(gmbh|ag|se|kg|ohg|ug|e\.?\s?k\.?|e\.?v\.?|co\.?|mbh|inc|ltd|llc|bv|sarl|s\.a\.|deutschland|germany|filiale|sagt danke|vielen dank|online|eu)\b/g;

/* Empfänger vereinheitlichen, damit „REWE Markt GmbH 4711 Willich“ und „REWE 0815“ gleich gelernt werden. */
export function normPayee(s) {
  return String(s || "").toLowerCase()
    .replace(/(paypal|pp\.\d+\.pp|sumup|sum up|zettle|izettle|klarna|visa|mastercard|girocard|ec-karte|lastschrift|sepa|kartenzahlung)[\s*/:.-]*/g, " ")
    .replace(/\d{2}[.\/]\d{2}([.\/]\d{2,4})?/g, " ").replace(/[0-9]+/g, " ")
    .replace(LEGAL, " ").replace(/[^a-zäöüß&+ ]+/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 3).join(" ");
}

/* IBAN, Kartennummern, Mandats- und Referenzkennungen entfernen, bevor etwas an die KI geht. */
export function scrub(s) {
  return String(s || "")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/gi, "[IBAN]")
    .replace(/\b(?:mref|cred|eref|kref|mandat\w*|gläubiger-id|glaeubiger-id|ref)[:\s]*\S+/gi, " ")
    .replace(/\d{6,}/g, "#").replace(/\s+/g, " ").trim().slice(0, 140);
}

const typeOf = (cats, id) => cats.find(c => c.id === id)?.type;
const fits = (cats, id, amount) => {
  const t = typeOf(cats, id); if (!t) return false;
  return t === "neutral" || (amount < 0 ? t === "aus" : t === "ein");
};

/* Lokale Zuordnung. Liefert {cat, by} oder null. */
export function suggest(tx, cfg) {
  const cats = cfg.cats, text = `${tx.payee || ""} ${tx.purpose || ""}`.toLowerCase();
  for (const r of cfg.rules || []) {
    if (r.match && text.includes(r.match.toLowerCase()) && fits(cats, r.cat, tx.amount)) return { cat: r.cat, by: "regel" };
  }
  const key = normPayee(tx.payee || tx.purpose);
  const learned = key && cfg.learned?.[key];
  if (learned && fits(cats, learned, tx.amount)) return { cat: learned, by: "gelernt" };
  // Wörterbuch: zuerst im Empfänger, dann im Verwendungszweck suchen
  for (const field of [tx.payee, tx.purpose]) {
    if (!field) continue;
    for (const [cat, res] of DICT_RE) {
      if (!cats.some(c => c.id === cat)) continue;
      if (res.some(re => re.test(field))) {
        if (fits(cats, cat, tx.amount)) return { cat, by: "wörterbuch" };
        // Geld zurück von einem Händler = Erstattung
        if (tx.amount > 0 && typeOf(cats, cat) === "aus" && cats.some(c => c.id === "erstattung")) return { cat: "erstattung", by: "wörterbuch" };
      }
    }
  }
  return null;
}

/* ---------------- Claude (Anthropic API) ---------------- */
export const MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 – genaueste Zuordnung (Standard)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 – sehr günstig, für große Importe"],
];
const API = "https://api.anthropic.com/v1/messages";

async function callClaude(ki, body) {
  if (!ki?.apiKey) throw new Error("Kein API-Schlüssel hinterlegt (Einstellungen → KI-Zuordnung).");
  const model = ki.model || MODELS[0][0];
  const opus = model.startsWith("claude-opus");
  const headers = {
    "content-type": "application/json",
    "x-api-key": ki.apiKey,
    "anthropic-version": "2026-10-21",
    // Aufruf direkt aus dem Browser: der Schlüssel bleibt auf deinen Geräten (verschlüsselt im Tresor).
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const payload = { model, max_tokens: 16000, ...body };
  payload.output_config = { effort: "low", ...body.output_config };
  if (opus) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; payload.fallbacks = "default"; }
  let r;
  try { r = await fetch(API, { method: "POST", headers, body: JSON.stringify(payload) }); }
  catch { throw new Error("Keine Verbindung zu Anthropic. Bist du online?"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || r.statusText;
    if (r.status === 401) throw new Error("API-Schlüssel ungültig oder widerrufen.");
    if (r.status === 429) throw new Error("Zu viele Anfragen – bitte gleich noch einmal versuchen.");
    if (r.status === 400 && /credit|balance|billing/i.test(msg)) throw new Error("Kein Guthaben im Anthropic-Konto (Console → Billing).");
    throw new Error(`Anthropic-Fehler ${r.status}: ${msg}`);
  }
  if (j.stop_reason === "refusal") throw new Error("Die KI hat diese Anfrage abgelehnt.");
  if (j.stop_reason === "max_tokens") throw new Error("Antwort zu lang – bitte weniger Buchungen auf einmal.");
  const text = (j.content || []).find(b => b.type === "text")?.text;
  if (!text) throw new Error("Leere Antwort der KI.");
  return { data: JSON.parse(text), usage: j.usage, model: j.model };
}

const catList = cats => cats.map(c => `- ${c.id}: ${c.name} (${c.type === "ein" ? "Einnahme" : c.type === "aus" ? "Ausgabe" : "neutral, z. B. Sparen/Umbuchung"})`).join("\n");

const SYSTEM_CAT = `Du ordnest Kontobewegungen aus dem privaten Haushaltsbuch einer Person in Deutschland Kategorien zu.
Negative Beträge sind Ausgaben, positive Einnahmen. Wähle für Ausgaben nur Ausgabe- oder neutrale Kategorien, für Einnahmen nur Einnahme- oder neutrale.
Typische Hinweise: Händlername, Verwendungszweck, Zahlungsdienst (PayPal, Klarna, SumUp) mit dem eigentlichen Händler dahinter, wiederkehrende Beträge (Abos, Versicherungen).
Geld vom eigenen Arbeitgeber ist Gehalt; Rückzahlungen von Händlern sind Erstattungen; Überweisungen auf eigene Spar- oder Depotkonten sind "sparen".
Wenn du unsicher bist, wähle die plausibelste Kategorie und setze sicherheit auf "niedrig". Gib zusätzlich einen kurzen, sauberen Händlernamen zurück (z. B. "REWE", "Deutsche Bahn").`;

/* Mehrere Buchungen auf einmal zuordnen. Liefert Map id → {cat, sicher, haendler}. */
export async function categorize(ki, cats, txs) {
  const out = new Map();
  for (let i = 0; i < txs.length; i += 80) {
    const part = txs.slice(i, i + 80);
    const items = part.map(t => ({ id: t.id, datum: t.date, betrag_eur: t.amount / 100, empfaenger: scrub(t.payee), zweck: scrub(t.purpose) }));
    const { data } = await callClaude(ki, {
      system: SYSTEM_CAT,
      messages: [{ role: "user", content: `Kategorien:\n${catList(cats)}\n\nBuchungen (JSON):\n${JSON.stringify(items)}\n\nOrdne jede Buchung genau einer Kategorie-ID zu.` }],
      output_config: { format: { type: "json_schema", schema: {
        type: "object", additionalProperties: false, required: ["zuordnungen"],
        properties: { zuordnungen: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["id", "kategorie", "sicherheit", "haendler"],
          properties: { id: { type: "string" }, kategorie: { type: "string", enum: cats.map(c => c.id) },
            sicherheit: { type: "string", enum: ["hoch", "mittel", "niedrig"] }, haendler: { type: "string" } } } } } } } },
    });
    for (const z of data.zuordnungen || []) {
      const t = part.find(x => x.id === z.id);
      if (t && fits(cats, z.kategorie, t.amount)) out.set(z.id, { cat: z.kategorie, sicher: z.sicherheit, haendler: z.haendler });
    }
  }
  return out;
}

/* Belegfoto oder PDF auslesen: Händler, Datum, Gesamtbetrag, Kategorie. */
export async function readReceipt(ki, cats, { b64, type }) {
  const block = type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: type, data: b64 } };
  const { data } = await callClaude(ki, {
    system: "Du liest Kassenbons, Quittungen und Rechnungen für ein privates Haushaltsbuch in Deutschland aus. Antworte nur mit den gefragten Feldern. Unbekanntes leer lassen bzw. 0.",
    messages: [{ role: "user", content: [block, { type: "text", text: `Lies diesen Beleg aus: Händler, Belegdatum (JJJJ-MM-TT), Gesamtbetrag in Euro (Endsumme inkl. MwSt., positiv), ob es eine Gutschrift/Erstattung ist, eine passende Kategorie und eine kurze Notiz (z. B. die wichtigsten Positionen, max. 80 Zeichen).\n\nKategorien:\n${catList(cats)}` }] }],
    output_config: { format: { type: "json_schema", schema: {
      type: "object", additionalProperties: false, required: ["haendler", "datum", "gesamtbetrag", "gutschrift", "kategorie", "notiz"],
      properties: { haendler: { type: "string" }, datum: { type: "string" }, gesamtbetrag: { type: "number" }, gutschrift: { type: "boolean" },
        kategorie: { type: "string", enum: cats.map(c => c.id) }, notiz: { type: "string" } } } } },
  });
  return data;
}

/* Kreditkarten- oder Kontoabrechnung als PDF (z. B. American Express) in Einzelbuchungen zerlegen. */
export async function readStatement(ki, cats, b64) {
  const { data } = await callClaude(ki, {
    system: `Du liest Kreditkarten- und Kontoabrechnungen (z. B. American Express, Visa, Mastercard, Girokonto) für ein privates Haushaltsbuch in Deutschland aus.
Übernimm jede einzelne Umsatzzeile genau einmal. Nicht übernehmen: Saldo-Vorträge, Zwischensummen, Gesamtsummen, Mindestbetrag, Zinsinformationen, Werbung.
Belastungen (Einkäufe, Gebühren) sind art "belastung", Gutschriften, Erstattungen und Zahlungseingänge (z. B. "Zahlung erhalten") sind art "gutschrift".
Beträge in Fremdwährung: nimm den abgerechneten Euro-Betrag.`,
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: `Lies alle Umsätze dieser Abrechnung aus und ordne jedem eine Kategorie zu. Datum als JJJJ-MM-TT (Umsatz- bzw. Belegdatum, nicht Buchungsdatum, falls beide vorhanden), Betrag positiv in Euro, Händler kurz und sauber.\n\nKategorien:\n${catList(cats)}` }] }],
    output_config: { format: { type: "json_schema", schema: {
      type: "object", additionalProperties: false, required: ["aussteller", "zeitraum", "buchungen"],
      properties: {
        aussteller: { type: "string" }, zeitraum: { type: "string" },
        buchungen: { type: "array", items: { type: "object", additionalProperties: false, required: ["datum", "haendler", "beschreibung", "betrag_eur", "art", "kategorie"],
          properties: { datum: { type: "string" }, haendler: { type: "string" }, beschreibung: { type: "string" }, betrag_eur: { type: "number" },
            art: { type: "string", enum: ["belastung", "gutschrift"] }, kategorie: { type: "string", enum: cats.map(c => c.id) } } } } } } } },
  });
  return data;
}

export async function testKey(ki) {
  const { data, model } = await callClaude(ki, {
    messages: [{ role: "user", content: "Antworte mit ok=true." }],
    output_config: { format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } } } },
  });
  return { ok: !!data.ok, model };
}
