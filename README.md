# Vertragsmanagement LLV

Lieferanten, Verträge, Fristen und rechtliche Prüfung der Liechtensteinischen Landesverwaltung an einem Ort. Feste Regeln steuern Ablauf und Fristen, KI-Agenten lesen, entwerfen und prüfen Verträge, und Menschen entscheiden an vier Haltepunkten. Jede Aktion steht in einem verketteten Audit-Protokoll.

## Wer damit arbeitet

| Person | Rolle | Startseite | Haltepunkte |
| --- | --- | --- | --- |
| **Fabian** Gassner | Projektleitung: erstellt Verträge aus den Textbausteinen oder reicht das Papier des Lieferanten ein | Meine Vorgänge, mit Fortschritt wie bei einer Sendungsverfolgung | H2 Entwurf einreichen |
| **Björn** Marxer | Lieferantenmanagement: Überblick über Lieferanten, Verträge und Fristen | Fristen, gruppiert nach Dringlichkeit, mit Entscheid direkt in der Zeile | H1 Daten bestätigen, H4 Fristentscheid |
| **Marco** Frommelt | Rechtsdienst: prüft Verträge mit dem Prüf-Agenten gegen seine Prüfstandards | Prüf-Eingang nach Prüffrist | H3 Freigeben oder nachverhandeln |

Marco pflegt seine Prüfstandards als Word-Dokumente im gemeinsamen Ordner «Prüfstandards» (je Kriterium Grün, Gelb, Rot und eine Musterformulierung). Die Anwendung liest jede Änderung ein, versioniert sie und nutzt die Musterformulierungen als Textbausteine für neue Verträge.

## Lokal starten

Voraussetzung: Node.js 22.

```bash
npm install
```

```bash
npm run dev
```

Dann <http://localhost:5173> öffnen und ein Konto wählen (Entra ID ist simuliert, ohne Passwort). Beim ersten Start lädt die API die Demodaten aus dem Prototyp: 12 Lieferanten, 18 Verträge, 7 Prüfstandards als Word-Dateien, 2 Lieferantenpapiere zur Prüfung. Alles liegt in `data/` (Datenbank und der lokale Ordner, der OneDrive nachbildet); `data/` löschen setzt die Demo zurück.

Lokal braucht es kein Azure: jeder Dienst hat einen lokalen Ersatz (Tabelle unten). Die regelbasierte Demo-KI liest den echten Text der Dokumente und ist in der Oberfläche als solche beschriftet.

### Rundgang in fünf Minuten

1. **Björn**: Fristen ansehen (fünf verpasste Kündigungstermine binden CHF 1’166’000). Unter «Erfassen» den Beispielvertrag lesen lassen und dem Erfassungs-Agenten zusehen, dann die Daten bestätigen (H1).
2. **Marco**: «Hosting Bürgerportal» öffnen, «KI-Prüfung starten». Danach Befunde übersteuern, kommentieren und zur Nachverhandlung zurückgeben (H3). Freigeben geht erst, wenn jeder rote Punkt als Ausnahme begründet ist.
3. **Fabian**: «Neuen Vertrag erstellen», Eckdaten eingeben, dem Entwurfs-Agenten zusehen. Eine Klausel ändern, die Abweichung begründen, einreichen (H2).
4. **Marco** prüft den Entwurf: unveränderte Textbausteine gelten als vorgeprüft, die KI prüft nur die Abweichung.
5. **Protokoll**: «Integrität prüfen» rechnet die Hash-Kette über alle Einträge nach.

## Wie es gebaut ist

