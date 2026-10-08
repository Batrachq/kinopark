// Панель администратора
import { api, $, qs, esc, rub, shortDate, weekday, dayLabel, time, dateKey, whenText, initPage, toast, requireLogin, openModal, SEAT_LABEL, HALL_LABEL } from './common.js';

initPage(0);

const panel = $('#panel');
let tab = qs.get('check') ? 'check' : 'stats';
let halls = [], movies = [];
let sessionsDate = dateKey(new Date());

// ---------- Обзор ----------
async function renderStats() {
    const s = await api('/admin/stats');
    const max = Math.max(...s.days.map(d => d.revenue), 1);
    const avgOcc = s.days.reduce((a, d) => a + d.occupancy, 0) / s.days.length;
    panel.innerHTML = `
    <div class="stats-grid">
        <div class="stat"><span>Выручка за сегодня</span><b>${rub(s.today.revenue)}</b><small>${s.today.tickets} билетов</small></div>
        <div class="stat"><span>Онлайн-продажи</span><b>${rub(s.online.revenue)}</b><small>${s.online.orders} заказов, из них бар ${rub(s.online.snacks)}</small></div>
        <div class="stat"><span>Средняя заполняемость</span><b>${Math.round(avgOcc * 100)}%</b><small>на ближайшие 7 дней</small></div>
        <div class="stat"><span>Зрителей в системе</span><b>${s.users}</b><small>зарегистрировано</small></div>
    </div>
    <div class="admin-grid">
        <section class="card">
            <div class="card-title">Продажи по дням сеансов</div>
            <div class="bars">${s.days.map(d => `
                <div class="bar" title="${rub(d.revenue)} · ${d.tickets} билетов · заполнено ${Math.round(d.occupancy * 100)}%">
                    <em>${Math.round(d.revenue / 1000)}k</em><i style="height:${(d.revenue / max) * 100}%"></i>
                    <small>${['Сегодня', 'Завтра'].includes(dayLabel(d.date)) ? dayLabel(d.date) : weekday(d.date) + ' ' + shortDate(d.date).split(' ')[0]}</small></div>`).join('')}
            </div>
        </section>
        <section class="card">
            <div class="card-title">Топ фильмов недели</div>
            <table class="table"><tbody>${s.top.map((m, i) => `
                <tr><td style="width:24px;color:var(--text-light)">${i + 1}</td><td><b>${esc(m.title)}</b></td>
                <td class="nowrap muted">${m.tickets} бил.</td><td class="nowrap" style="text-align:right">${rub(m.revenue)}</td></tr>`).join('')}
            </tbody></table>
        </section>
    </div>
    <section class="card" style="margin-top:20px">
        <div class="card-title">Последние онлайн-заказы</div>
        ${s.recent.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>№</th><th>Зритель</th><th>Фильм</th><th>Сеанс</th><th>Билетов</th><th>Сумма</th><th>Оплачен</th></tr></thead>
            <tbody>${s.recent.map(o => `<tr><td>${o.id}</td><td>${esc(o.user_name)}</td><td>${esc(o.title)}</td>
                <td class="nowrap">${whenText(o.starts_at)}</td><td>${o.tickets}</td><td class="nowrap">${rub(o.total)}</td><td class="nowrap muted">${esc(o.paid_at)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted">Пока никто не купил билет онлайн</p>'}
    </section>`;
}

// ---------- Сеансы ----------
async function renderSessions() {
    const list = await api(`/admin/sessions?date=${sessionsDate}`);
    const days = Array.from({ length: 10 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i - 1); return dateKey(d); });
    panel.innerHTML = `
    <section class="card">
        <div class="toolbar">
            <div class="date-tabs" style="margin:0;flex:1">${days.map(d => `
                <button class="date-tab ${d === sessionsDate ? 'active' : ''}" data-date="${d}"><b>${weekday(d).replace(/^./, c => c.toUpperCase())}</b><small>${shortDate(d)}</small></button>`).join('')}</div>
            <button class="btn btn-primary" id="add-session">+ Добавить сеанс</button>
        </div>
        <div class="table-wrap"><table class="table">
            <thead><tr><th>Время</th><th>Фильм</th><th>Кинотеатр / зал</th><th>Формат</th><th>Заполнено</th><th>Цена от</th><th></th></tr></thead>
            <tbody>${list.map(s => {
                const occ = Math.round(s.occupancy * 100);
                return `<tr><td><b>${time(s.starts_at)}</b></td><td>${esc(s.movie.title)}</td>
                <td>${esc(s.cinema.name)}<br><small class="muted">${esc(s.hall.name)}</small></td><td>${s.format}</td>
                <td style="min-width:120px">${s.capacity - s.free_seats}/${s.capacity} <small class="muted">(${occ}%)</small>
                    <div class="occ-bar"><i class="${occ >= 80 ? 'high' : occ >= 50 ? 'mid' : ''}" style="width:${occ}%"></i></div>
                    ${s.online_tickets ? `<small class="muted">онлайн: ${s.online_tickets}</small>` : ''}</td>
                <td class="nowrap">${rub(s.min_price)}</td>
                <td class="actions"><a class="btn btn-outline btn-sm" href="/seats.html?session=${s.id}" target="_blank">Зал</a>
                    <button class="btn btn-danger btn-sm" data-del-session="${s.id}">Удалить</button></td></tr>`;
            }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">На этот день сеансов нет</td></tr>'}</tbody>
        </table></div>
    </section>`;
}

function sessionForm() {
    const m = openModal(`<h2>Новый сеанс</h2><p class="sub">Сервер проверит, что зал в это время свободен</p>
        <form novalidate>
            <div class="field"><label>Фильм</label><select name="movieId" required>${movies.filter(x => x.is_active).map(x => `<option value="${x.id}">${esc(x.title)} (${x.duration_min} мин)</option>`).join('')}</select></div>
            <div class="field"><label>Зал</label><select name="hallId" required>${halls.map(h => `<option value="${h.id}">${esc(h.cinema_name)} — ${esc(h.name)} (${HALL_LABEL[h.type]}, ${h.capacity} мест)</option>`).join('')}</select></div>
            <div class="field"><label>Начало</label><input name="startsAt" type="datetime-local" required value="${sessionsDate}T21:00"></div>
            <div class="field"><label>Формат</label><select name="format"><option>2D</option><option>3D</option></select><span class="hint">В IMAX-зале формат всегда IMAX</span></div>
            <div class="form-error hidden"></div>
            <button class="btn btn-primary btn-lg btn-block">Создать</button>
        </form>`);
    const form = m.el.querySelector('form');
    form.onsubmit = async e => {
        e.preventDefault();
        try {
            await api('/admin/sessions', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
            sessionsDate = form.startsAt.value.slice(0, 10);
            m.close(); toast('Сеанс добавлен', 'success'); renderSessions();
        } catch (err) { const b = form.querySelector('.form-error'); b.textContent = err.message; b.classList.remove('hidden'); }
    };
}

// ---------- Фильмы ----------
async function renderMovies() {
    movies = await api('/admin/movies');
    const today = dateKey(new Date());
    panel.innerHTML = `
    <section class="card">
        <div class="toolbar"><div class="card-title" style="margin:0">Фильмы (${movies.length})</div>
            <button class="btn btn-primary" id="add-movie">+ Добавить фильм</button></div>
        <div class="table-wrap"><table class="table">
            <thead><tr><th>Название</th><th>Жанры</th><th>Премьера</th><th>Длит.</th><th>Возраст</th><th>Базовая цена</th><th>Сеансов</th><th></th></tr></thead>
            <tbody>${movies.map(x => `<tr style="${x.is_active ? '' : 'opacity:.5'}">
                <td><b>${esc(x.title)}</b>${x.is_active ? '' : ' <span class="chip">снят с проката</span>'}${x.release_date > today ? ' <span class="chip amber">скоро</span>' : ''}</td>
                <td class="muted">${esc(x.genres || '')}</td><td class="nowrap">${shortDate(x.release_date)}</td><td>${x.duration_min}</td>
                <td>${esc(x.age_rating)}</td><td>${rub(x.base_price)}</td><td>${x.upcoming}</td>
                <td class="actions"><button class="btn btn-outline btn-sm" data-edit-movie="${x.id}">Изменить</button>
                    ${x.is_active ? `<button class="btn btn-danger btn-sm" data-del-movie="${x.id}">Удалить</button>` : ''}</td></tr>`).join('')}</tbody>
        </table></div>
    </section>`;
}

function movieForm(movie) {
    const m0 = movie || { age_rating: '12+', base_price: 400, release_date: dateKey(new Date()), is_active: 1 };
    const ages = ['0+', '6+', '12+', '16+', '18+'];
    const m = openModal(`<h2>${movie ? 'Редактировать фильм' : 'Новый фильм'}</h2><p class="sub">Цена билета будет меняться от базовой в зависимости от зала, времени и спроса</p>
        <form novalidate class="form-grid">
            <div class="field full"><label>Название</label><input name="title" value="${esc(m0.title || '')}" required></div>
            <div class="field full"><label>Описание</label><textarea name="description">${esc(m0.description || '')}</textarea></div>
            <div class="field full"><label>Жанры через запятую</label><input name="genres" value="${esc(m0.genres || '')}" placeholder="Фантастика, Драма"></div>
            <div class="field"><label>Длительность, мин</label><input name="duration_min" type="number" min="1" value="${m0.duration_min || ''}" required></div>
            <div class="field"><label>Возраст</label><select name="age_rating">${ages.map(a => `<option ${a === m0.age_rating ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
            <div class="field"><label>Базовая цена, ₽</label><input name="base_price" type="number" min="50" step="10" value="${m0.base_price}" required></div>
            <div class="field"><label>Рейтинг (0–10)</label><input name="rating" type="number" min="0" max="10" step="0.1" value="${m0.rating ?? ''}"></div>
            <div class="field"><label>Дата премьеры</label><input name="release_date" type="date" value="${m0.release_date}" required></div>
            <div class="field"><label>Год</label><input name="year" type="number" value="${m0.year || ''}"></div>
            <div class="field"><label>Режиссёр</label><input name="director" value="${esc(m0.director || '')}"></div>
            <div class="field"><label>Страна</label><input name="country" value="${esc(m0.country || '')}"></div>
            <div class="field full"><label>Ссылка на постер</label><input name="poster_url" value="${esc(m0.poster_url || '')}" placeholder="https://… (можно оставить пустым — постер нарисуется сам)"></div>
            ${movie && !movie.is_active ? `<div class="field full"><label><input type="checkbox" name="restore" style="height:auto"> Вернуть в прокат</label></div>` : ''}
            <div class="form-error full hidden"></div>
            <button class="btn btn-primary btn-lg full">${movie ? 'Сохранить' : 'Добавить фильм'}</button>
        </form>`, { wide: true });
    const form = m.el.querySelector('form');
    form.onsubmit = async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(form));
        body.is_active = movie ? (movie.is_active ? true : !!body.restore) : true;
        try {
            await api(movie ? `/admin/movies/${movie.id}` : '/admin/movies', { method: movie ? 'PUT' : 'POST', body });
            m.close(); toast(movie ? 'Сохранено' : 'Фильм добавлен. Сеансы для него можно создать во вкладке «Сеансы»', 'success'); renderMovies();
        } catch (err) { const b = form.querySelector('.form-error'); b.textContent = err.message; b.classList.remove('hidden'); }
    };
}

// ---------- Проверка билетов ----------
function renderCheck() {
    panel.innerHTML = `
    <section class="card check-box">
        <div class="card-title">Контроль на входе</div>
        <p class="muted" style="margin:-8px 0 16px;font-size:14px">Отсканируйте QR-код камерой телефона — откроется эта страница с кодом. Или введите код вручную.</p>
        <form class="check-form" id="check-form">
            <input name="code" placeholder="KP-XXXX-XXXX" value="${esc(qs.get('check') || '')}" autocomplete="off" required>
            <button class="btn btn-primary btn-lg">Проверить</button>
        </form>
        <div id="check-result"></div>
    </section>`;
    $('#check-form').onsubmit = e => { e.preventDefault(); check(e.target.code.value, false); };
    if (qs.get('check')) check(qs.get('check'), false);
}

async function check(code, use) {
    const r = await api('/admin/check', { method: 'POST', body: { code, use } });
    const cls = { valid: 'ok', admitted: 'ok', used: 'bad', invalid: 'bad', not_found: 'bad', early: 'warn' }[r.result];
    const icon = { valid: '✓', admitted: '✓', early: '⏱' }[r.result] || '✕';
    const t = r.ticket;
    $('#check-result').innerHTML = `
    <div class="check-result ${cls}">
        <h3>${icon} ${esc(r.message)}</h3>
        ${t ? `<dl>
            <dt>Фильм</dt><dd><b>${esc(t.movie)}</b></dd>
            <dt>Сеанс</dt><dd>${whenText(t.starts_at)}</dd>
            <dt>Зал</dt><dd>${esc(t.cinema)}, ${esc(t.hall)}</dd>
            <dt>Место</dt><dd><b>${t.row} ряд, ${t.seat} место</b> · ${SEAT_LABEL[t.seat_type]}</dd>
            <dt>Зритель</dt><dd>${esc(t.holder || 'Касса')}</dd>
            <dt>Код</dt><dd class="ticket-code">${esc(t.code)}</dd>
        </dl>` : ''}
        ${r.result === 'valid' ? `<button class="btn btn-primary btn-lg btn-block" style="margin-top:16px" id="admit">Пропустить в зал</button>` : ''}
    </div>`;
    $('#admit')?.addEventListener('click', () => check(code, true));
}

// ---------- Переключение вкладок ----------
async function show(name) {
    tab = name;
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    panel.innerHTML = '<div class="skeleton" style="height:300px"></div>';
    try {
        if (name === 'stats') await renderStats();
        if (name === 'sessions') await renderSessions();
        if (name === 'movies') await renderMovies();
        if (name === 'check') renderCheck();
    } catch (e) { panel.innerHTML = `<div class="empty-state"><strong>Ошибка</strong>${esc(e.message)}</div>`; }
}

$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });

