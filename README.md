# pompsmart.nl

Een rekentool die laat zien of tanken in België of Duitsland loont. De hele site is één statisch bestand (`index.html`). Er is geen server, geen database en geen build-stap nodig.

## Bestanden

- `index.html`: de site. Opmaak, rekenlogica en data staan er allemaal in.
- `CNAME`: het domein, voor GitHub Pages. Andere hosts negeren het.
- `scripts/fetch-de-prices.mjs`, `scripts/fetch-be-prices.mjs` en `.github/workflows/pages.yml`: de actuele Duitse en Belgische prijzen, zie hieronder.

## Live Duitse prijzen (Tankerkönig)

Voor Duitsland toont de site de actuele prijs van de goedkoopste open pomp bij elk van de 12 grensovergangen. Zo werkt het:

- `.github/workflows/pages.yml` publiceert de site bij elke push naar `main`, en elke 30 minuten opnieuw.
- Bij elke publicatie haalt `scripts/fetch-de-prices.mjs` de prijzen op bij Tankerkönig en zet ze in `de-prijzen.json` naast de site.
- `index.html` laadt dat bestand. Ontbreekt het, of is het ouder dan 3 uur, dan rekent de site met het Duitse gemiddelde uit `DEFAULT_PRICES`.

De API-sleutel staat als geheim in GitHub en komt nooit in de publieke site.

**Eenmalig instellen**
1. Vraag een gratis API-sleutel aan op https://creativecommons.tankerkoenig.de (knop *API-Key*).
2. Zet hem in de repository onder **Settings → Secrets and variables → Actions → New repository secret**, met de naam `TANKERKOENIG_API_KEY`.
3. Zet onder **Settings → Pages → Build and deployment → Source** de bron op **GitHub Actions**.
4. Start de workflow één keer met de hand: **Actions → Site publiceren → Run workflow**.

**Goed om te weten**
- De gegevens vallen onder CC BY 4.0. De bronvermelding (Tankerkönig en MTS-K) staat onderaan de site; laat die staan.
- GitHub zet geplande workflows in een publieke repository uit na 60 dagen zonder commits, en stuurt daar vooraf een mail over. Zet hem dan weer aan onder **Actions**. Tot die tijd valt de site vanzelf terug op de gemiddelden.
- De lijst grensovergangen staat op twee plekken: `BORDER.DE` in `index.html` en `POINTS` in het script. Houd de namen gelijk.

## Belgische maximumprijzen (Statbel)

Voor België gebruikt de site de officiële maximumprijs van vandaag voor Euro 95 (E10) en diesel (B7), zoals de FOD Economie die elke dag vaststelt. Pompen mogen niet meer vragen; aan de grens is tanken vaak iets goedkoper, en dat staat ook op de site.

- `scripts/fetch-be-prices.mjs` haalt de prijzen bij elke publicatie op bij Statbel (be.STAT) en zet ze in `be-prijzen.json`. Hiervoor is geen API-sleutel nodig.
- Het script neemt een prijs alleen over als in dezelfde rij ook de prijs zonder btw staat, met precies 21% btw verschil. Verandert Statbel de opmaak, dan komt er dus geen verkeerd getal op de site; de site rekent dan met het gemiddelde.
- Is de maximumprijs ouder dan 3 dagen, dan rekent de site ook met het gemiddelde.
- Werkt het niet meer, kijk dan in de log van **Actions → Site publiceren**, bij de stap *Belgische maximumprijzen ophalen*. Daar staat per bron wat er gevonden is.

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

## Privacy en Google Analytics

De site gebruikt Google Analytics (`G-16KSML5VFV`), maar laadt de Google-tag pas nadat een bezoeker in de cookiemelding op **Akkoord** klikt. Bij **Weigeren** wordt er niets naar Google gestuurd. De keuze wordt in de browser bewaard (`localStorage`, sleutel `pompsmart-consent`) en is te wijzigen via **Cookie-instellingen** onderaan de pagina.

Invoer van bezoekers blijft in hun eigen browser. Locatie wordt alleen gevraagd als iemand op **Mijn locatie** klikt, en blijft op het apparaat.

Zet in Google Analytics onder **Beheer → Gegevensverzameling** Google-signalen en advertentiepersonalisatie uit, en stel de bewaartermijn in op 2 maanden. Dat past bij een meting die alleen het gebruik van de site bijhoudt.

Google Fonts wordt geladen vanaf Google. Wil je dat niet, download de lettertypen dan en zet ze naast `index.html`.
