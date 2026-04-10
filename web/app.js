import { buildRecommendationFromExport, exportBrowserCollectorScript, extractItemTemplate, formatPriceLabel } from "./shared/pricing.mjs";

const scriptOutput = document.querySelector("#script-output");
const copyScriptButton = document.querySelector("#copy-script");
const fileInput = document.querySelector("#json-file");
const fileName = document.querySelector("#file-name");
const runButton = document.querySelector("#run-analysis");
const itemNameDisplay = document.querySelector("#item-name");
const itemOptionsForm = document.querySelector("#item-options");
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const matches = document.querySelector("#matches");

let uploadedJson = null;
let currentItemName = "";
let optionSchema = {};

scriptOutput.value = exportBrowserCollectorScript();

copyScriptButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(scriptOutput.value);
  copyScriptButton.textContent = "복사 완료";
  window.setTimeout(() => {
    copyScriptButton.textContent = "스크립트 복사";
  }, 1500);
});

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  fileName.textContent = `${file.name} 선택됨`;

  try {
    uploadedJson = JSON.parse(await file.text());
    const template = extractItemTemplate(uploadedJson);
    optionSchema = template.options || {};
    currentItemName = template.name || "";
    itemNameDisplay.textContent = currentItemName || "아이템 이름을 찾지 못했습니다";
    itemNameDisplay.classList.toggle("muted", !currentItemName);
    renderOptionFields(optionSchema);

    status.textContent = "파일을 읽었습니다. 아이템 이름과 옵션 템플릿을 자동으로 채웠어요. 필요한 값만 수정한 뒤 결과 보기를 누르세요.";
  } catch (error) {
    uploadedJson = null;
    currentItemName = "";
    optionSchema = {};
    itemNameDisplay.textContent = "JSON 업로드 후 자동으로 표시됩니다";
    itemNameDisplay.classList.add("muted");
    renderOptionFields({});
    status.textContent = `JSON 읽기 실패: ${error.message}`;
  }
});

runButton.addEventListener("click", runAnalysis);

itemOptionsForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  event.preventDefault();
  runAnalysis();
});

function runAnalysis() {
  if (!uploadedJson) {
    status.textContent = "먼저 Traderie에서 다운로드한 JSON 파일을 업로드해주세요.";
    return;
  }

  const item = {
    name: currentItemName,
    options: collectOptionValues()
  };

  const result = buildRecommendationFromExport(uploadedJson, item);
  renderResult(result);
}

function renderResult(result) {
  status.textContent = "";

  summary.classList.remove("hidden");
  matches.classList.remove("hidden");

  summary.innerHTML = [
    card("추천 등록가", formatRecommendationPrice(result.recommendation)),
    card("관측 범위", formatRecommendationRange(result.recommendation.range)),
    card("비교 표본", `${result.recommendation.sampleSize || 0}건`)
  ].join("");

  if (result.matches.length === 0) {
    matches.innerHTML = `<div class="match">비슷한 거래를 아직 찾지 못했습니다. 옵션 값을 조금 더 넓게 적어보세요.</div>`;
    return;
  }

  matches.innerHTML = result.matches.map(({ trade, score }) => {
    const timeAgo = extractTradeTime(trade.context);
    const detailText = formatTradeDetailText(trade, result.item?.name);
    return `
      <article class="match">
        <strong>${escapeHtml(formatTradePriceText(trade.priceText))}</strong>
        ${detailText ? `<div>${escapeHtml(detailText)}</div>` : ""}
        ${timeAgo ? `<div class="muted mono">${escapeHtml(timeAgo)}</div>` : ""}
      </article>
    `;
  }).join("");
}

function card(label, value) {
  return `<div class="card"><div class="muted">${escapeHtml(label)}</div><div><strong>${escapeHtml(value)}</strong></div></div>`;
}

