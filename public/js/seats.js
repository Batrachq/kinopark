// Шаг 2: схема зала, выбор мест, динамическая цена, бронирование
import { api, $, qs, esc, rub, poster, whenText, duration, initPage, toast, requireLogin, plural, SEAT_LABEL, HALL_LABEL, ICONS } from './common.js';

initPage(2);

const sessionId = Number(qs.get('session'));
const MAX = 8;
let session;
const selected = new Map();          // seatId → seat
const byId = new Map();

function renderBar(s) {
    document.title = `${s.movie.title}, ${whenText(s.starts_at)} — КиноПарк`;
    $('#back').href = `/movie.html?id=${s.movie.id}`;
    $('#session-bar').innerHTML = `
    <div class="session-bar">
        <div class="poster-wrapper mini-poster">${poster(s.movie)}</div>
        <div>
            <h2>${esc(s.movie.title)}</h2>
            <div class="sb-meta">
                <span><b style="color:var(--text-dark)">${whenText(s.starts_at)}</b></span>
                <span>${esc(s.cinema.name)}, ${esc(s.hall.name)}${s.hall.name.includes(HALL_LABEL[s.hall.type]) ? '' : ' · ' + HALL_LABEL[s.hall.type]}</span>
                <span>${s.format !== s.hall.name ? s.format + ' · ' : ''}${duration(s.movie.duration_min)} · ${esc(s.movie.age_rating)}</span>
            </div>
        </div>
    </div>`;
}

// Проходы: в широких залах ряд делится на три блока
function aisleAfter(perRow) {
    if (perRow >= 14) { const side = Math.round(perRow / 4); return new Set([side, perRow - side]); }
    return new Set();
}

function renderMap() {
    const s = session;
    const rows = new Map();
    for (const seat of s.seats) (rows.get(seat.row) || rows.set(seat.row, []).get(seat.row)).push(seat);
    const aisles = aisleAfter(s.hall.seats_per_row);

    $('#seat-map').innerHTML = [...rows.entries()].map(([row, seats]) => {
        // Ряд диванов короче — центрируем его
        let html = '';
        seats.forEach((seat, i) => {
            const cls = ['seat', seat.type !== 'standard' ? seat.type : '',
                seat.type === 'sofa' ? (seat.num % 2 ? 'left' : 'right') : '',
                selected.has(seat.id) ? 'selected' : ''].join(' ');
            html += `<button class="${cls}" data-id="${seat.id}" ${seat.taken ? 'disabled' : ''}
                        aria-label="Ряд ${row}, место ${seat.num}, ${SEAT_LABEL[seat.type]}, ${seat.price} рублей${seat.taken ? ', занято' : ''}"><span>${seat.num}</span></button>`;
            if (aisles.has(i + 1) && seat.type !== 'sofa') html += '<span class="aisle"></span>';
        });
        return `<div class="seat-row"><span class="row-label">${row}</span><div class="seats-line">${html}</div><span class="row-label">${row}</span></div>`;
    }).join('');

    const types = Object.entries(s.seat_types).filter(([k]) => s.seats.some(x => x.type === k));
    $('#legend').innerHTML = types.map(([k, v]) =>
        `<span><i class="seat ${k !== 'standard' ? k : ''}"></i>${v.label} <b>${rub(v.price)}</b></span>`).join('') +
        `<span><i class="seat selected"></i>Выбрано</span><span><i class="seat" style="background:var(--bg-gray);border-color:var(--border)"></i>Занято</span>`;
}

function renderSummary() {
    const list = [...selected.values()].sort((a, b) => a.row - b.row || a.num - b.num);
    $('#sel-count').textContent = `${list.length} из ${MAX}`;
    $('#sel-box').innerHTML = list.length
        ? `<ul class="sel-list">${list.map(x => `
            <li><span><b>${x.row} ряд, ${x.num} место</b><br><small class="muted">${SEAT_LABEL[x.type]}</small></span>
                <span class="nowrap">${rub(x.price)} <button class="x" data-remove="${x.id}" aria-label="Убрать">×</button></span></li>`).join('')}</ul>`
        : `<div class="sel-empty">Нажмите на свободное место на схеме зала</div>`;
    $('#total').textContent = rub(list.reduce((a, x) => a + x.price, 0));
    $('#next').disabled = !list.length || !session.sales_open;
    $('#next').textContent = list.length ? `Оплатить ${list.length} ${plural(list.length, 'билет', 'билета', 'билетов')}` : 'Перейти к оплате';
    try { sessionStorage.setItem(`kp_sel_${sessionId}`, JSON.stringify([...selected.keys()])); } catch { }
}

