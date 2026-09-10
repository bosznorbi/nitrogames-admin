# Nitrogames szavazóapp

Csapatépítő játékfejlesztő verseny szavazórendszere. A csapatok két óra alatt
fejlesztenek egy-egy játékot AI-jal, a résztvevők pedig telefonról, QR-kód
beolvasásával pontozzák őket.

- **Telefonos szavazás.** Minden csapatnak saját QR-kódja van, ami a csapat szavazólapjára visz.
- **Személyes belépő QR.** Mindenki kap egy kinyomtatott kódot, egyszer beolvassa, és a
  böngésző onnantól tudja, ki ő. Tartalék: kézzel beírható 5 karakteres kód, vagy név megadása.
- **Csapat API.** Minden csapat kap egy API kulcsot, amivel feltöltheti a háttérképét,
  logóját, játéknevét, és lekérheti a saját QR-kódját nyomtatáshoz.
- **Admin felület.** Jelszóval védett: élő eredmények, szempontonkénti bontás, átlagok,
  CSV export, nyomtatható QR-ívek, kivetítő nézet a díjkiosztóhoz.
- **Dinamikus szempontok.** A pontozási szempontok, a skálájuk és a súlyuk bármikor
  szerkeszthetők az admin felületen, akár a verseny közben is.

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

1. **Csapatok** fül: állítsd be a csapatok számát (pl. 9). Minden csapat kap egy
   API kulcsot, ezt add oda nekik.
2. **Szempontok** fül: nézd át az öt alapértelmezett szempontot, írd át vagy vegyél fel újakat.
3. **Szavazók** fül: generálj annyi szavazót, ahányan lesztek (pl. 60), majd nyomtasd ki az ívet.
4. Amikor kezdődik a szavazás, kapcsold be a **Szavazás nyitva** kapcsolót.

### Környezeti változók

Lásd [.env.example](.env.example).

| Változó | Mire jó |
| --- | --- |
| `PORT` | Port, alapból 3000. Railwayen automatikusan jön. |
| `ADMIN_PASSWORD` | Admin felület jelszava. **Mindenképp állítsd be.** |
| `SESSION_SECRET` | Sütik aláírása. Ha nincs megadva, generálunk egyet a `DATA_DIR`-be. |
| `DATA_DIR` | Adatbázis és feltöltött képek helye. Railwayen a mountolt volume útvonala. |
| `PUBLIC_BASE_URL` | A QR-kódokba kerülő nyilvános cím. Localhoston hagyd üresen. |
| `EVENT_NAME` | Fejlécben megjelenő név. |
| `BG_WIDTH` / `BG_HEIGHT` | A kötelező háttérkép-méret, alapból 1080 x 1920. |
| `LOGO_WIDTH` / `LOGO_HEIGHT` | A kötelező logóméret, alapból 512 x 512. |
| `MAX_UPLOAD_BYTES` | Feltöltési méretkorlát, alapból 4 MB. |

### Hasznos parancsok

```bash
npm run dev    # újraindul, ha változik a kód
npm run lan    # kiírja a telefonról elérhető címet és QR kódot rajzol a terminálba
npm run demo -- --igen --arany 80   # véletlen DEMO szavazatok próbához
```

## Tesztelés telefonról localhoston

A telefon és a gép legyen **ugyanazon a wifin** (céges vendéghálón gyakran tiltott
az eszközök közti forgalom, akkor használj mobil hotspotot).

1. Indítsd az appot: `npm start`
2. Másik terminálban: `npm run lan`
3. Olvasd be a terminálba rajzolt QR-kódot, vagy írd be kézzel a kiírt címet
   (pl. `http://192.168.25.232:3000`).

A szerver `0.0.0.0`-n figyel, tehát a hálózatról elérhető. Ha mégsem tölt be:

- **Windows tűzfal.** Az első indításnál felugró ablakban engedélyezd a Node.js-t
  a *privát* hálózaton. Ha elkattintottad, kézzel is felveheted:

  ```bash
  netsh advfirewall firewall add rule name="Nitrogames 3000" dir=in action=allow protocol=TCP localport=3000
  ```

  (Rendszergazdai PowerShellben vagy parancssorban futtasd.)
- **Rossz hálózati kártya.** A `npm run lan` a kimenő útvonal alapján jelöli meg,
  melyik címet érdemes először próbálni, de ha VPN vagy virtuális adapter is fut,
  próbáld végig a listát.
- **A QR-kódok localhostra mutatnak.** A csapat- és szavazói QR-kódok abból a
  címből készülnek, amin az admin felületet megnyitottad. Ha telefonról fogsz
  tesztelni, az admint is a `192.168.x.x` címen nyisd meg, ne localhoston,
  különben a kinyomtatott QR-ek a telefon saját localhostjára mutatnak.

## Kitelepítés Railwayre

A repó privát, és a Railway projekt egy másik ember (a "haver") fiókjában lesz.
A Railway GitHub App csak olyan repóhoz fér hozzá, amihez a bejelentkezett
GitHub-felhasználónak is van jogosultsága, ezért először hozzáférést kell adni.

