// Личный кабинет: профиль, билеты с QR-кодами, возврат
import { api, $, esc, rub, poster, whenText, parseLocal, initPage, toast, requireLogin, openModal, renderHeader, getUser, plural, SEAT_LABEL } from './common.js';

initPage(0);

let orders = [], tab = 'upcoming', user;

const isPast = o => parseLocal(o.session.starts_at).getTime() + o.session.movie.duration_min * 60_000 < Date.now();

function renderProfile() {
    const initials = user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const paid = orders.filter(o => o.status === 'paid');
    const tickets = paid.reduce((a, o) => a + o.tickets.length, 0);
    $('#profile').innerHTML = `
        <div class="avatar">${esc(initials)}</div>
        <h2>${esc(user.name)}</h2>
        <p class="muted">${esc(user.email)}</p>
        ${user.phone ? `<p class="muted">${esc(user.phone)}</p>` : ''}
        <div class="profile-stats">
            <div><b>${tickets}</b><span>${plural(tickets, 'билет', 'билета', 'билетов')}</span></div>
            <div><b>${paid.filter(o => !isPast(o)).length}</b><span>впереди</span></div>
        </div>
        <button class="btn btn-outline btn-block" id="edit">Редактировать профиль</button>`;
    $('#edit').onclick = editProfile;
}

function editProfile() {
    const m = openModal(`<h2>Профиль</h2><p class="sub">${esc(user.email)}</p>
        <form novalidate>
            <div class="field"><label>Имя</label><input name="name" value="${esc(user.name)}" required></div>
            <div class="field"><label>Телефон</label><input name="phone" type="tel" value="${esc(user.phone || '')}"></div>
            <div class="form-error hidden"></div>
            <button class="btn btn-primary btn-lg btn-block">Сохранить</button>
        </form>`);
    const form = m.el.querySelector('form');
    form.onsubmit = async e => {
        e.preventDefault();
        try {
            user = (await api('/me', { method: 'PUT', body: Object.fromEntries(new FormData(form)) })).user;
            await getUser(true); renderHeader(); renderProfile(); m.close(); toast('Сохранено', 'success');
        } catch (err) { const box = form.querySelector('.form-error'); box.textContent = err.message; box.classList.remove('hidden'); }
    };
}

function ticketCard(o) {
    const past = isPast(o);
    const refunded = o.status === 'refunded';
    const used = o.tickets.every(t => t.status === 'used');
    const status = refunded ? '<span class="chip red">Возвращён</span>'
        : used ? '<span class="chip">Использован</span>'
        : past ? '<span class="chip">Сеанс прошёл</span>'
        : '<span class="chip green">Оплачен</span>';
    const first = o.tickets.find(t => t.status !== 'cancelled') || o.tickets[0];
    return `
    <article class="ticket ${past || refunded ? 'past' : ''}">
        <div class="ticket-main">
            <a class="poster-wrapper" href="/movie.html?id=${o.session.movie.id}">${poster(o.session.movie)}</a>
            <div style="min-width:0">
                <h3>${esc(o.session.movie.title)}</h3>
                <div class="ticket-when">${whenText(o.session.starts_at)}</div>
                <div class="ticket-where">${esc(o.session.cinema.name)}, ${esc(o.session.cinema.address)} · ${esc(o.session.hall.name)} · ${o.session.format}</div>
                <div class="ticket-seats">${o.tickets.map(t => `<span class="chip ${t.type === 'vip' ? 'violet' : t.type === 'sofa' ? 'amber' : 'blue'}">${t.row} ряд, ${t.num} место</span>`).join('')}</div>
                ${o.snacks.length ? `<div class="ticket-where">Бар: ${o.snacks.map(s => `${esc(s.name)} × ${s.qty}`).join(', ')}</div>` : ''}
                <div class="ticket-foot">${status}<span>Заказ №${o.id}</span><span>${rub(o.total)}</span>
                    ${o.can_refund ? `<button class="btn btn-danger btn-sm" data-refund="${o.id}">Вернуть билеты</button>` : ''}</div>
            </div>
        </div>
        <div class="ticket-stub">
            ${refunded ? '<span class="muted" style="font-size:13px;text-align:center">Билеты<br>аннулированы</span>' : `
            <button class="qr-btn" data-qr="${o.id}" title="Открыть QR-код"><img src="/api/tickets/${first.code}/qr.svg" alt="QR-код билета"></button>
            <span class="ticket-code">${first.code}</span>
            ${o.tickets.length > 1 ? `<span class="muted" style="font-size:12px">+ ещё ${o.tickets.length - 1}</span>` : ''}`}
        </div>
    </article>`;
}

