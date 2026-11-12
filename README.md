# NF · Dokumentenablage & Haushaltsbuch

Private, verschlüsselte Dokumentenablage mit Haushaltsbuch als installierbare Web-App (PWA). Kein Server, keine Cloud, kein Konto.

## Sicherheitsmodell
- Alle Dokumente und Angaben werden **im Browser** mit AES-256-GCM verschlüsselt, bevor sie gespeichert werden (Web Crypto API).
- Ein zufälliger Datenschlüssel wird mit dem Master-Passwort (PBKDF2-SHA-256, 600.000 Runden) und zusätzlich mit einem
  Wiederherstellungsschlüssel (160 Bit) verpackt. Im Betrieb existiert er nur als nicht exportierbarer Schlüssel im Arbeitsspeicher.
- Gespeichert wird nur verschlüsselt in IndexedDB des Geräts. Die App sendet nichts ins Internet (strenge Content-Security-Policy).
- Automatische Sperre nach einstellbarer Inaktivität und nach 1 Minute im Hintergrund; Sperren lädt die Seite neu und verwirft alles Entschlüsselte.
- **Passwort und Wiederherstellungsschlüssel verloren = Daten verloren.** Es gibt keine Hintertür.
- Dieses Repository enthält nur den Programmcode – **niemals Dokumente hier hochladen.**

## Haushaltsbuch
Umschalter **Ablage | Haushalt** oben. Gleicher Tresor, gleiches Passwort, gleiches Backup und gleicher Dropbox-Abgleich.
- **Übersicht:** Einnahmen, Ausgaben, Saldo, Sparquote, Budget-Tracker (Ausgaben im Monatsverlauf gegen Budget), Ausgaben nach Kategorie, 12-Monats-Verlauf, Kontostände.
- **Buchungen:** Suche und Filter, „Zu prüfen“-Liste, Belege aus der Ablage verknüpfen oder neu fotografieren.
- **Budget:** Plan je Kategorie (Standard oder nur für einen Monat), geplante Einnahmen, „frei zum Sparen“, Vorschlag aus den letzten 3 Monaten.
- **Tracker:** Sparziele, automatisch erkannte Fixkosten & Abos, Einkäufe ab 100 € ohne Beleg.
- **Import:** CSV/Excel aus dem Online-Banking (Sparkasse, Volksbank, ING, DKB, comdirect, N26 …), American-Express-Export (CSV/Excel, Vorzeichen wird automatisch umgedreht, eigenes Konto) und PDF-Abrechnungen per KI. Doppelte werden übersprungen.
- **Automatische Zuordnung:** lokal per eigenen Regeln, Gelerntem aus Korrekturen und Händler-Wörterbuch. Optional **Claude (Anthropic)** mit eigenem API-Schlüssel für unbekannte Händler, Belegfotos und PDF-Abrechnungen. Gesendet werden nur Datum, Betrag, Empfänger und gekürzter Zweck (IBAN/Referenzen entfernt) bzw. der gewählte Beleg.

Daten: `fin-cfg` (Einstellungen, Budgets, Ziele) und `fin-m-JJJJ-MM` (Buchungen je Monat) als verschlüsselte Datensätze; bei gleichzeitiger Änderung auf zwei Geräten werden Buchungen zusammengeführt.

## Geräte-Abgleich über Dropbox
Optional in *Einstellungen → Geräte-Abgleich*. Die App lädt nur bereits verschlüsselte Pakete in ihren
Dropbox-App-Ordner (`Apps/<App-Name>`, Zugriffstyp „App folder“: kein Zugriff auf andere Dropbox-Dateien).
Auf weiteren Geräten: *Ablage von Dropbox übernehmen* und mit demselben Master-Passwort entsperren.
Bei gleichzeitiger Änderung desselben Dokuments gewinnt die jüngere Fassung.

Einrichtung: in der [Dropbox App Console](https://www.dropbox.com/developers/apps) eine App mit
„Scoped access“ und „App folder“ anlegen, unter *Permissions* `files.content.write` und `files.content.read`
aktivieren und den *App key* in `js/config.js` eintragen. Anmeldung per OAuth-PKCE ohne Server.

## Geräte & Backup
Die Daten liegen pro Gerät/Browser. Übertragung und Sicherung über *Einstellungen → Backup erstellen*: eine einzelne,
weiterhin verschlüsselte `.nfablage`-Datei (z. B. in iCloud Drive oder auf USB-Stick). Auf dem neuen Gerät:
*Ich habe ein Backup – wiederherstellen*, oder in einen bestehenden Tresor *Backup einspielen*.

Tipp iPhone: In Safari „Teilen → Zum Home-Bildschirm“. Als installierte App wird der Speicher nicht automatisch aufgeräumt.

## Veröffentlichen (GitHub Pages)
Push auf `main` startet `.github/workflows/pages.yml`. Einmalig: *Settings → Pages → Source: GitHub Actions*.

## Dateien
`index.html` · `app.css` · `js/app.js` (Oberfläche) · `js/haushalt.js` (Haushaltsbuch) · `js/ki.js` (Zuordnung, Claude) · `js/csv.js` (Import) · `js/charts.js` (Diagramme) · `js/crypto.js` (Verschlüsselung) · `js/db.js` (Speicher) · `sw.js` (Offline) ·
`tools/build_icons.py` (Icons neu erzeugen)
