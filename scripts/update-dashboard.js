/**
 * 미래사업본부 통합 대시보드 — 데이터 추출 스크립트 (v3)
 *
 * 각 대시보드 실제 페이지 텍스트를 기반으로 패턴이 검증되었습니다.
 * 매일 오전 8시(KST) GitHub Actions가 자동 실행하여 data.json 생성.
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
const RENDER_WAIT = 6_000;

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
  try { return { ok: true, ...(await fn()) }; }
  catch (err) { console.error(`[${label}] FAILED:`, err.message); return { ok: false, error: err.message }; }
}

function parseNum(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  const eok = str.match(/([\d.,]+)\s*억/);
  if (eok) return Math.round(parseFloat(eok[1].replace(/,/g, '')) * 1e8);
  const man = str.match(/([\d.,]+)\s*만/);
  if (man) return Math.round(parseFloat(man[1].replace(/,/g, '')) * 1e4);
  const cleaned = str.replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function matchInt(text, regex) {
  const m = text.match(regex);
  return m ? Number(m[1]) : null;
}
function matchKRW(text, regex) {
  const m = text.match(regex);
  return m ? parseNum(m[1]) : null;
}

// ---------- DAILY ----------

async function extractDaily(browser) {
  return safeRun('daily', () =>
    withPage(browser, URLS.daily, async (page) => {
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => document.body.innerText || '');

      const lastUpdate = text.match(/최종\s*업데이트\s*[:：]?\s*(\d{4}\.\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2})/)?.[1] || null;
      const period     = text.match(/데이터\s*기간\s*[:：]?\s*([^\n]+)/)?.[1]?.trim() || null;

      // 라벨 직접 매칭 (페이지 텍스트: "당일 매출\n5,675만원\n기준일: 5/27")
      const todayRevenue  = matchKRW(text, /당일\s*매출\s*\n\s*([\d.,]+\s*[억만]?원?)/);
      const monthRevenue  = matchKRW(text, /(?:1|2|3|4|5|6|7|8|9|10|11|12)월\s*누적\s*매출\s*\n\s*([\d.,]+\s*[억만]?원?)/);
      const ytdRevenue    = matchKRW(text, /2026\s*누적\s*매출\s*\n\s*([\d.,]+\s*[억만]?원?)/);
      const monthForecast = matchKRW(text, /월\s*예상\s*마감\s*매출\s*\n\s*([\d.,]+\s*[억만]?원?)/);

      // 일일 상품 테이블 — 헤더에 "일일 매출"이 있는 테이블 선택 후 컬럼 인덱스로 추출
      const top5 = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        let target = null;
        let headerCells = [];
        for (const t of tables) {
          const ths = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
          if (ths.some(h => /일일\s*매출/.test(h))) { target = t; headerCells = ths; break; }
        }
        if (!target) return [];
        const colIdx = (label) => headerCells.findIndex(h => new RegExp(label).test(h));
        const brandIdx = colIdx('브랜드');
        const nameIdx  = colIdx('상품');
        const qtyIdx   = colIdx('일일\\s*수량');
        const revIdx   = colIdx('일일\\s*매출');
        const trs = target.querySelectorAll('tbody tr');
        return Array.from(trs).slice(0, 10).map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
          return {
            brand: brandIdx >= 0 ? cells[brandIdx] : cells[0],
            name:  nameIdx  >= 0 ? cells[nameIdx]  : cells[1],
            qty:   qtyIdx   >= 0 ? cells[qtyIdx]   : cells[2],
            rev:   revIdx   >= 0 ? cells[revIdx]   : cells[3],
          };
        }).filter(r => r.name);
      });

      const top5Parsed = top5.slice(0, 5).map(p => ({
        brand: p.brand,
        name: p.name,
        dailyRevenue: parseNum(p.rev),
        dailyQty: parseNum(p.qty),
      }));

      return {
        lastUpdate, period,
        todayRevenue, monthRevenue, ytdRevenue, monthForecast,
        top5: top5Parsed,
      };
    })
  );
}

// ---------- WEEKLY ----------

async function extractWeekly(browser) {
  return safeRun('weekly', () =>
    withPage(browser, URLS.weekly, async (page) => {
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => document.body.innerText || '');

      // "기준일:\n2026년 5월 28일\n|" 형식
      const baseDate =
        text.match(/기준일\s*[:：]\s*\n*\s*(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/)?.[1] ||
        text.match(/기준일\s*[:：]?\s*\n?(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2})/)?.[1] ||
        null;
      const weekLabel = text.match(/(\d{4})년\s+(\d{1,2})주차/)?.[0] || null;

      const pbMonthShipment = matchKRW(text, /(?:1|2|3|4|5|6|7|8|9|10|11|12)월\s*자사\s*PB\s*출고[^\n]*\n\s*([\d.,]+\s*[억만]?)/);
      const pbYtdShipment   = matchKRW(text, /2026\s*누적\s*출고[^\n]*\n\s*([\d.,]+\s*[억만]?)/);
      const gbMonth         = matchKRW(text, /(?:1|2|3|4|5|6|7|8|9|10|11|12)월\s*공구[^\n]*\n\s*([\d.,]+\s*[억만]?)/);
      const gbYtd           = matchKRW(text, /2026\s*누적\s*공구[^\n]*\n\s*([\d.,]+\s*[억만]?)/);
      const targetAchievement =
        text.match(/출고\s*누적\s*목표\s*달성률\s*\n\s*([\d.,]+\s*%)/)?.[1] ||
        text.match(/목표\s*달성률\s*\n\s*([\d.,]+\s*%)/)?.[1] || null;
      const annualTarget    = matchKRW(text, /2026\s*연간\s*목표\s*\n\s*([\d.,]+\s*억)/);
      const annualAchievement = text.match(/연간\s*달성률\s*\n?\s*([\d.,]+\s*%)/)?.[1] || null;

      return {
        baseDate, weekLabel,
        pbMonthShipment, pbYtdShipment,
        gbMonth, gbYtd,
        targetAchievement, annualTarget, annualAchievement,
        period: '2026년 누적',
      };
    })
  );
}

// ---------- STOCK ----------

async function extractStock(browser) {
  return safeRun('stock', () =>
    withPage(browser, URLS.stock, async (page) => {
      await page.waitForTimeout(3_000);
      const text = await page.evaluate(() => document.body.innerText || '');

      // 새 포맷: "라벨\n숫자\n부가설명" (건 suffix 없음)
      const grab = (label) => {
        const re = new RegExp(label + '\\s*\\n\\s*(\\d+)');
        const m = text.match(re);
        return m ? Number(m[1]) : null;
      };

      const urgentOrder = grab('즉시\\s*발주\\s*필요');
      const reviewOrder = grab('발주\\s*검토\\s*권장');
      const inProgress  = grab('발주\\s*진행\\s*중');
      const expiry6m    = grab('유통기한\\s*6\\s*개월\\s*이내');
      const expiry9m    = grab('유통기한\\s*9\\s*개월\\s*이내');
      const totalAmount = matchKRW(text, /총\s*재고\s*금액\s*\n\s*([\d.,]+\s*[억만]?)/);
      const skuCount    = matchInt(text, /(\d+)\s*개\s*SKU/);

      return {
        urgentOrder, reviewOrder, inProgress,
        expiry6m, expiry9m,
        // 호환성(기존 HTML이 expiryWithin9m 참조)
        expiryWithin9m: expiry9m,
        expiry6to9m: null, expiry9to12m: null,
        totalAmount, skuCount,
      };
    })
  );
}

// ---------- VOC ----------

async function extractVoc(browser) {
  return safeRun('voc', () =>
    withPage(browser, URLS.voc, async (page) => {
      await page.waitForTimeout(8_000);
      const text = await page.evaluate(() => document.body.innerText || '');

      const grab = (label) => {
        const re = new RegExp(label + '\\s*\\n\\s*(\\d+)');
        const m = text.match(re);
        return m ? Number(m[1]) : null;
      };

      const total   = grab('총\\s*문의');
      const pending = grab('미처리');
      const high    = grab('🔴?\\s*높음\\s*우선순위') || grab('높음\\s*우선순위');
      // "처리율 50%" 형식이 라인 안에 있음
      const rateMatch = text.match(/처리율\s*(\d{1,3})\s*%/);
      const completed = text.match(/(\d+)\s*\n\s*완료\s*건수/)?.[1] ? Number(text.match(/(\d+)\s*\n\s*완료\s*건수/)[1]) : null;
      const processingRate = rateMatch ? Number(rateMatch[1])
        : (total != null && completed != null && total > 0 ? Math.round((completed/total)*100) : null);

      return { total, pending, high, completed, processingRate };
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
      extractDaily(browser), extractWeekly(browser),
      extractStock(browser), extractVoc(browser),
    ]);
    result = { updatedAt: new Date().toISOString(), daily, weekly, stock, voc };
  } finally { await browser.close(); }

  fs.writeFileSync(DATA_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log('Wrote', DATA_PATH);
}

main().catch((err) => { console.error(err); process.exit(1); });
