import { config } from './config';
import { buildApp } from './app';
import { createServices } from './context';
import { seedIfEmpty } from './seed/seed';
import { pollStore, runDaily } from './services/operations';

if (config.appInsightsConnectionString) {
  const { useAzureMonitor } = await import('@azure/monitor-opentelemetry');
  useAzureMonitor({ azureMonitorExporterOptions: { connectionString: config.appInsightsConnectionString } });
}

const services = await createServices();
await seedIfEmpty(services);
const app = await buildApp(services);
await app.listen({ port: config.port, host: config.host });

// Background work. In Azure the daily run is a Container Apps Job (SCHEDULER=external).
const every = (ms: number, fn: () => Promise<unknown>) => setInterval(() => fn().catch((e) => app.log.error(e)), ms);
every(5_000, () => services.events.dispatch());
every(config.storage.pollMinutes * 60_000, () => pollStore(services));
if (config.scheduler === 'inprocess') {
  let lastDay = '';
  every(60_000, async () => {
    const today = services.today();
    if (today !== lastDay) {
      lastDay = today;
      await runDaily(services);
    }
  });
}

app.log.info(`Vertragsmanagement läuft auf http://localhost:${config.port} (KI: ${services.ai.name}, Ablage: ${services.store.kind}, DB: ${services.db.kind})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await services.db.close();
    process.exit(0);
  });
}
