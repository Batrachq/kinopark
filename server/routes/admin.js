// Панель администратора: статистика, фильмы, сеансы, проверка билетов на входе
import { all, get, run, transaction, toDateStr, toDateTimeStr, nowStr, parseLocal } from '../db.js';
import { HttpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { SESSION_SQL, sessionSummary } from './catalog.js';

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function movieFromBody(b) {
    const m = {
        title: String(b.title || '').trim(),
        description: String(b.description || '').trim(),
        duration_min: Number(b.duration_min),
        age_rating: String(b.age_rating || '12+'),
        rating: b.rating === '' || b.rating == null ? null : Number(b.rating),
        base_price: Number(b.base_price),
        poster_url: String(b.poster_url || '').trim() || null,
        director: String(b.director || '').trim() || null,
        country: String(b.country || '').trim() || null,
        year: Number(b.year) || null,
        release_date: String(b.release_date || ''),
        genres: (Array.isArray(b.genres) ? b.genres : String(b.genres || '').split(','))
            .map(g => String(g).trim()).filter(Boolean),
    };
    if (m.title.length < 1) throw new HttpError(400, 'Укажите название');
    if (!(m.duration_min > 0 && m.duration_min < 600)) throw new HttpError(400, 'Длительность — от 1 до 600 минут');
    if (!(m.base_price >= 50)) throw new HttpError(400, 'Базовая цена — от 50 ₽');
    if (m.rating !== null && !(m.rating >= 0 && m.rating <= 10)) throw new HttpError(400, 'Рейтинг — от 0 до 10');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.release_date)) throw new HttpError(400, 'Укажите дату премьеры');
    if (!['0+', '6+', '12+', '16+', '18+'].includes(m.age_rating)) throw new HttpError(400, 'Неверный возрастной рейтинг');
    return m;
}

function saveGenres(movieId, genres) {
    run('DELETE FROM movie_genres WHERE movie_id = ?', movieId);
    for (const name of genres) {
        const g = get('SELECT id FROM genres WHERE name = ?', name) ?? { id: run('INSERT INTO genres (name) VALUES (?)', name).lastInsertRowid };
        run('INSERT OR IGNORE INTO movie_genres (movie_id, genre_id) VALUES (?, ?)', movieId, g.id);
    }
}

