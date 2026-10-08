// =====================================================================
//  КиноПарк — точка входа сервера.  Запуск:  npm start  →  http://localhost:3000
// =====================================================================
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
    console.error(`\n  Нужен Node.js версии 22.13 или новее (у вас ${process.versions.node}).\n  Скачайте LTS-версию с https://nodejs.org\n`);
    process.exit(1);
}

const { createServer } = await import('node:http');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { Router, createHandler } = await import('./http.js');
const { DB_PATH } = await import('./db.js');
const { seedIfEmpty, ensureSchedule } = await import('./seed.js');
const { default: catalogRoutes } = await import('./routes/catalog.js');
const { default: orderRoutes, expirePending } = await import('./routes/orders.js');
const { default: adminRoutes } = await import('./routes/admin.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

if (seedIfEmpty()) console.log('  База данных создана и заполнена демо-данными');
const added = ensureSchedule();
if (added) console.log(`  Добавлено сеансов в расписание: ${added}`);

const router = new Router();
catalogRoutes(router);
orderRoutes(router);
adminRoutes(router);

setInterval(expirePending, 30_000);                 // снимаем просроченные брони
setInterval(() => ensureSchedule(), 3_600_000);     // раз в час дополняем расписание

createServer(createHandler(router, PUBLIC_DIR)).listen(PORT, () => {
    console.log(`\n  🎬 КиноПарк запущен:  http://localhost:${PORT}`);
    console.log(`  База данных:         ${DB_PATH}`);
    console.log(`  Админ:  admin@kinopark.ru / admin123     Зритель:  demo@kinopark.ru / demo123\n`);
});
