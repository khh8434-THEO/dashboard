/**
 * 미래사업본부 통합 대시보드 — 데이터 추출 스크립트
 *
 * 각 대시보드에서 가능한 만큼 KPI를 뽑아 data.json에 기록합니다.
 * 추출이 실패한 필드는 null 로 남고, 해당 섹션은 ok:false 가 됩니다.
 *
 * 각 함수의 정규식/셀렉터는 대시보드 DOM 변경에 따라 조정이 필요할 수 있습니다.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(REPO_ROOT, 'data.json');

const URLS = {
  daily:  'https://khh8434-theo.github.io/daily-dashboard/',
  weekly: 'https://khh8434-theo.github.io/pharmabros-weekly-dashboard/',
  stock:  'https://khh8434-theo.github.io/stock-managementdashboard/',
  voc:    'https://pharmacy-voc-dashboard.vercel.app/',
};

const NAV_TIMEOUT = 60_000;
const RENDER_WAIT = 5_000;

// ---------- 공통 유틸 ----------

async function withPage(browser, url, fn) {
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT }).catch(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    });
    await page.waitForTimeout(RENDER_WAIT);
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function safeRun(label, fn) {
  try {
    const result = await fn();
    return { ok: true, ...result };
  } catch (err) {
    console.error(`[${label}] FAILED:`, err.message);
    return { ok: false, error: err.message };
  }
}

function getBodyText(page) {
  return page.evaluate(() => document.body.innerText || '');
}

// "1,234,567" 또는 "1.23억" 같은 표시 문자열에서 숫자 추출
function parseNum(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  // "1.23억" → 1.23 * 1e8
  const eokMatch = str.match(/([\d.,]+)\s*억/);
  if (eokMatch) return Math.round(parseFloat(eokMatch[1].replace(/,/g, '')) * 1e8);
  const manMatch = str.match(/([\d.,]+)\s*만/);
  if (manMatch) return Math.round(parseFloat(manMatch[1].replace(/,/g, '')) * 1e4);
  const cleaned = str.replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// 큰 숫자를 "억/만" 단위 표시로 포맷팅 (UI 출력은 HTML 쪽에서 하지만 디버그용)
function fmtKRW(n) {
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억';
  if (abs >= 1e4) return (n / 1e4).toFixed(1).replace(/\.?0+$/, '') + '만';
  return n.toLocaleString('ko-KR');
}

function matchInt(text, regex) {
  const m = text.match(regex);
  return m ? Number(m[1]) : null;
}

// ---------- DAILY ----------

async function extractDaily(browser) {
  return safeRun('daily', () =>
    withPage(browser, URLS.daily, async (page) => {
      // 테이블 렌더링 추가 대기
      await page.waitForTimeout(3_000);

      const text = await getBodyText(page);

      // 최종 업데이트, 데이터 기간
      const lastUpdateMatch =
        text.match(/최종\s*업데이트[^0-9]{0,30}(\d{4}\.\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2})/) ||
        text.match(/(\d{4}\.\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2})/);
      const periodMatch = text.match(/데이터\s*기간\s*[:：]?\s*(\d{4}\.\d{1,2}[^\n]*?\d{4}\.\d{1,2}[^\n]{0,20})/);

      // 제품별 테이블에서 행 단위 데이터 추출
      // 컬럼: 브랜드 | 제품명 | 누적 매출 | 일일 매출 | 일일 수량 | 5월 매출 | 5월 수량 | ...
      const rows = await page.evaluate(() => {
        const result = [];
        // 가장 큰 데이터 테이블을 찾음 (제품 테이블이 가장 행이 많을 가능성)
        const tables = Array.from(document.querySelectorAll('table'));
        let target = null;
        let maxRows = 0;
        for (const t of tables) {
          const rs = t.querySelectorAll('tbody tr, tr');
          if (rs.length > maxRows) { target = t; maxRows = rs.length; }
        }
        if (!target) return [];
        const trs = target.querySelectorAll('tbody tr');
        const list = trs.length ? Array.from(trs) : Array.from(target.querySelectorAll('tr')).slice(1);
        for (const tr of list) {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
          if (cells.length >= 5) result.push(cells);
        }
        return result;
      });

      // 일일 매출 = 4번째 컬럼(인덱스 3), 일일 수량 = 5번째(인덱스 4), 가정
      const products = rows
        .map(r => ({
          brand: r[0],
          name: r[1],
          cumulativeRevenue: parseNum(r[2]),
          dailyRevenue: parseNum(r[3]),
          dailyQty: parseNum(r[4]),
          monthRevenue: parseNum(r[5]),
          monthQty: parseNum(r[6]),
        }))
        .filter(p => p.name && p.dailyRevenue != null);

      const topByDaily = [...products]
        .sort((a, b) => (b.dailyRevenue || 0) - (a.dailyRevenue || 0))
        .slice(0, 5);

      // 합계: 당일 매출은 모든 제품 일일매출 합
      const sum = (arr, key) => arr.reduce((acc, p) => acc + (p[key] || 0), 0);
      const todayRevenue = products.length ? sum(products, 'dailyRevenue') : null;
      const monthRevenue = products.length ? sum(products, 'monthRevenue') : null;
      const ytdRevenue = products.length ? sum(products, 'cumulativeRevenue') : null;

      // 텍스트에서 직접 라벨 매칭도 시도 (보완용)
      const ytdLabel = parseNum(text.match(/2026\s*누적\s*매출[^0-9억만]{0,20}([\d.,억만\s]+)/)?.[1]);
      const monthLabel = parseNum(text.match(/(?:5월|당월|월간)\s*누적\s*매출[^0-9억만]{0,20}([\d.,억만\s]+)/)?.[1]);
      const todayLabel = parseNum(text.match(/(?:당일|오늘)\s*매출[^0-9억만]{0,20}([\d.,억만\s]+)/)?.[1]);

      return {
        lastUpdate: lastUpdateMatch?.[1] ?? null,
        period: periodMatch?.[1]?.trim() ?? null,
        todayRevenue: todayLabel ?? todayRevenue,
        monthRevenue: monthLabel ?? monthRevenue,
        ytdRevenue: ytdLabel ?? ytdRevenue,
        top5: topByDaily.map(p => ({
          brand: p.brand,
          name: p.name,
          dailyRevenue: p.dailyRevenue,
          dailyQty: p.dailyQty,
        })),
        debugProductCount: products.length,
      };
    })
  );
}

// ---------- WEEKLY ----------

async function extractWeekly(browser) {
  return safeRun('weekly', () =>
    withPage(browser, URLS.weekly, async (page) => {
      await page.waitForTimeout(3_000);
      const text = await getBodyText(page);

      const baseDateMatch =
        text.match(/기준일\s*[:：|]?\s*(\d{4}[.\-\/]\d{1,2}[.\-\/]?\d{0,2})/) ||
        text.match(/(\d{4}[.\-]\d{1,2}[.\-]\d{1,2})/);

      const latest = await page.evaluate(() => {
        const candidates = ['latestMonth', 'LATEST_MONTH', 'CURRENT_MONTH'];
        for (const k of candidates) if (typeof window[k] !== 'undefined') return window[k];
        return null;
      }).catch(() => null);

      const achMatch = text.match(/누적\s*실적[^%]{0,80}?(\d{1,3})\s*%/);

      // PB 출고 매출액 — "당월" 키워드 근처에서 숫자 찾기
      const pbMonth =
        parseNum(text.match(/PB[^A-Za-z]{0,40}(?:당월|이번\s*달|월간)[^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]) ||
        parseNum(text.match(/(?:당월|이번\s*달)[^0-9억만]{0,20}PB[^0-9억만]{0,40}([\d.,]+\s*[억만]?)/i)?.[1]);
      const pbYtd =
        parseNum(text.match(/PB[^A-Za-z]{0,40}(?:2026\s*누적|연간\s*누적|YTD)[^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]) ||
        parseNum(text.match(/(?:누적|YTD)[^0-9억만]{0,30}PB[^0-9억만]{0,40}([\d.,]+\s*[억만]?)/i)?.[1]);

      // 공구(공동구매) 매출
      const gbMonth =
        parseNum(text.match(/공동\s*구매[^0-9억만]{0,40}(?:당월|이번\s*달)[^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]) ||
        parseNum(text.match(/공구[^0-9억만]{0,30}(?:당월|이번\s*달)[^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]) ||
        parseNum(text.match(/(?:당월|이번\s*달)[^0-9억만]{0,20}공[동구][^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]);
      const gbYtd =
        parseNum(text.match(/공동\s*구매[^0-9억만]{0,40}(?:2026\s*누적|YTD|누적)[^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]) ||
        parseNum(text.match(/공구[^0-9억만]{0,30}(?:누적|YTD)[^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]) ||
        parseNum(text.match(/(?:2026\s*누적|YTD)[^0-9억만]{0,20}공[동구][^0-9억만]{0,30}([\d.,]+\s*[억만]?)/i)?.[1]);

      return {
        baseDate: baseDateMatch?.[1] ?? null,
        latestMonth: latest != null ? `${latest}월` : null,
        achievement: achMatch?.[1] ? `${achMatch[1]}%` : null,
        period: '2026년 누적',
        pbMonthShipment: pbMonth,
        pbYtdShipment: pbYtd,
        gbMonth: gbMonth,
        gbYtd: gbYtd,
      };
    })
  );
}

// ---------- STOCK ----------

async function extractStock(browser) {
  return safeRun('stock', () =>
    withPage(browser, URLS.stock, async (page) => {
      await page.waitForTimeout(3_000);
      const text = await getBodyText(page);

      const u  = matchInt(text, /즉시\s*발주\s*필요[^0-9]{0,10}(\d+)\s*건/);
      const r  = matchInt(text, /발주\s*검토\s*권장[^0-9]{0,10}(\d+)\s*건/);
      const e6 = matchInt(text, /유통기한\s*6\s*개월\s*이내[^0-9]{0,10}(\d+)\s*건/);
      const e69= matchInt(text, /유통기한\s*6\s*[~∼-]\s*9\s*개월[^0-9]{0,10}(\d+)\s*건/);
      const e912= matchInt(text, /유통기한\s*9\s*[~∼-]\s*12\s*개월[^0-9]{0,10}(\d+)\s*건/);

      // 9개월 이내 = 6개월 이내 + 6~9개월
      const within9m = (e6 != null || e69 != null) ? (e6 ?? 0) + (e69 ?? 0) : null;

      return {
        urgentOrder: u,
        reviewOrder: r,
        expiry6m: e6,
        expiry6to9m: e69,
        expiry9to12m: e912,
        expiryWithin9m: within9m,
      };
    })
  );
}

// ---------- VOC ----------

async function extractVoc(browser) {
  return safeRun('voc', () =>
    withPage(browser, URLS.voc, async (page) => {
      await page.waitForTimeout(8_000);
      const text = await getBodyText(page);

      const total =
        matchInt(text, /총\s*문의[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /전체\s*문의[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /전체[^\n0-9]{0,8}(\d+)\s*건/) ||
        matchInt(text, /Total[^0-9]{0,10}(\d+)/i);
      const pending =
        matchInt(text, /미\s*처리[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /미응대[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /대기[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /진행\s*중[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /Pending[^0-9]{0,10}(\d+)/i);
      const high =
        matchInt(text, /(?:우선\s*순위\s*)?높음[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /높음[^0-9]{0,8}(\d+)\s*건/) ||
        matchInt(text, /High[^0-9]{0,10}(\d+)/i);

      let processingRate = null;
      if (total != null && pending != null && total > 0) {
        processingRate = Math.round(((total - pending) / total) * 100);
      } else {
        const rateMatch = text.match(/처리율[^0-9%]{0,15}(\d{1,3})\s*%/);
        if (rateMatch) processingRate = Number(rateMatch[1]);
      }

      return {
        total, pending, high, processingRate,
        snippet: text.replace(/\s+/g, ' ').slice(0, 240),
      };
    })
  );
}

// ---------- main ----------

async function main() {
  console.log('Launching browser…');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let result;
  try {
    console.log('Extracting in parallel…');
    const [daily, weekly, stock, voc] = await Promise.all([
      extractDaily(browser),
      extractWeekly(browser),
      extractStock(browser),
      extractVoc(browser),
    ]);
    result = { updatedAt: new Date().toISOString(), daily, weekly, stock, voc };
  } finally {
    await browser.close();
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log('Wrote', DATA_PATH);
  console.log('Sample:', {
    daily_top5_count: result.daily?.top5?.length,
    daily_products: result.daily?.debugProductCount,
    weekly_pbMonth: result.weekly?.pbMonthShipment,
    stock_urgent: result.stock?.urgentOrder,
    voc_total: result.voc?.total,
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
