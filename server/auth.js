// Пароли: scrypt с солью (встроенный crypto). Сессии: случайный токен в HttpOnly-cookie.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run, toFullStr, nowStr } from './db.js';
import { HttpError } from './http.js';

const COOKIE = 'kp_token';
const TOKEN_DAYS = 30;

export function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const a = Buffer.from(hash, 'hex');
    const b = scryptSync(password, salt, 64);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function startSession(res, userId) {
    const token = randomBytes(32).toString('hex');
    const exp = new Date(Date.now() + TOKEN_DAYS * 86_400_000);
    run('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, toFullStr(exp));
    res.setCookie(COOKIE, token, { maxAge: TOKEN_DAYS * 86_400 });
}

export function endSession(req, res) {
    if (req.cookies[COOKIE]) run('DELETE FROM auth_tokens WHERE token = ?', req.cookies[COOKIE]);
    res.setCookie(COOKIE, '', { maxAge: 0 });
}

export function currentUser(req) {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    return get(`SELECT u.id, u.email, u.name, u.phone, u.role, u.created_at
                FROM auth_tokens t JOIN users u ON u.id = t.user_id
                WHERE t.token = ? AND t.expires_at > ?`, token, nowStr()) || null;
}

export const publicUser = u => u && ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, created_at: u.created_at });

// Middleware: требует вход
export function requireAuth(req) {
    req.user = currentUser(req);
    if (!req.user) throw new HttpError(401, 'Войдите в аккаунт');
}

export function requireAdmin(req) {
    requireAuth(req);
    if (req.user.role !== 'admin') throw new HttpError(403, 'Доступ только для администратора');
}