| Pfad | Inhalt |
| --- | --- |
| [`packages/domain`](packages/domain) | Fristenlogik (rollierende Verlängerung, Kündigungsmodus, Zustellpuffer, liechtensteinische Feiertage), Ablauf mit Haltepunkten, Rollen, Ereignisse der KI-Agenten. Reiner, getesteter Code ohne KI. |
| [`apps/api`](apps/api) | Fastify-API mit OpenAPI unter `/api/docs`. Simulierte Entra ID, Audit-Protokoll, KI-Agenten als Aufträge mit Live-Ereignissen (Server-Sent Events), Ablage, Prüfstandards aus Word, Export, Webhooks. |
| [`apps/web`](apps/web) | React-Oberfläche. Die KI-Bühne zeigt live, was ein Agent tut: welche Zeile er liest, welcher Wert aus welcher Zeile stammt, welche Klausel er gegen welches Kriterium prüft. |
| [`infra`](infra), [`azure.yaml`](azure.yaml), [`Dockerfile`](Dockerfile) | Azure-Bereitstellung mit Bicep und Azure Developer CLI. |
| [`docs/konzept.md`](docs/konzept.md) | Konzept, Rollen, Ablauf, Entscheide |
| [`docs/azure-deployment.md`](docs/azure-deployment.md) | Betrieb in Azure |
| [`docs/onedrive-setup.md`](docs/onedrive-setup.md) | Gemeinsamen OneDrive-Ordner anbinden, ohne dass jemand sich anmelden muss |
| [`prototype`](prototype) | Der ursprüngliche Prototyp |

### Lokal und in Azure

| Aufgabe | Lokal | Azure (Schweiz Nord) |
| --- | --- | --- |
| Anwendung | `npm run dev` | Azure Container Apps (API und Oberfläche in einem Container) |
| Anmeldung | simulierte Entra ID | Microsoft Entra ID (`AUTH_MODE=entra`) |
| Datenbank | PGlite in `data/` | Azure Database for PostgreSQL, passwortlos mit verwalteter Identität |
| Dokumente lesen | pdf.js | Azure AI Document Intelligence |
| KI-Agenten | regelbasierte Demo-KI | Azure OpenAI, Antworten zeilenweise gestreamt und gegen ein Schema geprüft |
| Gemeinsamer Ordner | `data/onedrive` | freigegebener OneDrive-Ordner über Microsoft Graph |
| Geheimnisse | Datei in `data/` | Azure Key Vault |
| E-Mail | Benachrichtigungen in der Anwendung | Azure Communication Services |
| Ereignisse für Drittsysteme | signierte Webhooks | Azure Event Grid |
| Audit-Archiv | hash-verkettete Tabelle | zusätzlich unveränderlicher Blob Storage und Log Analytics |
| Täglicher Fristenlauf | in der API | Container Apps Job |
| Überwachung | Konsole | Application Insights |

Alle Einstellungen stehen in [`apps/api/src/config.ts`](apps/api/src/config.ts).

### Schnittstelle für Drittsysteme

Die API-Beschreibung liegt unter `/api/docs` (OpenAPI unter `/api/openapi.json`). Drittsysteme melden sich per OAuth 2.0 Client Credentials an; lokal gibt es dafür den Demo-Client `erp-connector` (Geheimnis `demo-secret-bitte-aendern`, in Produktion nur mit gesetztem `MOCK_API_CLIENT_SECRET`). Daten fliessen in beide Richtungen: Verträge, Dokumente und Lieferanten hinein (`POST /api/v1/contracts`, `POST /api/v1/documents`, `PUT /api/v1/suppliers/by-ref/{system}/{id}`), Verträge, Fristen, Kalender und Exporte hinaus, dazu Ereignisse über Webhooks oder Event Grid und Dateien im Ordner «Export».

## Prüfen

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

## In Azure bereitstellen

Siehe [docs/azure-deployment.md](docs/azure-deployment.md). Kurz: `azd auth login`, `azd env new`, `azd up`. Vor dem ersten Deployment die Verfügbarkeit des KI-Modells in Schweiz Nord prüfen (dort beschrieben).

## Skills für Claude Code

- **hallmark** (MIT, [Nutlope/hallmark](https://github.com/Nutlope/hallmark), Stand `04977e1`): Design-Regeln gegen generisch wirkende Oberflächen; die Oberfläche folgt den Regeln für App-Bildschirme.
- **pick-ui-library** (MIT, [emilkowalski/skills](https://github.com/emilkowalski/skills), Stand `f7ce8c0`): Auswahl der Bibliotheken (base-ui, Sonner, cmdk, recharts, zustand, clsx).
