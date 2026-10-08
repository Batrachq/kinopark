// Публичная часть: аккаунт, фильмы, сеансы, схема зала
import { all, get, run, toDateStr, nowStr, toDateTimeStr } from '../db.js';
import { HttpError } from '../http.js';
import { hashPassword, verifyPassword, startSession, endSession, currentUser, publicUser, requireAuth } from '../auth.js';
import { sessionPricing, SEAT_TYPE } from '../pricing.js';
import { expirePending } from './orders.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Сколько мест занято на сеансе (бронь + оплачено + использовано)
export const takenCount = sessionId =>
    get(`SELECT COUNT(*) AS n FROM tickets WHERE session_id = ? AND status IN ('reserved','paid','used')`, sessionId).n;

export const SESSION_SQL = `
    SELECT s.id, s.starts_at, s.format, s.movie_id, s.hall_id,
           m.title, m.base_price, m.duration_min, m.age_rating, m.poster_url,
           h.name AS hall_name, h.type AS hall_type, h.price_multiplier, h.rows_count, h.seats_per_row,
           c.id AS cinema_id, c.name AS cinema_name, c.address AS cinema_address,
           (SELECT COUNT(*) FROM seats WHERE hall_id = h.id) AS capacity
    FROM sessions s
    JOIN movies m ON m.id = s.movie_id
    JOIN halls h ON h.id = s.hall_id
    JOIN cinemas c ON c.id = h.cinema_id`;

export function sessionSummary(s) {
    const taken = takenCount(s.id);
    const occupancy = s.capacity ? taken / s.capacity : 0;
    const pricing = sessionPricing(s, occupancy);
    return {
        id: s.id, starts_at: s.starts_at, format: s.format,
        hall: { id: s.hall_id, name: s.hall_name, type: s.hall_type },
        cinema: { id: s.cinema_id, name: s.cinema_name, address: s.cinema_address },
        min_price: pricing.minPrice, occupancy: Math.round(occupancy * 100) / 100,
        free_seats: s.capacity - taken, factors: pricing.factors,
    };
}

function genresMap() {
    const map = new Map();
    for (const r of all('SELECT mg.movie_id, g.name FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id ORDER BY g.name'))
        (map.get(r.movie_id) || map.set(r.movie_id, []).get(r.movie_id)).push(r.name);
    return map;
}

