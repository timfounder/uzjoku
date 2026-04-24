# OʻzJOKU — University Website

Статический сайт Университета журналистики и массовых коммуникаций Узбекистана.
Apple-style интерфейс: frosted glass, scroll-reveal, count-up, плавные переходы.
Три языка (RU / UZ / EN), тёмная тема, 7 страниц в одном SPA.

## Структура

```
├── index.html              ← главный HTML (точка входа)
├── assets/
│   ├── site.css            ← дизайн-система + все стили
│   ├── app.js              ← роутинг, i18n, анимации
│   ├── i18n.js             ← словари RU / UZ / EN
│   ├── admin.html / .css / .js  ← админ-панель (тексты, фото)
│   └── uploads/            ← загруженные фото (gitignored)
├── server.js               ← Node-сервер: статика + admin API
├── package.json
├── Procfile                ← для Heroku-совместимых платформ
├── railway.json            ← конфиг Railway
├── nixpacks.toml           ← nixpacks build
├── .github/workflows/pages.yml  ← авто-деплой на GitHub Pages
└── .nojekyll               ← отключает Jekyll на GH Pages
```

## Локальный запуск

```bash
npm install    # зависимостей нет, просто создаст lock-файл
npm start      # → http://localhost:3000
```

Или без Node — просто откройте `index.html` в браузере.

## Деплой на GitHub Pages (бесплатно, статика)

1. Создайте репозиторий на GitHub, залейте туда все файлы:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<USER>/<REPO>.git
   git push -u origin main
   ```

2. В репозитории откройте **Settings → Pages** и выставьте:
   - **Source:** `GitHub Actions`

3. После пуша GitHub Actions автоматически задеплоит сайт.
   Ссылка появится в **Settings → Pages** (обычно `https://<USER>.github.io/<REPO>/`).

Файл `.github/workflows/pages.yml` уже настроен — правки не нужны.

## Деплой на Railway (Node-сервер)

1. Зарегистрируйтесь на [railway.app](https://railway.app).
2. **New Project → Deploy from GitHub repo** → выберите ваш репозиторий.
3. Railway прочитает `railway.json` + `package.json` и сам:
   - установит Node 20 (через `nixpacks.toml`);
   - запустит `node server.js`;
   - выдаст публичную ссылку вида `https://<project>.up.railway.app`.

`PORT` Railway подставит сам. Чтобы включить админ-панель — задайте переменные `ADMIN_PASSWORD` и `ADMIN_SECRET` (см. ниже).

## Админ-панель

Админ-панель доступна по адресу `/admin` и позволяет:

- редактировать все переводы RU / UZ / EN (поиск, добавление новых ключей, поле `art_body` поддерживает HTML);
- загружать фото (drag-and-drop, до 25 МБ, jpg / png / webp / svg / avif);
- копировать URL загруженного фото для вставки в контент;
- удалять загруженные файлы.

### Включение

Задайте две переменные окружения:

```
ADMIN_PASSWORD=<ваш-пароль>
ADMIN_SECRET=<длинная-случайная-строка>   # для подписи cookie сессии
```

Без этих переменных `/admin` отдаёт сообщение «админ-панель отключена» и API-эндпоинты возвращают `503`.

Сгенерировать `ADMIN_SECRET` можно так:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Хранение

- Тексты пишутся в `assets/i18n.js` (с резервной копией `.bak` при каждом сохранении).
- Фото складываются в `assets/uploads/` и доступны по URL `/assets/uploads/<file>`.

### Persistent storage на Railway

Файловая система Railway эфемерна — после нового деплоя `assets/uploads/` обнулится. Чтобы фото сохранялись:

1. Railway → ваш сервис → **Volumes** → **Add Volume**.
2. Mount path: `/app/assets/uploads`. Размер: 1 ГБ хватит для типового кампуса.
3. (Опционально) `UPLOADS_DIR=/app/assets/uploads` — если вы изменили путь монтирования.

Обновления `i18n.js` уцелеют между деплоями, только если коммитить файл обратно в git, либо хранить в волюме (можно подменить путь через симлинк, но проще коммитить — это исходный код).

## Безопасность админки

- HTTP-only cookie с HMAC-подписью (TTL 12 ч).
- Сравнение пароля через `timingSafeEqual`.
- Загрузки ограничены белым списком `image/*`-mime и 25 МБ.
- Все `POST /api/*` и `DELETE /api/*` требуют валидной cookie.
- Имена файлов санитайзятся (только `[\w.\-]`), путь не выходит за `UPLOADS_DIR`.

Для продакшена рекомендуется поставить сайт за HTTPS (Railway даёт его «из коробки»).

## Деплой на Vercel / Netlify (альтернатива)

Сайт чисто статический — достаточно подключить репозиторий, указать:
- **Build command:** *(пусто)*
- **Output directory:** `.` (корень)

## Кастомный домен

- **GitHub Pages:** Settings → Pages → Custom domain → добавьте A/CNAME запись у регистратора.
- **Railway:** Project → Settings → Domains → Add Custom Domain.

## Лицензия

MIT — контент сайта носит демонстрационный характер, замените перед публикацией.
