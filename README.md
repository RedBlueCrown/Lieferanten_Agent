# Vertragsmanagement

Anwendung für Lieferanten- und Vertragsmanagement mit drei Rollen: Vertragsmanagement (Einkauf), Projektleitung und Rechtsdienst. Feste Regeln steuern Ablauf und Fristen, KI-Agenten lesen, entwerfen und prüfen Verträge, Menschen entscheiden an vier Haltepunkten.

## Inhalt

| Pfad | Was |
| --- | --- |
| [`docs/konzept.md`](docs/konzept.md) | Verbesserungen, Rollen, Ablauf, Architektur, API und Etappen |
| [`prototype/Vertragsmanagement_offline.html`](prototype/Vertragsmanagement_offline.html) | Prototyp v0.9.0, läuft offline im Browser |
| [`prototype/src/`](prototype/src/), [`prototype/styles/`](prototype/styles/) | Quelltexte des Prototyps, entpackt zum Lesen |
| [`.claude/skills/`](.claude/skills/) | Design-Skills für Claude Code: `hallmark` und `pick-ui-library` |

## Prototyp ansehen

`prototype/Vertragsmanagement_offline.html` im Browser öffnen. Die Rolle wechselt man oben rechts; «Demodaten zurücksetzen» in der Fusszeile stellt den Ausgangszustand her. Ohne KI-Dienst zeigt der Prototyp vorbereitete Beispielergebnisse.

## Skills

- **hallmark** (MIT, [Nutlope/hallmark](https://github.com/Nutlope/hallmark), Stand `04977e1`): Design-Regeln gegen generisch wirkende Oberflächen; `/hallmark audit <pfad>` oder `/hallmark redesign <pfad>`.
- **pick-ui-library** (MIT, [emilkowalski/skills](https://github.com/emilkowalski/skills), Stand `f7ce8c0`): wählt Bibliotheken für Aufgaben in der Oberfläche; wird nur auf ausdrücklichen Aufruf aktiv.
