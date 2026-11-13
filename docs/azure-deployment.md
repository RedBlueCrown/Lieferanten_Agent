# Betrieb in Azure (Pilot)

Ein `azd up` legt die ganze Umgebung in der Region **Schweiz Nord** (`switzerlandnorth`) an und stellt die Anwendung bereit. Die Anwendung meldet sich bei allen Azure-Diensten **ohne Passwort** an: eine verwaltete Identität, Rollen (RBAC), lokale Schlüssel wo möglich abgeschaltet. In den App-Einstellungen stehen keine Schlüssel und keine Verbindungszeichenfolgen mit Geheimnissen.

Vorlagen: [`infra/`](../infra) (Bicep), [`azure.yaml`](../azure.yaml) (Azure Developer CLI), [`Dockerfile`](../Dockerfile), Workflows in [`.github/workflows/`](../.github/workflows).

## Architektur

| Dienst | Zweck |
| --- | --- |
| Azure Container Apps, App `ca-api-…` | API und Weboberfläche in **einem** Container (Port 3000, nur HTTPS). Health-Probe `GET /api/health`. |
| Container Apps Job `caj-daily-…` | Täglicher Fristenlauf, `0 5 * * *` UTC. Gleiches Image, gleiche Einstellungen, gleiche Identität. |
| Verwaltete Identität `id-…` | Eine Identität für App und Job; alle Berechtigungen hängen an ihr. |
| Azure Container Registry (Basic) | Container-Images. Gebaut wird in der Registry (ACR Tasks), also ebenfalls in Schweiz Nord. |
| Azure Database for PostgreSQL 16 (Flexible Server, B1ms, 32 GB) | Datenbank `vertragsmanagement`. Anmeldung nur mit Entra ID; die Identität der App ist Entra-Administrator. |
| Azure OpenAI | KI-Agenten (Deployment `gpt-4.1`, Typ Standard = Verarbeitung in der Region). |
| Azure AI Document Intelligence | Text und Struktur aus PDF-Verträgen. |
| Azure Communication Services + E-Mail | Benachrichtigungen per E-Mail, Datenstandort Schweiz, Absender `DoNotReply@…azurecomm.net`. |
| Event Grid Topic (CloudEvents 1.0) | Ereignisse für Drittsysteme; diese abonnieren das Topic. |
| Storage Account, Container `audit-archive` | Unveränderliches Audit-Archiv (WORM), siehe unten. |
| Key Vault | Refresh-Token für OneDrive (Secret `onedrive-refresh-token`). |
| Log Analytics + Application Insights | Logs, Telemetrie, Audit-Logs von Key Vault, Storage und KI-Diensten. |
| API Management (Consumption, optional) | API-Gateway mit Abonnementschlüsseln für Drittsysteme. |

Rollen der Identität: AcrPull (Registry), Key Vault Secrets Officer (liest und schreibt das rotierende Token), Storage Blob Data Contributor (nur `audit-archive`), Cognitive Services OpenAI User, Cognitive Services User (Document Intelligence), EventGrid Data Sender, Communication and Email Service Owner (E-Mail-Versand mit Entra ID), Monitoring Metrics Publisher (Application Insights).

### Warum eine Container App in Schweiz Nord

- **Alle Daten und aller Verkehr bleiben in Schweiz Nord.** Mit Azure Static Web Apps wäre die Oberfläche global verteilt worden, und verknüpfte Backends laufen in Schweiz Nord nicht.
- **Ein Container, ein Ursprung.** Die API liefert die gebaute Oberfläche aus (`WEB_DIST_DIR`). Kein CORS, ein Zertifikat, ein Deployment.
- **Genau eine Instanz im Pilot** (min. und max. 1 Replik). Der Fortschritt laufender KI-Aufträge wird per Server-Sent Events aus dem Arbeitsspeicher gestreamt. Für mehrere Repliken braucht es zuerst einen gemeinsamen Ereignisbus (z. B. PostgreSQL `LISTEN/NOTIFY`).

## Voraussetzungen

