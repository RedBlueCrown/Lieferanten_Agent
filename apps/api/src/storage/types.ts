/**
 * The shared document folder. Locally it is a directory on disk; in production
 * it is a OneDrive folder shared with the app's own Microsoft account. Both
 * implement this interface, so the rest of the API never knows which one runs.
 *
 * Paths are relative to the shared folder, use "/" and never start with "/".
 * "" is the shared folder itself.
 *
 * Folder layout (created on first start if missing):
 *   Prüfstandards/          Word documents maintained by the legal check (Marco)
 *   Eingang/                drop a contract PDF here and it is ingested
 *   Verträge/<Lieferant>/   archived contracts, written by the app
 *   Export/                 exports for third-party systems, written by the app
 *   Vorgänge/<id>/          drafts, supplier papers and signed versions of a case
 *   Beispiele/              sample contracts for demos
 */
export interface StoreItem {
  /** Stable id from the backing store (OneDrive item id or a path hash). */
  id: string;
  path: string;
  name: string;
  isFolder: boolean;
  size?: number;
  /** ISO timestamp. */
  lastModified: string;
  /** Changes whenever the content changes. */
  eTag?: string;
  /** Link that opens the file in OneDrive / Word for the web, when available. */
  webUrl?: string;
}

export interface StoreInfo {
  kind: 'local' | 'onedrive';
  /** Human-readable label, e.g. "OneDrive › LLV Vertragsmanagement". */
  label: string;
  rootName: string;
  webUrl?: string;
}

export interface DocumentStore {
  readonly kind: 'local' | 'onedrive';
  describe(): Promise<StoreInfo>;
  /** Direct children of a folder. Missing folder → empty list. */
  list(folder: string): Promise<StoreItem[]>;
  /** Throws StoreNotFoundError when the file does not exist. */
  read(path: string): Promise<{ bytes: Uint8Array; item: StoreItem }>;
  /** Creates or replaces a file; creates missing parent folders. */
  write(path: string, bytes: Uint8Array, opts?: { contentType?: string }): Promise<StoreItem>;
  ensureFolder(path: string): Promise<void>;
  /** Moves or renames a file; creates missing parent folders of the target. */
  move(from: string, to: string): Promise<StoreItem>;
}

export class StoreNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Nicht gefunden: ${path}`);
    this.name = 'StoreNotFoundError';
  }
}

export const FOLDERS = {
  standards: 'Prüfstandards',
  inbox: 'Eingang',
  contracts: 'Verträge',
  export: 'Export',
  cases: 'Vorgänge',
  samples: 'Beispiele',
} as const;
