-- =====================================================================
--  КиноПарк — схема базы данных (SQLite)
--  Сеть кинотеатров → залы → места; фильмы → сеансы; пользователи → заказы → билеты
-- =====================================================================

PRAGMA foreign_keys = ON;

-- Кинотеатры сети
CREATE TABLE IF NOT EXISTS cinemas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    address     TEXT    NOT NULL,
    metro       TEXT
);

-- Залы кинотеатра. price_multiplier — наценка зала (IMAX дороже обычного)
CREATE TABLE IF NOT EXISTS halls (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    cinema_id        INTEGER NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
    name             TEXT    NOT NULL,
    type             TEXT    NOT NULL DEFAULT 'standard' CHECK (type IN ('standard','comfort','imax')),
    price_multiplier REAL    NOT NULL DEFAULT 1.0,
    rows_count       INTEGER NOT NULL,
    seats_per_row    INTEGER NOT NULL
);

-- Места в зале. type: обычное / VIP / диван (кресло-диван на двоих считается по местам)
CREATE TABLE IF NOT EXISTS seats (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    hall_id   INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    row_num   INTEGER NOT NULL,
    seat_num  INTEGER NOT NULL,
    type      TEXT    NOT NULL DEFAULT 'standard' CHECK (type IN ('standard','vip','sofa')),
    UNIQUE (hall_id, row_num, seat_num)
);

-- Жанры и связь многие-ко-многим с фильмами
CREATE TABLE IF NOT EXISTS genres (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS movies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
    age_rating    TEXT    NOT NULL DEFAULT '12+',
    rating        REAL    CHECK (rating BETWEEN 0 AND 10),
    base_price    INTEGER NOT NULL CHECK (base_price > 0),   -- базовая цена билета, ₽
    poster_url    TEXT,
    director      TEXT,
    country       TEXT,
    year          INTEGER,
    release_date  TEXT    NOT NULL,                          -- 'YYYY-MM-DD'; в будущем → раздел «Скоро»
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS movie_genres (
    movie_id  INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    genre_id  INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (movie_id, genre_id)
);

-- Сеансы. starts_at — местное время 'YYYY-MM-DD HH:MM'
CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id   INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    hall_id    INTEGER NOT NULL REFERENCES halls(id)  ON DELETE CASCADE,
    starts_at  TEXT    NOT NULL,
    format     TEXT    NOT NULL DEFAULT '2D' CHECK (format IN ('2D','3D','IMAX'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_movie ON sessions(movie_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_sessions_hall  ON sessions(hall_id, starts_at);

-- Пользователи. role: user — зритель, admin — администратор/контролёр
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT    NOT NULL,
    phone          TEXT,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Токены входа (хранятся в cookie)
CREATE TABLE IF NOT EXISTS auth_tokens (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT    NOT NULL
);

-- Заказ: бронь мест (pending, 10 минут) → оплачен (paid) / отменён / истёк
CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status        TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','cancelled','expired','refunded')),
    source        TEXT    NOT NULL DEFAULT 'online' CHECK (source IN ('online','box_office')),
    tickets_total INTEGER NOT NULL DEFAULT 0,
    snacks_total  INTEGER NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL DEFAULT 0,
    card_last4    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at    TEXT,
    paid_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

-- Билет = конкретное место на конкретном сеансе
CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seat_id     INTEGER NOT NULL REFERENCES seats(id),
    price       INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'reserved'
                        CHECK (status IN ('reserved','paid','used','cancelled')),
    code        TEXT    NOT NULL UNIQUE,      -- код для QR
    used_at     TEXT
);
-- Ключевое ограничение: одно место на сеансе нельзя продать дважды
-- (отменённые билеты не мешают продать место снова)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_seat
    ON tickets(session_id, seat_id) WHERE status IN ('reserved','paid','used');

-- Предзаказ из бара (чтобы не стоять в очереди в фойе)
CREATE TABLE IF NOT EXISTS snacks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    descr     TEXT,
    price     INTEGER NOT NULL CHECK (price > 0),
    icon      TEXT    NOT NULL DEFAULT 'popcorn',
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS order_snacks (
    order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    snack_id  INTEGER NOT NULL REFERENCES snacks(id),
    qty       INTEGER NOT NULL CHECK (qty > 0),
    price     INTEGER NOT NULL,
    PRIMARY KEY (order_id, snack_id)
);