function renderTickets() {
    const list = orders.filter(o => tab === 'past' ? (isPast(o) || o.status === 'refunded') : (!isPast(o) && o.status === 'paid'));
    if (tab === 'upcoming') list.sort((a, b) => a.session.starts_at.localeCompare(b.session.starts_at));
    $('#tickets').innerHTML = list.length ? list.map(ticketCard).join('')
        : `<div class="empty-state"><strong>${tab === 'past' ? 'История пуста' : 'Нет предстоящих сеансов'}</strong>
           ${tab === 'past' ? '' : '<a class="btn btn-primary" href="/" style="margin-top:14px">Выбрать фильм</a>'}</div>`;
}

function showQr(order) {
    const tickets = order.tickets.filter(t => t.status !== 'cancelled');
    let i = 0;
    const m = openModal('<div class="qr-modal-body"></div>');
    const draw = () => {
        const t = tickets[i];
        m.el.querySelector('.qr-modal-body').innerHTML = `
            <h2>${esc(order.session.movie.title)}</h2>
            <p class="sub">${whenText(order.session.starts_at)} · ${esc(order.session.hall.name)}</p>
            <img src="/api/tickets/${t.code}/qr.svg" alt="QR-код">
            <div style="font-size:18px;font-weight:700">${t.row} ряд, ${t.num} место</div>
            <div class="muted" style="font-size:13px;margin-top:4px">${SEAT_LABEL[t.type]} · ${rub(t.price)} · <span class="ticket-code">${t.code}</span></div>
            ${t.status === 'used' ? '<div class="chip" style="margin-top:10px">Уже использован</div>' : ''}
            ${tickets.length > 1 ? `<div class="qr-pager"><button class="btn btn-outline btn-sm" data-p="-1" ${i ? '' : 'disabled'}>←</button>
                <span>Билет ${i + 1} из ${tickets.length}</span><button class="btn btn-outline btn-sm" data-p="1" ${i < tickets.length - 1 ? '' : 'disabled'}>→</button></div>` : ''}
            <p class="muted" style="font-size:13px;margin-top:16px">Покажите код контролёру на входе в зал. Яркость экрана — на максимум.</p>`;
        m.el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { i += Number(b.dataset.p); draw(); });
    };
    draw();
}

// ---------- События ----------
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    tab = b.dataset.tab; renderTickets();
}));

$('#tickets').addEventListener('click', async e => {
    const qr = e.target.closest('[data-qr]');
    if (qr) return showQr(orders.find(o => o.id === Number(qr.dataset.qr)));
    const rf = e.target.closest('[data-refund]');
    if (!rf) return;
    const o = orders.find(x => x.id === Number(rf.dataset.refund));
    const m = openModal(`<h2>Вернуть билеты?</h2>
        <p class="sub">«${esc(o.session.movie.title)}», ${whenText(o.session.starts_at)}. ${o.tickets.length} ${plural(o.tickets.length, 'билет', 'билета', 'билетов')} — ${rub(o.total)} вернутся на карту •••• ${esc(o.card_last4 || '')}.</p>
        <div style="display:flex;gap:10px"><button class="btn btn-danger btn-lg" style="flex:1" data-yes>Вернуть</button>
        <button class="btn btn-outline btn-lg" style="flex:1" data-no>Отмена</button></div>`);
    m.el.querySelector('[data-no]').onclick = m.close;
    m.el.querySelector('[data-yes]').onclick = async () => {
        try {
            const upd = await api(`/orders/${o.id}/cancel`, { method: 'POST' });
            orders = orders.map(x => x.id === upd.id ? upd : x);
            m.close(); renderProfile(); renderTickets(); toast('Билеты возвращены, деньги вернутся на карту', 'success');
        } catch (err) { toast(err.message, 'error'); }
    };
});

(async () => {
    user = await requireLogin();
    if (!user) { location.href = '/'; return; }
    renderHeader();
    orders = await api('/my/orders');
    renderProfile();
    renderTickets();
})();