function renderOptionFields(options) {
  const entries = Object.entries(options || {});
  if (entries.length === 0) {
    itemOptionsForm.innerHTML = "";
    return;
  }

  itemOptionsForm.innerHTML = entries.map(([key, value]) => {
    const inputType = isNumericOptionKey(key) ? "number" : "text";
    const inputMode = isNumericOptionKey(key) ? ' inputmode="numeric"' : "";
    const placeholder = inputType === "number" ? "숫자 입력" : "값 입력";
    return `
      <div class="option-row">
        <label for="${escapeHtml(optionFieldId(key))}">${escapeHtml(key)}</label>
        <input
          id="${escapeHtml(optionFieldId(key))}"
          class="input"
          data-option-key="${escapeHtml(key)}"
          type="${inputType}"
          ${inputMode}
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
        />
      </div>
    `;
  }).join("");
}

function collectOptionValues() {
  const values = {};
  for (const input of itemOptionsForm.querySelectorAll("[data-option-key]")) {
    const key = input.dataset.optionKey;
    values[key] = input.value.trim();
  }

  return values;
}

function optionFieldId(key) {
  return `option-${String(key).toLowerCase().replace(/\s+/g, "-")}`;
}

function isNumericOptionKey(key) {
  return [
    "수량",
    "추가 방어력",
    "방어력 증가",
    "시전 속도 증가",
    "화염 저항",
    "공격 속도 증가",
    "악마에게 주는 피해",
    "생명력",
    "명중률",
    "민첩",
    "강타 확률",
    "화염 피해",
    "마나 재생",
    "화염 기술",
    "필요 레벨",
    "방어력"
  ].includes(String(key || "").trim());
}

function formatRecommendationPrice(recommendation) {
  if (recommendation?.suggestedListPriceText) {
    return formatTradePriceText(recommendation.suggestedListPriceText);
  }

  const label = recommendation?.suggestedListPrice;
  if (!label) {
    return "판단 보류";
  }
  return formatPriceLabel(label);
}

function formatRecommendationRange(range) {
  if (!range) {
    return "-";
  }

  const [low, high] = String(range).split(" - ");
  if (!low || !high) {
    return formatPriceLabel(range);
  }

  return `${formatPriceLabel(low)} - ${formatPriceLabel(high)}`;
}

function formatTradePriceText(priceText) {
  return String(priceText || "")
    .replaceAll(" / OR / ", " OR ")
    .replace(/^OR \/\s*/i, "OR ");
}

function extractTradeTime(context) {
  return (context || []).find((entry) => /\d+\s*(분|시간|일)\s*전/.test(String(entry).trim())) || "";
}

function formatTradeDetailText(trade, itemName) {
  const details = extractTradeDetails(trade, itemName);
  if (details.length > 0) {
    return details.join(" / ");
  }

  const text = String(trade?.itemText || "").trim();
  const normalizedName = String(itemName || "").trim();
  if (!text) {
    return "";
  }

  if (text === `1 X ${normalizedName}` || text === normalizedName) {
    return "";
  }

  return text;
}

function extractTradeDetails(trade, itemName) {
  const normalizedName = String(itemName || "").trim().toLowerCase();
  const context = (trade?.context || []).map((entry) => normalizeTradeDetailEntry(entry)).filter(Boolean);
  const priceStartIndex = context.findIndex((entry) => /(?:^|\b)(trading for|i give)(?:\b|$)/i.test(entry));
  const detailSource = priceStartIndex === -1 ? context : context.slice(0, priceStartIndex);

  return Array.from(new Set(detailSource
    .filter((entry) => {
      const lower = entry.toLowerCase();
      return lower !== `1 x ${normalizedName}`
        && lower !== normalizedName
        && !/^or$/i.test(entry)
        && !/^they give$/i.test(entry)
        && !/^high rune value:/i.test(entry)
        && !/^additional item/i.test(entry)
        && !/\d+\s*(분|시간|일)\s*전/.test(entry)
        && !/^\d+\s*x\s+/.test(entry)
        && !/^(pc|softcore|ladder|reign of the warlock|americas|asia|europe)$/i.test(entry);
    })));
}

function normalizeTradeDetailEntry(entry) {
  const text = String(entry || "")
    .replace(/\u00a0/g, " ")
    .replace(/•/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(Trading For|I Give)$/i.test(text)) {
    return text;
  }

  return text.replace(/\b(?:Trading For|I Give)\b[\s\S]*$/i, "").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
