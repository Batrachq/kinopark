// =====================================================================
//  Общий код для всех страниц: запросы к API, шапка, вход/регистрация,
//  уведомления, форматирование, постеры
// =====================================================================

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || 'Ошибка сервера');
        err.status = res.status;
        throw err;
    }
    return data;
}

// ---------- Утилиты ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const qs = new URLSearchParams(location.search);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rub = n => `${Number(n).toLocaleString('ru-RU')} ₽`;

export function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function parseLocal(s) {
    const [d, t = '00:00'] = s.split(' ');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return new Date(y, m - 1, day, hh, mm);
}
export const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dayLabel(dateStr) {
    const d = parseLocal(dateStr.slice(0, 10));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86_400_000);
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Завтра';
    return WEEKDAYS_FULL[d.getDay()][0].toUpperCase() + WEEKDAYS_FULL[d.getDay()].slice(1);
}
export const shortDate = s => { const d = parseLocal(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
export const longDate = s => { const d = parseLocal(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const weekday = s => WEEKDAYS[parseLocal(s).getDay()];
export const time = s => s.slice(11, 16);
export function whenText(s) {
    const label = dayLabel(s);
    const base = `${longDate(s)}, ${time(s)}`;
    return label === 'Сегодня' || label === 'Завтра' ? `${label}, ${base}` : `${base}, ${weekday(s)}`;
}
export const duration = min => `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;

export const SEAT_LABEL = { standard: 'Обычное', vip: 'VIP', sofa: 'Диван' };
export const HALL_LABEL = { standard: 'Стандарт', comfort: 'Комфорт', imax: 'IMAX' };

// ---------- Постер ----------
const PALETTES = [['#1e3a8a', '#3b82f6'], ['#0f172a', '#2563eb'], ['#312e81', '#6366f1'], ['#0c4a6e', '#0ea5e9'],
                  ['#1e40af', '#60a5fa'], ['#3730a3', '#2563eb'], ['#164e63', '#22d3ee'], ['#1e293b', '#475569']];
export function poster(movie, sub = '') {
    const [g1, g2] = PALETTES[movie.id % PALETTES.length];
    const gen = `<div class="poster-gen" style="--g1:${g1};--g2:${g2}">
        <div class="pg-title">${esc(movie.title)}</div>${sub ? `<div class="pg-sub">${esc(sub)}</div>` : ''}</div>`;
    const img = movie.poster_url ? `<img src="${esc(movie.poster_url)}" alt="${esc(movie.title)}" loading="lazy" onerror="this.remove()">` : '';
    return gen + img;
}

// ---------- Иконки (inline SVG) ----------
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
    ticket: svg('<path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M13 5v2M13 11v2M13 17v2"/>'),
    qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
    seat: svg('<path d="M5 11V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5"/><path d="M3 11h18v5H3zM6 16v4M18 16v4"/>'),
    trend: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    check: svg('<path d="m5 12 5 5L20 7"/>', 'stroke-width="3"'),
    back: svg('<path d="m15 18-6-6 6-6"/>'),
    star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/>'),
    popcorn: svg('<path d="M6 9 8 21h8l2-12"/><path d="M5 9a2 2 0 0 1 1-3.7A3 3 0 0 1 12 4a3 3 0 0 1 6 1.3A2 2 0 0 1 19 9z"/><path d="M10 9l.5 12M14 9l-.5 12"/>'),
    nachos: svg('<path d="M3 20 12 4l9 16z"/><path d="M8 14h.01M12 11h.01M14 16h.01"/>'),
    hotdog: svg('<path d="M4 15a3 3 0 0 0 0-6h16a3 3 0 0 1 0 6z" transform="translate(0 1)"/><path d="M6 12c2-1 4 1 6 0s4-1 6 0"/>'),
    drink: svg('<path d="M6 8h12l-1.5 13h-9z"/><path d="M5 8h14M12 8l2-6h3"/>'),
    combo: svg('<path d="M3 10 4.5 21h6L12 10z"/><path d="M13 10h8l-1.2 11h-5.6z"/><path d="M15 10l1.5-6h2.5"/><path d="M3 10a2 2 0 0 1 2-3 2.5 2.5 0 0 1 4.5 0A2 2 0 0 1 12 10"/>'),
};

// ---------- Уведомления ----------
export function toast(msg, type = '') {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    box.append(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ---------- Модальное окно ----------
export function openModal(html, { wide = false, onClose } = {}) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <button class="modal-close" aria-label="Закрыть">×</button>${html}</div>`;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    back.querySelector('.modal-close').onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    back.querySelector('input, select, textarea')?.focus();
    return { el: back.querySelector('.modal'), close };
}

// ---------- Текущий пользователь ----------
let currentUser;
export async function getUser(force = false) {
    if (currentUser === undefined || force) {
        try { currentUser = (await api('/me')).user; } catch { currentUser = null; }
    }
    return currentUser;
}

// Вход / регистрация. Возвращает Promise<user|null>
export function authModal(mode = 'login') {
    return new Promise(resolve => {
        let done = false;
        const render = () => mode === 'login' ? `
            <h2>Вход</h2><p class="sub">Чтобы покупать билеты и видеть их в личном кабинете</p>
            <form novalidate>
                <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
                <div class="field"><label>Пароль</label><input name="password" type="password" autocomplete="current-password" required></div>
                <div class="form-error hidden"></div>
                <button class="btn btn-primary btn-lg btn-block">Войти</button>
                <div class="demo-hint">Демо-аккаунты: <b>demo@kinopark.ru</b> / demo123 · админ <b>admin@kinopark.ru</b> / admin123</div>
                <div class="modal-switch">Нет аккаунта? <button type="button" data-switch>Зарегистрироваться</button></div>
            </form>` : `
            <h2>Регистрация</h2><p class="sub">Займёт меньше минуты</p>
            <form novalidate>
                <div class="field"><label>Имя</label><input name="name" autocomplete="name" required></div>
                <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
                <div class="field"><label>Телефон <span class="muted">(необязательно)</span></label><input name="phone" type="tel" autocomplete="tel" placeholder="+7"></div>
                <div class="field"><label>Пароль</label><input name="password" type="password" autocomplete="new-password" minlength="6" required><span class="hint">Не короче 6 символов</span></div>
                <div class="form-error hidden"></div>
                <button class="btn btn-primary btn-lg btn-block">Создать аккаунт</button>
                <div class="modal-switch">Уже есть аккаунт? <button type="button" data-switch>Войти</button></div>
            </form>`;

        const m = openModal(render(), { onClose: () => { if (!done) resolve(null); } });
        const bind = () => {
            const form = m.el.querySelector('form');
            m.el.querySelector('[data-switch]').onclick = () => {
                mode = mode === 'login' ? 'register' : 'login';
                m.el.innerHTML = '<button class="modal-close" aria-label="Закрыть">×</button>' + render();
                m.el.querySelector('.modal-close').onclick = m.close;
                bind();
                m.el.querySelector('input').focus();
            };
            form.onsubmit = async e => {
                e.preventDefault();
                const btn = form.querySelector('.btn-primary');
                const errBox = form.querySelector('.form-error');
                btn.disabled = true; errBox.classList.add('hidden');
                try {
                    const { user } = await api(mode === 'login' ? '/auth/login' : '/auth/register',
                        { method: 'POST', body: Object.fromEntries(new FormData(form)) });
                    currentUser = user;
                    done = true;
                    m.close();
                    renderHeader();
                    toast(mode === 'login' ? `Здравствуйте, ${user.name}!` : 'Аккаунт создан', 'success');
                    resolve(user);
                } catch (err) {
                    errBox.textContent = err.message; errBox.classList.remove('hidden');
                    btn.disabled = false;
                }
            };
        };
        bind();
    });
}

export async function requireLogin() {
    return (await getUser()) || authModal('login');
}

export async function logout() {
    await api('/auth/logout', { method: 'POST' });
    currentUser = null;
    location.href = '/';
}

// ---------- Шапка ----------
let headerStep = 0;
export async function renderHeader(step = headerStep) {
    headerStep = step;
    const header = $('#site-header');
    if (!header) return;
    const user = await getUser();
    const steps = ['Фильмы', 'Места', 'Оплата'];
    const page = location.pathname;
    const middle = step
        ? `<nav class="steps" aria-label="Этапы покупки">${steps.map((s, i) => `
            ${i ? '<span class="separator">›</span>' : ''}
            <span class="step ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}">
                <span class="step-num">${i + 1 < step ? '✓' : i + 1}</span><span class="step-label">${s}</span></span>`).join('')}</nav>`
        : `<nav class="main-nav">
            <a href="/" class="${page === '/' || page === '/index.html' ? 'active' : ''}">Афиша</a>
            ${user ? `<a href="/account.html" class="${page.startsWith('/account') ? 'active' : ''}">Мои билеты</a>` : ''}
            ${user?.role === 'admin' ? `<a href="/admin.html" class="${page.startsWith('/admin') ? 'active' : ''}">Админка</a>` : ''}
           </nav>`;
    const initials = user ? user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : '';
    header.innerHTML = `
        <div class="container header-content">
            <a class="logo" href="/"><div class="logo-icon">K</div><span>КиноПарк</span></a>
            ${middle}
            <div class="auth-buttons">
                ${user
                    ? `${step && user.role === 'admin' ? '<a class="login" href="/admin.html">Админка</a>' : ''}
                       <a class="user-chip" href="/account.html" title="Личный кабинет"><span class="avatar">${esc(initials)}</span>${esc(user.name.split(' ')[0])}</a>
                       <button class="login" data-logout>Выйти</button>`
                    : `<button class="login" data-login>Войти</button>
                       <button class="register-btn" data-register>Регистрация</button>`}
            </div>
        </div>`;
    header.querySelector('[data-login]')?.addEventListener('click', () => authModal('login'));
    header.querySelector('[data-register]')?.addEventListener('click', () => authModal('register'));
    header.querySelector('[data-logout]')?.addEventListener('click', logout);
}

export function renderFooter() {
    const f = $('#site-footer');
    if (f) f.innerHTML = `<div class="container">
        <span>© ${new Date().getFullYear()} КиноПарк — сеть кинотеатров. Учебный проект.</span>
        <span>Электронный билет · QR-вход · Динамические цены</span></div>`;
}

export function initPage(step = 0) {
    renderHeader(step);
    renderFooter();
}
