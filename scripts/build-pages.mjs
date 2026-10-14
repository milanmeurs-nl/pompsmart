// Maakt bij elke publicatie een pagina per grensovergang, twee overzichtspagina's en de
// sitemap, met de prijzen van dat moment erin. Zo heeft Google voor elke grensplaats een
// eigen pagina met actuele, lokale informatie.
//
// Gebruik: node scripts/build-pages.mjs site
// Leest site/index.html (plaatsen, grensovergangen, standaardprijzen) en, als ze er zijn,
// site/de-prijzen.json, site/be-prijzen.json en site/nl-prijzen.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const SITE = process.argv[2] || "site";
const ORIGIN = "https://pompsmart.nl";
const now = new Date();

// ---------- gegevens uit index.html, zodat er maar één lijst is ----------
const indexHtml = await readFile(join(SITE, "index.html"), "utf8");
function constant(name) {
  const m = new RegExp(`const ${name} = ([\\s\\S]*?);\\n`).exec(indexHtml);
  if (!m) throw new Error(`${name} niet gevonden in index.html`);
  return new Function(`return (${m[1]});`)();
}
const CITIES = constant("CITIES");
const BORDER = constant("BORDER");
const DEFAULT_PRICES = constant("DEFAULT_PRICES");
const PRICE_DATE = constant("PRICE_DATE");

async function readJson(file) {
  try { return JSON.parse(await readFile(join(SITE, file), "utf8")); } catch { return null; }
}
const hoursOld = iso => (now - new Date(iso)) / 36e5;
const okPrice = v => typeof v === "number" && v > 1 && v < 4;

const deRaw = await readJson("de-prijzen.json");
const beRaw = await readJson("be-prijzen.json");
const nlRaw = await readJson("nl-prijzen.json");
const liveDE = deRaw && deRaw.points && hoursOld(deRaw.updated) <= 3 ? deRaw : null;
const liveBE = beRaw && okPrice(beRaw.petrol) && okPrice(beRaw.diesel) &&
  hoursOld((beRaw.date || beRaw.updated.slice(0, 10)) + "T00:00:00") <= 72 ? beRaw : null;
const liveNL = nlRaw && okPrice(nlRaw.petrol) && okPrice(nlRaw.diesel) &&
  hoursOld(nlRaw.date + "T00:00:00") <= 240 ? nlRaw : null;

