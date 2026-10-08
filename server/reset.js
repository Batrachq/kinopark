// Пересоздать базу с нуля:  npm run reset-db
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
for (const f of ['kinopark.db', 'kinopark.db-wal', 'kinopark.db-shm']) rmSync(join(dir, f), { force: true });
console.log('База удалена. Запустите  npm start  — она создастся заново с демо-данными.');
