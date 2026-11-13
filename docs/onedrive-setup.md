# OneDrive anbinden

Die Anwendung legt Prüfstandards, eingehende Verträge, das Vertragsarchiv und Exporte in **einem** OneDrive-Ordner ab. Diese Anleitung verbindet diesen Ordner einmalig mit der Anwendung. Zeitbedarf: etwa 20 Minuten.

## Warum ein eigenes Konto für die App

Die Anwendung meldet sich **nicht** mit Ihrem persönlichen Microsoft-Konto an. Sie erhält ein eigenes Microsoft-Konto (z. B. `llv-vertragsmanagement@outlook.com`). Sie teilen genau einen Ordner mit diesem Konto, und die Anwendung spricht Dateien ausschliesslich über den Freigabelink dieses Ordners an.

Damit gilt:

- Die Anwendung sieht **nur den freigegebenen Ordner**, nicht Ihr übriges OneDrive, nicht Ihre E-Mails, nicht Ihre Kontakte.
- Sie müssen sich nie in der Anwendung anmelden; Ihr Passwort bleibt bei Ihnen.
- Sie können den Zugriff jederzeit selbst beenden, indem Sie die Freigabe aufheben.

Das App-Konto hat zusätzlich ein eigenes, leeres OneDrive, das ungenutzt bleibt. Teilen Sie mit dem App-Konto nichts ausser diesem einen Ordner: Was mit dem Konto geteilt ist, könnte die Anwendung grundsätzlich erreichen.

## 1. App-Konto anlegen