// ---------- hulpfuncties ----------
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v, d = 3) => "€ " + v.toFixed(d).replace(".", ",");
const euro2 = v => (v < 0 ? "−" : "") + "€ " + Math.abs(v).toFixed(2).replace(".", ",");
const cents = v => Math.abs(v * 100).toFixed(1).replace(".", ",");
const slugify = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dateNl = iso => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
const timeNl = iso => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
function haversine(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rekenvoorbeeld zoals de rekentool het standaard doet: compacte auto, tank voor 85% leeg.
const EXAMPLE = {
  petrol: { label: "Euro 95", litres: 42.5, cons: 6.0, car: "compacte benzineauto (6,0 l/100 km, 42,5 liter tanken)" },
  diesel: { label: "diesel", litres: 44.2, cons: 4.8, car: "compacte diesel (4,8 l/100 km, 44,2 liter tanken)" }
};
const WEAR = 0.05;

const NL = {
  petrol: liveNL ? liveNL.petrol : DEFAULT_PRICES.NL.petrol,
  diesel: liveNL ? liveNL.diesel : DEFAULT_PRICES.NL.diesel,
  label: liveNL ? `gemiddelde volgens het CBS, ${dateNl(liveNL.date)}` : `gemiddelde van ${PRICE_DATE}`
};

// ---------- de grensovergangen ----------
const COUNTRY = {
  DE: { name: "Duitsland", adj: "Duitse", dir: "tanken-duitsland", plate: "D" },
  BE: { name: "België", adj: "Belgische", dir: "tanken-belgie", plate: "B" }
};
const crossings = [];
for (const c of ["DE", "BE"]) {
  for (const [name, lat, lon] of BORDER[c]) {
    const m = /^(.*?)\s*\(via (.*)\)$/.exec(name);
    const place = m ? m[1] : name, via = m ? m[2] : null;
    const slug = slugify(via ? `${place}-${via}` : place);
    const live = c === "DE" && liveDE && liveDE.points[name] ? liveDE.points[name] : null;
    const prices = {
      petrol: c === "DE" ? (live && (live.e10 || live.e5)) || null : liveBE ? { price: liveBE.petrol } : null,
      diesel: c === "DE" ? (live && live.diesel) || null : liveBE ? { price: liveBE.diesel } : null
    };
    crossings.push({ c, name, place, via, slug, lat, lon, prices, url: `/${COUNTRY[c].dir}/${slug}/` });
  }
}

function priceFor(x, fuel) {
  const p = x.prices[fuel];
  if (p && okPrice(p.price)) return { value: p.price, station: x.c === "DE" ? p : null, live: true };
  return { value: DEFAULT_PRICES[x.c][fuel], station: null, live: false };
}

function savings(x, town, fuel) {
  const p = priceFor(x, fuel), ex = EXAMPLE[fuel];
  const oneWay = haversine([town[1], town[2]], [x.lat, x.lon]) * 1.3 + (p.station ? p.station.dist || 0 : 0);
  const trip = oneWay * 2 * (ex.cons / 100 * p.value + WEAR);
  return { oneWay, net: ex.litres * (NL[fuel] - p.value) - trip };
}

function nearbyTowns(x) {
  return CITIES.map(t => ({ t, km: haversine([t[1], t[2]], [x.lat, x.lon]) * 1.3 }))
    .filter(o => o.km <= 75).sort((a, b) => a.km - b.km).slice(0, 6).map(o => o.t);
}

// ---------- gedeelde opmaak ----------
const CSS = `
:root{--bg:#eef1f5;--surface:#fff;--ink:#15202e;--muted:#5a6677;--line:#d5dbe4;--sign:#0b4a8b;--sign-ink:#fff;--signal:#f2b705;--good:#1d7a46;--bad:#b3261e;--totem:#10161f;--totem-ink:#f7c948;
--font-display:"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif;--font-body:"Source Sans 3",system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e131a;--surface:#161d27;--ink:#e6ebf2;--muted:#98a3b3;--line:#2a3442;--sign:#3d82d1;--good:#4cc282;--bad:#ff8a80;--totem:#05080c;color-scheme:dark}}
*{box-sizing:border-box}html{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-body);font-size:16px;line-height:1.55}
[hidden]{display:none!important}
.wrap{max-width:880px;margin:0 auto;padding-inline:16px;padding-block:20px 56px;display:flex;flex-direction:column;gap:22px}
a{color:var(--sign)}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.shield{background:var(--sign);color:var(--sign-ink);font-family:var(--font-display);font-weight:700;font-size:1.1rem;padding:3px 10px;border-radius:4px;border:2px solid var(--sign-ink);outline:2px solid var(--sign);text-decoration:none;white-space:nowrap}
.shield em{font-style:normal;color:var(--signal)}
.crumbs{font-size:.85rem;color:var(--muted)}.crumbs a{color:var(--muted)}
h1{font-family:var(--font-display);font-weight:700;font-size:clamp(1.8rem,5vw,2.5rem);line-height:1.08;margin:0;text-wrap:balance}
h2{font-family:var(--font-display);font-size:1.35rem;margin:0 0 6px}
.lede{margin:6px 0 0;max-width:65ch}
.prices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (max-width:560px){.prices{grid-template-columns:minmax(0,1fr)}}
.price{background:var(--totem);color:#fff;border-radius:8px;padding:16px 18px;display:flex;flex-direction:column;gap:4px;min-width:0}
.price .k{font-family:var(--font-display);letter-spacing:.12em;text-transform:uppercase;font-size:.78rem;color:#9fb0c4}
.price .v{font-family:var(--font-display);font-weight:700;font-size:2.4rem;line-height:1;color:var(--totem-ink);font-variant-numeric:tabular-nums}
.price .s{color:#c9d3df;font-size:.9rem}
.price .d{font-weight:600}.price .d.up{color:#ff8a80}.price .d.down{color:#7ee2a8}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:18px;min-width:0}
.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
th{font-family:var(--font-display);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
td.num,th.num{text-align:right}.pos{color:var(--good);font-weight:600}.neg{color:var(--bad)}
.note{font-size:.85rem;color:var(--muted);margin:8px 0 0}
.cta{display:inline-block;background:var(--sign);color:var(--sign-ink);font-weight:600;text-decoration:none;padding:12px 18px;border-radius:6px;margin-top:4px}
.cta:hover{filter:brightness(1.1)}
ul.links{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px}
.plate{font-size:.72rem;font-weight:700;background:var(--sign);color:var(--sign-ink);border-radius:3px;padding:1px 5px;letter-spacing:.06em;margin-right:6px}
footer{font-size:.82rem;color:var(--muted);display:flex;flex-direction:column;gap:6px}
footer p{margin:0}
.linkbtn{font:inherit;background:none;border:0;color:var(--sign);text-decoration:underline;cursor:pointer;padding:0}
.consent{position:fixed;z-index:10;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));max-width:560px;margin-inline:auto;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 28px rgb(0 0 0/.22);padding:16px;display:flex;flex-direction:column;gap:12px;font-size:.92rem}
.consent p{margin:0}.consent .actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.consent button{font:inherit;font-weight:600;border-radius:6px;padding:8px 16px;cursor:pointer;border:1px solid var(--sign)}
.consent .yes{background:var(--sign);color:var(--sign-ink)}.consent .no{background:transparent;color:var(--sign)}
a:focus-visible,button:focus-visible{outline:3px solid var(--signal);outline-offset:2px}
`;

// Dezelfde cookiemelding en Google-tag als op de homepage, met dezelfde opgeslagen keuze.
const CONSENT_JS = `(function(){
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
gtag('js',new Date());gtag('config','G-16KSML5VFV');
var loaded=false;function load(){if(loaded)return;loaded=true;gtag('consent','update',{analytics_storage:'granted'});
var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-16KSML5VFV';document.head.appendChild(s);}
var c=null;try{c=localStorage.getItem('pompsmart-consent');}catch(e){}
if(c==='granted')load();
document.addEventListener('DOMContentLoaded',function(){
var box=document.getElementById('consent');if(!box)return;
function decide(v){try{localStorage.setItem('pompsmart-consent',v);}catch(e){}box.hidden=true;if(v==='granted')load();
else if(loaded){gtag('consent','update',{analytics_storage:'denied'});document.cookie.split(';').map(function(x){return x.split('=')[0].trim();}).filter(function(n){return /^_ga/.test(n);}).forEach(function(n){document.cookie=n+'=; Max-Age=0; path=/; domain=.'+location.hostname.replace(/^www\\./,'');document.cookie=n+'=; Max-Age=0; path=/';});}}
if(c!=='granted'&&c!=='denied')box.hidden=false;
document.getElementById('consentYes').onclick=function(){decide('granted');};
document.getElementById('consentNo').onclick=function(){decide('denied');};
document.getElementById('consentOpen').onclick=function(){box.hidden=false;document.getElementById('consentYes').focus();};
});})();`;

function page({ path, title, description, breadcrumbs, body }) {
  const url = ORIGIN + path;
  const ld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, item: ORIGIN + b.path }))
  };
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="nl_NL">
<meta property="og:site_name" content="Pompsmart">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b4a8b">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230b4a8b'/%3E%3Cpath d='M9 7h9a2 2 0 0 1 2 2v16H7V9a2 2 0 0 1 2-2z' fill='%23fff'/%3E%3Crect x='10' y='10' width='7' height='5' fill='%230b4a8b'/%3E%3Cpath d='M20 12h2l3 3v8a1.5 1.5 0 0 1-3 0v-5h-2' fill='none' stroke='%23f2b705' stroke-width='2'/%3E%3C/svg%3E">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script src="/consent.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&family=Source+Sans+3:wght@400;600&display=swap">
<link rel="stylesheet" href="/pagina.css">
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="shield" href="/">pomp<em>smart</em>.nl</a>
    <nav class="crumbs" aria-label="Kruimelpad">${breadcrumbs.map((b, i) => i === breadcrumbs.length - 1 ? esc(b.name) : `<a href="${b.path}">${esc(b.name)}</a>`).join(" › ")}</nav>
  </header>
