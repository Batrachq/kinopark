// Подключение к SQLite (встроенный модуль Node.js, ничего устанавливать не нужно)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'kinopark.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

// --- Короткие помощники для запросов ---
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

// Транзакция: всё или ничего (нужно, чтобы два человека не купили одно место)
export function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

// --- Время: храним местное время строкой 'YYYY-MM-DD HH:MM' ---
const pad = n => String(n).padStart(2, '0');
export const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDateTimeStr = d => `${toDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toFullStr = d => `${toDateTimeStr(d)}:${pad(d.getSeconds())}`;
export const parseLocal = s => {
    const [date, time = '00:00'] = s.split(' ');
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm, ss = 0] = time.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, ss);
};
export const nowStr = () => toFullStr(new Date());
