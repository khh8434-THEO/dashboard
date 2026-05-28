/**
 * 미래사업본부 통합 대시보드 — 데이터 추출 스크립트
 *
 * 매일 오전 8시(KST = 23:00 UTC 전일) GitHub Actions가 이 스크립트를 실행하여
 * 4개 대시보드를 헤드리스 브라우저로 열고 핵심 지표를 추출, data.json 에 저장합니다.
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

function matchInt(text, regex) {
  const m = text.match(regex);
  return m ? Number(m[1]) : null;
}

async function extractDaily(browser) {
  return safeRun('daily', () =>
    withPage(browser, URLS.daily, async (page) => {
      const text = await getBodyText(page);
      const lastUpdateMatch =
        text.match(/최종\s*업데이트[^0-9]{0,30}(\d{4}\.\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2})/) ||
        text.match(/(\d{4}\.\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2})/);
      const periodMatch = text.match(/데이터\s*기간\s*[:：]?\s*(\d{4}\.\d{1,2}[^\n]*?\d{4}\.\d{1,2}[^\n]{0,20})/);
      return {
        lastUpdate: lastUpdateMatch?.[1] ?? null,
        period: periodMatch?.[1]?.trim() ?? null,
      };
    })
  );
}

async function extractWeekly(browser) {
  return safeRun('weekly', () =>
    withPage(browser, URLS.weekly, async (page) => {
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
      return {
        baseDate: baseDateMatch?.[1] ?? null,
        latestMonth: latest != null ? `${latest}월` : null,
        achievement: achMatch?.[1] ? `${achMatch[1]}%` : null,
        period: '2026년 누적',
      };
    })
  );
}

async function extractStock(browser) {
  return safeRun('stock', () =>
    withPage(browser, URLS.stock, async (page) => {
      await page.waitForTimeout(3_000);
      const text = await getBodyText(page);
      return {
        urgentOrder:  matchInt(text, /즉시\s*발주\s*필요[^0-9]{0,10}(\d+)\s*건/),
        reviewOrder:  matchInt(text, /발주\s*검토\s*권장[^0-9]{0,10}(\d+)\s*건/),
        expiry6m:     matchInt(text, /유통기한\s*6\s*개월\s*이내[^0-9]{0,10}(\d+)\s*건/),
        expiry6to9m:  matchInt(text, /유통기한\s*6\s*[~∼-]\s*9\s*개월[^0-9]{0,10}(\d+)\s*건/),
        expiry9to12m: matchInt(text, /유통기한\s*9\s*[~∼-]\s*12\s*개월[^0-9]{0,10}(\d+)\s*건/),
      };
    })
  );
}

async function extractVoc(browser) {
  return safeRun('voc', () =>
    withPage(browser, URLS.voc, async (page) => {
      await page.waitForTimeout(7_000);
      const text = await getBodyText(page);
      const total =
        matchInt(text, /총\s*문의[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /전체\s*문의[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /Total[^0-9]{0,10}(\d+)/i);
      const pending =
        matchInt(text, /미응대[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /대기[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /진행\s*중[^0-9]{0,15}(\d+)/) ||
        matchInt(text, /Pending[^0-9]{0,10}(\d+)/i);
      return {
        total, pending,
        snippet: text.replace(/\s+/g, ' ').slice(0, 180),
      };
    })
  );
}

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
}

main().catch((err) => { console.error(err); process.exit(1); });