export default function adminRoutes(r) {
    r.get('/api/admin/stats', requireAdmin, (req, res) => {
        const today = toDateStr(new Date());
        const sold = `t.status IN ('paid','used')`;
        const todayRow = get(`SELECT COUNT(*) AS tickets, COALESCE(SUM(t.price),0) AS revenue
                              FROM tickets t JOIN sessions s ON s.id = t.session_id
                              WHERE ${sold} AND substr(s.starts_at,1,10) = ?`, today);
        const online = get(`SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(o.total),0) AS revenue,
                                   COALESCE(SUM(o.snacks_total),0) AS snacks
                            FROM orders o WHERE o.source = 'online' AND o.status = 'paid'`);
        const users = get(`SELECT COUNT(*) AS n FROM users WHERE role = 'user'`).n;

        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = toDateStr(addDays(new Date(), i));
            const row = get(`SELECT COUNT(*) AS tickets, COALESCE(SUM(t.price),0) AS revenue
                             FROM tickets t JOIN sessions s ON s.id = t.session_id
                             WHERE ${sold} AND substr(s.starts_at,1,10) = ?`, d);
            const cap = get(`SELECT COALESCE(SUM((SELECT COUNT(*) FROM seats se WHERE se.hall_id = s.hall_id)),0) AS c
                             FROM sessions s WHERE substr(s.starts_at,1,10) = ?`, d).c;
            days.push({ date: d, ...row, occupancy: cap ? row.tickets / cap : 0 });
        }

        const top = all(`SELECT m.id, m.title, COUNT(t.id) AS tickets, COALESCE(SUM(t.price),0) AS revenue
                         FROM movies m JOIN sessions s ON s.movie_id = m.id
                         JOIN tickets t ON t.session_id = s.id AND ${sold}
                         WHERE substr(s.starts_at,1,10) BETWEEN ? AND ?
                         GROUP BY m.id ORDER BY tickets DESC LIMIT 5`, today, days[6].date);

        const recent = all(`SELECT o.id, o.total, o.paid_at, u.name AS user_name, m.title, s.starts_at,
                                   (SELECT COUNT(*) FROM tickets t WHERE t.order_id = o.id) AS tickets
                            FROM orders o JOIN users u ON u.id = o.user_id
                            JOIN sessions s ON s.id = o.session_id JOIN movies m ON m.id = s.movie_id
                            WHERE o.source = 'online' AND o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 8`);
        res.json({ today: todayRow, online, users, days, top, recent });
    });

    // ---------- Фильмы ----------
    r.get('/api/admin/movies', requireAdmin, (req, res) => {
        const movies = all(`SELECT m.*, (SELECT GROUP_CONCAT(g.name, ', ') FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = m.id) AS genres,
                                   (SELECT COUNT(*) FROM sessions s WHERE s.movie_id = m.id AND s.starts_at > ?) AS upcoming
                            FROM movies m ORDER BY m.is_active DESC, m.release_date DESC`, toDateTimeStr(new Date()));
        res.json(movies);
    });

    r.post('/api/admin/movies', requireAdmin, (req, res) => {
        const m = movieFromBody(req.body);
        const id = transaction(() => {
            const id = run(`INSERT INTO movies (title, description, duration_min, age_rating, rating, base_price, poster_url, director, country, year, release_date)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                m.title, m.description, m.duration_min, m.age_rating, m.rating, m.base_price, m.poster_url, m.director, m.country, m.year, m.release_date).lastInsertRowid;
            saveGenres(id, m.genres);
            return id;
        });
        res.json({ id: Number(id) }, 201);
    });

    r.put('/api/admin/movies/:id', requireAdmin, (req, res) => {
        const id = Number(req.params.id);
        if (!get('SELECT 1 FROM movies WHERE id = ?', id)) throw new HttpError(404, 'Фильм не найден');
        const m = movieFromBody(req.body);
        transaction(() => {
            run(`UPDATE movies SET title=?, description=?, duration_min=?, age_rating=?, rating=?, base_price=?, poster_url=?,
                 director=?, country=?, year=?, release_date=?, is_active=? WHERE id=?`,
                m.title, m.description, m.duration_min, m.age_rating, m.rating, m.base_price, m.poster_url,
                m.director, m.country, m.year, m.release_date, req.body.is_active === false ? 0 : 1, id);
            saveGenres(id, m.genres);
        });
        res.json({ ok: true });
    });

    // Фильм с проданными билетами не удаляем, а снимаем с проката
    r.delete('/api/admin/movies/:id', requireAdmin, (req, res) => {
        const id = Number(req.params.id);
        const hasOnline = get(`SELECT 1 FROM orders o JOIN sessions s ON s.id = o.session_id
                               WHERE s.movie_id = ? AND o.source = 'online' AND o.status IN ('paid','pending')`, id);
        if (hasOnline) { run('UPDATE movies SET is_active = 0 WHERE id = ?', id); return res.json({ archived: true }); }
        run('DELETE FROM movies WHERE id = ?', id);
        res.json({ deleted: true });
    });

    // ---------- Сеансы ----------
    r.get('/api/admin/halls', requireAdmin, (req, res) => res.json(all(`
        SELECT h.*, c.name AS cinema_name, (SELECT COUNT(*) FROM seats s WHERE s.hall_id = h.id) AS capacity
        FROM halls h JOIN cinemas c ON c.id = h.cinema_id ORDER BY c.id, h.id`)));

    r.get('/api/admin/sessions', requireAdmin, (req, res) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : toDateStr(new Date());
        const rows = all(`${SESSION_SQL} WHERE substr(s.starts_at,1,10) = ? ORDER BY c.id, h.id, s.starts_at`, date);
        res.json(rows.map(s => ({
            ...sessionSummary(s), movie: { id: s.movie_id, title: s.title, duration_min: s.duration_min },
            capacity: s.capacity,
            online_tickets: get(`SELECT COUNT(*) AS n FROM tickets t JOIN orders o ON o.id = t.order_id
                                 WHERE t.session_id = ? AND o.source = 'online' AND t.status IN ('reserved','paid','used')`, s.id).n,
        })));
    });

    r.post('/api/admin/sessions', requireAdmin, (req, res) => {
        const movie = get('SELECT * FROM movies WHERE id = ?', Number(req.body.movieId));
        const hall = get('SELECT * FROM halls WHERE id = ?', Number(req.body.hallId));
        const startsAt = String(req.body.startsAt || '').replace('T', ' ').slice(0, 16);
        if (!movie || !hall) throw new HttpError(400, 'Выберите фильм и зал');
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startsAt)) throw new HttpError(400, 'Укажите дату и время');
        if (startsAt <= toDateTimeStr(new Date())) throw new HttpError(400, 'Нельзя создать сеанс в прошлом');
        const format = hall.type === 'imax' ? 'IMAX' : (req.body.format === '3D' ? '3D' : '2D');

        // Проверка пересечения с другими сеансами в зале (+20 минут на уборку)
        const start = parseLocal(startsAt), end = new Date(start.getTime() + (movie.duration_min + 20) * 60_000);
        const day = toDateStr(start), prevDay = toDateStr(addDays(start, -1));
        const clash = all(`SELECT s.starts_at, m.duration_min, m.title FROM sessions s JOIN movies m ON m.id = s.movie_id
                           WHERE s.hall_id = ? AND substr(s.starts_at,1,10) IN (?, ?)`, hall.id, day, prevDay)
            .find(o => { const os = parseLocal(o.starts_at), oe = new Date(os.getTime() + (o.duration_min + 20) * 60_000); return os < end && oe > start; });
        if (clash) throw new HttpError(409, `Зал занят: «${clash.title}» в ${clash.starts_at.slice(11)}`);

        const id = run('INSERT INTO sessions (movie_id, hall_id, starts_at, format) VALUES (?, ?, ?, ?)', movie.id, hall.id, startsAt, format).lastInsertRowid;
        res.json({ id: Number(id) }, 201);
    });

    r.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
        const id = Number(req.params.id);
        const online = get(`SELECT 1 FROM orders WHERE session_id = ? AND source = 'online' AND status IN ('paid','pending')`, id);
        if (online) throw new HttpError(409, 'На сеанс уже куплены билеты онлайн — удалить нельзя');
        run('DELETE FROM sessions WHERE id = ?', id);
        res.json({ ok: true });
    });

    // ---------- Контроль на входе: проверка QR ----------
    r.post('/api/admin/check', requireAdmin, (req, res) => {
        const code = String(req.body.code || '').trim().toUpperCase();
        const t = get(`SELECT t.*, se.row_num, se.seat_num, se.type AS seat_type, u.name AS user_name
                       FROM tickets t JOIN seats se ON se.id = t.seat_id
                       JOIN orders o ON o.id = t.order_id LEFT JOIN users u ON u.id = o.user_id WHERE t.code = ?`, code);
        if (!t) return res.json({ result: 'not_found', message: 'Билет с таким кодом не найден' });
        const s = get(`${SESSION_SQL} WHERE s.id = ?`, t.session_id);
        const info = {
            code: t.code, row: t.row_num, seat: t.seat_num, seat_type: t.seat_type, holder: t.user_name,
            movie: s.title, starts_at: s.starts_at, hall: s.hall_name, cinema: s.cinema_name, used_at: t.used_at,
        };
        if (t.status === 'cancelled' || t.status === 'reserved') return res.json({ result: 'invalid', message: 'Билет не оплачен или возвращён', ticket: info });
        if (t.status === 'used') return res.json({ result: 'used', message: `Билет уже использован (${t.used_at})`, ticket: info });
        const minsToStart = (parseLocal(s.starts_at) - Date.now()) / 60_000;
        const endsAgo = -minsToStart - s.duration_min;
        if (endsAgo > 0) return res.json({ result: 'invalid', message: 'Сеанс уже закончился', ticket: info });
        if (req.body.use && minsToStart > 60)
            return res.json({ result: 'early', message: 'Вход на сеанс открывается за час до начала', ticket: info });
        if (req.body.use) {
            run(`UPDATE tickets SET status = 'used', used_at = ? WHERE id = ?`, nowStr(), t.id);
            return res.json({ result: 'admitted', message: 'Проход разрешён', ticket: { ...info, used_at: nowStr() } });
        }
        res.json({ result: 'valid', message: minsToStart > 60 ? 'Билет действителен, но сеанс ещё не скоро' : 'Билет действителен', ticket: info });
    });
}
