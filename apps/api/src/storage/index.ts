import { config } from '../config';
import { LocalFolderStore } from './local';
import { FOLDERS, type DocumentStore } from './types';

export async function createStore(): Promise<DocumentStore> {
  let store: DocumentStore;
  if (config.storage.provider === 'onedrive') {
    const { createOneDriveStore } = await import('./onedrive');
    store = createOneDriveStore(config);
  } else {
    store = new LocalFolderStore(config.storage.localDir);
  }
  for (const f of Object.values(FOLDERS)) await store.ensureFolder(f);
  return store;
}

export { FOLDERS };
export type { DocumentStore };
