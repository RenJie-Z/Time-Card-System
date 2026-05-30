import { createApp } from './app.js';
import { createDatabase } from './db.js';

const port = Number(process.env.PORT || 8000);
const db = createDatabase();
const app = createApp(db);

app.listen(port, '0.0.0.0', () => {
  console.log(`Daily Study Check-in API listening on http://localhost:${port}`);
});
