# Englisch lernen

Private Lern-Web-App: Vokabeln und Sätze, ohne Spielereien, mit Wiederholungssystem.

## Starten
- **Einfach:** `index.html` doppelklicken – läuft direkt im Browser (Chrome/Edge empfohlen, wegen der Sprachausgabe).
- **Als App installieren (Handy/PC):** Ordner auf einen Webserver mit HTTPS legen (z. B. GitHub Pages oder Netlify, kostenlos),
  Seite öffnen → im Browsermenü „App installieren“ bzw. „Zum Startbildschirm“. Danach läuft sie auch offline.

## Aufbau
| Datei | Inhalt |
|---|---|
| `data.js` | Lektionen, Vokabeln, Beispielsätze – hier eigene Inhalte ergänzen |
| `app.js` | Logik: Übungen, Wiederholungssystem, Statistik, Zeitmessung |
| `style.css` | Gestaltung (hell/dunkel automatisch) |
| `manifest.json`, `sw.js`, `icon.svg` | Installierbare App / Offline-Betrieb |

## Lernprinzip
- Jede Vokabel hat Stufe 0–6. Richtig → nächste Stufe, Wiederholung nach 1, 3, 7, 14, 30, 90 Tagen.
- Fehler → zurück auf Stufe 1, kommt am nächsten Tag wieder. Im laufenden Durchgang wird sie wiederholt, bis sie sitzt.
- Ab Stufe 4 gilt eine Vokabel als „sicher“.
- Lernzeit zählt nur während eines Durchgangs und pausiert nach 90 s ohne Eingabe.

## Ablauf eines Durchgangs (10 Vokabeln)
1. Neue Vokabeln als Paare – Tippen auf das englische Wort liest es vor
2. Paare finden – richtige Paare verschwinden
3. Lernkarten: deutsches Wort → auf Englisch sagen (Spracherkennung, alternativ schreiben). Falsche kommen danach noch einmal, bis alle sitzen.
4. Alle Paare noch einmal im Überblick
5. Lückentext mit Beispielsätzen
6. Sätze laut nachsprechen (mind. 80 % der Wörter müssen erkannt werden)

Spracherkennung funktioniert in Chrome/Edge (auch auf Android) und Safari auf dem iPhone; sie braucht Internet und eine https-Adresse.

Der Lernstand liegt im Browser (localStorage). Unter *Einstellungen → Sicherung* lässt er sich exportieren und auf einem anderen Gerät laden.
