// =====================================================================
//  Генератор QR-кодов без внешних библиотек (байтовый режим, уровень коррекции M).
//  Алгоритм по стандарту ISO/IEC 18004: данные → коды Рида—Соломона →
//  размещение в матрице → маска → SVG.
// =====================================================================

const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS    = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_ECL_M = 0;

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const n = Math.floor(ver / 7) + 2;
        r -= (25 * n - 10) * n - 55;
        if (ver >= 7) r -= 36;
    }
    return r;
}
const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}
function rsDivisor(degree) {
    const r = new Array(degree - 1).fill(0).concat([1]);
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < r.length; j++) {
            r[j] = gfMul(r[j], root);
            if (j + 1 < r.length) r[j] ^= r[j + 1];
        }
        root = gfMul(root, 2);
    }
    return r;
}
function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
        const f = b ^ r.shift();
        r.push(0);
        div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
    }
    return r;
}

export function makeQrMatrix(text) {
    const bytes = [...Buffer.from(text, 'utf8')];
    let ver = 1;
    for (; ver <= 40; ver++) {
        const ccBits = ver < 10 ? 8 : 16;
        if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error('Слишком длинный текст для QR');

    // 1. Битовый поток
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0b0100, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // 2. Коррекция ошибок и чередование блоков
    const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, div);
        if (i < nShort) dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++)
        blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]); });

    // 3. Матрица и служебные узоры
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
            if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
        }
    const align = [];
    if (ver > 1) {
        const n = Math.floor(ver / 7) + 2;
        const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
        align.push(6);
        for (let p = size - 7; align.length < n; p -= step) align.splice(1, 0, p);
    }
    align.forEach((ax, i) => align.forEach((ay, j) => {
        const last = align.length - 1;
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
            setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = mask => {
        const d = (FORMAT_ECL_M << 3) | mask;
        let rem = d;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const b = ((d << 10) | rem) ^ 0x5412;
        for (let i = 0; i <= 5; i++) setF(8, i, getBit(b, i));
        setF(8, 7, getBit(b, 6)); setF(8, 8, getBit(b, 7)); setF(7, 8, getBit(b, 8));
        for (let i = 9; i < 15; i++) setF(14 - i, 8, getBit(b, i));
        for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, getBit(b, i));
        for (let i = 8; i < 15; i++) setF(8, size - 15 + i, getBit(b, i));
        setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const b = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const a = size - 11 + i % 3, c = Math.floor(i / 3);
            setF(a, c, getBit(b, i)); setF(c, a, getBit(b, i));
        }
    }

    // 4. Размещение данных «змейкой»
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
            const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
            if (!fn[y][x] && bi < codewords.length * 8) {
                m[y][x] = getBit(codewords[bi >>> 3], 7 - (bi & 7));
                bi++;
            }
        }
    }

    // 5. Маска: пробуем все 8, берём с наименьшим штрафом
    const maskFn = [
        (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
        (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
    ];
    const applyMask = k => {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
            if (!fn[y][x] && maskFn[k](x, y)) m[y][x] = !m[y][x];
    };
    const penalty = () => {
        let p = 0, dark = 0;
        for (let y = 0; y < size; y++) {
            let rx = 1, ry = 1;
            for (let x = 0; x < size; x++) {
                if (m[y][x]) dark++;
                if (x > 0) {
                    if (m[y][x] === m[y][x - 1]) { rx++; if (rx === 5) p += 3; else if (rx > 5) p++; } else rx = 1;
                    if (m[x][y] === m[x - 1][y]) { ry++; if (ry === 5) p += 3; else if (ry > 5) p++; } else ry = 1;
                }
                if (x > 0 && y > 0 && m[y][x] === m[y][x - 1] && m[y][x] === m[y - 1][x] && m[y][x] === m[y - 1][x - 1]) p += 3;
            }
        }
        const total = size * size;
        p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
        return p;
    };
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) {
        applyMask(k); drawFormat(k);
        const p = penalty();
        if (p < bestP) { bestP = p; best = k; }
        applyMask(k);
    }
    applyMask(best); drawFormat(best);
    return m;
}

export function qrSvg(text, { color = '#1f2937', border = 4 } = {}) {
    const m = makeQrMatrix(text);
    const size = m.length + border * 2;
    let path = '';
    m.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + border},${y + border}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="${color}"/></svg>`;
}
