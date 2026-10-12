// Haalt de officiële Belgische maximumprijzen van vandaag op bij Statbel (be.STAT),
// zoals vastgesteld door de FOD Economie, en schrijft ze naar een JSON-bestand
// dat index.html bij het laden ophaalt.
//
// Gebruik: node scripts/fetch-be-prices.mjs site/be-prijzen.json
// Optioneel: STATBEL_VIEWS (komma-gescheiden view-id's) en STATBEL_BASE om te testen.
//
// Het script leest de tabel zonder uit te gaan van een vaste opmaak. Een prijs telt alleen
// als in dezelfde rij ook de prijs zonder btw staat en die precies 21% btw verschilt, zodat
// een gewijzigde pagina nooit een verkeerd getal op de site zet.
import { writeFile } from "node:fs/promises";

const BASE = process.env.STATBEL_BASE || "https://bestat.statbel.fgov.be/bestat/api/views";
// Dagelijks officieel tarief van de aardolieproducten (NL en FR).
const VIEWS = (process.env.STATBEL_VIEWS || "f8d4c0ce-bec4-4f58-b2a2-4f6b8667ad24,9e9cf394-6c54-4d81-8013-7124a8c4bf15").split(",");
const FORMATS = ["HTML", "CSV"];
const out = process.argv[2] || "be-prijzen.json";

const PRODUCTS = {
  petrol: label => /95/.test(label) && /E\s*10/i.test(label),
  diesel: label => /(diesel|gasoil|gazole)/i.test(label) && /B\s*7/i.test(label) && !/(verwarming|chauffage|heating|extra)/i.test(label)
};

const decode = t => t.replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&euro;|&#8364;/g, "€").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function rowsFromHtml(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m =>
    [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => decode(c[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
  );
}
function rowsFromCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  return lines.map(l => l.split(sep).map(c => c.replace(/^"|"$/g, "").trim()));
}

const num = c => {
  const m = /^[€\s]*(-?\d{1,2}[.,]\d{2,4})\s*(€|eur|euro)?(\s*\/\s*l)?$/i.exec(c);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
};
const dateOf = cells => {
  for (const c of cells) {
    let m = /(\d{2})[\/.-](\d{2})[\/.-](\d{4})/.exec(c);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = /(\d{4})-(\d{2})-(\d{2})/.exec(c);
    if (m) return m[0];
  }
  return null;
};

// Prijs incl. btw: een getal in de rij dat 21% boven een ander getal in dezelfde rij ligt.
function inclVat(values) {
  for (const incl of values) for (const excl of values) {
    if (incl > excl && Math.abs(excl * 1.21 - incl) < 0.006 && incl > 1 && incl < 4) return incl;
  }
  return null;
}

function extract(rows) {
  const found = {};
  for (const cells of rows) {
    const label = cells.filter(c => num(c) == null).join(" ");
    const values = cells.map(num).filter(v => v != null);
    const date = dateOf(cells);
    for (const [fuel, test] of Object.entries(PRODUCTS)) {
      if (!test(label)) continue;
      const price = inclVat(values);
      if (price == null) continue;
      // Meerdere dagen in de tabel: neem de nieuwste.
      if (!found[fuel] || (date && (!found[fuel].date || date > found[fuel].date))) found[fuel] = { price, date };
    }
  }
  return found;
}

let result = null;
outer: for (const view of VIEWS) {
  for (const fmt of FORMATS) {
    const url = `${BASE}/${view}/result/${fmt}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "pompsmart.nl (github.com/milanmeurs-nl/pompsmart)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = fmt === "HTML" ? rowsFromHtml(text) : rowsFromCsv(text);
      // Laat zien wat er gelezen is, zodat een gewijzigde opmaak in de log te zien is.
      console.log(`${view} ${fmt}: ${rows.length} rijen, kop: ${JSON.stringify(rows.slice(0, 2)).slice(0, 400)}`);
      rows.filter(r => /95|diesel|gasoil|gazole/i.test(r.join(" "))).slice(0, 12)
        .forEach(r => console.log(`  ${JSON.stringify(r).slice(0, 300)}`));
      const found = extract(rows);
      console.log(`${view} ${fmt}: Euro 95 ${found.petrol ? found.petrol.price : "niet gevonden"}, diesel ${found.diesel ? found.diesel.price : "niet gevonden"}`);
      if (found.petrol && found.diesel) { result = { found, url }; break outer; }
    } catch (e) {
      console.warn(`${url}: ${e.message}`);
    }
  }
}

if (!result) {
  console.error("Geen Belgische maximumprijzen gevonden. De site rekent dan met het gemiddelde.");
  process.exit(1);
}
const { found, url } = result;
await writeFile(out, JSON.stringify({
  updated: new Date().toISOString(),
  date: found.petrol.date || found.diesel.date || null,
  petrol: found.petrol.price,
  diesel: found.diesel.price,
  source: "Statbel, officieel tarief van de aardolieproducten (FOD Economie)",
  url
}, null, 2));
console.log(`Belgische maximumprijzen: Euro 95 € ${found.petrol.price}, diesel € ${found.diesel.price}${found.petrol.date ? ` (${found.petrol.date})` : ""} → ${out}`);
