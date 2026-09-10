# Nitrogames szavazóapp

Csapatépítő játékfejlesztő verseny szavazórendszere. Kilenc (dinamikusan bővíthető)
csapat két óra alatt fejleszt egy-egy játékot AI-jal, a résztvevők pedig telefonról,
QR-kód beolvasásával pontozzák őket.

## Mit tud

- **Telefonos szavazás.** Minden csapatnak saját QR-kódja van, ami a csapat szavazólapjára visz.
- **Személyes belépő QR.** Mindenki kap egy kinyomtatott kódot, egyszer beolvassa, és a
  böngésző onnantól megjegyzi, ki ő. Tartalék: kézzel beírható 5 karakteres kód.
- **Csapat API.** Minden csapat kap egy API kulcsot, amivel feltöltheti a saját
  háttérképét, logóját, játéknevét, és lekérheti a saját QR-kódját nyomtatáshoz.
- **Admin felület.** Jelszóval védett: élő eredmények, szempontonkénti bontás, átlagok,
  szavazatszámok, CSV export, nyomtatható QR-ívek.
- **Dinamikus szempontok.** A pontozási szempontok az admin felületen bármikor
  szerkeszthetők, a skála és a súlyozás is.

## Gyors indítás

```bash
npm install
cp .env.example .env
npm start
```

Az app a <http://localhost:3000> címen indul, az admin felület a `/admin` útvonalon.

## Környezeti változók

Lásd [.env.example](.env.example). A legfontosabbak:

| Változó | Mire jó |
| --- | --- |
| `ADMIN_PASSWORD` | Admin felület jelszava |
| `SESSION_SECRET` | Sütik aláírása |
| `DATA_DIR` | Adatbázis és feltöltések helye (Railwayen a mountolt volume) |
| `PUBLIC_BASE_URL` | A QR-kódokba kerülő nyilvános cím |

## Állapot

Fejlesztés alatt.
