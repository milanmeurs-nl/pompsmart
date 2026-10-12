// Haalt de officiële Belgische maximumprijzen op bij Statbel (be.STAT), zoals de
// FOD Economie die elke dag vaststelt, en schrijft ze naar een JSON-bestand dat
// index.html bij het laden ophaalt.
//
// Gebruik: node scripts/fetch-be-prices.mjs site/be-prijzen.json
// Optioneel: STATBEL_BASE en STATBEL_TODAY (JJJJ-MM-DD) om te testen.
//
// Bronnen, in volgorde:
// 1. CSV met een prijs per dag (laatste 30 dagen, anders 365 dagen). Kolommen worden
//    op naam gezocht ("Dag", "Product", "Prijs incl. BTW"); de prijs van vandaag wint.
// 2. De dagtabel in HTML (één dag, vaak die van morgen). Daar telt een prijs alleen als
//    in dezelfde rij ook de prijs zonder btw staat, precies 21% lager.
// Elke rij die gebruikt wordt, staat in de log van de workflow.
import { writeFile } from "node:fs/promises";

const BASE = process.env.STATBEL_BASE || "https://bestat.statbel.fgov.be/bestat/api/views";
const DATED_CSV_VIEWS = [
  "ef2a5bfb-a361-47a6-b113-e3df26563404", // officieel tarief, laatste 30 dagen
  "f8d4c0ce-bec4-4f58-b2a2-4f6b8667ad24"  // officieel tarief, laatste 365 dagen
];
const DAY_HTML_VIEW = "9e9cf394-6c54-4d81-8013-7124a8c4bf15"; // tarif officiel, dernier jour
const out = process.argv[2] || "be-prijzen.json";
const today = process.env.STATBEL_TODAY ||
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());

// Euro 95 in Nederland is E10; diesel aan de pomp is B7.
const PRODUCTS = {
  petrol: label => /\b95\s*RON\s*E\s*10\b/i.test(label),
  diesel: label => /^\s*Diesel\s*B\s*7\b/i.test(label)
};

const MONTHS = {
  jan: 1, janv: 1, feb: 2, fev: 2, "fév": 2, "févr": 2, mrt: 3, maa: 3, mar: 3, mars: 3, apr: 4, avr: 4,
  mei: 5, mai: 5, may: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, "aoû": 8, sep: 9, sept: 9,
  okt: 10, oct: 10, nov: 11, dec: 12, "déc": 12
};
// "14okt25", "13OCT26", "13/10/2026" of "2026-10-13" → "2026-10-13"
function parseDate(text) {
  let m = /(\d{1,2})\s*([a-zéû]{3,5})\.?\s*(\d{2}|\d{4})(?![\d])/i.exec(text);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /(\d{2})[\/.-](\d{2})[\/.-](\d{4})/.exec(text);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? m[0] : null;
}

const price = c => {
  const m = /^\s*(\d{1,2}[.,]\d{2,4})\s*$/.exec(c);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
};
const sane = v => v != null && v > 1 && v < 4;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0];
  const sep = [";", "\t", ","].find(s => head.includes(s)) || ",";
  return lines.map(line => {
    const cells = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

const decode = t => t.replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&euro;|&#8364;/g, "€")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&eacute;/g, "é").replace(/&egrave;/g, "è");
function parseHtml(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m =>
    [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => decode(c[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()));
}

// Bron 1: één rij per dag en product, kolommen op naam.
function fromDatedCsv(rows) {
  const head = rows[0].map(h => h.toLowerCase());
  const iDay = head.findIndex(h => /^(dag|jour|day|datum|date)$/.test(h));
  const iProd = head.findIndex(h => /^(product|produit)$/.test(h));
  const iPrice = head.findIndex(h => /incl|comprise|tvac|btw inbegrepen/.test(h));
  if (iDay < 0 || iProd < 0 || iPrice < 0) throw new Error(`kolommen niet gevonden in ${JSON.stringify(rows[0])}`);
  const found = {};
  for (const r of rows.slice(1)) {
    const date = parseDate(r[iDay] || ""), v = price(r[iPrice] || "");
    if (!date || !sane(v) || date > today) continue;
    for (const [fuel, test] of Object.entries(PRODUCTS)) {
      if (test(r[iProd] || "") && (!found[fuel] || date > found[fuel].date)) found[fuel] = { price: v, date, row: r };
    }
  }
  return found;
}

// Bron 2: dagtabel; datum uit de kop, prijs incl. btw gecontroleerd tegen de prijs zonder btw.
function fromDayHtml(rows) {
  const date = parseDate(rows.map(r => r.join(" ")).find(t => /(date|datum)\s*:/i.test(t)) || "");
  const found = {};
  for (const r of rows) {
    const label = r.filter(c => price(c) == null).join(" ");
    const vals = r.map(price).filter(v => v != null);
    for (const [fuel, test] of Object.entries(PRODUCTS)) {
      if (found[fuel] || !r.some(c => test(c))) continue;
      const incl = vals.find(i => vals.some(e => i > e && Math.abs(e * 1.21 - i) < 0.006));
      if (sane(incl)) found[fuel] = { price: incl, date, row: r };
    }
  }
  return found;
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "pompsmart.nl (github.com/milanmeurs-nl/pompsmart)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sources = [
  ...DATED_CSV_VIEWS.map(v => ({ url: `${BASE}/${v}/result/CSV`, read: t => fromDatedCsv(parseCsv(t)) })),
  { url: `${BASE}/${DAY_HTML_VIEW}/result/HTML`, read: t => fromDayHtml(parseHtml(t)) }
];

let result = null;
for (const { url, read } of sources) {
  try {
    const found = read(await get(url));
    for (const f of ["petrol", "diesel"]) {
      console.log(`${url} ${f}: ${found[f] ? `€ ${found[f].price} (${found[f].date || "geen datum"}) uit ${JSON.stringify(found[f].row)}` : "niet gevonden"}`);
    }
    if (found.petrol && found.diesel) { result = { found, url }; break; }
  } catch (e) {
    console.warn(`${url}: ${e.message}`);
  }
}

if (!result) {
  console.error("Geen Belgische maximumprijzen gevonden. De site rekent dan met het gemiddelde.");
  process.exit(1);
}
const { found, url } = result;
await writeFile(out, JSON.stringify({
  updated: new Date().toISOString(),
  date: [found.petrol.date, found.diesel.date].filter(Boolean).sort()[0] || null,
  petrol: found.petrol.price,
  diesel: found.diesel.price,
  source: "Statbel, officieel tarief van de aardolieproducten (FOD Economie)",
  url
}, null, 2));
console.log(`Vandaag (${today}): Euro 95 € ${found.petrol.price}, diesel € ${found.diesel.price}, tarief van ${found.petrol.date || "onbekende datum"} → ${out}`);
