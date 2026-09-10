# Nitrogames szavazóapp

Csapatépítő játékfejlesztő verseny szavazórendszere. A csapatok két óra alatt
fejlesztenek egy-egy játékot AI-jal, a résztvevők pedig telefonról, QR-kód
beolvasásával pontozzák őket.

- **Egy képernyő a szavazóknak.** A személyes QR beolvasása után egy 3x3-as
  rács jön: a még nem pontozott játékok szürkék. A listából nem lehet
  szavazni, csak a csapat QR-kódját beolvasva.
- **Névtelen belépő cetlik.** Mindenki kap egy papírt QR-rel és egy négybetűs
  kóddal. Nincs regisztráció, nincs név, a kódok anonimak.
- **A csapatok maguk töltik fel a játékukat.** Csapatnév, játéknév, leírás,
  háttérkép és csempekép, papírról begépelhető kóddal, API-n keresztül.
- **A szerver megmondja, mi hiányzik.** Egy végpont felsorolja, mit kell még
  beállítani ahhoz, hogy a csapat készen álljon.
- **Admin felület.** Élő eredmények, szempontonkénti bontás, nyomtatható
  PDF-ek, kivetítő nézet. Mobilon is használható.
- **Dinamikus szempontok.** Skála és súly is szerkeszthető, akár verseny közben.

## Tartalom

