# ZRSZ reconnaissance findings (2026-09-15)

## Detail URL template

```
https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=<id>/#/pdm/<id>
```

Confirmed by clicking two different result cards in the live search UI:
- `idp=3479449` / `#/pdm/3479449` (POMOŽNI DELAVEC V PROIZVODNJI/SKLADIŠČU - M/Ž)
- `idp=3479420` / `#/pdm/3479420` (HIŠNIK IV - M/Ž)

`<id>` is the same value as `idDelovnoMesto` from the search response.

## Description endpoint

A description endpoint exists. Clicking a result card fires:

```
GET https://apigateway-prod-www-prod.apps.ess.gov.si/iskalnik-po-pdm/v1/delovno-mesto/podrobnosti-prosto-delovno-mesto?idDelovnoMesto=<id>&user_key=9b7dcbe8ec1855d14f0b2ec4f6335a91
```

(observed via `read_network_requests` after clicking the second card, then verified independently with `curl`).

The description text is in the field **`opisDelInNalog`** (string). Example response for `idDelovnoMesto=3479420`:

```json
{
  "idDelovnoMesto": "3479420",
  "opisDelInNalog": "Popravila, skrb za okolico, vzdrževanje stavbe in okolice, prevoz učencev, delo po navodilih vodstva",
  "nazivDelovnegaMesta": "HIŠNIK IV - M/Ž",
  "delodajalec": "OSNOVNA ŠOLA BREZOVICA PRI LJUBLJANI, BREZOVICA PRI LJUBLJANI",
  ...
}
```

Other potentially useful fields on this endpoint: `trajanjeZaposlitve`, `delovniCas`, `urnikDela`, `okvirnaPlaca`, `izobrazba`, `delovneIzkusnje`, `kontaktZaKandidata`, `objavaKraj`, `datumObjave`, `prijavaDo`, `kodaInNazivSKP`.

The documented fallback (`.../iskanje-dela/#/pdm/<id>` with `description: ''`) is **not needed** — Task 5 should call the `podrobnosti-prosto-delovno-mesto` endpoint to populate `description` from `opisDelInNalog`, and build the public job URL from the confirmed template above.

## Fixture

`tests/fixtures/zrsz-search.json` captured via the Step 1 POST request (region filter `Osrednjeslovenska`, page size 50).

- `steviloDelovnihMest` (total): 1526
- `seznamDelovnihMest.length` (items in this page): 50
- Item keys: `idDelovnoMesto, nazivDelovnegaMesta, delodajalec, krajDM, trajanjeZaposlitve, delovniCas, ravenIzobrazbe, datumObjave, ikonaReferenca, zrszNapotovanje, topNapovedi, poklicniBarometer, poklicniBarometer1, poklic, datumSpremembe, ikonaNegativnaReferenca` — includes all keys the brief expected (`idDelovnoMesto`, `nazivDelovnegaMesta`, `delodajalec`, `krajDM`, `trajanjeZaposlitve`, `delovniCas`, `datumObjave`, `poklic`).

## Notes / uncertainty

- The `?idp=<id>` query parameter appears to be cosmetic/informational (the actual client-side routing is driven by the `#/pdm/<id>` hash fragment); Task 5 should treat the whole string after the base path, including both the query param and hash, as the canonical public URL, since that's what the browser address bar actually showed.
- No alert/confirm/prompt dialogs were triggered during recon.
- First page load returned a transient `503` from the CMS (TYPO3); a second navigation to the same URL succeeded. Not expected to affect Task 5's use of the API endpoints directly.