- Azure-Abonnement mit der Rolle **Besitzer** oder **Mitwirkender + Administrator für rollenbasierte Zugriffssteuerung** (die Vorlagen legen Rollenzuweisungen an).
- [Azure Developer CLI](https://aka.ms/azd) (`azd`). Docker ist nicht nötig, das Image wird in der Registry gebaut; ohne ACR Tasks baut `azd` lokal mit Docker.
- Optional die [Azure CLI](https://aka.ms/azcli) (`az`): Ein Hook stellt damit nach jedem `azd deploy` auch den täglichen Job auf das neue Image um. Ohne `az` geschieht das beim nächsten `azd provision`.
- **Modellverfügbarkeit prüfen.** Nur der Bereitstellungstyp **Standard** verarbeitet in der Region des Kontos; `DataZoneStandard` und `GlobalStandard` können ausserhalb der Schweiz verarbeiten. Das Angebot für Schweiz Nord hat sich 2026 mehrfach geändert. Vor dem ersten Deployment:

  ```bash
  az cognitiveservices model list --location switzerlandnorth \
    --query "[?model.name=='gpt-4.1'].{version:model.version, skus:model.skus[].name}" -o table
  ```

  Fehlt `Standard`, ein anderes Modell wählen (`AZURE_OPENAI_MODEL`, `AZURE_OPENAI_MODEL_VERSION`) oder das OpenAI-Konto in Schweiz West anlegen (`AZURE_OPENAI_LOCATION=switzerlandwest`). Die Anzeige in der App (`AI_REGION_LABEL`) passt sich an. Ein anderer Typ als Standard nur nach Freigabe durch Datenschutz und Rechtsdienst.

## Erstes Deployment

```bash
azd auth login
azd env new vm-pilot
azd env set AZURE_LOCATION switzerlandnorth
# Solange AUTH_MODE=mock gilt, den Zugriff auf das LLV-Netz beschränken:
azd env set ALLOWED_IP_RANGES "203.0.113.0/24,198.51.100.7"
azd up
```

Im Modus `mock` kann sich jede Person ohne Passwort mit einer Demo-Rolle anmelden, und der Demo-Client für Drittsysteme hat ein bekanntes Geheimnis. Ohne IP-Filter ist der Pilot damit öffentlich nutzbar.

`azd up` fragt nach dem Abonnement, legt die Ressourcengruppe `rg-vm-pilot` an, baut das Image und gibt am Ende die Adresse der App aus. Alle Ausgaben (Endpunkte, Namen) zeigt `azd env get-values`.

Danach:

| Befehl | Wirkung |
| --- | --- |
| `azd deploy` | Neue App-Version (Image bauen und ausrollen). |
| `azd provision` | Infrastruktur und Einstellungen anwenden, z. B. nach `azd env set …`. |
| `azd up` | Beides. |
| `azd down` | Alles löschen (siehe Audit-Archiv). |

Beim allerersten `azd provision` läuft noch ein Platzhalter-Image; `azd deploy` ersetzt es. Spätere `azd provision` behalten das ausgerollte Image.

### Einstellungen (`azd env set NAME wert`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `AUTH_MODE` | `mock` | `mock` = simulierte Anmeldung, `entra` = Microsoft Entra ID. |
| `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE`, `ENTRA_SPA_CLIENT_ID` | leer | Für `AUTH_MODE=entra`, siehe unten. Leere Mandanten-ID = Mandant des Abonnements. |
| `ALLOWED_IP_RANGES` | leer | Kommagetrennte IP-Bereiche, die die App erreichen dürfen. Leer = offen. |
| `STORAGE_PROVIDER` | `local` | `local` oder `onedrive`, siehe unten. |
| `ONEDRIVE_SHARE_URL`, `ONEDRIVE_CLIENT_ID` | leer | Für `STORAGE_PROVIDER=onedrive`. |
| `STORAGE_POLL_MINUTES` | `2` | Abfrageintervall der OneDrive-Ordner. |
| `AZURE_OPENAI_MODEL`, `AZURE_OPENAI_MODEL_VERSION` | `gpt-4.1`, `2025-04-14` | Modell des Deployments. |
| `AZURE_OPENAI_SKU`, `AZURE_OPENAI_CAPACITY` | `Standard`, `50` | Bereitstellungstyp und Kontingent in 1000 Tokens pro Minute. |
| `AZURE_OPENAI_LOCATION` | leer (= Schweiz Nord) | Region des OpenAI-Kontos. |
| `AUDIT_RETENTION_DAYS` | `3650` | Aufbewahrung im Audit-Archiv (Tage). |
| `KEY_VAULT_PURGE_PROTECTION` | `false` | Löschschutz des Key Vault (nicht umkehrbar). |
| `DAILY_JOB_CRON` | `0 5 * * *` | Zeitplan des Fristenlaufs (UTC). |
| `DEPLOY_APIM`, `APIM_PUBLISHER_EMAIL` | `false`, leer | API Management, siehe unten. |

## Anmeldung mit Entra ID (`AUTH_MODE=entra`)

Im Entra Admin Center zwei App-Registrierungen anlegen:

1. **API** (`Vertragsmanagement API`, nur dieser Mandant)
   - Anwendungs-ID-URI: `api://vertragsmanagement` (oder eigene, dann in `ENTRA_API_AUDIENCE` eintragen).
   - Bereich (Scope) `access_as_user` freigeben.
   - App-Rollen (Mitgliedstyp Benutzer/Gruppen), der **Wert** muss genau so lauten:

     | Anzeigename | Wert |
     | --- | --- |
     | Projektleitung | `Vertragsmanagement.Projektleitung` |
     | Lieferantenmanagement | `Vertragsmanagement.Lieferantenmanagement` |
     | Rechtsdienst | `Vertragsmanagement.Rechtsdienst` |

     Für Drittsysteme zusätzlich `Vertragsmanagement.Api.ReadWrite` (bzw. `Vertragsmanagement.Api.Read` nur lesend) mit Mitgliedstyp Anwendungen.
   - Unter **Unternehmensanwendungen › Eigenschaften** «Zuweisung erforderlich» einschalten und unter «Benutzer und Gruppen» die Rollen zuweisen.
2. **Weboberfläche** (`Vertragsmanagement Web`)
   - Plattform **Single-Page-Anwendung**, Umleitungs-URI = Adresse der App (`SERVICE_APP_ENDPOINT_URL`).
   - API-Berechtigung: delegiert `access_as_user` der API, Administratorzustimmung erteilen.

Dann:

```bash
azd env set AUTH_MODE entra
azd env set ENTRA_TENANT_ID <Mandanten-ID>
azd env set ENTRA_API_AUDIENCE api://vertragsmanagement
azd env set ENTRA_SPA_CLIENT_ID <Client-ID der Weboberfläche>
azd provision
```

## Ablage auf OneDrive (`STORAGE_PROVIDER=onedrive`)

Mit `local` liegen die Dateien im Container unter `/tmp/data` und gehen bei jedem Neustart und jeder neuen Version verloren. Das taugt nur für Vorführungen.

Für den Pilotbetrieb OneDrive anbinden, wie in [onedrive-setup.md](onedrive-setup.md) beschrieben (App-Konto, App-Registrierung, Freigabe, Skript). Wer `azd` ausführt, erhält auf dem Key Vault die Rolle Key Vault Secrets Officer und kann das Token hochladen:

```bash
az keyvault secret set --vault-name "$(azd env get-value AZURE_KEY_VAULT_NAME)" \
  --name onedrive-refresh-token --file data/onedrive-token.txt
rm data/onedrive-token.txt

azd env set STORAGE_PROVIDER onedrive
azd env set ONEDRIVE_SHARE_URL '<Freigabelink>'
azd env set ONEDRIVE_CLIENT_ID <Client-ID>
azd provision
```

`KEY_VAULT_URI` setzen die Vorlagen selbst. Das Secret wird von Bicep nie angelegt oder überschrieben, weil die App das Token bei jeder Erneuerung selbst ersetzt.

## Täglicher Fristenlauf

Der Container Apps Job `caj-daily-…` startet täglich um 05:00 UTC (06:00 Uhr Winterzeit, 07:00 Uhr Sommerzeit) `node apps/api/dist/jobs/daily.mjs`. Die App läuft deshalb mit `SCHEDULER=external` und plant den Lauf nicht selbst. Ein Lauf darf höchstens 30 Minuten dauern und wird bei einem Fehler einmal wiederholt.

```bash
az containerapp job start -n <Job> -g <Ressourcengruppe>            # sofort ausführen
az containerapp job execution list -n <Job> -g <Ressourcengruppe> -o table
```

## Audit-Archiv

Jeder Audit-Eintrag wird zusätzlich als JSON-Datei in den Container `audit-archive` geschrieben (Anmeldung nur mit Entra ID, Kontoschlüssel abgeschaltet). Der Container hat eine **zeitbasierte Aufbewahrungsrichtlinie** (WORM) über `AUDIT_RETENTION_DAYS` Tage: Einträge lassen sich in dieser Zeit weder ändern noch löschen.

**Im Pilot ist die Richtlinie nicht gesperrt.** Ein Administrator kann sie verkürzen oder entfernen, sie ist also noch keine Compliance-Garantie. Für den Produktivbetrieb sperren:

```bash
az storage container immutability-policy show --account-name <st…> --container-name audit-archive   # etag ablesen
az storage container immutability-policy lock --account-name <st…> --container-name audit-archive --if-match <etag>
```

Das Sperren ist **endgültig**: Danach lässt sich die Frist nur noch verlängern, und Container, Storage Account und Ressourcengruppe können bis zum Ablauf der Frist nicht gelöscht werden (auch nicht mit `azd down`).

## API Management (optional)

```bash
azd env set DEPLOY_APIM true
azd env set APIM_PUBLISHER_EMAIL <Adresse>
azd provision
```

API Management importiert die Schnittstelle von `/api/openapi.json` der laufenden App. Es wird deshalb erst angelegt, wenn die App einmal ausgerollt ist. Mit `ALLOWED_IP_RANGES` muss die ausgehende Adresse von API Management zugelassen sein.

## GitHub Actions

- **`ci.yml`** (Push auf `main`, Pull Requests): `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, dazu Image-Build und Bicep-Prüfung.
- **`deploy.yml`** (nur manuell): Anmeldung per OpenID Connect, dann `azd provision` und `azd deploy`.

Einrichtung für `deploy.yml`:

1. App-Registrierung oder verwaltete Identität mit **föderierten Anmeldeinformationen** für GitHub (Entität: Branch `main`, Subject `repo:<org>/<repo>:ref:refs/heads/main`). Kein Client-Geheimnis.
2. Rollen auf dem Abonnement: Mitwirkender + Administrator für rollenbasierte Zugriffssteuerung.
3. Repository-Variablen: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION=switzerlandnorth`.
4. **Wichtig:** Alle Einstellungen aus der Tabelle oben, die lokal per `azd env set` gesetzt sind (z. B. `AUTH_MODE`, `STORAGE_PROVIDER`, `ONEDRIVE_*`, `ALLOWED_IP_RANGES`), ebenfalls als Repository-Variablen setzen. Sonst setzt der Workflow sie auf die Standardwerte zurück.

## Pilot und Produktion

| Thema | Pilot (diese Vorlagen) | Für den Produktivbetrieb |
| --- | --- | --- |
| Netzwerk | Öffentliche Endpunkte mit TLS und Entra ID; PostgreSQL mit der Regel «Azure-Dienste zulassen». | Container-Apps-Umgebung im VNet, Private Endpoints für PostgreSQL, Storage, Key Vault, OpenAI, Document Intelligence, Event Grid; öffentlichen Zugriff abschalten. Registry dafür auf Premium. |
| Anmeldung | `mock` mit IP-Filter. | `entra`. |
| Skalierung | 1 Replik, keine Zonenredundanz. | Gemeinsamer Ereignisbus für SSE, dann mehrere Repliken; zonenredundante Umgebung. |
| Audit-Archiv | Richtlinie nicht gesperrt, ZRS. | Richtlinie sperren; GZRS (Zweitkopie in Schweiz West). |
| Datenbank | B1ms, 7 Tage Sicherung, keine Hochverfügbarkeit, keine Geo-Sicherung. | General Purpose, zonenredundante Hochverfügbarkeit, Geo-Sicherung (Schweiz West), Wiederherstellung regelmässig üben. |
| Key Vault | Ohne Löschschutz. | `KEY_VAULT_PURGE_PROTECTION=true`. |
| E-Mail | Azure-verwaltete Domain mit tiefen Sendelimits. | Eigene Absenderdomain (z. B. Subdomain der LLV) mit SPF und DKIM. |
| Telemetrie | Application Insights mit Verbindungszeichenfolge (enthält kein Geheimnis). | Lokale Authentifizierung abschalten; die App sendet dann mit ihrer Identität (Rolle ist bereits zugewiesen). |
| Dokumentablage | `local` ist flüchtig. | `onedrive`. |

Kosten sind hier bewusst nicht aufgeführt; massgebend ist der Azure-Preisrechner für Schweiz Nord.