function renderFactors() {
    const f = session.factors;
    $('#factors').innerHTML = `
        <h4>${ICONS.trend.replace('<svg', '<svg width="16" height="16"')} Как сформирована цена</h4>
        ${f.length ? `<ul>${f.map(x => `<li><span>${esc(x.label)}</span><span class="${x.percent > 0 ? 'up' : 'down'}">${x.percent > 0 ? '+' : ''}${x.percent}%</span></li>`).join('')}</ul>`
                   : '<p class="muted">Базовая цена, без наценок и скидок</p>'}
        <p class="muted" style="margin-top:8px;font-size:12px">Заполнено ${Math.round(session.occupancy * 100)}% зала. Чем больше спрос, тем дороже оставшиеся места; ранние билеты дешевле.</p>`;
}

function toggle(seat) {
    // Диван продаётся парой: выбираем обе половины
    const group = [seat];
    if (seat.type === 'sofa') {
        const partner = session.seats.find(x => x.row === seat.row && x.num === (seat.num % 2 ? seat.num + 1 : seat.num - 1));
        if (partner && !partner.taken) group.push(partner);
    }
    if (selected.has(seat.id)) group.forEach(x => selected.delete(x.id));
    else {
        if (selected.size + group.length > MAX) return toast(`За один раз можно купить не больше ${MAX} билетов`, 'error');
        group.forEach(x => selected.set(x.id, x));
    }
    group.forEach(x => document.querySelector(`.seat[data-id="${x.id}"]`)?.classList.toggle('selected', selected.has(x.id)));
    renderSummary();
}

// ---------- События ----------
const tip = $('#tip');
$('#seat-map').addEventListener('click', e => {
    const b = e.target.closest('.seat');
    if (b && !b.disabled) toggle(byId.get(Number(b.dataset.id)));
});
$('#seat-map').addEventListener('mouseover', e => {
    const b = e.target.closest('.seat');
    if (!b) return tip.classList.add('hidden');
    const s = byId.get(Number(b.dataset.id));
    const r = b.getBoundingClientRect();
    tip.innerHTML = s.taken ? `${s.row} ряд, ${s.num} место — занято`
        : `${s.row} ряд, ${s.num} место · ${SEAT_LABEL[s.type]}<br><b>${rub(s.price)}</b>${s.type === 'sofa' ? ' <small>за место</small>' : ''}`;
    tip.style.left = `${r.left + r.width / 2}px`;
    tip.style.top = `${r.top}px`;
    tip.classList.remove('hidden');
});
$('#seat-map').addEventListener('mouseleave', () => tip.classList.add('hidden'));
window.addEventListener('scroll', () => tip.classList.add('hidden'), { passive: true });

$('#sel-box').addEventListener('click', e => {
    const b = e.target.closest('[data-remove]');
    if (b) toggle(byId.get(Number(b.dataset.remove)));
});

$('#next').addEventListener('click', async () => {
    const user = await requireLogin();
    if (!user) return;
    const btn = $('#next');
    btn.disabled = true;
    try {
        const { orderId } = await api('/orders', { method: 'POST', body: { sessionId, seatIds: [...selected.keys()] } });
        try { sessionStorage.removeItem(`kp_sel_${sessionId}`); } catch { }
        location.href = `/checkout.html?order=${orderId}`;
    } catch (e) {
        toast(e.message, 'error');
        if (e.status === 409) await load(true);
        btn.disabled = false;
    }
});

// ---------- Загрузка (и обновление каждые 20 секунд — видно, как места занимают другие) ----------
async function load(refresh = false) {
    const s = await api(`/sessions/${sessionId}`);
    session = s;
    byId.clear();
    s.seats.forEach(x => byId.set(x.id, x));
    // Если выбранное место заняли или цена изменилась — обновляем выбор
    let lost = 0;
    for (const id of [...selected.keys()]) {
        const fresh = byId.get(id);
        if (!fresh || fresh.taken) { selected.delete(id); lost++; } else selected.set(id, fresh);
    }
    if (lost && refresh) toast(`${lost} ${plural(lost, 'место уже заняли', 'места уже заняли', 'мест уже заняли')}. Выберите другие.`, 'error');
    renderMap(); renderSummary(); renderFactors();
}

(async () => {
    try {
        await load();
        renderBar(session);
        try {
            for (const id of JSON.parse(sessionStorage.getItem(`kp_sel_${sessionId}`) || '[]')) {
                const seat = byId.get(id);
                if (seat && !seat.taken) selected.set(id, seat);
            }
        } catch { }
        renderMap(); renderSummary();
        const hc = document.querySelector('.map-scroll');
        hc.scrollLeft = (hc.scrollWidth - hc.clientWidth) / 2;
        if (!session.sales_open) {
            $('#sel-box').innerHTML = '<div class="sel-empty">Продажа на этот сеанс закрыта</div>';
        }
        setInterval(() => load(true).catch(() => { }), 20_000);
    } catch (e) {
        document.querySelector('.booking-layout').innerHTML = `<div class="empty-state"><strong>Сеанс не найден</strong><a href="/">Вернуться к афише</a></div>`;
    }
})();
