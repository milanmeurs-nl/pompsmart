// Haalt de actuele prijzen op bij de Duitse grenspompen via de Tankerkönig-API
// (gegevens van de MTS-K, licentie CC BY 4.0) en schrijft ze naar een JSON-bestand
// dat index.html bij het laden ophaalt.
//
// Gebruik: TANKERKOENIG_API_KEY=... node scripts/fetch-de-prices.mjs site/de-prijzen.json
// Optioneel: TANKERKOENIG_URL om tegen een testserver te draaien.
import { writeFile } from "node:fs/promises";

// Moet gelijk blijven aan BORDER.DE in index.html: de site zoekt op deze namen.
const POINTS = [
  ["Bunde (via Nieuweschans)", 53.18, 7.27],
  ["Nordhorn (via Denekamp)", 52.43, 7.07],
  ["Bad Bentheim (via Oldenzaal)", 52.30, 7.15],
  ["Gronau (via Enschede)", 52.21, 7.02],
  ["Bocholt (via Dinxperlo)", 51.84, 6.55],
  ["Emmerich (via Zevenaar)", 51.84, 6.24],
  ["Kranenburg (via Nijmegen)", 51.79, 6.01],
  ["Kaldenkirchen (via Venlo)", 51.32, 6.20],
  ["Elmpt (via Roermond)", 51.21, 6.15],
  ["Selfkant (via Sittard)", 51.01, 5.93],
  ["Herzogenrath (via Kerkrade)", 50.87, 6.10],
  ["Aken (via Vaals)", 50.77, 6.05]
];
const RADIUS_KM = 6;
const API = process.env.TANKERKOENIG_URL || "https://creativecommons.tankerkoenig.de/json/list.php";
const key = process.env.TANKERKOENIG_API_KEY;
const out = process.argv[2] || "de-prijzen.json";

if (!key) {
  console.log("Geen TANKERKOENIG_API_KEY ingesteld: live prijzen overgeslagen.");
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Goedkoopste pomp die nu open is; is er geen enkele open, dan de goedkoopste die er is.
function cheapest(stations, field) {
  const priced = stations.filter(s => typeof s[field] === "number" && s[field] > 0);
  const open = priced.filter(s => s.isOpen);
  const pool = open.length ? open : priced;
  if (!pool.length) return null;
  const s = pool.reduce((a, b) => (b[field] < a[field] ? b : a));
  return {
    price: s[field],
    brand: (s.brand || "").trim(),
    name: (s.name || "").trim(),
    street: [s.street, s.houseNumber].filter(Boolean).join(" ").trim(),
    place: (s.place || "").trim(),
    dist: typeof s.dist === "number" ? s.dist : 0,
    open: !!s.isOpen
  };
}

const points = {};
let ok = 0;
for (const [name, lat, lng] of POINTS) {
  const url = new URL(API);
  url.search = new URLSearchParams({ lat, lng, rad: RADIUS_KM, sort: "dist", type: "all", apikey: key });
  try {
    const res = await fetch(url, { headers: { "User-Agent": "pompsmart.nl (github.com/milanmeurs-nl/pompsmart)" } });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || `HTTP ${res.status}`);
    points[name] = { e5: cheapest(json.stations || [], "e5"), diesel: cheapest(json.stations || [], "diesel") };
    ok++;
  } catch (e) {
    console.warn(`${name}: ${e.message}`);
  }
  await sleep(1500); // rustig aan met de API
}

if (!ok) {
  console.error("Geen enkele prijs opgehaald. Klopt de API-sleutel?");
  process.exit(1);
}
await writeFile(out, JSON.stringify({
  updated: new Date().toISOString(),
  source: "Tankerkönig (tankerkoenig.de), gegevens MTS-K, CC BY 4.0",
  points
}, null, 2));
console.log(`${ok}/${POINTS.length} grensposten bijgewerkt: ${out}`);
