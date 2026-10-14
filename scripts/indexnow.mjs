// Meldt alle pagina's uit de live sitemap bij IndexNow (Bing, Yandex en andere
// deelnemende zoekmachines), zodat ze weten dat de prijzen zijn bijgewerkt.
// Draait één keer per dag via .github/workflows/indexnow.yml.
//
// Het sleutelbestand <sleutel>.txt staat in de root van de repository en wordt mee
// gepubliceerd; zo kan IndexNow controleren dat de melding van pompsmart.nl komt.
// Gebruik: node scripts/indexnow.mjs
// Optioneel: INDEXNOW_URL en SITEMAP_URL om tegen een testserver te draaien.
import { readdir, readFile } from "node:fs/promises";

const HOST = "pompsmart.nl";
const ENDPOINT = process.env.INDEXNOW_URL || "https://api.indexnow.org/indexnow";
const SITEMAP = process.env.SITEMAP_URL || `https://${HOST}/sitemap.xml`;

const keyFile = (await readdir(".")).find(f => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) { console.error("Geen IndexNow-sleutelbestand gevonden in de root."); process.exit(1); }
const key = (await readFile(keyFile, "utf8")).trim();

const res = await fetch(SITEMAP);
if (!res.ok) { console.error(`Sitemap niet op te halen: HTTP ${res.status}`); process.exit(1); }
const urls = [...(await res.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1].trim())
  .filter(u => new URL(u).host === HOST);
if (!urls.length) { console.error("Geen adressen in de sitemap."); process.exit(1); }

const send = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList: urls })
});
const meaning = {
  200: "ontvangen", 202: "ontvangen, sleutel wordt nog gecontroleerd",
  400: "ongeldig verzoek", 403: "sleutel ongeldig of sleutelbestand niet gevonden",
  422: "adressen horen niet bij de host of sleutel klopt niet", 429: "te veel meldingen, later opnieuw"
}[send.status] || "onbekend antwoord";
console.log(`${urls.length} adressen gemeld bij IndexNow: HTTP ${send.status} (${meaning}).`);
if (send.status >= 400) { console.log(await send.text()); process.exit(1); }
