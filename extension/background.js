const DEFAULTS = {
  armed: false,
  saleAtLocal: "2026-10-03T10:08:00",
  optionText: "曜石黑\n16GB+1TB 典藏版",
  primaryText: "立即购买",
  secondaryText: "提交订单\n确认订单",
};

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(["saleAtMs", "primaryText"]).then(function (current) {
    if (current.saleAtMs && current.primaryText) return;
    const saleAtMs = new Date(DEFAULTS.saleAtLocal).getTime();
    chrome.storage.local.set({
      armed: false,
      saleAtMs: saleAtMs,
      optionText: DEFAULTS.optionText,
      primaryText: DEFAULTS.primaryText,
      secondaryText: DEFAULTS.secondaryText,
      status: { phase: "idle", message: "还没开始", at: Date.now() },
    });
  });
});
