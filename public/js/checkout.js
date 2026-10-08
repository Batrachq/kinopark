// Шаг 3: таймер брони, бар, оплата
import { api, $, qs, esc, rub, whenText, initPage, toast, requireLogin, SEAT_LABEL, ICONS, plural } from './common.js';

initPage(3);

const orderId = Number(qs.get('order'));
let order, snacks = [];
const cart = new Map();     // snackId → qty
let timerId;

function renderSnacks() {
    $('#snacks').innerHTML = snacks.map(s => {
        const q = cart.get(s.id) || 0;
        return `<div class="snack ${q ? 'on' : ''}">
            <div class="snack-top"><div class="snack-icon">${ICONS[s.icon] || ICONS.popcorn}</div>
                <div><div class="snack-name">${esc(s.name)}</div><div class="snack-descr">${esc(s.descr || '')}</div></div></div>
            <div class="snack-bottom"><span class="snack-price">${rub(s.price)}</span>
                <span class="stepper"><button data-dec="${s.id}" ${q ? '' : 'disabled'} aria-label="Меньше">−</button><span>${q}</span>
                <button data-inc="${s.id}" ${q >= 10 ? 'disabled' : ''} aria-label="Больше">+</button></span></div>
        </div>`;
    }).join('');
}

function renderSummary() {
    const o = order;
    const snackLines = snacks.filter(s => cart.get(s.id)).map(s => ({ ...s, qty: cart.get(s.id) }));
    const snacksTotal = snackLines.reduce((a, s) => a + s.price * s.qty, 0);
    const total = o.tickets_total + snacksTotal;
    $('#summary').innerHTML = `
        <div class="card-title">${esc(o.session.movie.title)}</div>
        <p style="font-weight:600;margin-top:-8px">${whenText(o.session.starts_at)}</p>
        <p class="muted" style="font-size:14px;margin:4px 0 16px">${esc(o.session.cinema.name)}, ${esc(o.session.hall.name)} · ${o.session.format}</p>
        <ul class="sel-list">${o.tickets.map(t => `<li><span>${t.row} ряд, ${t.num} место <small class="muted">· ${SEAT_LABEL[t.type]}</small></span><span>${rub(t.price)}</span></li>`).join('')}
            ${snackLines.map(s => `<li><span>${esc(s.name)} × ${s.qty}</span><span>${rub(s.price * s.qty)}</span></li>`).join('')}</ul>
        <div class="total-row"><span>К оплате</span><strong>${rub(total)}</strong></div>
        <button class="btn btn-primary btn-lg btn-block" id="pay" form="pay-form">Оплатить ${rub(total)}</button>
        <p class="muted" style="font-size:12px;margin-top:12px;text-align:center">Билеты появятся в личном кабинете сразу после оплаты</p>`;
}

function startTimer(seconds) {
    const end = Date.now() + seconds * 1000;
    const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const el = $('#timer');
        el.innerHTML = `${ICONS.clock.replace('<svg', '<svg width="16" height="16"')} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        el.classList.toggle('urgent', left < 60);
        if (!left) { clearInterval(timerId); showExpired(); }
    };
    tick();
    timerId = setInterval(tick, 1000);
}

function showExpired() {
    $('#main').innerHTML = `<div class="card success-box" style="margin:40px auto;max-width:560px">
        <div class="success-icon" style="background:var(--warning-bg);color:var(--warning)">${ICONS.clock}</div>
        <h2>Время брони истекло</h2><p>Места снова доступны для покупки. Выберите их заново — это займёт минуту.</p>
        <a class="btn btn-primary btn-lg" href="/seats.html?session=${order.session.id}">Выбрать места</a></div>`;
}

function showSuccess(o) {
    clearInterval(timerId);
    document.querySelectorAll('.step').forEach(s => { s.classList.remove('active'); s.classList.add('done'); s.querySelector('.step-num').textContent = '✓'; });
    $('#main').innerHTML = `<div class="card success-box" style="margin:40px auto;max-width:600px">
        <div class="success-icon">${ICONS.check}</div>
        <h2>Оплата прошла!</h2>
        <p>${o.tickets.length} ${plural(o.tickets.length, 'билет', 'билета', 'билетов')} на «${esc(o.session.movie.title)}» — ${whenText(o.session.starts_at)}.<br>
           Покажите QR-код на входе в зал${o.snacks.length ? ' и на стойке бара' : ''}.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <a class="btn btn-primary btn-lg" href="/account.html">Открыть билеты</a>
            <a class="btn btn-outline btn-lg" href="/">На главную</a>
        </div></div>`;
}

// ---------- Поля карты с автоформатированием ----------
const card = $('#card'), exp = $('#exp'), cvc = $('#cvc'), holder = $('#holder');
card.addEventListener('input', () => {
    card.value = card.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
    $('#bc-num').textContent = (card.value + '•••• •••• •••• ••••'.slice(card.value.length)) || '•••• •••• •••• ••••';
});
exp.addEventListener('input', () => {
    const d = exp.value.replace(/\D/g, '').slice(0, 4);
    exp.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    $('#bc-exp').textContent = exp.value || 'ММ/ГГ';
});
cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, '').slice(0, 3); });
holder.addEventListener('input', () => {
    holder.value = holder.value.toUpperCase();
    $('#bc-holder').textContent = holder.value || 'Имя владельца';
});
$('#test-card').addEventListener('click', () => {
    card.value = '4242 4242 4242 4242'; card.dispatchEvent(new Event('input'));
    const d = new Date(); exp.value = `12${String(d.getFullYear() + 2).slice(2)}`; exp.dispatchEvent(new Event('input'));
    cvc.value = '123';
    if (!holder.value) { holder.value = 'KINOPARK STUDENT'; holder.dispatchEvent(new Event('input')); }
});

// ---------- События ----------
$('#snacks').addEventListener('click', e => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (!inc && !dec) return;
    const id = Number((inc || dec).dataset.inc || (inc || dec).dataset.dec);
    cart.set(id, Math.max(0, Math.min(10, (cart.get(id) || 0) + (inc ? 1 : -1))));
    renderSnacks(); renderSummary();
});

$('#pay-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#pay'), err = $('#pay-error');
    btn.disabled = true; err.classList.add('hidden');
    try {
        const paid = await api(`/orders/${orderId}/pay`, {
            method: 'POST',
            body: { card: { number: card.value, exp: exp.value, cvc: cvc.value, holder: holder.value },
                    snacks: [...cart].filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty })) },
        });
        showSuccess(paid);
    } catch (ex) {
        if (ex.status === 410) return showExpired();
        err.textContent = ex.message; err.classList.remove('hidden');
        btn.disabled = false;
    }
});

$('#back').addEventListener('click', async () => {
    try { await api(`/orders/${orderId}/cancel`, { method: 'POST' }); } catch { }
    location.href = `/seats.html?session=${order?.session.id ?? ''}`;
});

// ---------- Старт ----------
(async () => {
    const user = await requireLogin();
    if (!user) { location.href = '/'; return; }
    try {
        [order, snacks] = await Promise.all([api(`/orders/${orderId}`), api('/snacks')]);
    } catch (e) {
        $('#main').innerHTML = `<div class="empty-state" style="margin:40px 0"><strong>Заказ не найден</strong><a href="/">Вернуться к афише</a></div>`;
        return;
    }
    if (order.status === 'paid') return showSuccess(order);
    if (order.status !== 'pending') return showExpired();
    renderSnacks(); renderSummary();
    startTimer(order.expires_in);
})();
