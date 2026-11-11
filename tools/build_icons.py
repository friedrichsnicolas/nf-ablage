"""Erzeugt die App-Icons (Tannengrünes Monogramm auf Cremeweiß mit Champagner-Rahmen).

Aufruf:  python tools/build_icons.py      Benötigt: pip install cairosvg
Das helle Icon unterscheidet die Ablage auf dem Homescreen von der (dunklen) Visitenkarten-App.
"""
import pathlib, re
import cairosvg

ROOT = pathlib.Path(__file__).resolve().parent.parent
GREEN, CREAM, CHAMP = "#0E3A32", "#F7F4EE", "#C6A86A"
src = (ROOT / "assets/img/favicon.svg").read_text(encoding="utf-8")
src = src.replace('fill="#0E3A32"/>', f'fill="{CREAM}"/>'
                  f'<rect x="-325.77" y="-350" width="1700" height="1700" rx="40" fill="none" '
                  f'stroke="{CHAMP}" stroke-width="28"/>', 1)
icon = re.sub(r'(<g fill=")#F7F4EE', r"\1" + GREEN, src)
(ROOT / "assets/icons/icon.svg").write_text(icon, encoding="utf-8")
for size, name in [(192, "icon-192"), (512, "icon-512"), (512, "icon-maskable-512"),
                   (180, "apple-touch-icon"), (32, "favicon-32")]:
    cairosvg.svg2png(bytestring=icon.encode(), write_to=str(ROOT / f"assets/icons/{name}.png"),
                     output_width=size, output_height=size)
print("Icons erzeugt")
