#!/usr/bin/env node
/**
 * One-time setup: connects the app's own Microsoft account to the shared
 * OneDrive folder and stores its refresh token.
 *
 *   ONEDRIVE_CLIENT_ID=… ONEDRIVE_SHARE_URL=… node scripts/onedrive-connect.mjs [--out data/onedrive-token.json]
 *
 * Uses the OAuth 2.0 device code flow against the "consumers" authority
 * (personal Microsoft accounts). Sign in with the DEDICATED APP ACCOUNT,
 * not with your own account. Tokens are never printed.
 *
 * Writes two files, both mode 0600:
 *   <out>          JSON for the app's FileTokenStore (local operation)
 *   <out base>.txt the raw refresh token only, for `az keyvault secret set --file`
 *                  (delete it right after the upload)
 *
 * Plain Node 22, no dependencies. See docs/onedrive-setup.md.
 */
import fs from 'node:fs';
import path from 'node:path';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'Files.ReadWrite offline_access User.Read';
const SECRET_NAME = 'onedrive-refresh-token';

// ------------------------------------------------------------------ arguments

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Verwendung: ONEDRIVE_CLIENT_ID=… ONEDRIVE_SHARE_URL=… node scripts/onedrive-connect.mjs [--out data/onedrive-token.json]\n' +
      'Optional: KEY_VAULT_URI=https://<vault>.vault.azure.net/ für den fertigen az-Befehl.',
  );
  process.exit(0);
}
const outIdx = args.indexOf('--out');
const outFile = path.resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'data/onedrive-token.json');
let txtFile = outFile.replace(/\.json$/i, '') + '.txt';
if (txtFile === outFile) txtFile = outFile + '.raw.txt';

const clientId = process.env.ONEDRIVE_CLIENT_ID?.trim();
const shareUrl = process.env.ONEDRIVE_SHARE_URL?.trim();
if (!clientId || !shareUrl) {
  fail('ONEDRIVE_CLIENT_ID und ONEDRIVE_SHARE_URL müssen gesetzt sein (siehe docs/onedrive-setup.md).');
}

// ------------------------------------------------------------------ helpers

