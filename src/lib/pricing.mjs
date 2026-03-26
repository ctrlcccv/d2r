export function parseTradesFromText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const recentTradeIndexes = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/Recent Trades/i.test(lines[i])) {
      recentTradeIndexes.push(i);
    }
  }

  let bestStructured = [];
  for (const index of recentTradeIndexes) {
    const structured = parseRecentTradeBlocks(lines.slice(index + 1));
    if (structured.length > bestStructured.length) {
      bestStructured = structured;
    }
  }

  if (bestStructured.length > 0) {
    return dedupeTrades(bestStructured);
  }

  const trades = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const priceMatch = detectPriceToken(line);
    if (!priceMatch) {
      continue;
    }

    const context = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5));
    const itemLine = context.find((entry) => /%|socket|eth|defense|damage|res|skill|fcr|frw/i.test(entry)) || context[0];
    trades.push({
      itemText: itemLine,
      priceText: line,
      context
    });
  }

  return dedupeTrades(trades);
}

export function buildRecommendationFromExport(exportedPage, item) {
  const text = exportedPage?.text || exportedPage?.rawText || "";
  const trades = parseTradesFromText(text).filter(hasTradeTime);
  const requestedQuantity = parseRequestedQuantity(item?.options);
  const scored = trades
    .map((trade) => ({
      trade,
      score: scoreTradeSimilarity(item, trade)
    }))
    .filter((entry) => entry.score.total > 0)
    .sort((a, b) => compareTradeScores(a, b, requestedQuantity));

  const prices = scored
    .map(({ trade }) => normalizePrice(trade.priceText))
    .filter(Boolean);

  return {
    meta: {
      sourceUrl: exportedPage?.meta?.url || null,
      title: exportedPage?.meta?.title || null,
      parsedCount: trades.length
    },
    item,
    matchCount: scored.length,
    recommendation: summarizePrices(prices),
    matches: scored
  };
}

function hasTradeTime(trade) {
  return (trade?.context || []).some((entry) => /\d+\s*(분|시간|일)\s*전/.test(String(entry).trim()));
}

export function extractItemTemplate(exportedPage) {
  const text = exportedPage?.text || exportedPage?.rawText || "";
  const lines = String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const itemName = inferItemName(exportedPage, lines);
  const allLabels = extractStatLabels(lines);
  const trades = parseTradesFromText(text);
  const labels = sortTemplateLabels(itemName, inferVariableStatLabels(lines, allLabels, trades));
  const options = { 수량: "" };

  for (const label of labels) {
    options[toDisplayOptionKey(label)] = "";
  }

  return {
    name: itemName,
    options,
    labels
  };
}

export function exportBrowserCollectorScript() {
  return `(() => {
  const lines = Array.from(document.querySelectorAll("a, button, div, span, li"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .slice(0, 3000);

  const payload = {
    meta: {
      extractedAt: new Date().toISOString(),
      url: location.href,
      title: document.title
    },
    text: document.body?.innerText || "",
    rawRows: lines
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "traderie-page-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log("Downloaded traderie-page-export.json");
})();`;
}