panel.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-date]')) { sessionsDate = t.closest('[data-date]').dataset.date; return renderSessions(); }
    if (t.id === 'add-session') return sessionForm();
    if (t.id === 'add-movie') return movieForm();
    if (t.dataset.editMovie) return movieForm(movies.find(x => x.id === Number(t.dataset.editMovie)));
    if (t.dataset.delMovie) {
        try {
            const r = await api(`/admin/movies/${t.dataset.delMovie}`, { method: 'DELETE' });
            toast(r.archived ? 'На фильм уже куплены билеты — он снят с проката, но не удалён' : 'Фильм удалён', 'success');
            renderMovies();
        } catch (err) { toast(err.message, 'error'); }
    }
    if (t.dataset.delSession) {
        try { await api(`/admin/sessions/${t.dataset.delSession}`, { method: 'DELETE' }); toast('Сеанс удалён', 'success'); renderSessions(); }
        catch (err) { toast(err.message, 'error'); }
    }
});

(async () => {
    const user = await requireLogin();
    if (!user || user.role !== 'admin') {
        panel.innerHTML = `<div class="empty-state"><strong>Доступ только для администратора</strong>Войдите как admin@kinopark.ru</div>`;
        return;
    }
    [halls, movies] = await Promise.all([api('/admin/halls'), api('/admin/movies')]);
    show(tab);
})();
