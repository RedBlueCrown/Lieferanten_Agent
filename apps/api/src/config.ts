/**
 * Every setting the API reads, in one place. Local development needs none of
 * them: each provider falls back to a local, Azure-free implementation.
 * The Bicep templates in /infra set the Azure values on the Container App.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const flag = (v: string | undefined, d = false) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

/** Repo root: this file lives in apps/api/src (dev) or apps/api/dist (build). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = path.resolve(env.DATA_DIR ?? path.join(repoRoot, 'data'));

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  /** Public origin of the app, used for the mock issuer and links in e-mails. */
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  dataDir,
  /** Serve the built web app from the API (single-container mode). */
  webDistDir: env.WEB_DIST_DIR ? path.resolve(env.WEB_DIST_DIR) : undefined,

  db: {
    /** postgres://… for Azure Database for PostgreSQL; empty = embedded PGlite in DATA_DIR. */
    url: env.DATABASE_URL,
    /** Passwordless login to Azure PostgreSQL with the managed identity. */
    entraAuth: flag(env.DATABASE_ENTRA_AUTH),
  },

  auth: {
    /** mock = simulated Entra ID sign-in; entra = real Microsoft Entra ID tokens. */
    mode: (env.AUTH_MODE ?? 'mock') as 'mock' | 'entra',
    tenantId: env.ENTRA_TENANT_ID,
    /** Application ID URI of the API registration, e.g. api://vertragsmanagement */
    audience: env.ENTRA_API_AUDIENCE ?? 'api://vertragsmanagement',
    spaClientId: env.ENTRA_SPA_CLIENT_ID,
  },

  ai: {
    /** mock = deterministic demo agents; azure = Azure OpenAI + Document Intelligence. */
    provider: (env.AI_PROVIDER ?? 'mock') as 'mock' | 'azure',
    openaiEndpoint: env.AZURE_OPENAI_ENDPOINT,
    openaiDeployment: env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4.1',
    openaiApiVersion: env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
    docIntelEndpoint: env.DOCINTEL_ENDPOINT,
    /** Shown in the UI so users see where their data is processed. */
    regionLabel: env.AI_REGION_LABEL ?? 'Azure Schweiz Nord',
  },

  storage: {
    /** local = folder on disk that mirrors the OneDrive layout; onedrive = shared OneDrive folder. */
    provider: (env.STORAGE_PROVIDER ?? 'local') as 'local' | 'onedrive',
    localDir: path.resolve(env.LOCAL_STORE_DIR ?? path.join(dataDir, 'onedrive')),
    onedrive: {
      /** Sharing link of the shared folder (shared with the dedicated app account). */
      shareUrl: env.ONEDRIVE_SHARE_URL,
      /** Entra app registration that allows personal Microsoft accounts. */
      clientId: env.ONEDRIVE_CLIENT_ID,
      /** Initial refresh token of the app account; rotated tokens go to the token store. */
      refreshToken: env.ONEDRIVE_REFRESH_TOKEN,
      /** Key Vault that keeps the rotating refresh token (secret onedrive-refresh-token). */
      keyVaultUri: env.KEY_VAULT_URI,
      tokenFile: path.join(dataDir, 'onedrive-token.json'),
    },
    /** Minutes between scans of the Eingang and Prüfstandards folders. */
    pollMinutes: Number(env.STORAGE_POLL_MINUTES ?? 2),
  },

  mail: {
    /** outbox = stored in the database and shown in the app; acs = Azure Communication Services. */
    provider: (env.MAIL_PROVIDER ?? 'outbox') as 'outbox' | 'acs',
    acsEndpoint: env.ACS_ENDPOINT,
    sender: env.MAIL_SENDER ?? 'DoNotReply@vertragsmanagement.local',
  },

  events: {
    /** local = signed webhooks from the API; eventgrid = Azure Event Grid topic. */
    provider: (env.EVENTS_PROVIDER ?? 'local') as 'local' | 'eventgrid',
    eventGridEndpoint: env.EVENTGRID_ENDPOINT,
  },

  audit: {
    /** Copy every audit record to an immutable Blob container as well. */
    blobContainerUrl: env.AUDIT_BLOB_CONTAINER_URL,
  },

  /** Application Insights; set automatically by the Bicep templates. */
  appInsightsConnectionString: env.APPLICATIONINSIGHTS_CONNECTION_STRING,

  /** inprocess = API runs the daily deadline job itself; external = Container Apps Job. */
  scheduler: (env.SCHEDULER ?? 'inprocess') as 'inprocess' | 'external',

  /** Override "today" for demos and tests (YYYY-MM-DD). Empty = real date. */
  today: env.APP_TODAY,
} as const;

export type Config = typeof config;