export default function catalogRoutes(r) {
    // ---------- Аккаунт ----------
    r.get('/api/me', (req, res) => res.json({ user: publicUser(currentUser(req)) }));

    r.post('/api/auth/register', (req, res) => {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const phone = String(req.body.phone || '').trim() || null;
        const password = String(req.body.password || '');
        if (name.length < 2) throw new HttpError(400, 'Введите имя');
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Некорректный email');
        if (password.length < 6) throw new HttpError(400, 'Пароль должен быть не короче 6 символов');
        if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Этот email уже зарегистрирован');
        const id = run('INSERT INTO users (email, name, phone, password_hash) VALUES (?, ?, ?, ?)',
            email, name, phone, hashPassword(password)).lastInsertRowid;
        startSession(res, id);
        res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', id)) }, 201);
    });

    r.post('/api/auth/login', (req, res) => {
        const email = String(req.body.email || '').trim().toLowerCase();
        const u = get('SELECT * FROM users WHERE email = ?', email);
        if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash))
            throw new HttpError(401, 'Неверный email или пароль');
        startSession(res, u.id);
        res.json({ user: publicUser(u) });
    });

    r.post('/api/auth/logout', (req, res) => { endSession(req, res); res.json({ ok: true }); });

    r.put('/api/me', requireAuth, (req, res) => {
        const name = String(req.body.name ?? req.user.name).trim();
        const phone = String(req.body.phone ?? req.user.phone ?? '').trim() || null;
        if (name.length < 2) throw new HttpError(400, 'Введите имя');
        run('UPDATE users SET name = ?, phone = ? WHERE id = ?', name, phone, req.user.id);
        res.json({ user: publicUser({ ...req.user, name, phone }) });
    });

    // ---------- Справочники ----------
    r.get('/api/cinemas', (req, res) => res.json(all(`
        SELECT c.*, (SELECT COUNT(*) FROM halls h WHERE h.cinema_id = c.id) AS halls_count FROM cinemas c ORDER BY c.id`)));

    r.get('/api/genres', (req, res) => res.json(all(`
        SELECT DISTINCT g.name FROM genres g
        JOIN movie_genres mg ON mg.genre_id = g.id JOIN movies m ON m.id = mg.movie_id
        WHERE m.is_active = 1 ORDER BY g.name`).map(g => g.name)));

    r.get('/api/snacks', (req, res) => res.json(all('SELECT id, name, descr, price, icon FROM snacks WHERE is_active = 1 ORDER BY id')));

    // ---------- Афиша ----------
    r.get('/api/movies', (req, res) => {
        expirePending();
        const today = toDateStr(new Date());
        const status = req.query.status === 'soon' ? 'soon' : 'now';
        const cinema = Number(req.query.cinema) || null;
        const q = String(req.query.q || '').trim().toLowerCase();
        const genres = genresMap();
        const now = toDateTimeStr(new Date());
        const horizon = toDateStr(new Date(Date.now() + 7 * 86_400_000)) + ' 23:59';

        let movies = all(`SELECT * FROM movies WHERE is_active = 1 AND release_date ${status === 'now' ? '<=' : '>'} ?
                          ORDER BY ${status === 'now' ? 'rating DESC, id' : 'release_date, id'}`, today);
        const result = [];
        for (const m of movies) {
            if (q && !m.title.toLowerCase().includes(q)) continue;
            if (req.query.genre && !(genres.get(m.id) || []).includes(req.query.genre)) continue;
            const sessions = all(`${SESSION_SQL} WHERE s.movie_id = ? AND s.starts_at > ? AND s.starts_at <= ?
                                  ${cinema ? 'AND c.id = ?' : ''}`, m.id, now, horizon, ...(cinema ? [cinema] : []));
            if (status === 'now' && !sessions.length) continue;
            const prices = sessions.map(s => sessionSummary(s).min_price);
            result.push({
                id: m.id, title: m.title, genres: genres.get(m.id) || [], duration_min: m.duration_min,
                age_rating: m.age_rating, rating: m.rating, poster_url: m.poster_url, release_date: m.release_date,
                min_price: prices.length ? Math.min(...prices) : m.base_price,
                sessions_count: sessions.length, presale: status === 'soon' && sessions.length > 0,
            });
        }
        res.json(result);
    });

    r.get('/api/movies/:id', (req, res) => {
        expirePending();
        const m = get('SELECT * FROM movies WHERE id = ? AND is_active = 1', Number(req.params.id));
        if (!m) throw new HttpError(404, 'Фильм не найден');
        const cinema = Number(req.query.cinema) || null;
        const sessions = all(`${SESSION_SQL} WHERE s.movie_id = ? AND s.starts_at > ? ${cinema ? 'AND c.id = ?' : ''}
                              ORDER BY s.starts_at`, m.id, toDateTimeStr(new Date()), ...(cinema ? [cinema] : []))
            .map(sessionSummary);
        res.json({ ...m, genres: genresMap().get(m.id) || [], sessions });
    });

    // ---------- Схема зала ----------
    r.get('/api/sessions/:id', (req, res) => {
        expirePending();
        const s = get(`${SESSION_SQL} WHERE s.id = ?`, Number(req.params.id));
        if (!s) throw new HttpError(404, 'Сеанс не найден');
        const summary = sessionSummary(s);
        const pricing = sessionPricing(s, 1 - summary.free_seats / s.capacity);
        const taken = new Set(all(`SELECT seat_id FROM tickets WHERE session_id = ? AND status IN ('reserved','paid','used')`, s.id).map(t => t.seat_id));
        const seats = all('SELECT id, row_num, seat_num, type FROM seats WHERE hall_id = ? ORDER BY row_num, seat_num', s.hall_id)
            .map(seat => ({ id: seat.id, row: seat.row_num, num: seat.seat_num, type: seat.type,
                            taken: taken.has(seat.id), price: pricing.priceFor(seat.type) }));
        res.json({
            ...summary,
            sales_open: s.starts_at > toDateTimeStr(new Date()),
            movie: { id: s.movie_id, title: s.title, duration_min: s.duration_min, age_rating: s.age_rating, poster_url: s.poster_url },
            hall: { id: s.hall_id, name: s.hall_name, type: s.hall_type, rows: s.rows_count, seats_per_row: s.seats_per_row },
            seat_types: Object.fromEntries(Object.entries(SEAT_TYPE).map(([k, v]) => [k, { label: v.label, price: pricing.priceFor(k) }])),
            seats,
        });
    });
}