${body}
  <footer>
    <p>Duitse prijzen: <a href="https://www.tankerkoenig.de" rel="noopener">Tankerkönig</a>, met gegevens van de Markttransparenzstelle für Kraftstoffe (MTS-K), licentie <a href="https://creativecommons.org/licenses/by/4.0/deed.nl" rel="noopener">CC BY 4.0</a>. Belgische maximumprijzen: FOD Economie, via Statbel. Nederlandse gemiddelden: CBS. Afstanden zijn geschat: hemelsbreed keer 1,3.</p>
    <p>Pompsmart geeft een schatting, geen garantie. Prijzen kunnen tussen twee updates veranderen. Deze pagina is bijgewerkt op ${now.toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })} om ${timeNl(now.toISOString())}. <button type="button" class="linkbtn" id="consentOpen">Cookie-instellingen</button></p>
  </footer>
</div>
<div class="consent" id="consent" role="dialog" aria-labelledby="consentText" hidden>
  <p id="consentText">Mogen we met Google Analytics meten hoe Pompsmart gebruikt wordt? Daarvoor plaatst Google cookies. De site werkt ook als je weigert.</p>
  <div class="actions"><button type="button" class="no" id="consentNo">Weigeren</button><button type="button" class="yes" id="consentYes">Akkoord</button></div>
