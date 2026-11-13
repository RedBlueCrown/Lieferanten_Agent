/**
 * A folder on disk with the same layout as the shared OneDrive folder.
 * Used for local development and demos; the seed fills it with sample files.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../util';
import { type DocumentStore, type StoreInfo, type StoreItem, StoreNotFoundError } from './types';

export class LocalFolderStore implements DocumentStore {
  readonly kind = 'local' as const;

  constructor(private readonly root: string) {}

  private abs(p: string): string {
    const clean = p.replace(/^\/+/, '');
    const full = path.resolve(this.root, clean);
    if (!full.startsWith(path.resolve(this.root))) throw new Error('Pfad ausserhalb des Ordners');
    return full;
  }

  private async item(rel: string): Promise<StoreItem> {
    const st = await fs.stat(this.abs(rel));
    const name = path.posix.basename(rel) || path.basename(this.root);
    return {
      id: sha256(rel).slice(0, 16),
      path: rel,
      name,
      isFolder: st.isDirectory(),
      size: st.isDirectory() ? undefined : st.size,
      lastModified: st.mtime.toISOString(),
      eTag: `${st.size}-${st.mtimeMs}`,
    };
  }

  async describe(): Promise<StoreInfo> {
    return { kind: 'local', label: 'Lokaler Ordner (Demo für OneDrive)', rootName: path.basename(this.root) };
  }

  async list(folder: string): Promise<StoreItem[]> {
    const dir = this.abs(folder);
    if (!existsSync(dir)) return [];
    const names = (await fs.readdir(dir)).filter((n) => !n.startsWith('.') && !n.startsWith('~$'));
    const items = await Promise.all(names.map((n) => this.item(folder ? `${folder}/${n}` : n)));
    return items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, 'de'));
  }

  async read(p: string) {
    const full = this.abs(p);
    if (!existsSync(full)) throw new StoreNotFoundError(p);
    return { bytes: new Uint8Array(await fs.readFile(full)), item: await this.item(p) };
  }

  async write(p: string, bytes: Uint8Array): Promise<StoreItem> {
    const full = this.abs(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    return this.item(p);
  }

  async ensureFolder(p: string): Promise<void> {
    await fs.mkdir(this.abs(p), { recursive: true });
  }

  async move(from: string, to: string): Promise<StoreItem> {
    const src = this.abs(from);
    if (!existsSync(src)) throw new StoreNotFoundError(from);
    const dst = this.abs(to);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return this.item(to);
  }
}