1. Unter <https://signup.live.com> ein neues Microsoft-Konto erstellen, z. B. `llv-vertragsmanagement@outlook.com`.
2. Ein langes, zufälliges Passwort setzen und im Passwortmanager der Organisation ablegen.
3. Zweistufige Überprüfung einschalten (<https://account.microsoft.com/security>) und Wiederherstellungsdaten hinterlegen, die der Organisation gehören (nicht einer Einzelperson).
4. Das Konto für nichts anderes verwenden.

## 2. App in Microsoft Entra registrieren

Im Microsoft Entra Admin Center (<https://entra.microsoft.com>) des Azure-Mandanten, in dem die Anwendung läuft:

1. **Identität › Anwendungen › App-Registrierungen › Neue Registrierung**
   - Name: `Vertragsmanagement OneDrive`
   - Unterstützte Kontotypen: **Nur persönliche Microsoft-Konten** («Personal Microsoft accounts only»)
   - Umleitungs-URI: Plattform **Öffentlicher Client/nativ (mobil und Desktop)**, Wert `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. **Authentifizierung › Erweiterte Einstellungen › Öffentliche Clientflows zulassen: Ja** (nötig für die Gerätecode-Anmeldung).
3. **API-Berechtigungen › Berechtigung hinzufügen › Microsoft Graph › Delegierte Berechtigungen**:
   - `Files.ReadWrite`
   - `offline_access`
   - `User.Read`

   Eine Administratorzustimmung ist nicht nötig; das App-Konto stimmt bei der ersten Anmeldung selbst zu.
4. **Kein** Geheimnis und kein Zertifikat anlegen. Die App ist ein öffentlicher Client.
5. Die **Anwendungs-ID (Client-ID)** von der Übersichtsseite kopieren.

## 3. Ordner mit dem App-Konto teilen

Mit **Ihrem eigenen** Konto in OneDrive:

1. Den Ordner anlegen oder auswählen, z. B. `LLV Vertragsmanagement`.
2. **Teilen**, die Adresse des App-Kontos eingeben, Berechtigung **Kann bearbeiten**, senden.
3. **Link kopieren** und dabei darauf achten, dass der Link nur für **bestimmte Personen** gilt (das App-Konto), nicht für «Jeder mit dem Link».

Den kopierten Link brauchen Sie in Schritt 4 und 5 als `ONEDRIVE_SHARE_URL`.

## 4. Verbindung herstellen (einmalig)

Im Projektordner:

```bash
ONEDRIVE_CLIENT_ID=<Client-ID> \
ONEDRIVE_SHARE_URL='<Freigabelink>' \
node scripts/onedrive-connect.mjs --out data/onedrive-token.json
```

1. Das Skript zeigt eine Adresse und einen Code. Öffnen Sie die Adresse, am besten in einem **privaten Browserfenster**.
2. Melden Sie sich mit dem **App-Konto** an, **nicht mit Ihrem eigenen Konto**, und bestätigen Sie die Berechtigungen.
3. Das Skript prüft danach selbst:
   - **Angemeldetes Konto:** Hier muss die Adresse des App-Kontos stehen. Steht dort Ihr eigenes Konto, die erzeugten Dateien löschen und neu beginnen.
   - **Freigegebener Ordner:** Name und Anzahl Elemente des geteilten Ordners.
4. Das Refresh-Token wird in zwei Dateien geschrieben (nur für den Eigentümer lesbar, Inhalt wird nie angezeigt):
   - `data/onedrive-token.json` für den lokalen Betrieb,
   - `data/onedrive-token.txt` nur mit dem Token, für den Upload in den Key Vault.

## 5. Anwendung konfigurieren

In jedem Fall:

| Variable | Wert |
| --- | --- |
| `STORAGE_PROVIDER` | `onedrive` |
| `ONEDRIVE_SHARE_URL` | Freigabelink aus Schritt 3 |
| `ONEDRIVE_CLIENT_ID` | Client-ID aus Schritt 2 |

**Azure (Container App):**

1. Token in den Key Vault laden und die Textdatei sofort löschen:

   ```bash
   az keyvault secret set --vault-name <vault> --name onedrive-refresh-token --file data/onedrive-token.txt
   rm data/onedrive-token.txt
   ```

2. `KEY_VAULT_URI=https://<vault>.vault.azure.net/` setzen.
3. Die verwaltete Identität der Container App braucht auf dem Key Vault die Rolle **Key Vault Secrets Officer** (lesen *und* schreiben), weil Microsoft das Token bei jeder Erneuerung austauscht und die Anwendung das neue Token zurückschreibt. Falls die Bicep-Vorlagen das nicht bereits tun, einmalig zuweisen.
4. `data/onedrive-token.json` wird in Azure nicht gebraucht und kann gelöscht werden.

**Lokal:** `KEY_VAULT_URI` leer lassen. Die Anwendung liest und schreibt dann `DATA_DIR/onedrive-token.json` (Standard: Ordner `data` im Arbeitsverzeichnis der API). Liegt die Datei aus Schritt 4 woanders, dorthin kopieren oder beim Skript `--out` entsprechend setzen. Die `.txt`-Datei löschen.

`ONEDRIVE_REFRESH_TOKEN` ist nur ein Startwert: Er wird ausschliesslich verwendet, solange Key Vault bzw. Token-Datei noch leer sind. Der Weg über das Skript ist vorzuziehen.

## Ordnerstruktur

Beim ersten Start legt die Anwendung im geteilten Ordner fehlende Unterordner an:

| Ordner | Wer schreibt | Zweck |
| --- | --- | --- |
| `Prüfstandards/` | Rechtsdienst | Word-Dokumente mit den Prüfstandards. Die Anwendung liest sie und übernimmt Änderungen automatisch. |
| `Eingang/` | Mitarbeitende | Einen Vertrag als PDF hier ablegen; die Anwendung holt ihn ab und erfasst ihn (Abfrage alle paar Minuten, `STORAGE_POLL_MINUTES`). |
| `Verträge/<Lieferant>/` | Anwendung | Archiv der erfassten und unterzeichneten Verträge, je Lieferant ein Ordner. |
| `Export/` | Anwendung | Exporte für Drittsysteme. |

Die Ordner `Verträge/` und `Export/` bitte nicht von Hand umbenennen oder umstellen.

## Gültigkeit der Anmeldung

Die Anwendung arbeitet mit einem Refresh-Token des App-Kontos. Microsoft gibt bei jeder Erneuerung ein neues Token aus; die Anwendung speichert es jedes Mal (Key Vault bzw. Token-Datei).

Ehrlich gesagt: Refresh-Tokens persönlicher Microsoft-Konten **laufen ab, wenn sie längere Zeit nicht benutzt werden** (Microsoft nennt 90 Tage; die Dauer ist nicht einstellbar). Solange die Anwendung läuft, benutzt sie das Token mehrmals täglich, weil sie die Ordner regelmässig abfragt, und hält es so frisch. Neu verbinden (Schritt 4 und 5) müssen Sie nur, wenn

- die Anwendung länger als etwa drei Monate gestoppt war,
- das Passwort des App-Kontos geändert, die Zustimmung zurückgezogen oder das Konto von Microsoft gesperrt wurde.

Die Anwendung meldet das dann mit dem Fehler `invalid_grant` und einem Hinweis auf das Skript.

Microsoft schliesst persönliche Konten nach zwei Jahren ohne Anmeldung. Ob die Nutzung durch die Anwendung als Aktivität zählt, ist nicht dokumentiert. Melden Sie sich deshalb etwa einmal im Jahr von Hand mit dem App-Konto an (z. B. auf <https://outlook.com>).

## Zugriff entziehen

Jeder der folgenden Schritte beendet den Zugriff, der erste wirkt sofort:

1. **Freigabe beenden:** In Ihrem OneDrive den Ordner wählen, **Zugriff verwalten**, das App-Konto entfernen. Die Anwendung kommt danach an keine Datei mehr heran.
2. **Zustimmung zurückziehen:** Mit dem App-Konto unter <https://account.live.com/consent/Manage> die App «Vertragsmanagement OneDrive» entfernen. Das Refresh-Token wird damit wertlos.
3. **App-Konto löschen** unter <https://account.microsoft.com>.

Anschliessend das Secret `onedrive-refresh-token` im Key Vault bzw. die Datei `onedrive-token.json` löschen.
