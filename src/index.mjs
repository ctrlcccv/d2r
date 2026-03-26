import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { normalizePrice, parseTradesFromText } from "./lib/pricing.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SESSION_DIR = path.join(ROOT, ".session", "traderie");
const DEFAULT_INPUT = path.join(ROOT, "sample-item.json");
const RECENT_TRADES_PATH = path.join(DATA_DIR, "recent-trades.json");

const TARGET = {
  home: "https://traderie.com/diablo2resurrected",
  recentTrades: "https://traderie.com/diablo2resurrected"
};

ensureDir(DATA_DIR);
ensureDir(path.dirname(SESSION_DIR));

const command = process.argv[2];
const inputPath = process.argv[3] || DEFAULT_INPUT;

switch (command) {
  case "login":
    await runLogin();
    break;
  case "scrape":
    await runScrape();
    break;
  case "import":
    await runImport(process.argv[3]);
    break;
  case "recommend":
    await runRecommend(inputPath);
    break;
  default:
    printUsage();
    process.exitCode = 1;
}

async function runLogin() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false
  });

  const page = await context.newPage();
  await page.goto(TARGET.home, { waitUntil: "domcontentloaded" });

  console.log("");
  console.log("1. Open the Traderie login flow in the browser window.");
  console.log("2. Complete login, including 2FA if needed.");
  console.log("3. Navigate to a page where your account is clearly logged in.");
  console.log("4. Press Ctrl+C here when you are done.");
  console.log("");

  await new Promise(() => {});
}

async function runScrape() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: true
  });
  const page = await context.newPage();

  await page.goto(TARGET.recentTrades, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const loggedInHints = [
    "recent trades",
    "sold",
    "completed",
    "history"
  ];

  const bodyText = (await page.textContent("body")) || "";
  const looksLoggedIn = loggedInHints.some((hint) =>
    bodyText.toLowerCase().includes(hint)
  );

  if (!looksLoggedIn) {
    console.warn("The page does not look authenticated yet.");
    console.warn("Run `npm run login` first and make sure the session is saved.");
  }

  const snapshot = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const rows = Array.from(document.querySelectorAll("a, button, div, span, li"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 1500);

    return {
      scrapedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      text,
      rows
    };
  });

  const parsedTrades = parseTradesFromText(snapshot.text);
  const payload = {
    meta: {
      scrapedAt: snapshot.scrapedAt,
      url: snapshot.url,
      title: snapshot.title,
      parsedCount: parsedTrades.length
    },
    trades: parsedTrades,
    rawRows: snapshot.rows
  };

  fs.writeFileSync(RECENT_TRADES_PATH, JSON.stringify(payload, null, 2));
  await context.close();

  console.log(`Saved ${parsedTrades.length} parsed trades to ${RECENT_TRADES_PATH}`);
  if (parsedTrades.length === 0) {
    console.log("No structured trades were detected yet. You may need to tune selectors for the exact logged-in page.");
  }
}

async function runRecommend(itemPath) {
  if (!fs.existsSync(RECENT_TRADES_PATH)) {
    throw new Error("Missing data/recent-trades.json. Run `npm run scrape` first.");
  }

  if (!fs.existsSync(itemPath)) {
    throw new Error(`Missing item input file: ${itemPath}`);
  }

  const recentTrades = JSON.parse(fs.readFileSync(RECENT_TRADES_PATH, "utf8"));
  const item = JSON.parse(fs.readFileSync(itemPath, "utf8"));

  const scored = recentTrades.trades
    .map((trade) => ({
      trade,
      score: scoreTradeSimilarity(item, trade)
    }))
    .filter((entry) => entry.score.total > 0)
    .sort((a, b) => b.score.total - a.score.total);

  const topMatches = scored.slice(0, 10);
  const prices = topMatches
    .map(({ trade }) => normalizePrice(trade.priceText))
    .filter(Boolean);

  const recommended = summarizePrices(prices);

  const result = {
    item,
    generatedAt: new Date().toISOString(),
    matchCount: topMatches.length,
    recommendation: recommended,
    matches: topMatches
  };

  console.log(JSON.stringify(result, null, 2));
}

async function runImport(importPath) {
  if (!importPath) {
    throw new Error("Missing import path. Example: `npm run import ~/Downloads/traderie-page-export.json`");
  }

  const resolvedPath = resolveUserPath(importPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Import file not found: ${resolvedPath}`);
  }

  const imported = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const text = imported.text || imported.rawText || "";
  const parsedTrades = parseTradesFromText(text);
  const payload = {
    meta: {
      importedAt: new Date().toISOString(),
      sourcePath: resolvedPath,
      sourceUrl: imported.meta?.url || null,
      title: imported.meta?.title || null,
      parsedCount: parsedTrades.length
    },
    trades: parsedTrades,
    rawRows: imported.rawRows || []
  };

  fs.writeFileSync(RECENT_TRADES_PATH, JSON.stringify(payload, null, 2));
  console.log(`Imported ${parsedTrades.length} parsed trades into ${RECENT_TRADES_PATH}`);
  if (parsedTrades.length === 0) {
    console.log("No structured trades were detected yet. We may need to tune the parser after seeing the exported page content.");
  }
}

function scoreTradeSimilarity(item, trade) {
  const haystack = `${trade.itemText} ${trade.context.join(" ")}`.toLowerCase();
  let total = 0;
  const matched = [];

  if (item.name && haystack.includes(String(item.name).toLowerCase())) {
    total += 50;
    matched.push(`name:${item.name}`);
  }

  for (const [key, expected] of Object.entries(item.options || {})) {
    const expectedText = String(expected).toLowerCase();
    if (haystack.includes(expectedText)) {
      total += 10;
      matched.push(`${key}:${expected}`);
    }
  }

  return { total, matched };
}

function summarizePrices(prices) {
  if (prices.length === 0) {
    return {
      suggestedListPrice: null,
      note: "No comparable recent trades were parsed yet."
    };
  }

  const sorted = prices.slice().sort((a, b) => a.value - b.value);
  const median = sorted[Math.floor(sorted.length / 2)];
  const low = sorted[0];
  const high = sorted[sorted.length - 1];

  return {
    suggestedListPrice: median.label,
    range: `${low.label} - ${high.label}`,
    sampleSize: prices.length
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveUserPath(input) {
  if (input.startsWith("~/")) {
    return path.join(process.env.HOME || "", input.slice(2));
  }
  return path.resolve(ROOT, input);
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run login");
  console.log("  npm run scrape");
  console.log("  npm run import -- <path-to-exported-json>");
  console.log("  npm run recommend");
}
