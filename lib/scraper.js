'use strict';
/**
 * استخراج تعداد نصب/دانلود، امتیاز و تعداد نظرات از صفحات کافه‌بازار و مایکت.
 * این ماژول از cheerio (پیاده‌سازی سریع jQuery-مانند روی سرور) استفاده می‌کند،
 * دقیقاً معادل نسخه‌ی پایتونی قبلی که با BeautifulSoup نوشته شده بود.
 *
 * هیچ تابعی در این فایل نباید Exception پرتاب‌شده را رها کند و کل فرآیند را
 * متوقف کند — هر خطا برای همان یک اپ/فروشگاه ثبت و بقیه ادامه پیدا می‌کنند.
 */

const cheerio = require('cheerio');

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function faToEnDigits(s) {
  return String(s).replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

function parsePersianCount(raw) {
  if (raw == null) return null;
  let s = faToEnDigits(String(raw)).trim().replace(/,/g, '').replace(/[،٬]/g, '');
  let m = s.match(/([\d.]+)\s*(میلیون|M)/i);
  if (m) return Math.round(parseFloat(m[1]) * 1_000_000);
  m = s.match(/([\d.]+)\s*(هزار|K)/i);
  if (m) return Math.round(parseFloat(m[1]) * 1_000);
  m = s.match(/[\d.]+/);
  if (m) {
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function parsePersianFloat(raw) {
  if (raw == null) return null;
  let s = faToEnDigits(String(raw)).trim().replace(/,/g, '');
  let m = s.match(/[\d.]+/);
  if (m) {
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// کافه‌بازار: هر آمار در <tr class="InfoCube"> با یک سلول عنوان و یک سلول
// محتوا نمایش داده می‌شود. ردیفی که عنوانش «رأی» دارد همان ردیف امتیاز است.
// ---------------------------------------------------------------------------
function extractCafebazaar(html) {
  const $ = cheerio.load(html);
  let installs = null;
  let rating = null;
  let comments = null;

  $('tr.InfoCube').each((_, tr) => {
    const $tr = $(tr);
    const titleTxt = $tr.find('.InfoCube__title').first().text().trim();
    const contentEl = $tr.find('.InfoCube__content').first();
    const contentTxt = contentEl.text().trim();

    if (titleTxt.includes('رأی')) {
      const m = titleTxt.match(/([۰-۹,،٬]+)\s*رأی/);
      if (m) comments = parsePersianCount(m[1]);
      const ratingDiv = contentEl.find('div').first();
      const rtxt = (ratingDiv.length ? ratingDiv.text() : contentTxt).trim();
      const m2 = rtxt.match(/[۰-۹]+\.[۰-۹]+/);
      if (m2) rating = parsePersianFloat(m2[0]);
    } else if (installs === null && contentTxt) {
      if (/[۰-۹\d]/.test(contentTxt) && !/مگابایت|گیگابایت|کیلوبایت|\//.test(contentTxt)) {
        const n = parsePersianCount(contentTxt);
        if (n && n > 5) installs = n; // اعداد کوچک‌تر از ۵ معمولاً امتیازند نه نصب
      }
    }
  });

  // روش پشتیبان برای زمانی که ساختار tr.InfoCube پیدا نشد
  if (installs === null) {
    $('td.InfoCube__content').each((_, td) => {
      if (installs !== null) return;
      const txt = $(td).text().trim();
      if (/[۰-۹\d]/.test(txt) && !/مگابایت|گیگابایت|کیلوبایت|\//.test(txt)) {
        const n = parsePersianCount(txt);
        if (n && n > 5) installs = n;
      }
    });
  }

  if (rating === null || comments === null) {
    const idx = html.indexOf('رأی');
    if (idx > -1) {
      const around = html.slice(Math.max(0, idx - 60), idx + 60);
      if (comments === null) {
        const m = around.match(/([۰-۹,،٬]+)\s*رأی/);
        if (m) comments = parsePersianCount(m[1]);
      }
      if (rating === null) {
        const before = html.slice(Math.max(0, idx - 300), idx);
        const matches = [...before.matchAll(/[۰-۹]+\.[۰-۹]+/g)];
        if (matches.length) rating = parsePersianFloat(matches[matches.length - 1][0]);
      }
    }
  }

  return { installs, rating, comments };
}

// ---------------------------------------------------------------------------
// مایکت: جدول برچسب/مقدار — <td>دانلود</td><td>۶ میلیون</td>
// ---------------------------------------------------------------------------
const MYKET_LABELS = {
  installs: ['دانلود'],
  rating: ['امتیاز'],
  comments: ['نظرات', 'نظر', 'دیدگاه'],
};

function extractMyket(html) {
  const $ = cheerio.load(html);
  const result = { installs: null, rating: null, comments: null };

  $('td').each((_, td) => {
    const txt = $(td).text().trim();
    if (!txt || txt.length > 20) return;
    for (const key of Object.keys(MYKET_LABELS)) {
      if (result[key] !== null) continue;
      const keywords = MYKET_LABELS[key];
      if (keywords.some((kw) => txt === kw || txt.includes(kw))) {
        const next = $(td).next('td');
        if (!next.length) continue;
        const vtxt = next.text().trim();
        result[key] = key === 'rating' ? parsePersianFloat(vtxt) : parsePersianCount(vtxt);
      }
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// دریافت صفحه با تایم‌اوت (بدون AbortController هیچ تضمینی برای برنگشتن
// fetch وجود ندارد و ممکن است کل صف اسکرپ به‌خاطر یک سایت کند گیر کند)
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndParse(url, store) {
  if (!url) return { installs: null, rating: null, comments: null, error: null };
  try {
    const html = await fetchWithTimeout(url);
    const stats = store === 'bazaar' ? extractCafebazaar(html) : extractMyket(html);
    return { ...stats, error: null };
  } catch (e) {
    return { installs: null, rating: null, comments: null, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * اسکرپ همه‌ی پلتفرم‌ها با محدودیت هم‌زمانی (تا سرور مقصد بیش از حد فشار
 * نبیند و در عین حال کل فرآیند طول نکشد). هیچ‌وقت throw نمی‌کند مگر در
 * موارد کاملاً غیرمنتظره (مثلاً فایل sources خراب که بیرون از این تابع
 * خوانده می‌شود)؛ خطای هر اپ/فروشگاه در errors[] جمع می‌شود.
 */
async function scrapeAll(sources, { concurrency = 3 } = {}) {
  const platformIds = Object.keys(sources || {});
  const values = {};
  const errors = [];
  let cursor = 0;

  async function worker() {
    while (cursor < platformIds.length) {
      const myIdx = cursor++;
      const pid = platformIds[myIdx];
      const urls = sources[pid] || {};
      const [bazaar, myket] = await Promise.all([
        fetchAndParse(urls.bazaar, 'bazaar'),
        fetchAndParse(urls.myket, 'myket'),
      ]);
      if (bazaar.error) errors.push({ platform: pid, store: 'bazaar', message: bazaar.error });
      if (myket.error) errors.push({ platform: pid, store: 'myket', message: myket.error });
      values[pid] = {
        bnum: bazaar.installs,
        brate: bazaar.rating,
        bcom: bazaar.comments,
        mnum: myket.installs,
        mrate: myket.rating,
        mcom: myket.comments,
      };
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, platformIds.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { values, errors };
}

module.exports = {
  scrapeAll,
  extractCafebazaar,
  extractMyket,
  parsePersianCount,
  parsePersianFloat,
};
