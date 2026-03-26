(() => {
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
})();
