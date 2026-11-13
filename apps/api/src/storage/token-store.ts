/**
 * Keeps the refresh token of the dedicated OneDrive app account.
 *
 * Microsoft rotates refresh tokens on every use, so the store is written after
 * every refresh. Locally the token lives in a JSON file (mode 0600); in Azure it
 * lives in Key Vault (secret "onedrive-refresh-token"), read and written with
 * the Container App's managed identity.
 *
 * Nothing in here ever logs or returns a token in an error message.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SecretClient } from '@azure/keyvault-secrets';
import type { Config } from '../config';

export interface TokenStore {
  load(): Promise<string | undefined>;
  save(refreshToken: string): Promise<void>;
}

export const KEY_VAULT_SECRET_NAME = 'onedrive-refresh-token';

/** JSON file `{ "refreshToken": "…", "updatedAt": "…" }`, readable by the owner only. */
export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<string | undefined> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error(`Token-Datei ${this.filePath} kann nicht gelesen werden: ${(err as Error).message}`);
    }
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    if (!trimmed.startsWith('{')) return trimmed; // a file with only the raw token is accepted too
    try {
      const data = JSON.parse(trimmed) as { refreshToken?: unknown };
      return typeof data.refreshToken === 'string' && data.refreshToken ? data.refreshToken : undefined;
    } catch {
      throw new Error(`Token-Datei ${this.filePath} ist kein gültiges JSON.`);
    }
  }

  async save(refreshToken: string): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const body = JSON.stringify({ refreshToken, updatedAt: new Date().toISOString() }, null, 2) + '\n';
    // Write to a fresh temp file (created with 0600) and rename it over the old
    // one, so a crash never leaves a half-written token behind.
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, body, { mode: 0o600, flag: 'wx' });
      await fs.chmod(tmp, 0o600);
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw new Error(`Token-Datei ${this.filePath} kann nicht geschrieben werden: ${(err as Error).message}`);
    }
  }
}

/** Key Vault secret, accessed with DefaultAzureCredential (managed identity in Azure). */
export class KeyVaultTokenStore implements TokenStore {
  private client?: Promise<SecretClient>;

  constructor(
    private readonly vaultUri: string,
    private readonly secretName = KEY_VAULT_SECRET_NAME,
    clientFactory?: () => SecretClient | Promise<SecretClient>,
  ) {
    if (clientFactory) this.client = Promise.resolve(clientFactory());
  }

  /** The Azure SDKs are loaded lazily, so local development never pulls them in. */
  private getClient(): Promise<SecretClient> {
    this.client ??= (async () => {
      const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
        import('@azure/keyvault-secrets'),
        import('@azure/identity'),
      ]);
      return new SecretClient(this.vaultUri, new DefaultAzureCredential());
    })();
    return this.client;
  }

  async load(): Promise<string | undefined> {
    const client = await this.getClient();
    try {
      const secret = await client.getSecret(this.secretName);
      return secret.value?.trim() || undefined;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode === 404 || e.code === 'SecretNotFound') return undefined;
      throw new Error(`Key Vault: Secret ${this.secretName} kann nicht gelesen werden (${e.code ?? e.statusCode ?? 'Fehler'}).`);
    }
  }

  async save(refreshToken: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.setSecret(this.secretName, refreshToken, { contentType: 'text/plain' });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string };
      throw new Error(`Key Vault: Secret ${this.secretName} kann nicht geschrieben werden (${e.code ?? e.statusCode ?? 'Fehler'}).`);
    }
  }
}

type OneDriveSettings = Pick<Config['storage']['onedrive'], 'keyVaultUri' | 'tokenFile'>;

/**
 * Key Vault when KEY_VAULT_URI is set, else the token file in DATA_DIR.
 * The initial token from ONEDRIVE_REFRESH_TOKEN is not handled here: the
 * OneDrive store uses it only while this store is still empty.
 */
export function createTokenStore(cfg: { storage: { onedrive: OneDriveSettings } }): TokenStore {
  const { keyVaultUri, tokenFile } = cfg.storage.onedrive;
  return keyVaultUri ? new KeyVaultTokenStore(keyVaultUri) : new FileTokenStore(tokenFile);
}
