# pompsmart.nl

Een rekentool die laat zien of tanken in België of Duitsland loont. De hele site is één statisch bestand (`index.html`). Er is geen server, geen database en geen build-stap nodig.

## Bestanden

- `index.html`: de site. Opmaak, rekenlogica en data staan er allemaal in.
- `CNAME`: het domein, voor GitHub Pages. Andere hosts negeren het.

## Prijzen bijwerken

Bovenin het `<script>` in `index.html` staan:

```js
const PRICE_DATE = "medio juli 2026";
const DEFAULT_PRICES = { NL: {...}, BE: {...}, DE: {...} };
```

Pas de prijzen en de datum aan en zet het bestand opnieuw online. Bezoekers die eerder zelf prijzen hadden ingevuld, krijgen dan automatisch de nieuwe startprijzen.
Bron: de wekelijkse EU Weekly Oil Bulletin (gemiddelden inclusief belastingen), of fuel-prices.eu.

## Online zetten

Kies één van deze drie. Alle drie zijn gratis voor een site als deze en regelen https zelf.

### Optie A: Netlify (makkelijkst)
1. Ga naar app.netlify.com en log in.
2. Kies **Add new site → Deploy manually** en sleep deze map erin.
3. Ga naar **Domain management → Add a domain** en vul `pompsmart.nl` in.
4. Zet bij je domeinregistrar de DNS-records die Netlify toont (een A-record voor `pompsmart.nl` en een CNAME voor `www`).

### Optie B: Cloudflare Pages
1. Ga in het Cloudflare-dashboard naar **Workers & Pages → Create → Pages → Upload assets** en upload deze map.
2. Kies **Custom domains → Set up a domain** en vul `pompsmart.nl` in.
3. Staat je domein al bij Cloudflare, dan worden de DNS-records automatisch gezet.

### Optie C: GitHub Pages
1. Maak een nieuwe repository (bijvoorbeeld `pompsmart`) en zet `index.html` en `CNAME` erin.
2. Ga naar **Settings → Pages**, kies de branch `main` en map `/ (root)`.
3. Zet bij je registrar deze DNS-records:
   - `A` voor `pompsmart.nl` naar `185.199.108.153`, `185.199.109.153`, `185.199.110.153` en `185.199.111.153`
   - `CNAME` voor `www` naar `<jouw-gebruikersnaam>.github.io`
4. Vink **Enforce HTTPS** aan zodra het certificaat klaar is.

Nieuwe DNS-records kunnen een paar minuten tot een paar uur nodig hebben.

## Privacy

De site plaatst geen cookies en stuurt geen gegevens naar een server. Invoer wordt alleen in de browser van de bezoeker bewaard (`localStorage`). Locatie wordt alleen gevraagd als de bezoeker op **Mijn locatie** klikt, en blijft op het apparaat. Daardoor heb je geen cookiebanner nodig. Voeg je later analytics of advertenties toe, dan verandert dat.

Google Fonts wordt geladen vanaf Google. Wil je dat niet, download de lettertypen dan en zet ze naast `index.html`.
