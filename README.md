# NF · Dokumentenablage

Private, verschlüsselte Dokumentenablage als installierbare Web-App (PWA). Kein Server, keine Cloud, kein Konto.

## Sicherheitsmodell
- Alle Dokumente und Angaben werden **im Browser** mit AES-256-GCM verschlüsselt, bevor sie gespeichert werden (Web Crypto API).
- Ein zufälliger Datenschlüssel wird mit dem Master-Passwort (PBKDF2-SHA-256, 600.000 Runden) und zusätzlich mit einem
  Wiederherstellungsschlüssel (160 Bit) verpackt. Im Betrieb existiert er nur als nicht exportierbarer Schlüssel im Arbeitsspeicher.
- Gespeichert wird nur verschlüsselt in IndexedDB des Geräts. Die App sendet nichts ins Internet (strenge Content-Security-Policy).
- Automatische Sperre nach einstellbarer Inaktivität und nach 1 Minute im Hintergrund; Sperren lädt die Seite neu und verwirft alles Entschlüsselte.
- **Passwort und Wiederherstellungsschlüssel verloren = Daten verloren.** Es gibt keine Hintertür.
- Dieses Repository enthält nur den Programmcode – **niemals Dokumente hier hochladen.**

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
`index.html` · `app.css` · `js/app.js` (Oberfläche) · `js/crypto.js` (Verschlüsselung) · `js/db.js` (Speicher) · `sw.js` (Offline) ·
`tools/build_icons.py` (Icons neu erzeugen)