1. [Gyors indítás](#gyors-indítás)
2. [Tesztelés telefonról localhoston](#tesztelés-telefonról-localhoston)
3. [Kitelepítés Railwayre](#kitelepítés-railwayre)
4. [Az esemény menete](#az-esemény-menete)
5. [Csapat API](#csapat-api)
6. [Oldalak és végpontok](#oldalak-és-végpontok)
7. [Hogyan számoljuk az eredményt](#hogyan-számoljuk-az-eredményt)

## Gyors indítás

Node 22 kell hozzá.

```bash
npm install
cp .env.example .env
npm start
```

Az app a <http://localhost:3000> címen indul. Az `.env` fájlban legalább az
`ADMIN_PASSWORD`-öt írd át.

Első lépések az admin felületen (<http://localhost:3000/admin>):

1. **Csapatok** fül: állítsd be a csapatok számát. Minden csapat kap egy
   nyolc karakteres kódot, ez kerül a nyomtatott lapjukra.
2. **Szempontok** fül: nézd át az öt alapértelmezett szempontot.
3. **Szavazók** fül: generálj annyi cetlit, ahányan lesztek, plusz tartalékot.
4. **Áttekintés** fül: töltsd le a két PDF-et, és nyomtasd ki.
5. Amikor kezdődik a szavazás, kapcsold be a **Szavazás nyitva** kapcsolót.

### A TESZT kód

Mindig létezik egy `TESZT` nevű szavazó, mintha ki lenne nyomtatva. A
belépő oldalon (`/belepes`) beírva bármikor kipróbálhatod a szavazói oldalt.
Törölni nem lehet, a teljes nullázást is túléli.

### Környezeti változók

| Változó | Mire jó |
| --- | --- |
| `PORT` | Port, alapból 3000. Railwayen automatikusan jön, ne állítsd. |
| `ADMIN_PASSWORD` | Admin jelszó. **Mindenképp állítsd be.** |
| `SESSION_SECRET` | Sütik aláírása. Ha nincs, generálunk egyet a `DATA_DIR`-be. |
| `DATA_DIR` | Adatbázis és feltöltött képek helye. Railwayen a volume útvonala. |
| `PUBLIC_BASE_URL` | A QR-kódokba kerülő nyilvános cím. Localhoston hagyd üresen. |
| `EVENT_NAME` | Fejlécben megjelenő név. |
| `BG_WIDTH` / `BG_HEIGHT` | Kötelező háttérkép-méret, alapból 1080 x 1920. |
| `ICON_SIZE` | Kötelező csempekép-méret, alapból 512. |
| `MAX_UPLOAD_BYTES` | Feltöltési méretkorlát, alapból 4 MB. |

### Hasznos parancsok

```bash
npm run dev    # újraindul, ha változik a kód
npm run lan    # kiírja a telefonról elérhető címet és QR kódot rajzol a terminálba
npm test       # végigmegy a teljes folyamaton egy futó szerver ellen
npm run demo -- --igen --arany 80   # véletlen DEMO szavazatok próbához
```

## Tesztelés telefonról localhoston

A telefon és a gép legyen **ugyanazon a wifin**. Céges vendéghálón gyakran
tiltott az eszközök közti forgalom, akkor használj mobil hotspotot.

1. `npm start`
2. Másik terminálban: `npm run lan`
3. Olvasd be a terminálba rajzolt QR-kódot, vagy írd be a kiírt címet.

**Az admint is a hálózati címen nyisd meg** (`http://192.168.x.x:3000/admin`),
ne localhoston. A QR-kódokba az a cím ég bele, amin az admint megnyitottad.
Az Áttekintés fülön a Fő QR-kód kártya figyelmeztet, ha rossz címen vagy.

Ha nem tölt be:

- **Windows tűzfal.** Az első indításnál engedélyezd a Node.js-t a *privát*
  hálózaton. Kézzel, rendszergazdaként:

  ```bash
  netsh advfirewall firewall add rule name="Nitrogames 3000" dir=in action=allow protocol=TCP localport=3000
  ```

- **Rossz hálózati kártya.** Az `npm run lan` a kimenő útvonal alapján jelöli
  meg, melyik címet érdemes először próbálni.

## Kitelepítés Railwayre

A repó privát, és a Railway projekt egy másik ember fiókjában lesz. A Railway
GitHub App csak olyan repóhoz fér hozzá, amihez a bejelentkezett
GitHub-felhasználónak is van jogosultsága.

### 1. Hozzáférés a repóhoz

A repó **Settings → Collaborators → Add people**, add meg a GitHub
felhasználónevét. A deployhoz elég a `Read`. Fogadja el a meghívót.

### 2. Railway projekt

**New Project → Deploy from GitHub repo**. Ha nem látja a repót, a
**Configure GitHub App** linken adjon a Railway appnak hozzáférést hozzá.
Ettől kezdve minden `git push` a `main` ágra új deployt indít.

### 3. Volume

**Ez a legfontosabb lépés.** Az adatok SQLite fájlban vannak. Volume nélkül
minden deploy törli az összes csapatot, szavazót és szavazatot.

A service **Settings → Volumes → Add Volume**, a mount path legyen `/data`.

### 4. Környezeti változók

| Változó | Érték |
| --- | --- |
| `ADMIN_PASSWORD` | erős jelszó |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | hosszú véletlen string |
| `PUBLIC_BASE_URL` | a Railway domain, miután megvan |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

A domaint a **Settings → Networking → Generate Domain** adja. Amint megvan,
írd be a `PUBLIC_BASE_URL`-be, és indítsd újra a service-t.

> **A sorrend számít:** volume, env-ek, domain, `PUBLIC_BASE_URL`,
> újraindítás, és csak utána nyomtass QR-t. A kinyomtatott kódokba a cím bele
> van égetve.

### 5. Ellenőrzés

```bash
curl https://<a-te-domained>/healthz
```

## Az esemény menete

**Előtte**

1. Deploy, `PUBLIC_BASE_URL` beállítva, volume mountolva.
2. Admin: csapatszám és szempontok véglegesítve, szavazók generálva.
3. Nyomtatás az Áttekintés fülről:
   - **Szavazói belépők** (24 db egy A4-en) felvágva, mindenki kap egyet.
   - **Csapat belépők** (A5, kettő egy A4-en) félbevágva, csapatonként egy.
4. A szavazás **zárva** marad, amíg a fejlesztés tart.

**Fejlesztés alatt**

A csapatok a lapjukon lévő kóddal és a [kezdőcsomag](https://github.com/bosznorbi/nitrogames)
`tools/nitrogames.mjs` eszközével nevezik be a játékot. A lapon lévő QR-t
telefonnal beolvasva a csapat konzol nyílik meg, azt Teamsen át tudják küldeni
a fejlesztőgépre. A konzolon böngészőből is feltölthetők a képek, tetszőleges
méretben, mert az oldal levágja őket.

Az admin **Csapatok** fülén látszik, melyik csapatnak mi hiányzik még.

**Bemutató és szavazás**

1. Admin: **Szavazás nyitva** be.
2. Mindenki beolvassa a saját cetlijét egyszer, utána a csapatok QR-jeit.
3. Szavazás után a főoldalon animációval színesedik ki a csempe.

**Díjkiosztó**

1. Admin: **Szavazás nyitva** ki.
2. Kivetítő nézet (`/admin/eredmeny`), a *Pontok elrejtése* kapcsolóval
   felvezethető az eredményhirdetés.

## Csapat API

Minden csapat kap egy nyolc karakteres kódot (`ABCD-1234`). A kód a
`Authorization: Bearer` fejlécben megy, kötőjellel vagy anélkül, kis- és
nagybetű mindegy. Alternatívák: `X-Csapat-Kod` fejléc vagy `?kod=` paraméter.

| Metódus | Útvonal | Mit csinál |
| --- | --- | --- |
| `GET` | `/api/csapat/allapot` | **Mi hiányzik még.** Ezt érdemes ismételten hívni. |
| `GET` | `/api/csapat` | Minden adat és a készültség. |
| `PUT` | `/api/csapat` | `csapatnev`, `jatek_neve`, `mottó`, `leiras`, `szin` |
| `POST` | `/api/csapat/hatterkep` | Háttérkép, pontosan 1080 x 1920. |
| `POST` | `/api/csapat/csempekep` | Csempekép, pontosan 512 x 512. |
| `POST` | `/api/csapat/csempekep-kesz` | Opcionális, csempekép szavazás után. |
| `GET` | `/api/csapat/qr` | A saját QR-kódjuk. `format=png\|svg\|json` |

A készültség végpont válasza megmondja a következő lépést is:

```json
{
  "kesz": false,
  "kesz_darab": 4,
  "osszesen": 6,
  "uzenet": "Még 2 dolog hiányzik.",
  "kovetkezo_lepes": {
    "kulcs": "csempekep",
    "teendo": "Töltsetek fel csempeképet, pontosan 512x512 képpont.",
    "hogyan": "POST https://.../api/csapat/csempekep"
  },
  "hianyzik": [ ... ]
}
```

A formátumot a fájl tartalmából állapítjuk meg, nem a `Content-Type`
fejlécből, tehát átnevezéssel nem lehet becsapni. A csapatok szándékosan
**nem látják** a rájuk érkezett szavazatokat.

```bash
# Mi hiányzik még
curl -H "Authorization: Bearer ABCD-1234" https://pelda.up.railway.app/api/csapat/allapot

# Adatok
curl -X PUT -H "Authorization: Bearer ABCD-1234" -H "Content-Type: application/json" \
  -d '{"csapatnev":"Kavesznet","jatek_neve":"A jatekunk","leiras":"Mirol szol"}' \
  https://pelda.up.railway.app/api/csapat

# Háttérkép
curl -X POST -H "Authorization: Bearer ABCD-1234" -H "Content-Type: image/png" \
  --data-binary @hatter.png https://pelda.up.railway.app/api/csapat/hatterkep

# QR nyomtatáshoz
curl -H "Authorization: Bearer ABCD-1234" \
  "https://pelda.up.railway.app/api/csapat/qr?size=1200" -o qr.png
```

## Oldalak és végpontok

| Útvonal | Kinek |
| --- | --- |
| `/` | Szavazók főoldala: 3x3-as csemperács |
| `/v/:token` | A személyes belépő QR célja |
| `/belepes` | Belépés a papírra nyomtatott kóddal |
| `/t/:azonosito` | Egy csapat szavazólapja, csak QR-ből érhető el |
| `/csapat` | Csapat konzol, kóddal |
| `/admin` | Admin felület (jelszó) |
| `/admin/eredmeny` | Kivetítő nézet |
| `/api/admin/print/voters.pdf` | Szavazói belépők (`?cols=3..6`, `?only_new=1`) |
| `/api/admin/print/teams.pdf` | Csapat belépők, A5, kettő egy A4-en |
| `/healthz` | Állapotellenőrzés |

A PDF-ek `?nezet=inline` paraméterrel a böngészőben nyílnak meg letöltés
helyett, így telefonról a megosztás gombbal továbbküldhetők Teamsen.

## Hogyan számoljuk az eredményt

Szempontonként külön skála és súly állítható, ezért az összesített pontszám
nem egyszerű átlag:

1. Minden csapat minden szempontjára kiszámoljuk a **beérkezett pontok átlagát**.
2. Az átlagot **0 és 100 közé normalizáljuk** a szempont saját skálája szerint:
   `(átlag - min) / (max - min) * 100`.
3. A normalizált értékek **súlyozott átlaga** adja az összesített pontszámot.

A kategóriagyőztesek szempontonként a legmagasabb nyers átlag alapján állnak
össze, tehát szempontonként külön is lehet díjazni.