### 1. Add hozzá a havert a GitHub repóhoz

A repó oldalán: **Settings → Collaborators → Add people**, add meg a GitHub
felhasználónevét. Elég a `Read` jogosultság a deployhoz (ha ő is akar pusholni,
adj `Write`-ot). A haver fogadja el a meghívót e-mailben vagy a
<https://github.com/notifications> oldalon.

### 2. A haver hozza létre a Railway projektet

A Railwayen: **New Project → Deploy from GitHub repo**. Ha nem látja a repót,
kattintson a **Configure GitHub App** linkre, és a GitHub oldalán adjon a Railway
appnak hozzáférést a `bosznorbi/nitrogames-admin` repóhoz. Utána a repó megjelenik
a listában.

Ettől kezdve minden `git push` a `main` ágra automatikusan új deployt indít.

### 3. Volume, hogy ne vesszenek el a szavazatok

**Ez a legfontosabb lépés.** Az adatok SQLite fájlban vannak. Volume nélkül minden
deploy (tehát minden push) törli az összes csapatot, szavazót és szavazatot.

A Railway projektben: a service-re kattintva **Settings → Volumes → Add Volume**,
a mount path legyen `/data`.

### 4. Környezeti változók

A service **Variables** fülén:

| Változó | Érték |
| --- | --- |
| `ADMIN_PASSWORD` | egy erős jelszó |
| `SESSION_SECRET` | hosszú véletlen string |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | a Railway domain, pl. `https://nitrogames-admin-production.up.railway.app` |
| `EVENT_NAME` | pl. `Nitrogames` |

Véletlen titok generálása:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

A `PORT`-ot ne állítsd be kézzel, azt a Railway adja.

A domaint a **Settings → Networking → Generate Domain** gombbal kapod meg. Amint
megvan, írd be a `PUBLIC_BASE_URL`-be, és indítsd újra a service-t: ettől kezdve
a QR-kódok erre a címre mutatnak.

> A `PUBLIC_BASE_URL` beállítása után **ne nyomtass újra QR-t**, amíg a cím nem
> végleges. A kinyomtatott kódok abba a címbe vannak égetve.

### 5. Ellenőrzés

```bash
curl https://<a-te-domained>/healthz
```

Ha `{"ok":true,...}` jön vissza, működik. Utána nyisd meg a `/admin` oldalt.

### Miért nem kell adatbázis service

Az app SQLite-ot használ, a mountolt volume-on. Egy kb. 60 fős eseményhez ez bőven
elég, és nem kell külön Postgres service-t fizetni. Ha később mégis kellene, a
`src/db.js` az egyetlen fájl, amit át kell írni.

## Az esemény menete

**Előtte**

1. Deploy Railwayre, `PUBLIC_BASE_URL` beállítva, volume mountolva.
2. Admin: csapatok száma beállítva, szempontok véglegesítve.
3. Admin: szavazók generálva (kicsit többet, mint ahányan lesztek, legyen tartalék).
4. Nyomtatás: az admin **Áttekintés** fülén két gomb tölt le kész PDF-et.
   A **szavazói belépők** (alapból 24 db egy A4-en) felvágva, mindenki kap egy cetlit.
   A **csapat táblák** (A5, kettő egy A4-en) félbevágva a csapatok asztalára.
5. A szavazás **zárva** marad, amíg a fejlesztés tart.
6. Minden csapat megkapja az API kulcsát és a `/team` oldal címét.

**Fejlesztés alatt**

A csapatok a `/team` oldalon vagy közvetlenül az API-n feltöltik a háttérképet,
beállítják a játék nevét. A csapat QR-je végig ugyanaz marad, akkor is, ha
közben átnevezik a játékot, tehát a kinyomtatott tábla nem avul el.

**Bemutató és szavazás**

1. Admin: **Szavazás nyitva** kapcsoló be.
2. Mindenki beolvassa a saját cetlijét (egyszer), majd a csapatok QR-jeit.
3. Az admin **Eredmények** fülén élőben látszik, hányan szavaztak.

**Díjkiosztó**

1. Admin: **Szavazás nyitva** kapcsoló ki.
2. Nyisd meg a **Kivetítő nézetet** (`/admin/eredmeny`) a projektoron.
   A *Pontok elrejtése* kapcsolóval eltakarhatod a számokat, amíg felvezeted.
3. A kategóriagyőztesek szempontonként külön is megvannak, az összesített
   sorrend pedig a súlyozott pontszám alapján áll össze.

## Csapat API

Minden csapat kap egy `ng_` kezdetű API kulcsot. A kulcs kétféleképpen adható meg:

```
Authorization: Bearer ng_...
X-API-Key: ng_...
```

A legegyszerűbb, ha a csapatok a **`/team` oldalt** nyitják meg: beírják a kulcsot,
és onnantól kattintgatva is tudnak képet tölteni, illetve ott van a saját kulcsukkal
kitöltött, másolható példakód is.

### Végpontok

