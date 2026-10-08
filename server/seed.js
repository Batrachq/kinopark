// =====================================================================
//  Начальные данные + автогенерация расписания на 7 дней вперёд.
//  При каждом запуске сервера расписание дополняется, поэтому
//  демо-база не «устаревает».
// =====================================================================
import { randomBytes } from 'node:crypto';
import { db, all, get, run, transaction, toDateStr, toDateTimeStr, parseLocal, nowStr } from './db.js';
import { hashPassword } from './auth.js';
import { sessionPricing } from './pricing.js';

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function ticketCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = randomBytes(8);
    const s = [...b].map(x => abc[x % abc.length]).join('');
    return `KP-${s.slice(0, 4)}-${s.slice(4)}`;
}

const CINEMAS = [
    { name: 'КиноПарк Центральный', address: 'ул. Тверская, 18', metro: 'Пушкинская',
      halls: [
          { name: 'Зал 1', type: 'standard', mult: 1.0, rows: 10, seats: 14 },
          { name: 'Зал «Комфорт»', type: 'comfort', mult: 1.2, rows: 7, seats: 10 },
          { name: 'IMAX', type: 'imax', mult: 1.5, rows: 12, seats: 18 },
      ] },
    { name: 'КиноПарк Город', address: 'Ленинградский пр., 62', metro: 'Аэропорт',
      halls: [
          { name: 'Зал 1', type: 'standard', mult: 1.0, rows: 9, seats: 12 },
          { name: 'Зал 2', type: 'standard', mult: 1.0, rows: 11, seats: 16 },
      ] },
];

const U = id => `https://images.unsplash.com/${id}?q=80&w=800&auto=format&fit=crop`;

// release: смещение даты премьеры в днях от сегодняшнего (отрицательное — уже идёт)
const MOVIES = [
    { title: 'Дюна: Часть вторая', genres: ['Фантастика', 'Приключения'], duration: 166, age: '16+', rating: 8.5, price: 550,
      poster: U('photo-1536440136628-849c177e76a1'), director: 'Дени Вильнёв', country: 'США, Канада', year: 2024, release: -40,
      description: 'Пол Атрейдес объединяется с фрименами, чтобы отомстить заговорщикам, уничтожившим его семью. Ему предстоит выбор между любовью всей жизни и судьбой известной вселенной.' },
    { title: 'Оппенгеймер', genres: ['Биография', 'Драма'], duration: 180, age: '18+', rating: 8.9, price: 480,
      poster: U('photo-1585647347384-2593bc35786b'), director: 'Кристофер Нолан', country: 'США, Великобритания', year: 2023, release: -60,
      description: 'История американского физика Роберта Оппенгеймера, руководителя Манхэттенского проекта, и цены, которую ему пришлось заплатить за создание атомной бомбы.' },
    { title: 'Мастер и Маргарита', genres: ['Фэнтези', 'Драма'], duration: 158, age: '16+', rating: 7.8, price: 420,
      poster: U('photo-1533488765986-dfa2a9939acd'), director: 'Михаил Локшин', country: 'Россия', year: 2024, release: -30,
      description: 'Москва, 1930-е. Известный писатель оказывается в центре литературного скандала, а в городе появляется загадочный иностранец Воланд со своей свитой.' },
    { title: 'Интерстеллар', genres: ['Фантастика', 'Драма'], duration: 169, age: '12+', rating: 9.0, price: 500,
      poster: U('photo-1451187580459-43490279c0fa'), director: 'Кристофер Нолан', country: 'США, Великобритания', year: 2014, release: -20,
      description: 'Земля умирает. Группа исследователей отправляется через червоточину в поисках нового дома для человечества. Повторный прокат в IMAX.' },
    { title: 'Барби', genres: ['Комедия', 'Фэнтези'], duration: 114, age: '12+', rating: 7.3, price: 380,
      poster: U('photo-1555421689-491a97ff2040'), director: 'Грета Гервиг', country: 'США', year: 2023, release: -50,
      description: 'Барби живёт в идеальном Барбиленде, пока однажды не начинает задумываться о смерти. Чтобы всё исправить, ей придётся отправиться в реальный мир.' },
    { title: 'Человек-паук: Нет пути домой', genres: ['Боевик', 'Приключения'], duration: 148, age: '12+', rating: 8.3, price: 450,
      poster: U('photo-1635805737707-575885ab0820'), director: 'Джон Уоттс', country: 'США', year: 2021, release: -25,
      description: 'Мир узнал, кто скрывается под маской Человека-паука. Питер просит Доктора Стрэнджа о помощи, но заклинание открывает дверь в мультивселенную.' },
    { title: 'Головоломка 2', genres: ['Анимация', 'Комедия'], duration: 96, age: '6+', rating: 7.6, price: 350,
      poster: null, director: 'Келси Манн', country: 'США', year: 2024, release: -15,
      description: 'Райли становится подростком, и в штабе её эмоций появляются новые жильцы: Тревожность, Зависть, Хандра и Неловкость.' },
    { title: 'Джон Уик 4', genres: ['Боевик', 'Триллер'], duration: 169, age: '18+', rating: 7.8, price: 450,
      poster: null, director: 'Чад Стахелски', country: 'США', year: 2023, release: -10,
      description: 'Джон Уик находит способ одолеть Правление Кланов. Но прежде чем обрести свободу, ему предстоит сразиться с новым могущественным врагом.' },
    // Скоро в кино (премьера в будущем; у ближайшей — предпродажа)
    { title: 'Северный ветер', genres: ['Драма', 'Приключения'], duration: 132, age: '12+', rating: null, price: 450,
      poster: null, director: 'Анна Соколова', country: 'Россия', year: 2026, release: 4,
      description: 'Экспедиция полярников оказывается отрезанной от мира на дрейфующей станции. Вдали от дома им придётся заново узнать, кто они на самом деле.' },
    { title: 'Код доступа', genres: ['Боевик', 'Триллер'], duration: 118, age: '16+', rating: null, price: 450,
      poster: null, director: 'Игорь Белов', country: 'Россия', year: 2026, release: 12,
      description: 'Хакер-одиночка случайно получает ключ к системе, которая управляет городом. Теперь за ним охотятся и спецслужбы, и те, кто эту систему создал.' },
    { title: 'Тайна старого маяка', genres: ['Анимация', 'Приключения'], duration: 92, age: '6+', rating: null, price: 350,
      poster: null, director: 'Мария Ким', country: 'Россия', year: 2026, release: 19,
      description: 'Брат и сестра проводят лето у бабушки на побережье и находят в старом маяке карту, которая ведёт к сокровищу морских духов.' },
    { title: 'Последний рубеж', genres: ['Фантастика', 'Боевик'], duration: 141, age: '16+', rating: null, price: 500,
      poster: null, director: 'Алексей Громов', country: 'Россия', year: 2026, release: 26,
      description: 'Орбитальная станция на краю Солнечной системы принимает сигнал, которого не может быть. Экипажу предстоит решить — ответить или промолчать.' },
];