function fail(msg) {
  console.error(`\nFehler: ${msg}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Only the first line of error_description (the rest is trace and correlation ids). */
const describeError = (data) => `${data.error ?? 'unbekannt'}: ${(data.error_description ?? '').split(/\r?\n/)[0]}`;

async function graphGet(pathname, accessToken, headers = {}) {
  const res = await fetch(GRAPH + pathname, { headers: { Authorization: `Bearer ${accessToken}`, ...headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error?.code ?? res.status;
    const message = data.error?.message ?? res.statusText;
    throw new Error(`Graph ${res.status} ${code}: ${message}`);
  }
  return data;
}

const encodeSharingUrl = (url) => 'u!' + Buffer.from(url, 'utf8').toString('base64url').replace(/=+$/, '');

function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.rmSync(file, { force: true }); // so the new file is created with mode 0600
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// ------------------------------------------------------------------ 1. device code

console.log('OneDrive verbinden (Gerätecode-Anmeldung, persönliche Microsoft-Konten)\n');
const { res: dcRes, data: dc } = await postForm(`${AUTHORITY}/devicecode`, { client_id: clientId, scope: SCOPES });
if (!dcRes.ok || !dc.device_code) {
  fail(
    `Gerätecode konnte nicht angefordert werden (${describeError(dc)}).\n` +
      'Prüfen Sie die Client-ID, «Persönliche Microsoft-Konten» als Kontotyp und «Öffentliche Clientflows zulassen» in der App-Registrierung.',
  );
}

console.log('='.repeat(72));
console.log(`  1. Öffnen Sie ${dc.verification_uri}`);
console.log(`  2. Geben Sie den Code ein:  ${dc.user_code}`);
console.log('  3. Melden Sie sich mit dem APP-KONTO an (z. B. llv-vertragsmanagement@outlook.com),');
console.log('     NICHT mit Ihrem eigenen Microsoft-Konto. Am besten in einem privaten Browserfenster.');
console.log('  4. Bestätigen Sie die angefragten Berechtigungen.');
console.log('='.repeat(72));
console.log(`Warte auf die Anmeldung (Code gültig für ${Math.round((dc.expires_in ?? 900) / 60)} Minuten) …`);

// ------------------------------------------------------------------ 2. poll for tokens

let interval = Number(dc.interval) || 5;
const deadline = Date.now() + (Number(dc.expires_in) || 900) * 1000;
let tokens;
while (!tokens) {
  if (Date.now() > deadline) fail('Der Code ist abgelaufen. Bitte das Skript erneut starten.');
  await sleep(interval * 1000);
  const { res, data } = await postForm(`${AUTHORITY}/token`, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: dc.device_code,
  });
  if (res.ok && data.access_token) {
    tokens = data;
    break;
  }
  switch (data.error) {
    case 'authorization_pending':
      break;
    case 'slow_down':
      interval += 5;
      break;
    case 'expired_token':
    case 'code_expired':
      fail('Der Code ist abgelaufen. Bitte das Skript erneut starten.');
      break;
    case 'authorization_declined':
    case 'access_denied':
      fail('Die Anmeldung wurde abgelehnt.');
      break;
    default:
      fail(`Anmeldung fehlgeschlagen (${describeError(data)}).`);
  }
}
if (!tokens.refresh_token) fail('Kein Refresh-Token erhalten. Ist «offline_access» in der App-Registrierung erlaubt?');
console.log('Anmeldung erfolgreich.\n');

// ------------------------------------------------------------------ 3. check account and folder

let me;
try {
  me = await graphGet('/me', tokens.access_token);
} catch (err) {
  fail(`Konto konnte nicht gelesen werden: ${err.message}`);
}
const account = me.mail || me.userPrincipalName || '(unbekannt)';
console.log(`Angemeldetes Konto: ${account}${me.displayName ? ` (${me.displayName})` : ''}`);
console.log('  → Das muss das APP-KONTO sein. Falls hier Ihr eigenes Konto steht: Dateien löschen, abmelden, neu starten.\n');

let folderName;
try {
  const item = await graphGet(`/shares/${encodeSharingUrl(shareUrl)}/driveItem`, tokens.access_token, {
    Prefer: 'redeemSharingLink',
  });
  const remote = item.remoteItem;
  const folder = item.folder ?? remote?.folder;
  if (!folder) fail('Der Freigabelink zeigt auf eine Datei, nicht auf einen Ordner.');
  const driveId = remote?.parentReference?.driveId ?? item.parentReference?.driveId;
  const rootId = remote?.id ?? item.id;
  folderName = item.name || remote?.name;
  let count = folder.childCount;
  if (typeof count !== 'number' && driveId && rootId) {
    const children = await graphGet(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootId)}/children?$top=200`, tokens.access_token);
    count = children.value?.length ?? 0;
  }
  console.log(`Freigegebener Ordner: ${folderName} (${count ?? '?'} Elemente)`);
} catch (err) {
  fail(
    `Der Freigabelink ist für dieses Konto nicht erreichbar: ${err.message}\n` +
      'Ist der Ordner mit genau diesem Konto geteilt (Berechtigung «Kann bearbeiten»)?',
  );
}

// ------------------------------------------------------------------ 4. store the refresh token

const updatedAt = new Date().toISOString();
writePrivate(outFile, JSON.stringify({ refreshToken: tokens.refresh_token, updatedAt, account, folder: folderName }, null, 2) + '\n');
writePrivate(txtFile, tokens.refresh_token); // no trailing newline: az would store it as part of the secret

const vaultFromUri = process.env.KEY_VAULT_URI?.match(/^https:\/\/([^.]+)\.vault\./)?.[1];
const vault = vaultFromUri ?? '<vault>';

console.log('\nRefresh-Token gespeichert (Dateirechte 0600, Inhalt wird nicht angezeigt):');
console.log(`  ${outFile}`);
console.log(`  ${txtFile}`);
console.log('\nLokal: Die App liest DATA_DIR/onedrive-token.json. Liegt die Datei woanders, kopieren Sie sie dorthin.');
console.log('\nAzure: Token in den Key Vault laden und die .txt-Datei danach löschen:');
console.log(`  az keyvault secret set --vault-name ${vault} --name ${SECRET_NAME} --file "${txtFile}"`);
console.log(`  rm "${txtFile}"`);
console.log('\nFertig. Setzen Sie STORAGE_PROVIDER=onedrive, ONEDRIVE_SHARE_URL und ONEDRIVE_CLIENT_ID (siehe docs/onedrive-setup.md).');