| Metódus | Útvonal | Mit csinál |
| --- | --- | --- |
| `GET` | `/api/team/me` | Állapot lekérdezése, kulcs ellenőrzése. Visszaadja a kötelező képméreteket is. |
| `PUT` | `/api/team/me` | `game_name`, `tagline`, `description`, `accent_color` beállítása. |
| `POST` | `/api/team/me/background` | Háttérkép feltöltése. |
| `DELETE` | `/api/team/me/background` | Háttérkép törlése. |
| `POST` | `/api/team/me/logo` | Logó feltöltése. |
| `GET` | `/api/team/me/qr` | Saját QR-kód. `format=png\|svg\|json`, `size=128..2048`. |
| `GET` | `/api/team/me/tabla.pdf` | Nyomtatásra kész A5 tábla PDF-ben. |

### Képkövetelmények

A háttérképnek **pontosan** `1080 x 1920` képpontosnak kell lennie (álló, telefonra
tervezve), a logónak `512 x 512`-nek. Elfogadott formátumok: PNG, JPEG, WebP,
legfeljebb 4 MB. A formátumot a fájl tartalmából állapítjuk meg, nem a küldött
`Content-Type` fejlécből, tehát átnevezéssel nem lehet becsapni.

Ha a méret nem stimmel, `422`-vel válaszol, és megmondja, mit kapott és mit várt:

```json
{
  "error": "wrong_dimensions",
  "message": "A kép mérete 800x600, de pontosan 1080x1920 kell.",
  "got": { "width": 800, "height": 600, "format": "png" },
  "expected": { "width": 1080, "height": 1920, "formats": ["image/png", "image/jpeg", "image/webp"] }
}
```

### Példák

```bash
# Kulcs ellenőrzése
curl -H "Authorization: Bearer ng_..." https://pelda.up.railway.app/api/team/me

# Játék adatai
curl -X PUT -H "Authorization: Bearer ng_..." \
  -H "Content-Type: application/json" \
  -d '{"game_name":"Urpatkanyok bosszuja","tagline":"Ket ora, egy kuldetes","accent_color":"#ff5c8a"}' \
  https://pelda.up.railway.app/api/team/me

# Háttérkép nyers bináris body-val
curl -X POST -H "Authorization: Bearer ng_..." \
  -H "Content-Type: image/png" \
  --data-binary @hatter.png \
  https://pelda.up.railway.app/api/team/me/background

# Saját QR kód letöltése nyomtatáshoz
curl -H "Authorization: Bearer ng_..." \
  "https://pelda.up.railway.app/api/team/me/qr?size=1000" -o csapat-qr.png
```

A kép küldhető base64-ben is, ha az egyszerűbb:

```bash
curl -X POST -H "Authorization: Bearer ng_..." \
  -H "Content-Type: application/json" \
  -d "{\"image_base64\":\"$(base64 -w0 hatter.png)\"}" \
  https://pelda.up.railway.app/api/team/me/background
```

A csapatok szándékosan **nem látják** a rájuk érkezett szavazatokat.

## Oldalak és végpontok

| Útvonal | Kinek |
| --- | --- |
| `/` | Szavazók: csapatlista, ki mit pontozott már |
| `/v/:token` | A személyes belépő QR célja, beléptet és átirányít |
| `/join` | Belépés kóddal vagy névvel, ha a QR nem megy |
| `/t/:slug` | Egy csapat szavazólapja, ide visz a csapat QR-kódja |
| `/me` | Saját szavazatok, névmegadás |
| `/team` | Csapat konzol API kulccsal |
| `/admin` | Admin felület (jelszó) |
| `/admin/eredmeny` | Kivetítő nézet a díjkiosztóhoz |
| `/admin/nyomtatas/szavazok` | Szavazói QR-ív böngészős előnézete |
| `/admin/nyomtatas/csapatok` | Csapat QR-ív böngészős előnézete |
| `/api/admin/print/voters.pdf` | Szavazói belépők PDF-ben (`?cols=3..6`, `?only_new=1`) |
| `/api/admin/print/teams.pdf` | Csapat táblák PDF-ben, A5, kettő egy A4-en |
| `/healthz` | Állapotellenőrzés |

## Hogyan számoljuk az eredményt

Szempontonként külön skála és súly állítható, ezért az összesített pontszám nem
egyszerű átlag:

1. Minden csapat minden szempontjára kiszámoljuk a **beérkezett pontok átlagát**.
2. Az átlagot **0 és 100 közé normalizáljuk** a szempont saját skálája szerint:
   `(átlag - min) / (max - min) * 100`. Így egy 1-5-ös és egy 1-10-es szempont
   is összemérhető.
3. A normalizált értékek **súlyozott átlaga** adja az összesített pontszámot.

A **kategóriagyőztesek** szempontonként a legmagasabb nyers átlag alapján
állnak össze, tehát szempontonként külön is lehet díjazni.

Az admin felület a nyers átlagokat, a szavazatszámokat és a pontszámok
eloszlását is mutatja, a teljes adat pedig CSV-ben exportálható.
