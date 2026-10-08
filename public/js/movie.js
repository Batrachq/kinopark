// Страница фильма: описание + расписание по дням, кинотеатрам и залам
import { api, $, qs, esc, rub, poster, dayLabel, shortDate, weekday, time, duration, longDate, initPage, HALL_LABEL, dateKey } from './common.js';

initPage(1);

const id = Number(qs.get('id'));
let movie, selectedDay;
let cinema = (() => { try { return localStorage.getItem('kp_cinema') || ''; } catch { return ''; } })();

function renderMovie(m) {
    document.title = `${m.title} — КиноПарк`;
    const soon = m.release_date > dateKey(new Date());
    $('#movie').innerHTML = `
    <div class="movie-hero">
        <div class="poster-wrapper">${poster(m, m.genres[0] || '')}</div>
        <div>
            <div class="movie-chips">
                <span class="chip dark">${esc(m.age_rating)}</span>
                ${m.genres.map(g => `<span class="chip blue">${esc(g)}</span>`).join('')}
                ${soon ? `<span class="chip amber">Премьера ${longDate(m.release_date)}</span>` : ''}
            </div>
            <h1>${esc(m.title)}</h1>
            ${m.rating ? `<div class="rating-big">★ ${m.rating.toFixed(1)} <span class="muted" style="font-weight:400;font-size:13px">рейтинг зрителей</span></div>` : ''}
            <p class="movie-desc">${esc(m.description)}</p>
            <div class="facts">
                <div class="fact"><span>Длительность</span><strong>${duration(m.duration_min)}</strong></div>
                ${m.director ? `<div class="fact"><span>Режиссёр</span><strong>${esc(m.director)}</strong></div>` : ''}
                ${m.country ? `<div class="fact"><span>Страна</span><strong>${esc(m.country)}</strong></div>` : ''}
                ${m.year ? `<div class="fact"><span>Год</span><strong>${m.year}</strong></div>` : ''}
            </div>
        </div>
    </div>`;
}

function sessionsFiltered() {
    return movie.sessions.filter(s => !cinema || String(s.cinema.id) === cinema);
}

function renderDays() {
    const days = [...new Set(sessionsFiltered().map(s => s.starts_at.slice(0, 10)))];
    if (!days.includes(selectedDay)) selectedDay = days[0];
    $('#date-tabs').innerHTML = days.map(d => `
        <button class="date-tab ${d === selectedDay ? 'active' : ''}" data-day="${d}">
            <b>${['Сегодня', 'Завтра'].includes(dayLabel(d)) ? dayLabel(d) : weekday(d).replace(/^./, c => c.toUpperCase())}</b><small>${shortDate(d)}</small>
        </button>`).join('');
    renderSessions();
}

function renderSessions() {
    const box = $('#sessions');
    const list = sessionsFiltered().filter(s => s.starts_at.startsWith(selectedDay));
    if (!list.length) {
        const soon = movie.release_date > dateKey(new Date());
        box.innerHTML = `<div class="empty-state"><strong>${soon ? 'Расписание появится ближе к премьере' : 'Сеансов нет'}</strong>
            ${soon ? `Премьера — ${longDate(movie.release_date)}` : 'Попробуйте выбрать другой кинотеатр'}</div>`;
        return;
    }
    // Группировка: кинотеатр → зал → сеансы
    const byCinema = new Map();
    for (const s of list) {
        const c = byCinema.get(s.cinema.id) || byCinema.set(s.cinema.id, { cinema: s.cinema, halls: new Map() }).get(s.cinema.id);
        (c.halls.get(s.hall.id) || c.halls.set(s.hall.id, { hall: s.hall, items: [] }).get(s.hall.id)).items.push(s);
    }
    box.innerHTML = [...byCinema.values()].map(({ cinema: c, halls }) => `
        <div class="card cinema-block">
            <div class="cinema-head"><h3>${esc(c.name)}</h3><span>${esc(c.address)}</span></div>
            ${[...halls.values()].map(({ hall, items }) => `
            <div class="hall-row">
                <div class="hall-name">${esc(hall.name)}<small>${HALL_LABEL[hall.type]}</small></div>
                <div class="times">${items.map(s => {
                    const occ = Math.round(s.occupancy * 100);
                    const lvl = occ >= 80 ? 'high' : occ >= 50 ? 'mid' : '';
                    return `<a class="time-chip" href="/seats.html?session=${s.id}" title="Свободно мест: ${s.free_seats}">
                        <div class="tc-top"><span class="tc-time">${time(s.starts_at)}</span><span class="tc-format">${s.format}</span></div>
                        <div class="tc-price">от ${rub(s.min_price)}</div>
                        <div class="occ-bar"><i class="${lvl}" style="width:${Math.max(4, occ)}%"></i></div>
                    </a>`;
                }).join('')}</div>
            </div>`).join('')}
        </div>`).join('');
}

$('#date-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    selectedDay = b.dataset.day;
    document.querySelectorAll('.date-tab').forEach(t => t.classList.toggle('active', t === b));
    renderSessions();
});

$('#cinema-select').addEventListener('change', e => {
    cinema = e.target.value;
    try { localStorage.setItem('kp_cinema', cinema); } catch { }
    renderDays();
});

(async () => {
    try {
        const [m, cinemas] = await Promise.all([api(`/movies/${id}`), api('/cinemas')]);
        movie = m;
        $('#cinema-select').innerHTML += cinemas.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        if (!cinemas.some(c => String(c.id) === cinema)) cinema = '';
        $('#cinema-select').value = cinema;
        renderMovie(m);
        renderDays();
    } catch (e) {
        $('#movie').innerHTML = `<div class="empty-state" style="margin:28px 0"><strong>Фильм не найден</strong><a href="/">Вернуться к афише</a></div>`;
        $('#schedule').remove();
    }
})();
