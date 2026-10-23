# Hochsitze · Jagdgemeinschaft Thuine

Eigenständige Test-App (PWA), die später in die App „Jagd Thuine“ einfließen soll.

**Link:** https://grunzelthuine.github.io/Hochsitze/

## Funktionen (v1.0.0)
- Karte mit allen Hochsitzen: Luftbild (Esri), topografische Karte (BKG TopPlusOpen), OpenStreetMap. Symbol je Art, gelber Kegel = Blickrichtung, Ring gelb = Mängel, rot = gesperrt.
- Erfassen am Sitz (nur voller Zugang): GPS wird laufend gemessen und gemittelt (Genauigkeit sichtbar), Punkt von Hand verschiebbar. Name, Art, Zustand, Bemerkung, Blickrichtung (Kompass oder antippen), Foto und Handy-Panorama.
- Steht man beim Erfassen ≤ 30 m neben einem vorhandenen Sitz, fragt die App, ob dieser umgestellt wurde.
- Umstellen: neue GPS-Position, Datum, optional neue Fotos/Richtung. Der alte Standort bleibt mit Zeitraum, Fotos und Panorama im Verlauf. Karte: Uhr-Knopf blendet alte Standorte (gestrichelt) ein.
- Liste mit Suche und Sortierung nach Name, Entfernung oder Art.
- Offline: Änderungen ohne Netz landen in einer Warteschlange und werden automatisch hochgeladen. Angesehene Kartenkacheln und Fotos bleiben auf dem Gerät.

## Daten
- `data/hochsitze.json`: verschlüsselt (AES-GCM, PBKDF2-SHA256 150.000), gleiches Format wie `strecke.json` in Jagd Thuine.
- `data/fotos/*.bin`: verschlüsselte JPEGs (Format „SBE1“ wie die Dokumente in Jagd Thuine), jeweils mit Vorschaubild `-t.bin`.
- Modell: `sitze: [{id, name, art (kanzel|leiter|drueckjagd|erdsitz|sonst), zustand (gut|maengel|gesperrt), bemerkung, lat, lng, acc, richtung (Grad|null), foto {f,t,w,h}, pano {f,t,w,h}, seit, erstellt, geaendert, verlauf: [{lat, lng, acc, richtung, von, bis, foto, pano}]}]`.

## Zugang
- Lesen: alle mit dem Passwort der Jagdgemeinschaft.
- Schreiben: Einstellungen → „Voller Zugang“ + fine-grained Token mit Contents: Read & Write auf dieses Repo.
