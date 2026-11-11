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