const SNACKS = [
    { name: 'Попкорн солёный', descr: 'Средний, 3 л', price: 290, icon: 'popcorn' },
    { name: 'Попкорн карамельный', descr: 'Большой, 5 л', price: 390, icon: 'popcorn' },
    { name: 'Начос с сырным соусом', descr: '150 г', price: 350, icon: 'nachos' },
    { name: 'Хот-дог', descr: 'Классический', price: 260, icon: 'hotdog' },
    { name: 'Газировка', descr: '0,5 л', price: 190, icon: 'drink' },
    { name: 'Комбо «Для двоих»', descr: '2 попкорна M + 2 напитка', price: 790, icon: 'combo' },
];

function seatTypeFor(hall, row) {
    if (row === hall.rows) return 'sofa';                               // последний ряд — диваны
    if (row >= hall.rows - 2 && row < hall.rows) return 'vip';          // два ряда перед диванами
    return 'standard';
}

export function seedIfEmpty() {
    if (get('SELECT COUNT(*) AS n FROM cinemas').n > 0) return false;
    const today = new Date();
    transaction(() => {
        for (const c of CINEMAS) {
            const cid = run('INSERT INTO cinemas (name, address, metro) VALUES (?, ?, ?)', c.name, c.address, c.metro).lastInsertRowid;
            for (const h of c.halls) {
                const hid = run(`INSERT INTO halls (cinema_id, name, type, price_multiplier, rows_count, seats_per_row)
                                 VALUES (?, ?, ?, ?, ?, ?)`, cid, h.name, h.type, h.mult, h.rows, h.seats).lastInsertRowid;
                const ins = db.prepare('INSERT INTO seats (hall_id, row_num, seat_num, type) VALUES (?, ?, ?, ?)');
                for (let r = 1; r <= h.rows; r++) {
                    const perRow = r === h.rows ? h.seats - (h.seats % 2) : h.seats;   // диваны парами
                    for (let s = 1; s <= perRow; s++) ins.run(hid, r, s, seatTypeFor(h, r));
                }
            }
        }
        const genreId = name => {
            const g = get('SELECT id FROM genres WHERE name = ?', name);
            return g ? g.id : run('INSERT INTO genres (name) VALUES (?)', name).lastInsertRowid;
        };
        for (const m of MOVIES) {
            const mid = run(`INSERT INTO movies (title, description, duration_min, age_rating, rating, base_price, poster_url,
                                                 director, country, year, release_date)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                m.title, m.description, m.duration, m.age, m.rating, m.price, m.poster,
                m.director, m.country, m.year, toDateStr(addDays(today, m.release))).lastInsertRowid;
            for (const g of m.genres) run('INSERT INTO movie_genres (movie_id, genre_id) VALUES (?, ?)', mid, genreId(g));
        }
        for (const s of SNACKS) run('INSERT INTO snacks (name, descr, price, icon) VALUES (?, ?, ?, ?)', s.name, s.descr, s.price, s.icon);

        run(`INSERT INTO users (email, name, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`,
            'admin@kinopark.ru', 'Администратор', '+7 900 000-00-00', hashPassword('admin123'));
        run(`INSERT INTO users (email, name, phone, password_hash, role) VALUES (?, ?, ?, ?, 'user')`,
            'demo@kinopark.ru', 'Демо Зритель', '+7 900 111-22-33', hashPassword('demo123'));
    });
    return true;
}

// ---------------------------------------------------------------------
//  Расписание: заполняем каждый зал на каждый из ближайших 7 дней
// ---------------------------------------------------------------------
const rnd = (a, b) => a + Math.random() * (b - a);

export function ensureSchedule(days = 7) {
    const halls = all('SELECT * FROM halls ORDER BY id');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let created = 0;

    transaction(() => {
        for (let d = 0; d < days; d++) {
            const day = addDays(today, d);
            const dayStr = toDateStr(day);
            const movies = all(`SELECT * FROM movies WHERE is_active = 1 AND release_date <= ? ORDER BY rating DESC NULLS LAST, id`, dayStr);
            if (!movies.length) continue;

            for (const hall of halls) {
                const exists = get(`SELECT 1 FROM sessions WHERE hall_id = ? AND substr(starts_at, 1, 10) = ?`, hall.id, dayStr);
                if (exists) continue;
                // В IMAX — только самые зрелищные фильмы
                const pool = hall.type === 'imax'
                    ? movies.filter(m => /Фантастика|Приключения|Боевик/.test(genresOf(m.id))).slice(0, 3)
                    : movies;
                const list = pool.length ? pool : movies;
                let t = new Date(day); t.setHours(10, (hall.id * 15) % 60, 0, 0);
                let slot = 0;
                while (t.getHours() < 23 && t.getDate() === day.getDate()) {
                    const m = list[(hall.id * 3 + d + slot) % list.length];
                    const format = hall.type === 'imax' ? 'IMAX'
                        : (/Фантастика|Анимация/.test(genresOf(m.id)) && slot % 2 === 1 ? '3D' : '2D');
                    const sid = run('INSERT INTO sessions (movie_id, hall_id, starts_at, format) VALUES (?, ?, ?, ?)',
                        m.id, hall.id, toDateTimeStr(t), format).lastInsertRowid;
                    fillBoxOffice(sid, hall, t);
                    created++;
                    // следующий сеанс: фильм + 20 мин уборки, округление до 5 минут
                    t = new Date(t.getTime() + (m.duration_min + 20) * 60_000);
                    t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
                    slot++;
                }
            }
        }
    });
    return created;
}

const genreCache = new Map();
function genresOf(movieId) {
    if (!genreCache.has(movieId))
        genreCache.set(movieId, all('SELECT g.name FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = ?', movieId)
            .map(r => r.name).join(','));
    return genreCache.get(movieId);
}

// Имитация продаж в кассе, чтобы залы выглядели «живыми» и работал коэффициент спроса
function fillBoxOffice(sessionId, hall, start) {
    const h = start.getHours();
    const weekend = start.getDay() === 0 || start.getDay() === 6;
    let occ = h < 12 ? rnd(0.05, 0.25) : h < 17 ? rnd(0.15, 0.4) : rnd(0.25, 0.75);
    if (weekend) occ = Math.min(0.92, occ + 0.1);
    const seats = all('SELECT id, row_num, type FROM seats WHERE hall_id = ?', hall.id);
    // Центральные ряды популярнее
    const weighted = seats.map(s => ({ s, w: Math.random() * (1 - Math.abs(s.row_num - hall.rows_count * 0.6) / hall.rows_count) }))
        .sort((a, b) => b.w - a.w).slice(0, Math.round(seats.length * occ)).map(x => x.s);
    if (!weighted.length) return;
    const sess = get(`SELECT s.starts_at, m.base_price, h.type AS hall_type, h.price_multiplier
                      FROM sessions s JOIN movies m ON m.id = s.movie_id JOIN halls h ON h.id = s.hall_id WHERE s.id = ?`, sessionId);
    const pricing = sessionPricing(sess, 0, addDays(parseLocal(sess.starts_at), -1));
    let total = 0;
    const oid = run(`INSERT INTO orders (user_id, session_id, status, source, paid_at) VALUES (NULL, ?, 'paid', 'box_office', ?)`,
        sessionId, nowStr()).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO tickets (order_id, session_id, seat_id, price, status, code) VALUES (?, ?, ?, ?, 'paid', ?)`);
    for (const s of weighted) {
        const p = pricing.priceFor(s.type);
        total += p;
        ins.run(oid, sessionId, s.id, p, ticketCode());
    }
    run('UPDATE orders SET tickets_total = ?, total = ? WHERE id = ?', total, total, oid);
}
