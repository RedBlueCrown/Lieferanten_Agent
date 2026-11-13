// npm run seed: loads the demo data into an empty database.
import { createServices } from '../context';
import { seedIfEmpty } from './seed';

const s = await createServices();
const done = await seedIfEmpty(s);
console.log(done ? 'Demodaten geladen.' : 'Datenbank enthält bereits Daten – nichts geändert.');
await s.db.close();
