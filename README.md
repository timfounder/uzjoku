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
│   └── i18n.js             ← словари RU / UZ / EN
├── server.js               ← Node-сервер для Railway
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

Переменных окружения не требуется. `PORT` Railway подставит сам.

## Деплой на Vercel / Netlify (альтернатива)

Сайт чисто статический — достаточно подключить репозиторий, указать:
- **Build command:** *(пусто)*
- **Output directory:** `.` (корень)

## Кастомный домен

- **GitHub Pages:** Settings → Pages → Custom domain → добавьте A/CNAME запись у регистратора.
- **Railway:** Project → Settings → Domains → Add Custom Domain.

## Лицензия

MIT — контент сайта носит демонстрационный характер, замените перед публикацией.
