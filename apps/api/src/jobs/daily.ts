/**
 * Daily run for the Azure Container Apps Job: reminders, deadline events,
 * folder scan and event delivery. Locally the API runs the same code itself.
 */
import { createServices } from '../context';
import { runDaily } from '../services/operations';

const services = await createServices();
try {
  const r = await runDaily(services);
  console.log(JSON.stringify({ type: 'daily', ...r }));
  // Give started ingest jobs time to finish before the container stops.
  await new Promise((res) => setTimeout(res, r.poll.started.length ? 60_000 : 0));
} finally {
  await services.db.close();
}
