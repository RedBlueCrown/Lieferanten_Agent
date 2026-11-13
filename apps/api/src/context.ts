import { todayIso } from '@vm/domain';
import { createAiProvider, type AiProvider } from './ai';
import { AuditLog } from './audit';
import { config } from './config';
import { openDb, type Db } from './db';
import { JobHub } from './jobs';
import { EventsService } from './services/events';
import { Notifier } from './services/notify';
import { Repo } from './services/repo';
import { StandardsService } from './services/standards';
import { createStore } from './storage';
import type { DocumentStore } from './storage/types';

export interface Services {
  db: Db;
  audit: AuditLog;
  jobs: JobHub;
  store: DocumentStore;
  ai: AiProvider;
  repo: Repo;
  standards: StandardsService;
  notify: Notifier;
  events: EventsService;
  today(): string;
}

export async function createServices(): Promise<Services> {
  const db = await openDb();
  const audit = new AuditLog(db);
  await audit.init();
  const store = await createStore();
  const services: Services = {
    db,
    audit,
    jobs: new JobHub(db, audit),
    store,
    ai: createAiProvider(),
    repo: new Repo(db),
    standards: new StandardsService(db, store, audit),
    notify: new Notifier(db),
    events: new EventsService(db),
    today: () => todayIso(config.today),
  };
  return services;
}
