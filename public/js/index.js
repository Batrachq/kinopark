// Афиша: фильмы из базы данных + фильтры (сейчас/скоро, жанр, кинотеатр, поиск)
import { api, $, esc, rub, poster, shortDate, initPage, toast } from './common.js';

initPage(1);

// Состояние фильтров сохраняем в адресной строке — так работает кнопка «назад»
const params = new URLSearchParams(location.search);
const state = {
    time: params.get('time') === 'soon' ? 'soon' : 'now',
    genre: params.get('genre') || 'Все жанры',
    cinema: params.get('cinema') || localStorageGet('kp_cinema') || '',
    q: '',
};

const grid = $('#movies-grid');
const genreBox = $('#genre-filters');
const timeButtons = document.querySelectorAll('.time-filters .btn-filter');
const cinemaSelect = $('#cinema-select');
let genres = [];

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } }

function syncUrl() {
    const p = new URLSearchParams();
    if (state.time !== 'now') p.set('time', state.time);
    if (state.genre !== 'Все жанры') p.set('genre', state.genre);
    if (state.cinema) p.set('cinema', state.cinema);
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

function renderGenres() {
    genreBox.innerHTML = ['Все жанры', ...genres].map(g => `
        <button class="genre-btn ${g === state.genre ? 'active' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('');
}

function skeleton() {
    grid.innerHTML = Array.from({ length: 8 }, () => `
        <div><div class="skeleton" style="aspect-ratio:2/3;margin-bottom:12px"></div>
        <div class="skeleton" style="height:16px;width:80%;margin-bottom:8px"></div>
        <div class="skeleton" style="height:12px;width:50%"></div></div>`).join('');
}

let reqId = 0;
async function renderMovies() {
    const my = ++reqId;
    skeleton();
    const p = new URLSearchParams({ status: state.time });
    if (state.genre !== 'Все жанры') p.set('genre', state.genre);
    if (state.cinema) p.set('cinema', state.cinema);
    if (state.q) p.set('q', state.q);
    let movies;
    try { movies = await api(`/movies?${p}`); }
    catch (e) { grid.innerHTML = `<div class="empty-state"><strong>Не удалось загрузить афишу</strong>${esc(e.message)}</div>`; return; }
    if (my !== reqId) return;   // пришёл устаревший ответ

    if (!movies.length) {
        grid.innerHTML = `<div class="empty-state"><strong>Фильмов по вашему запросу не найдено</strong>Попробуйте другой жанр или кинотеатр</div>`;
        return;
    }

    grid.innerHTML = movies.map(m => {
        const soon = state.time === 'soon';
        const topLeft = soon
            ? (m.presale ? `<span class="badge presale">Предпродажа</span>` : `<span class="badge release">с ${shortDate(m.release_date)}</span>`)
            : (m.rating ? `<span class="badge rating">★ ${m.rating.toFixed(1)}</span>` : '');
        const clickable = !soon || m.presale;
        return `
        <a class="movie-card" href="/movie.html?id=${m.id}">
            <div class="poster-wrapper">
                ${poster(m, m.genres[0] || '')}
                ${topLeft}
                <span class="badge age-limit">${esc(m.age_rating)}</span>
                <span class="buy-ticket-btn">${clickable ? 'Выбрать сеанс' : 'Подробнее'}</span>
            </div>
            <div class="movie-info">
                <h3>${esc(m.title)}</h3>
                <p class="movie-meta">${esc(m.genres.join(' / '))}</p>
                <p class="movie-meta">${m.duration_min} мин</p>
                <p class="movie-price">${soon && !m.presale ? `Премьера ${shortDate(m.release_date)}` : `от ${rub(m.min_price)}`}</p>
            </div>
        </a>`;
    }).join('');
}

// ---------- События ----------
timeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.time === state.time);
    btn.addEventListener('click', () => {
        timeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.time = btn.dataset.time;
        syncUrl(); renderMovies();
    });
});

genreBox.addEventListener('click', e => {
    const b = e.target.closest('[data-genre]');
    if (!b) return;
    state.genre = b.dataset.genre;
    renderGenres(); syncUrl(); renderMovies();
});

cinemaSelect.addEventListener('change', () => {
    state.cinema = cinemaSelect.value;
    localStorageSet('kp_cinema', state.cinema);
    syncUrl(); renderMovies();
});

let t;
$('#search').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim(); renderMovies(); }, 250);
});

// ---------- Старт ----------
(async () => {
    try {
        const [g, cinemas] = await Promise.all([api('/genres'), api('/cinemas')]);
        genres = g;
        cinemaSelect.innerHTML += cinemas.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        if (!cinemas.some(c => String(c.id) === state.cinema)) state.cinema = '';
        cinemaSelect.value = state.cinema;
    } catch (e) { toast(e.message, 'error'); }
    renderGenres();
    renderMovies();
})();
