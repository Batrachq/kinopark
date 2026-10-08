// =====================================================================
//  Динамическое ценообразование
//  Цена места = базовая цена фильма × зал × время сеанса × тип места
//               × спрос (заполненность зала) × ранняя покупка
//  Цену всегда считает сервер — клиенту доверять нельзя.
// =====================================================================
import { parseLocal } from './db.js';

export const SEAT_TYPE = {
    standard: { label: 'Обычное', mult: 1.0 },
    vip:      { label: 'VIP',     mult: 1.3 },
    sofa:     { label: 'Диван',   mult: 1.4 },
};

const HALL_LABEL = { standard: 'Стандартный зал', comfort: 'Зал «Комфорт»', imax: 'IMAX' };

// Коэффициент времени сеанса
function timeFactor(start) {
    const h = start.getHours();
    const weekend = start.getDay() === 0 || start.getDay() === 6;
    if (h < 12) return { mult: 0.7, label: 'Утренний сеанс' };
    if (!weekend && h < 17) return { mult: 0.85, label: 'Дневной сеанс в будни' };
    if (weekend) return { mult: 1.0, label: 'Выходной день' };
    return { mult: 1.0, label: 'Вечерний сеанс' };
}

// Коэффициент спроса: чем полнее зал, тем дороже оставшиеся места
function demandFactor(occupancy) {
    if (occupancy >= 0.8) return { mult: 1.25, label: 'Ажиотаж: зал заполнен на 80%+' };
    if (occupancy >= 0.6) return { mult: 1.15, label: 'Высокий спрос: зал заполнен на 60%+' };
    if (occupancy >= 0.4) return { mult: 1.05, label: 'Повышенный спрос' };
    return { mult: 1.0, label: null };
}

// Ранняя покупка: за 3+ дня до сеанса — скидка
function earlyFactor(start, now) {
    const days = (start - now) / 86_400_000;
    if (days >= 3) return { mult: 0.9, label: 'Ранняя покупка (за 3+ дня)' };
    return { mult: 1.0, label: null };
}

const round10 = x => Math.max(10, Math.round(x / 10) * 10);

/**
 * Считает коэффициенты сеанса (общие для всех мест).
 * @param {{base_price:number, hall_type:string, price_multiplier:number, starts_at:string}} s
 * @param {number} occupancy 0..1
 */
export function sessionPricing(s, occupancy, now = new Date()) {
    const start = parseLocal(s.starts_at);
    const factors = [];
    const push = (label, mult) => { if (label && mult !== 1) factors.push({ label, percent: Math.round((mult - 1) * 100) }); };

    const hall = { mult: s.price_multiplier, label: HALL_LABEL[s.hall_type] };
    const time = timeFactor(start);
    const demand = demandFactor(occupancy);
    const early = earlyFactor(start, now);

    push(hall.label, hall.mult);
    push(time.label, time.mult);
    push(demand.label, demand.mult);
    push(early.label, early.mult);

    const mult = hall.mult * time.mult * demand.mult * early.mult;
    const priceFor = seatType => round10(s.base_price * mult * (SEAT_TYPE[seatType]?.mult ?? 1));
    return { mult, factors, priceFor, minPrice: priceFor('standard') };
}