function inferItemName(exportedPage, lines) {
  const title = exportedPage?.meta?.title || "";
  const titleMatch = title.match(/^What is\s+(.+?)\s+worth\?/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  const url = exportedPage?.meta?.url || "";
  const productMatch = url.match(/\/product\/([^/?#]+)/i);
  if (productMatch) {
    return decodeURIComponent(productMatch[1]).replaceAll("-", " ").trim();
  }

  const statIndex = lines.indexOf("Stats");
  for (let i = 0; i < Math.min(statIndex === -1 ? 30 : statIndex, lines.length); i += 1) {
    const line = lines[i];
    if (isLikelyItemName(line)) {
      return line;
    }
  }

  return "";
}

function extractStatLabels(lines) {
  const start = lines.indexOf("Stats");
  if (start === -1) {
    return [];
  }

  const endCandidates = ["필터 적용필터 해제", "Apply Filters", "1 X "];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (endCandidates.some((candidate) => line.includes(candidate)) || /^\d+\s*X\s+/.test(line)) {
      end = i;
      break;
    }
  }

  const labels = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line === "-" || /^Stats$/i.test(line)) {
      continue;
    }
    if (looksLikeStatLabel(line)) {
      labels.push(cleanStatLabel(line));
    }
  }

  return Array.from(new Set(labels));
}

function inferVariableStatLabels(lines, labels, trades) {
  const variableLabels = labels.filter((label) => {
    const key = toOptionKey(label);
    const observedValues = collectObservedTradeValues(trades, key);
    const hasRangeHint = hasVariableRangeHint(lines, key);

    if (hasRangeHint || observedValues.size > 1) {
      return true;
    }

    return isEditableStatLabel(label) && observedValues.size > 1;
  });

  if (variableLabels.some((label) => toOptionKey(label) === "defense")) {
    return variableLabels.filter((label) => toOptionKey(label) !== "plus_x_defense");
  }

  return variableLabels;
}

function sortTemplateLabels(itemName, labels) {
  const normalizedName = String(itemName || "").trim().toLowerCase();
  const orderMap = new Map();

  if (normalizedName === "어나이얼러스") {
    [
      "plus_x_to_all_skills",
      "plus_x_to_all_attributes",
      "plus_x_to_all_resistances",
      "plus_x_percent_to_experience_gained"
    ].forEach((key, index) => {
      orderMap.set(key, index);
    });
  }

  if (orderMap.size === 0) {
    return labels;
  }

  return [...labels].sort((a, b) => {
    const aIndex = orderMap.get(toOptionKey(a));
    const bIndex = orderMap.get(toOptionKey(b));
    const aOrder = aIndex ?? Number.MAX_SAFE_INTEGER;
    const bOrder = bIndex ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

function parseRecentTradeBlocks(lines) {
  const trades = [];
  let current = null;
  let seenFirstItem = false;

  for (const line of lines) {
    if (seenFirstItem && current?.expectAlternatePrice) {
      if (isTradeEndLine(line)) {
        current.context.push(line);
        if (current.priceText) {
          trades.push(finalizeTrade(current));
        }
        current = null;
        continue;
      }

      if (/^High Rune Value:/i.test(String(line).trim())) {
        current.context.push(line);
        current.expectAlternatePrice = false;
        continue;
      }

      if (/^\d+\s*X\s+/i.test(String(line).trim())) {
        if (current.priceText) {
          trades.push(finalizeTrade(current));
        }
        seenFirstItem = true;
        current = {
          itemText: line,
          details: [],
          priceText: null,
          context: [line]
        };
        continue;
      }

      current.context.push(line);
      if (isTradePriceIgnoreLine(line)) {
        continue;
      }
      current.priceText = current.priceText
        ? `${current.priceText} / OR / ${line}`
        : `OR / ${line}`;
      current.expectAlternatePrice = false;
      continue;
    }

    if (seenFirstItem && current?.expectPrice && !current.priceText) {
      if (isTradeEndLine(line)) {
        current = null;
        continue;
      }

      current.context.push(line);
      if (/^OR$/i.test(String(line).trim())) {
        current.expectAlternatePrice = true;
        continue;
      }
      if (isTradePriceIgnoreLine(line)) {
        continue;
      }
      current.priceText = line;
      current.expectPrice = false;
      continue;
    }

    if (/^\d+\s*X\s+/i.test(line)) {
      if (current && current.priceText) {
        trades.push(finalizeTrade(current));
      }
      seenFirstItem = true;
      current = {
        itemText: line,
        details: [],
        priceText: null,
        context: [line]
      };
      continue;
    }

    if (!seenFirstItem || !current) {
      continue;
    }

    current.context.push(line);

    if (current.priceText && /^OR$/i.test(String(line).trim())) {
      current.expectAlternatePrice = true;
      continue;
    }

    if (isTradeEndLine(line)) {
      if (current.priceText) {
        trades.push(finalizeTrade(current));
      }
      current = null;
      continue;
    }

    if (/^Trading For$/i.test(line)) {
      current.expectPrice = true;
      current.expectAlternatePrice = false;
      continue;
    }

    current.details.push(line);
  }

  if (current) {
    trades.push(finalizeTrade(current));
  }

  return trades.filter((trade) => trade.priceText);
}

function finalizeTrade(trade) {
  const visibleContext = trade.context.filter((line) => !isFixedTradeContextLine(line));

  return {
    itemText: pickRepresentativeItemText(trade),
    priceText: trade.priceText,
    context: visibleContext
  };
}

function looksLikeStatLabel(line) {
  const text = String(line).trim();
  if (!text) {
    return false;
  }

  if (/^[-\d]/.test(text) && !/[A-Za-z가-힣]/.test(text)) {
    return false;
  }

  return text.endsWith(":") || /^[+X]/.test(text) || /^[A-Z][A-Za-z\s%+:-]+$/.test(text) || /[가-힣]/.test(text);
}

function cleanStatLabel(label) {
  return String(label)
    .replace(/:+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEditableStatLabel(label) {
  const text = cleanStatLabel(label);
  return /(?:^|[^A-Za-z])X(?:$|[^A-Za-z])/i.test(text)
    || /\+X/i.test(text)
    || /X%/i.test(text);
}

function hasVariableRangeHint(lines, key) {
  const joined = lines.join("\n");

  if (key === "defense") {
    return /Defense:\s*\d+\s*-\s*\d+/i.test(joined);
  }

  return false;
}

function collectObservedTradeValues(trades, key) {
  const values = new Set();
  const patterns = getTradeValuePatterns(key);

  if (patterns.length === 0) {
    return values;
  }

  for (const trade of trades) {
    for (const line of [trade.itemText, ...(trade.context || [])]) {
      const text = String(line || "").trim();
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) {
          continue;
        }

        values.add(match.slice(1).join(":"));
      }
    }
  }

  return values;
}

function getTradeValuePatterns(key) {
  const patterns = {
    plus_x_to_all_resistances: [/^\+?\s*(\d+)\s*To All Resistances$/i],
    plus_x_to_all_skills: [/^\+?\s*(\d+)\s*To All Skills$/i],
    plus_x_to_all_attributes: [/^\+?\s*(\d+)\s*To All Attributes$/i],
    plus_x_percent_to_experience_gained: [/^\+?\s*(\d+)\s*%\s*To Experience Gained$/i],
    plus_x_defense: [/^\+?\s*(\d+)\s*Defense$/i, /^(\d+)\s*Defense$/i],
    plus_x_percent_enhanced_defense: [/^\+?\s*(\d+)\s*%\s*Enhanced Defense$/i],
    plus_x_percent_faster_cast_rate: [/^\+?\s*(\d+)\s*%\s*Faster Cast Rate$/i],
    fire_resist_plus_x_percent: [/^Fire Resist\s*\+?\s*(\d+)\s*%$/i, /^\+?\s*(\d+)\s*%\s*Fire Resist$/i],
    plus_x_percent_increased_attack_speed: [/^\+?\s*(\d+)\s*%\s*Increased Attack Speed$/i],
    plus_x_percent_damage_to_demons: [/^\+?\s*(\d+)\s*%\s*Damage To Demons$/i],
    x_percent_chance_to_cast_level_x_holy_bolt_on_striking: [/^(\d+)\s*%\s*Chance to cast level\s*(\d+)\s*Holy Bolt on striking$/i],
    x_fire_damage: [/^(\d+)\s*Fire Damage$/i],
    regenerate_mana_x_percent: [/^Regenerate Mana\s*(\d+)\s*%$/i],
    plus_x_to_fire_skills: [/^\+?\s*(\d+)\s*To Fire Skills$/i],
    required_level_x: [/^Required Level\s*(\d+)$/i],
    defense: [/^Defense:\s*(\d+)(?:\s*-\s*\d+)?$/i, /^\+?\s*(\d+)\s*Defense$/i, /^(\d+)\s*Defense$/i]
  };

  return patterns[key] || [];
}

function toOptionKey(label) {
  return cleanStatLabel(label)
    .toLowerCase()
    .replaceAll("%", " percent")
    .replaceAll("+", " plus ")
    .replaceAll("-", " minus ")
    .replaceAll("/", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_가-힣]/g, "")
    .replace(/^_+|_+$/g, "");
}

function toDisplayOptionKey(label) {
  const normalized = toOptionKey(label);
  const localized = {
    plus_x_to_all_resistances: "모든 저항",
    plus_x_to_all_skills: "모든 기술",
    plus_x_to_all_attributes: "모든 능력치",
    plus_x_percent_to_experience_gained: "경험치 획득",
    plus_x_defense: "추가 방어력",
    plus_x_percent_enhanced_defense: "방어력 증가",
    plus_x_percent_faster_cast_rate: "시전 속도 증가",
    fire_resist_plus_x_percent: "화염 저항",
    plus_x_percent_increased_attack_speed: "공격 속도 증가",
    plus_x_percent_damage_to_demons: "악마에게 주는 피해",
    x_percent_chance_to_cast_level_x_holy_bolt_on_striking: "타격 시 레벨 홀리 볼트 시전 확률",
    knockback: "적을 밀쳐냄",
    x_fire_damage: "화염 피해",
    regenerate_mana_x_percent: "마나 재생",
    plus_x_to_fire_skills: "화염 기술",
    required_level_x: "필요 레벨",
    defense: "방어력"
  };

  return localized[normalized] || normalized;
}

function isLikelyItemName(line) {
  const text = String(line).trim();
  if (!text || text.length > 40) {
    return false;
  }

  const blocked = [
    "Marketplace",
    "Community",
    "Value",
    "Platform",
    "Mode",
    "Ladder",
    "Stats",
    "Recent Trades",
    "Wiki"
  ];

  if (blocked.includes(text)) {
    return false;
  }

  return !/[:%]/.test(text);
}

function dedupeTrades(trades) {
  const seen = new Set();
  const unique = [];

  for (const trade of trades) {
    const key = [
      normalizeContextLine(trade.itemText),
      normalizeContextLine(trade.priceText),
      trade.context
        .filter((line) => !isNoiseLine(line) && !isFixedTradeContextLine(line))
        .map((line) => normalizeContextLine(line))
        .join("|")
    ].join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trade);
  }

  return unique;
}

function isFixedTradeContextLine(line) {
  const text = normalizeContextLine(line);
  return text === "pc"
    || text === "softcore"
    || text === "ladder"
    || text === "reign of the warlock";
}

function normalizeContextLine(line) {
  return String(line || "")
    .replace(/\u00a0/g, " ")
    .replace(/•/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickRepresentativeItemText(trade) {
  const candidates = [
    ...trade.details,
    trade.itemText,
    ...trade.context
  ].map((line) => String(line || "").trim()).filter(Boolean);

  const preferred = candidates.find((line) => (
    !isFixedTradeContextLine(line)
      && !/^trading for$/i.test(line)
      && !/^or$/i.test(line)
      && !/^americas$/i.test(line)
      && !/^asia$/i.test(line)
      && !/^normal$/i.test(line)
      && !/^high rune value:/i.test(line)
      && !/\d+\s*(분|시간|일)\s*전/.test(line)
      && !/^\d+\s*x\s+/i.test(line)
  ));

  return preferred || trade.itemText;
}

function scoreTradeSimilarity(item, trade) {
  const haystack = `${trade.itemText} ${trade.context.join(" ")}`.toLowerCase();
  let total = 0;
  const matched = [];
  const mismatched = [];
  const tradeQuantity = extractTradeQuantity(trade);
  let matchedOptionCount = 0;
  let mismatchedOptionCount = 0;

  if (item.name && haystack.includes(String(item.name).toLowerCase())) {
    total += 40;
    matched.push(`name:${item.name}`);
  }

  for (const [key, expected] of Object.entries(item.options || {})) {
    if (isQuantityOptionKey(key)) {
      continue;
    }
    const expectedText = String(expected).trim();
    if (!expectedText.trim()) {
      continue;
    }
    const matchState = getOptionMatchState(key, expectedText, trade, haystack);
    if (matchState === "match") {
      total += 18;
      matchedOptionCount += 1;
      matched.push(`${key}:${expected}`);
      continue;
    }

    if (matchState === "mismatch") {
      total -= 8;
      mismatchedOptionCount += 1;
      mismatched.push(`${key}:${expected}`);
    }
  }

  const requestedQuantity = parseRequestedQuantity(item?.options);
  const quantityDiff = requestedQuantity && tradeQuantity
    ? Math.abs(tradeQuantity - requestedQuantity)
    : null;

  return { total, matched, mismatched, matchedOptionCount, mismatchedOptionCount, tradeQuantity, quantityDiff };
}

function getOptionMatchState(key, expectedText, trade, haystack) {
  const normalizedKey = normalizeOptionLookupKey(key);
  const observedValues = collectObservedTradeValues([trade], normalizedKey);
  if (observedValues.size > 0) {
    const normalizedExpected = normalizeObservedValue(expectedText);
    return Array.from(observedValues).some((value) => value === normalizedExpected) ? "match" : "mismatch";
  }

  if (/^\d+$/.test(String(expectedText).trim())) {
    return "unknown";
  }

  return haystack.includes(expectedText.toLowerCase()) ? "match" : "unknown";
}

function normalizeOptionLookupKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  const aliases = {
    "모든 저항": "plus_x_to_all_resistances",
    "모든 기술": "plus_x_to_all_skills",
    "모든 능력치": "plus_x_to_all_attributes",
    "경험치 획득": "plus_x_percent_to_experience_gained",
    "추가 방어력": "plus_x_defense",
    "방어력 증가": "plus_x_percent_enhanced_defense",
    "시전 속도 증가": "plus_x_percent_faster_cast_rate",
    "화염 저항": "fire_resist_plus_x_percent",
    "공격 속도 증가": "plus_x_percent_increased_attack_speed",
    "악마에게 주는 피해": "plus_x_percent_damage_to_demons",
    "타격 시 레벨 홀리 볼트 시전 확률": "x_percent_chance_to_cast_level_x_holy_bolt_on_striking",
    "적을 밀쳐냄": "knockback",
    "화염 피해": "x_fire_damage",
    "마나 재생": "regenerate_mana_x_percent",
    "화염 기술": "plus_x_to_fire_skills",
    "필요 레벨": "required_level_x",
    "방어력": "defense"
  };

  return aliases[key] || aliases[normalized] || normalized;
}

function normalizeObservedValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[+%\s]/g, "");
}

function compareTradeScores(a, b, requestedQuantity) {
  if (requestedQuantity) {
    const diffA = a.score.quantityDiff ?? Number.POSITIVE_INFINITY;
    const diffB = b.score.quantityDiff ?? Number.POSITIVE_INFINITY;
    if (diffA !== diffB) {
      return diffA - diffB;
    }
  }

  if (a.score.matchedOptionCount !== b.score.matchedOptionCount) {
    return b.score.matchedOptionCount - a.score.matchedOptionCount;
  }

  if (a.score.mismatchedOptionCount !== b.score.mismatchedOptionCount) {
    return a.score.mismatchedOptionCount - b.score.mismatchedOptionCount;
  }

  return b.score.total - a.score.total;
}

function parseRequestedQuantity(options) {
  for (const [key, value] of Object.entries(options || {})) {
    if (!isQuantityOptionKey(key)) {
      continue;
    }

    const amount = Number.parseInt(String(value).trim(), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }

  return null;
}

function isQuantityOptionKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return normalized === "quantity"
    || normalized === "count"
    || normalized === "qty"
    || normalized === "수량"
    || normalized === "갯수"
    || normalized === "개수";
}

function extractTradeQuantity(trade) {
  const source = [trade.context?.[0], trade.itemText]
    .map((entry) => String(entry || "").trim())
    .find(Boolean);

  const match = source?.match(/^(\d+)\s*x\s+/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function normalizePrice(priceText) {
  const token = detectPriceToken(priceText);
  if (!token) {
    return null;
  }

  const runeValue = {
    zod: 16,
    jah: 15,
    ber: 14,
    sur: 13,
    lo: 12,
    ohm: 11,
    vex: 10,
    gul: 9,
    ist: 8,
    mal: 7,
    um: 6,
    pul: 5,
    lem: 4,
    fal: 3,
    ko: 2
  };

  const tokenMap = {
    zod: { label: "zod", value: runeValue.zod },
    jah: { label: "jah", value: runeValue.jah },
    ber: { label: "ber", value: runeValue.ber },
    sur: { label: "sur", value: runeValue.sur },
    lo: { label: "lo", value: runeValue.lo },
    ohm: { label: "ohm", value: runeValue.ohm },
    vex: { label: "vex", value: runeValue.vex },
    gul: { label: "gul", value: runeValue.gul },
    ist: { label: "ist", value: runeValue.ist },
    mal: { label: "mal", value: runeValue.mal },
    um: { label: "um", value: runeValue.um },
    pul: { label: "pul", value: runeValue.pul },
    lem: { label: "lem", value: runeValue.lem },
    fal: { label: "fal", value: runeValue.fal },
    ko: { label: "ko", value: runeValue.ko },
    조드: { label: "zod", value: runeValue.zod },
    자: { label: "jah", value: runeValue.jah },
    베르: { label: "ber", value: runeValue.ber },
    수르: { label: "sur", value: runeValue.sur },
    로: { label: "lo", value: runeValue.lo },
    옴: { label: "ohm", value: runeValue.ohm },
    벡스: { label: "vex", value: runeValue.vex },
    굴: { label: "gul", value: runeValue.gul },
    이스트: { label: "ist", value: runeValue.ist },
    말: { label: "mal", value: runeValue.mal },
    움: { label: "um", value: runeValue.um },
    풀: { label: "pul", value: runeValue.pul },
    렘: { label: "lem", value: runeValue.lem },
    팔: { label: "fal", value: runeValue.fal },
    코: { label: "ko", value: runeValue.ko },
    "최상급 자수정": { label: "perfect_amethyst", value: 0.25 },
    "최상급 해골": { label: "perfect_skull", value: 0.25 },
    "최상급 토파즈": { label: "perfect_topaz", value: 0.25 },
    "최상급 루비": { label: "perfect_ruby", value: 0.25 },
    "최상급 다이아몬드": { label: "perfect_diamond", value: 0.25 },
    "최상급 사파이어": { label: "perfect_sapphire", value: 0.25 },
    "최상급 에메랄드": { label: "perfect_emerald", value: 0.25 }
  };

  const normalized = tokenMap[token];
  if (!normalized) {
    return null;
  }

  return {
    label: normalized.label,
    value: normalized.value
  };
}

export function formatPriceLabel(label) {
  const labelMap = {
    zod: "조드 룬",
    jah: "자 룬",
    ber: "베르 룬",
    sur: "수르 룬",
    lo: "로 룬",
    ohm: "옴 룬",
    vex: "벡스 룬",
    gul: "굴 룬",
    ist: "이스트 룬",
    mal: "말 룬",
    um: "움 룬",
    pul: "풀 룬",
    lem: "렘 룬",
    fal: "팔 룬",
    ko: "코 룬",
    perfect_amethyst: "최상급 자수정",
    perfect_skull: "최상급 해골",
    perfect_topaz: "최상급 토파즈",
    perfect_ruby: "최상급 루비",
    perfect_diamond: "최상급 다이아몬드",
    perfect_sapphire: "최상급 사파이어",
    perfect_emerald: "최상급 에메랄드"
  };

  return labelMap[label] || label || "-";
}

function summarizePrices(prices) {
  if (prices.length === 0) {
    return {
      suggestedListPrice: null,
      note: "비교 가능한 최근 거래를 아직 충분히 읽지 못했습니다."
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

function detectPriceToken(text) {
  const source = String(text);
  const patterns = [
    /\b(zod|jah|ber|sur|lo|ohm|vex|gul|ist|mal|um|pul|lem|fal|ko)\b/i,
    /(조드|베르|수르|벡스|이스트|말|움|풀|렘|팔|코|굴|옴|로|자)\s*룬/i,
    /(최상급 자수정|최상급 해골|최상급 토파즈|최상급 루비|최상급 다이아몬드|최상급 사파이어|최상급 에메랄드)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function isNoiseLine(line) {
  const text = String(line).trim();
  if (!text) {
    return true;
  }

  if (/^OR$/i.test(text)) {
    return true;
  }

  if (/^High Rune Value:/i.test(text)) {
    return true;
  }

  if (/\d+\s*(분|시간|일)\s*전/.test(text)) {
    return true;
  }

  return !detectPriceToken(text) && !/^\d+\s*X\s+/.test(text);
}

function isTradePriceIgnoreLine(line) {
  const text = String(line).trim();
  if (!text) {
    return true;
  }

  if (/^OR$/i.test(text)) {
    return true;
  }

  if (/^High Rune Value:/i.test(text)) {
    return true;
  }

  if (isTradeEndLine(text)) {
    return true;
  }

  return false;
}

function isTradeEndLine(line) {
  const text = String(line).trim();
  if (/\d+\s*(분|시간|일)\s*전/.test(text)) {
    return true;
  }

  if (/^(더 보기|도움말|시작하기|F\.A\.Q\.|안전 거래 가이드|피드백 제출|Suggest A New Game|사용자 신고|Akrew Pro|순위표|소개|문의하기|Advertise with Traderie|Our Moderators|상점|콘텐츠 크리에이터 되기|Discord Values Bot|법적 사항|이용약관|개인정보 보호방침|커뮤니티 가이드라인)$/i.test(text)) {
    return true;
  }

  return false;
}