</div>
</body>
</html>
`;
}

function priceCard(x, fuel) {
  const p = priceFor(x, fuel), diff = p.value - NL[fuel];
  const label = fuel === "petrol" ? (x.c === "DE" ? "Euro 95 (Super E10)" : "Euro 95 (E10)") : (x.c === "DE" ? "Diesel" : "Diesel (B7)");
  let source;
  if (x.c === "DE" && p.station) {
    const st = p.station;
    source = `${esc([st.brand || st.name, st.street, st.place].filter(Boolean).join(", "))}${st.open ? "" : " (nu gesloten)"} · bijgewerkt om ${timeNl(liveDE.updated)}`;
  } else if (x.c === "BE" && p.live) {
    source = `officiële maximumprijs${liveBE.date ? ` van ${dateNl(liveBE.date)}` : ""}; aan de grens vaak iets lager`;
  } else {
    source = `${COUNTRY[x.c].adj} gemiddelde van ${PRICE_DATE}; actuele prijs nu niet beschikbaar`;
  }
  return `<div class="price"><span class="k">${label}</span><span class="v">${euro(p.value)}</span>
      <span class="s"><span class="d ${diff < 0 ? "down" : "up"}">${cents(diff)} ct/l ${diff < 0 ? "goedkoper" : "duurder"}</span> dan in Nederland (${NL.label}: ${euro(NL[fuel])})</span>
      <span class="s">${source}</span></div>`;
}

function crossingPage(x) {
  const C = COUNTRY[x.c];
  const towns = nearbyTowns(x);
  const where = x.via ? `vlak over de grens bij ${x.via}` : "vlak over de grens";
  const petrol = priceFor(x, "petrol"), diesel = priceFor(x, "diesel");
  const dP = NL.petrol - petrol.value, dD = NL.diesel - diesel.value;

  const intro = x.c === "DE"
    ? `${x.place} ligt ${where}. ${petrol.station ? `De goedkoopste open pomp in de buurt vraagt nu ${euro(petrol.value)} voor Euro 95 (Super E10)` : `Euro 95 kost in Duitsland gemiddeld ${euro(petrol.value)}`}, ${cents(dP)} cent per liter ${dP >= 0 ? "minder" : "meer"} dan in Nederland. Diesel kost er ${euro(diesel.value)}. Of de rit loont, hangt af van waar je woont en wat je rijdt.`
    : `${x.place} ligt ${where}. In België mag een pomp vandaag hoogstens ${euro(petrol.value)} vragen voor Euro 95 en ${euro(diesel.value)} voor diesel. Dat is ${cents(dP)} cent per liter ${dP >= 0 ? "minder" : "meer"} voor Euro 95 en ${cents(dD)} cent ${dD >= 0 ? "minder" : "meer"} voor diesel dan het Nederlandse gemiddelde. Onbemande pompen aan de grens zitten vaak nog iets onder de maximumprijs.`;

  const rows = towns.map(t => {
    const sp = savings(x, t, "petrol"), sd = savings(x, t, "diesel");
    const cell = s => s.net > 0.5 ? `<td class="num pos">${euro2(s.net)}</td>` : `<td class="num neg">loont niet</td>`;
    return `<tr><td><a href="/?plaats=${encodeURIComponent(t[0])}">${esc(t[0])}</a></td><td class="num">${Math.round(sp.oneWay)} km</td>${cell(sp)}${cell(sd)}</tr>`;
  }).join("\n          ");

  const tips = x.c === "DE"
    ? `<li>In Duitsland veranderen de prijzen meerdere keren per dag. Meestal is tanken 's avonds het goedkoopst en 's ochtends het duurst.</li>
        <li>Nederlandse Euro 95 heet in Duitsland Super E10. Super (E5) is meestal iets duurder.</li>
        <li>De prijs hierboven is die van de goedkoopste open pomp binnen ongeveer 6 kilometer van ${esc(x.place)}, elk half uur bijgewerkt.</li>`
    : `<li>De Belgische overheid (FOD Economie) stelt elke dag een maximumprijs vast. Een pomp mag niet meer vragen, wel minder.</li>
        <li>Nederlandse Euro 95 heet in België Benzine 95 E10. Diesel aan de pomp is B7.</li>
        <li>Vlak over de grens zitten vaak onbemande pompen die onder de maximumprijs blijven.</li>`;

  const others = crossings.filter(o => o !== x && o.c === x.c)
    .map(o => `<li><a href="${o.url}">${esc(o.via ? `${o.place} (bij ${o.via})` : o.place)}</a></li>`).join("");

  const title = `Tanken in ${x.place}${x.via ? ` (bij ${x.via})` : ""}: prijs vandaag | Pompsmart`;
  // Google toont ongeveer 160 tekens; neem zoveel plaatsen als daarin passen.
  const describe = n => `Actuele prijs voor Euro 95 en diesel in ${x.place}, ${where}. Zie wat je bespaart vanuit ${towns.slice(0, n).map(t => t[0]).join(", ") || "Nederland"}, na de kosten van de rit.`;
  const description = [3, 2, 1].map(describe).find(d => d.length <= 160) || describe(1);

  const body = `
  <section>
    <h1>Tanken in ${esc(x.place)}${x.via ? `, vlak over de grens bij ${esc(x.via)}` : ""}</h1>
    <p class="lede">${esc(intro)}</p>
  </section>
  <section class="prices" aria-label="Prijzen vandaag">
    ${priceCard(x, "petrol")}
    ${priceCard(x, "diesel")}
  </section>
  ${rows ? `<section class="card">
    <h2>Wat bespaar je vanuit de buurt?</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Vanuit</th><th class="num">Enkele reis</th><th class="num">Euro 95</th><th class="num">Diesel</th></tr></thead>
      <tbody>
          ${rows}
      </tbody>
    </table></div>
    <p class="note">Netto per tankbeurt, na brandstof en slijtage (€ 0,05 per km) voor de rit heen en terug. Voorbeeld: een ${EXAMPLE.petrol.car}, of een ${EXAMPLE.diesel.car}.</p>
  </section>` : ""}
  <section class="card">
    <h2>Reken het uit voor jouw auto</h2>
    <p class="lede">Vul je eigen woonplaats of postcode, auto en tankgedrag in. Pompsmart vergelijkt alle grensovergangen en zegt waar tanken voor jou het meest oplevert.</p>
    <p><a class="cta" href="/${towns[0] ? `?plaats=${encodeURIComponent(towns[0][0])}` : ""}">Naar de rekentool</a></p>
  </section>
  <section class="card">
    <h2>Goed om te weten</h2>
    <ul>
        ${tips}
    </ul>
  </section>
  <section>
    <h2>Andere grensovergangen in ${C.name}</h2>
    <ul class="links">${others}</ul>
    <p class="note"><a href="/${C.dir}/">Alle grensovergangen in ${C.name} op een rij</a> · <a href="/${x.c === "DE" ? COUNTRY.BE.dir : COUNTRY.DE.dir}/">Tanken in ${x.c === "DE" ? "België" : "Duitsland"}</a></p>
  </section>`;

  return page({
    path: x.url, title, description, body,
    breadcrumbs: [{ name: "Pompsmart", path: "/" }, { name: `Tanken in ${C.name}`, path: `/${C.dir}/` }, { name: x.place, path: x.url }]
  });
}

function overviewPage(c) {
  const C = COUNTRY[c];
  const list = crossings.filter(x => x.c === c)
    .map(x => ({ x, p: priceFor(x, "petrol"), d: priceFor(x, "diesel") }))
    .sort((a, b) => a.p.value - b.p.value);
  const rows = list.map(({ x, p, d }) =>
    `<tr><td><a href="${x.url}">${esc(x.place)}</a></td><td>${esc(x.via || "")}</td><td class="num">${euro(p.value)}</td><td class="num">${euro(d.value)}</td></tr>`).join("\n          ");
  const cheapest = list[0];
  const intro = c === "DE"
    ? (liveDE
      ? `Vandaag tank je bij de ${list.length} grensovergangen naar Duitsland Euro 95 (Super E10) vanaf ${euro(cheapest.p.value)}, in ${cheapest.x.place}. In Nederland kost het gemiddeld ${euro(NL.petrol)}. De prijzen zijn van de goedkoopste open pomp bij elke grensovergang, bijgewerkt om ${timeNl(liveDE.updated)}.`
      : `Actuele Duitse prijzen zijn nu niet beschikbaar; de tabel toont het Duitse gemiddelde van ${PRICE_DATE}.`)
    : (liveBE
      ? `In België geldt vandaag een maximumprijs van ${euro(liveBE.petrol)} voor Euro 95 en ${euro(liveBE.diesel)} voor diesel. In Nederland kost Euro 95 gemiddeld ${euro(NL.petrol)} en diesel ${euro(NL.diesel)}. Onbemande pompen vlak over de grens zitten vaak iets onder de maximumprijs.`
      : `De Belgische maximumprijs van vandaag is nu niet beschikbaar; de tabel toont het Belgische gemiddelde van ${PRICE_DATE}.`);
  const title = c === "DE" ? "Goedkoop tanken in Duitsland aan de grens | Pompsmart" : "Tanken in België aan de grens: maximumprijs vandaag | Pompsmart";
  const description = c === "DE"
    ? "De prijs voor Euro 95 en diesel bij alle Duitse grensovergangen vanuit Nederland, elk half uur bijgewerkt. Zie waar tanken in Duitsland het goedkoopst is."
    : "De Belgische maximumprijs voor Euro 95 en diesel van vandaag, en wat je bespaart bij de grensovergangen vanuit Nederland.";
  const body = `
  <section>
    <h1>${c === "DE" ? "Tanken in Duitsland, vlak over de grens" : "Tanken in België, vlak over de grens"}</h1>
    <p class="lede">${esc(intro)}</p>
  </section>
  <section class="card">
    <h2>${c === "DE" ? "Prijzen per grensovergang, goedkoopste eerst" : "Grensovergangen naar België"}</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Plaats</th><th>Vanuit</th><th class="num">Euro 95</th><th class="num">Diesel</th></tr></thead>
      <tbody>
          ${rows}
      </tbody>
    </table></div>
    <p class="note">${c === "DE" ? "Goedkoopste open pomp binnen ongeveer 6 km van elke grensovergang." : "In heel België geldt dezelfde maximumprijs; het verschil per grensovergang zit in de afstand vanaf jouw huis."}</p>
  </section>
  <section class="card">
    <h2>Loont de rit voor jou?</h2>
    <p class="lede">Hoe verder je van de grens woont, hoe meer de rit kost. De rekentool trekt brandstof, slijtage en tijd van je voordeel af.</p>
    <p><a class="cta" href="/">Naar de rekentool</a></p>
  </section>
  <p class="note"><a href="/${c === "DE" ? COUNTRY.BE.dir : COUNTRY.DE.dir}/">Bekijk ook tanken in ${c === "DE" ? "België" : "Duitsland"}</a></p>`;
  return page({
    path: `/${C.dir}/`, title, description, body,
    breadcrumbs: [{ name: "Pompsmart", path: "/" }, { name: `Tanken in ${C.name}`, path: `/${C.dir}/` }]
  });
}

// ---------- schrijven ----------
await writeFile(join(SITE, "pagina.css"), CSS.trim() + "\n");
await writeFile(join(SITE, "consent.js"), CONSENT_JS + "\n");
for (const x of crossings) {
  await mkdir(join(SITE, COUNTRY[x.c].dir, x.slug), { recursive: true });
  await writeFile(join(SITE, COUNTRY[x.c].dir, x.slug, "index.html"), crossingPage(x));
}
for (const c of ["DE", "BE"]) await writeFile(join(SITE, COUNTRY[c].dir, "index.html"), overviewPage(c));

// ---------- feiten van vandaag, voor de homepage en llms.txt ----------
// Gewone zinnen met datum en bron: die kunnen zoekmachines en AI-assistenten lezen en citeren
// zonder JavaScript uit te voeren.
const todayNl = now.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
const cheapestDE = fuel => {
  const list = crossings.filter(x => x.c === "DE").map(x => ({ x, p: priceFor(x, fuel) })).filter(o => o.p.live);
  return list.length ? list.reduce((a, b) => (b.p.value < a.p.value ? b : a)) : null;
};
const deP = cheapestDE("petrol"), deD = cheapestDE("diesel");
const nlSrc = liveNL ? `gemiddelde volgens het CBS van ${dateNl(liveNL.date)}` : `gemiddelde van ${PRICE_DATE}`;
const facts = [];
facts.push(`Euro 95 kost in Nederland ${euro(NL.petrol)} per liter en diesel ${euro(NL.diesel)} (${nlSrc}).`);
if (liveBE) facts.push(`In België mag een pomp${liveBE.date ? ` op ${dateNl(liveBE.date)}` : ""} hoogstens ${euro(liveBE.petrol)} vragen voor Euro 95 en ${euro(liveBE.diesel)} voor diesel (officiële maximumprijs, FOD Economie).`);
if (deP) facts.push(`Bij de Duitse grens is Euro 95 (Super E10) nu het goedkoopst in ${deP.x.place}${deP.x.via ? ` (bij ${deP.x.via})` : ""}: ${euro(deP.p.value)}, bijgewerkt om ${timeNl(liveDE.updated)}.`);
if (deD) facts.push(`Diesel is bij de Duitse grens nu het goedkoopst in ${deD.x.place}${deD.x.via ? ` (bij ${deD.x.via})` : ""}: ${euro(deD.p.value)}.`);
const rowsToday = [
  ["Nederland, gemiddeld", NL.petrol, NL.diesel, liveNL ? `CBS, ${dateNl(liveNL.date)}` : `vast gemiddelde, ${PRICE_DATE}`],
  liveBE && ["België, maximumprijs", liveBE.petrol, liveBE.diesel, `FOD Economie${liveBE.date ? `, ${dateNl(liveBE.date)}` : ""}`],
  deP && deD && ["Duitse grens, goedkoopste pomp", deP.p.value, deD.p.value, `Tankerkönig, ${timeNl(liveDE.updated)}`]
].filter(Boolean);
const todaySection = `<section class="foot vandaag" aria-labelledby="vandaagTitle">
    <h2 id="vandaagTitle">Brandstofprijzen op ${esc(todayNl)}</h2>
    ${facts.map(f => `<p>${esc(f)}</p>`).join("\n    ")}
    <div class="todaywrap"><table class="today">
      <thead><tr><th>Waar</th><th class="num">Euro 95</th><th class="num">Diesel</th><th>Bron</th></tr></thead>
      <tbody>${rowsToday.map(r => `<tr><td>${esc(r[0])}</td><td class="num">${euro(r[1])}</td><td class="num">${euro(r[2])}</td><td>${esc(r[3])}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>`;

// Links en prijzen op de homepage, op de plek van de plaatshouders
const linkList = ["DE", "BE"].map(c => `<li><a href="/${COUNTRY[c].dir}/"><strong>Tanken in ${COUNTRY[c].name}</strong></a></li>` +
  crossings.filter(x => x.c === c).map(x => `<li><span class="plate">${COUNTRY[c].plate}</span><a href="${x.url}">${esc(x.via ? `${x.place} (bij ${x.via})` : x.place)}</a></li>`).join("")).join("");
await writeFile(join(SITE, "index.html"), indexHtml
  .replace("<!--GRENSPAGINAS-->", linkList)
  .replace("<!--PRIJZEN-VANDAAG-->", todaySection));

// llms.txt (voorstel van llmstxt.org): wat de site is, de feiten van vandaag en alle pagina's
const pageLine = x => `- [Tanken in ${x.place}${x.via ? ` (bij ${x.via})` : ""}](${ORIGIN}${x.url}): ${(() => {
  const p = priceFor(x, "petrol"), d = priceFor(x, "diesel");
  return x.c === "DE"
    ? (p.live ? `Euro 95 ${euro(p.value)}, diesel ${euro(d.value)} bij de goedkoopste open pomp` : "prijs per grensovergang")
    : (p.live ? `Belgische maximumprijs: Euro 95 ${euro(p.value)}, diesel ${euro(d.value)}` : "tanken in België");
})()}`;
await writeFile(join(SITE, "llms.txt"), `# Pompsmart

> Pompsmart (pompsmart.nl) is een gratis Nederlandse rekentool die laat zien of tanken in België of Duitsland loont voor Nederlandse automobilisten, na aftrek van brandstof, slijtage en tijd voor de rit naar de grens.

De site gebruikt actuele prijzen: voor Duitsland de goedkoopste open pomp bij 12 grensovergangen (Tankerkönig, gegevens van de MTS-K, CC BY 4.0, elk half uur), voor België de officiële maximumprijs van de FOD Economie (dagelijks, via Statbel) en voor Nederland het daggemiddelde van het CBS. Bezoekers vullen hun woonplaats of postcode en hun auto in; de rekentool vergelijkt alle grensovergangen.

## Prijzen op ${todayNl}

${facts.map(f => `- ${f}`).join("\n")}

## Hoofdpagina's

- [Rekentool](${ORIGIN}/): bereken voor je eigen woonplaats en auto of tanken over de grens loont
- [Tanken in Duitsland](${ORIGIN}/tanken-duitsland/): alle Duitse grensovergangen, goedkoopste eerst
- [Tanken in België](${ORIGIN}/tanken-belgie/): de Belgische maximumprijs van vandaag en de grensovergangen

## Duitse grensovergangen

${crossings.filter(x => x.c === "DE").map(pageLine).join("\n")}

## Belgische grensovergangen

${crossings.filter(x => x.c === "BE").map(pageLine).join("\n")}

## Optional

- [Sitemap](${ORIGIN}/sitemap.xml)
`);

const today = now.toISOString().slice(0, 10);
const urls = ["/", ...["DE", "BE"].map(c => `/${COUNTRY[c].dir}/`), ...crossings.map(x => x.url)];
await writeFile(join(SITE, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>
`);

console.log(`${crossings.length} grenspagina's, 2 overzichten en llms.txt gemaakt. Prijzen: Duitsland ${liveDE ? "live" : "gemiddelde"}, België ${liveBE ? "maximumprijs" : "gemiddelde"}, Nederland ${liveNL ? `CBS ${liveNL.date}` : "vast gemiddelde"}.`);
