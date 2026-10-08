// Бронирование мест, оплата, возврат, мои билеты, QR
import { all, get, run, transaction, toFullStr, toDateTimeStr, nowStr, parseLocal } from '../db.js';
import { HttpError } from '../http.js';
import { requireAuth, currentUser } from '../auth.js';
import { sessionPricing } from '../pricing.js';
import { ticketCode } from '../seed.js';
import { qrSvg } from '../qr.js';
import { SESSION_SQL, takenCount } from './catalog.js';

export const HOLD_MINUTES = 10;
const MAX_SEATS = 8;
const REFUND_HOURS = 1;

// Снимаем просроченные брони (бронь живёт 10 минут)
export function expirePending() {
    const now = nowStr();
    const expired = all(`SELECT id FROM orders WHERE status = 'pending' AND expires_at < ?`, now);
    if (!expired.length) return;
    transaction(() => {
        for (const o of expired) {
            run(`UPDATE orders SET status = 'expired' WHERE id = ?`, o.id);
            run(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ?`, o.id);
        }
    });
}

function luhn(num) {
    let sum = 0;
    [...num].reverse().forEach((d, i) => {
        let n = Number(d);
        if (i % 2) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
    });
    return sum % 10 === 0;
}

function loadOrder(id, user) {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(id));
    if (!o || (o.user_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Заказ не найден');
    return o;
}

export function orderDetails(o) {
    const s = get(`${SESSION_SQL} WHERE s.id = ?`, o.session_id);
    const tickets = all(`SELECT t.id, t.price, t.status, t.code, t.used_at, se.row_num AS row, se.seat_num AS num, se.type
                         FROM tickets t JOIN seats se ON se.id = t.seat_id WHERE t.order_id = ? ORDER BY se.row_num, se.seat_num`, o.id);
    const snacks = all(`SELECT sn.id, sn.name, sn.icon, os.qty, os.price FROM order_snacks os JOIN snacks sn ON sn.id = os.snack_id
                        WHERE os.order_id = ?`, o.id);
    const start = parseLocal(s.starts_at);
    return {
        id: o.id, status: o.status, total: o.total, tickets_total: o.tickets_total, snacks_total: o.snacks_total,
        card_last4: o.card_last4, created_at: o.created_at, paid_at: o.paid_at,
        expires_in: o.status === 'pending' ? Math.max(0, Math.round((parseLocal(o.expires_at) - Date.now()) / 1000)) : null,
        can_refund: o.status === 'paid' && start - Date.now() > REFUND_HOURS * 3_600_000 && tickets.every(t => t.status === 'paid'),
        session: {
            id: s.id, starts_at: s.starts_at, format: s.format,
            hall: { name: s.hall_name, type: s.hall_type },
            cinema: { name: s.cinema_name, address: s.cinema_address },
            movie: { id: s.movie_id, title: s.title, duration_min: s.duration_min, age_rating: s.age_rating, poster_url: s.poster_url },
        },
        tickets, snacks,
    };
}

export default function orderRoutes(r) {
    // Шаг 2 → 3: бронируем выбранные места на 10 минут
    r.post('/api/orders', requireAuth, (req, res) => {
        expirePending();
        const sessionId = Number(req.body.sessionId);
        const seatIds = [...new Set((req.body.seatIds || []).map(Number))];
        if (!seatIds.length) throw new HttpError(400, 'Выберите места');
        if (seatIds.length > MAX_SEATS) throw new HttpError(400, `Можно выбрать не больше ${MAX_SEATS} мест`);

        const s = get(`${SESSION_SQL} WHERE s.id = ?`, sessionId);
        if (!s) throw new HttpError(404, 'Сеанс не найден');
        if (s.starts_at <= toDateTimeStr(new Date())) throw new HttpError(400, 'Продажа на этот сеанс закрыта');

        const seats = all(`SELECT id, type FROM seats WHERE hall_id = ? AND id IN (${seatIds.map(() => '?').join(',')})`, s.hall_id, ...seatIds);
        if (seats.length !== seatIds.length) throw new HttpError(400, 'Места не принадлежат этому залу');

        const orderId = transaction(() => {
            // Предыдущая незавершённая бронь пользователя освобождается
            for (const old of all(`SELECT id FROM orders WHERE user_id = ? AND status = 'pending'`, req.user.id)) {
                run(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, old.id);
                run(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ?`, old.id);
            }
            const pricing = sessionPricing(s, takenCount(s.id) / s.capacity);
            const expires = toFullStr(new Date(Date.now() + HOLD_MINUTES * 60_000));
            const oid = run(`INSERT INTO orders (user_id, session_id, status, expires_at) VALUES (?, ?, 'pending', ?)`,
                req.user.id, s.id, expires).lastInsertRowid;
            const ins = run.bind(null, `INSERT INTO tickets (order_id, session_id, seat_id, price, status, code) VALUES (?, ?, ?, ?, 'reserved', ?)`);
            let total = 0;
            try {
                for (const seat of seats) {
                    const price = pricing.priceFor(seat.type);
                    total += price;
                    ins(oid, s.id, seat.id, price, ticketCode());
                }
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Кто-то только что занял одно из выбранных мест. Выберите другие.');
                throw e;
            }
            run('UPDATE orders SET tickets_total = ?, total = ? WHERE id = ?', total, total, oid);
            return oid;
        });
        res.json({ orderId: Number(orderId) }, 201);
    });

    r.get('/api/orders/:id', requireAuth, (req, res) => {
        expirePending();
        res.json(orderDetails(loadOrder(req.params.id, req.user)));
    });

    // Шаг 3: оплата (учебная имитация — реальные деньги не списываются, номер карты не сохраняется)
    r.post('/api/orders/:id/pay', requireAuth, (req, res) => {
        expirePending();
        const o = loadOrder(req.params.id, req.user);
        if (o.status === 'expired') throw new HttpError(410, 'Время брони истекло. Выберите места заново.');
        if (o.status !== 'pending') throw new HttpError(400, 'Заказ уже обработан');

        const card = req.body.card || {};
        const number = String(card.number || '').replace(/\D/g, '');
        const [mm, yy] = String(card.exp || '').split('/').map(Number);
        if (number.length < 16 || !luhn(number)) throw new HttpError(400, 'Проверьте номер карты');
        if (!(mm >= 1 && mm <= 12) || new Date(2000 + yy, mm) < new Date()) throw new HttpError(400, 'Проверьте срок действия карты');
        if (!/^\d{3}$/.test(String(card.cvc || ''))) throw new HttpError(400, 'CVC — три цифры на обороте карты');

        const items = (req.body.snacks || []).map(i => ({ id: Number(i.id), qty: Math.min(10, Math.max(0, Number(i.qty) || 0)) })).filter(i => i.qty > 0);

        transaction(() => {
            let snacksTotal = 0;
            for (const i of items) {
                const sn = get('SELECT * FROM snacks WHERE id = ? AND is_active = 1', i.id);
                if (!sn) throw new HttpError(400, 'Товар бара не найден');
                run('INSERT INTO order_snacks (order_id, snack_id, qty, price) VALUES (?, ?, ?, ?)', o.id, sn.id, i.qty, sn.price);
                snacksTotal += sn.price * i.qty;
            }
            run(`UPDATE orders SET status = 'paid', paid_at = ?, snacks_total = ?, total = tickets_total + ?, card_last4 = ? WHERE id = ?`,
                nowStr(), snacksTotal, snacksTotal, number.slice(-4), o.id);
            run(`UPDATE tickets SET status = 'paid' WHERE order_id = ?`, o.id);
        });
        res.json(orderDetails(get('SELECT * FROM orders WHERE id = ?', o.id)));
    });

    // Отмена брони или возврат билетов
    r.post('/api/orders/:id/cancel', requireAuth, (req, res) => {
        expirePending();
        const o = loadOrder(req.params.id, req.user);
        if (o.status === 'pending') {
            transaction(() => {
                run(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, o.id);
                run(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ?`, o.id);
            });
        } else if (o.status === 'paid') {
            if (!orderDetails(o).can_refund)
                throw new HttpError(400, `Вернуть билеты можно не позднее чем за ${REFUND_HOURS} ч до сеанса`);
            transaction(() => {
                run(`UPDATE orders SET status = 'refunded' WHERE id = ?`, o.id);
                run(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ?`, o.id);
            });
        } else throw new HttpError(400, 'Этот заказ нельзя отменить');
        res.json(orderDetails(get('SELECT * FROM orders WHERE id = ?', o.id)));
    });

    // Личный кабинет: все оплаченные заказы
    r.get('/api/my/orders', requireAuth, (req, res) => {
        const orders = all(`SELECT o.* FROM orders o JOIN sessions s ON s.id = o.session_id
                            WHERE o.user_id = ? AND o.status IN ('paid','refunded') ORDER BY s.starts_at DESC`, req.user.id);
        res.json(orders.map(orderDetails));
    });

    // QR-код билета. Внутри — ссылка на страницу проверки для контролёра
    r.get('/api/tickets/:code/qr.svg', (req, res) => {
        const user = currentUser(req);
        if (!user) throw new HttpError(401, 'Войдите в аккаунт');
        const t = get('SELECT t.code, o.user_id FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.code = ?', req.params.code);
        if (!t || (t.user_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Билет не найден');
        const host = req.headers.host || 'localhost:3000';
        res.send(qrSvg(`http://${host}/admin.html?check=${t.code}`), 'image/svg+xml');
    });
}
