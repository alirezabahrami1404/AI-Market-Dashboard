'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { scrapeAll } = require('./lib/scraper');

const app = express();
const PORT = Number(process.env.PORT) || 3012;
const HOST = process.env.HOST || '127.0.0.1';

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.json');

app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function saveJSON(filePath, obj) {
  // اول در یک فایل موقت می‌نویسیم و بعد rename می‌کنیم تا اگر وسط نوشتن
  // مشکلی پیش بیاید، فایل اصلی دیتابیس خراب/نصفه‌کاره نشود.
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get('/api/data', (req, res) => {
  try {
    const data = loadJSON(DB_PATH);
    res.json(data);
  } catch (e) {
    console.error('[GET /api/data]', e);
    res.status(500).json({ error: 'خواندن دیتابیس روی سرور ناموفق بود.' });
  }
});

app.put('/api/data', (req, res) => {
  const body = req.body;
  if (
    !body ||
    !Array.isArray(body.periods) ||
    !Array.isArray(body.platforms) ||
    !Array.isArray(body.data)
  ) {
    return res.status(400).json({
      error: 'ساختار داده‌ی ارسالی نامعتبر است (periods / platforms / data لازم است).',
    });
  }
  try {
    saveJSON(DB_PATH, body);
    res.json({ ok: true });
  } catch (e) {
    console.error('[PUT /api/data]', e);
    res.status(500).json({ error: 'ذخیره‌سازی روی سرور ناموفق بود: ' + e.message });
  }
});

app.post('/api/scrape', async (req, res) => {
  let sourcesFile;
  try {
    sourcesFile = loadJSON(SOURCES_PATH);
  } catch (e) {
    console.error('[POST /api/scrape] خواندن sources.json ناموفق بود', e);
    return res.status(500).json({ error: 'فایل نگاشت لینک‌ها (sources.json) روی سرور پیدا/خوانده نشد.' });
  }

  try {
    const result = await scrapeAll(sourcesFile.sources, { concurrency: 3 });
    res.json({ label: '', values: result.values, errors: result.errors });
  } catch (e) {
    // این حالت فقط برای خطاهای کاملاً غیرمنتظره‌ی خارج از کنترل fetchAndParse است
    console.error('[POST /api/scrape] خطای غیرمنتظره', e);
    res.status(500).json({ error: 'اسکرپ خودکار با خطای غیرمنتظره مواجه شد: ' + (e.message || 'نامشخص') });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'مسیر API پیدا نشد.' });
});

// ---------------------------------------------------------------------------
// مدیریت خطاهای عمومی — همیشه باید آخرین middleware باشد
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[خطای غیرمنتظره‌ی Express]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'خطای غیرمنتظره‌ی سرور.' });
});

// خطاهای async که در جایی catch نشده‌اند نباید کل پروسه را پایین بیاورند.
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

app.listen(PORT, HOST, () => {
  console.log(`داشبورد روی http://${HOST}:${PORT} در حال اجراست.`);
});
