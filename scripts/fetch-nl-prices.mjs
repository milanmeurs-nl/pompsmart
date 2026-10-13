// Haalt de gemiddelde Nederlandse pompprijs per dag op bij het CBS (StatLine 80416ned,
// "Pompprijzen motorbrandstoffen; brandstofsoort, per dag") en schrijft die naar een
// JSON-bestand voor de site en de pagina's per grensovergang.
//
// Gebruik: node scripts/fetch-nl-prices.mjs site/nl-prijzen.json
// Optioneel: CBS_URL om tegen een testserver te draaien.
//
// De kolomnamen worden gezocht ("Euro95", "Diesel") in plaats van vastgelegd, en een prijs
// telt alleen tussen € 1 en € 4 per liter. Wat er gebruikt wordt, staat in de log.
import { writeFile } from "node:fs/promises";

const BASE = process.env.CBS_URL || "https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet";
const out = process.argv[2] || "nl-prijzen.json";

const sane = v => typeof v === "number" && v > 1 && v < 4;
// CBS-perioden per dag zien eruit als "2026MM10D12" of "20261012"; beide worden 2026-10-12.
function periodDate(p) {
  const digits = String(p).replace(/[^0-9]/g, "");
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(digits.length === 8 ? digits : "");
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = /^(\d{4})MM(\d{2})D(\d{2})$/i.exec(String(p).trim());
  return n ? `${n[1]}-${n[2]}-${n[3]}` : null;
}

async function get(url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "pompsmart.nl (github.com/milanmeurs-nl/pompsmart)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const urls = [
  `${BASE}?$orderby=Perioden%20desc&$top=10`,
  BASE // als sorteren niet lukt: alles ophalen en zelf de nieuwste dag zoeken
];

let result = null;
for (const url of urls) {
  try {
    const json = await get(url);
    const rows = json.value || [];
    if (!rows.length) throw new Error("geen rijen");
    const keys = Object.keys(rows[0]);
    const kPetrol = keys.find(k => /euro\s*95/i.test(k));
    const kDiesel = keys.find(k => /diesel/i.test(k));
    console.log(`${url}: ${rows.length} rijen, kolommen ${JSON.stringify(keys)}`);
    if (!kPetrol || !kDiesel) throw new Error("kolommen voor Euro 95 en diesel niet gevonden");
    let best = null;
    for (const r of rows) {
      const date = periodDate(r.Perioden);
      if (!date || !sane(r[kPetrol]) || !sane(r[kDiesel])) continue;
      if (!best || date > best.date) best = { date, petrol: r[kPetrol], diesel: r[kDiesel], row: r };
    }
    if (!best) throw new Error("geen dag met geldige prijzen");
    console.log(`Gebruikt: ${JSON.stringify(best.row)}`);
    result = best;
    break;
  } catch (e) {
    console.warn(`${url}: ${e.message}`);
  }
}

if (!result) {
  console.error("Geen Nederlandse pompprijs gevonden. De site rekent dan met het vaste gemiddelde.");
  process.exit(1);
}
await writeFile(out, JSON.stringify({
  updated: new Date().toISOString(),
  date: result.date,
  petrol: Math.round(result.petrol * 1000) / 1000,
  diesel: Math.round(result.diesel * 1000) / 1000,
  source: "CBS, pompprijzen motorbrandstoffen per dag (80416ned)"
}, null, 2));
console.log(`Nederland ${result.date}: Euro 95 € ${result.petrol}, diesel € ${result.diesel} → ${out}`);
