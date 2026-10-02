const DEFAULTS = {
  armed: false,
  saleAtLocal: "2026-10-03T10:08:00",
  optionText: "曜石黑\n16GB+1TB 典藏版",
  primaryText: "立即购买",
  secondaryText: "提交订单\n确认订单",
};

function isVmall(url) {
  try {
    const host = new URL(url).hostname;
    return host === "vmall.com" || host.endsWith(".vmall.com");
  } catch (error) {
    return false;
  }
}

function recentBuy(settings) {
  const progress = settings && settings.clickProgress;
  if (!progress || Number(progress.primaryClicks) < 1) return false;
  const boughtAt = Number(progress.lastClickAt) || 0;
  return boughtAt > 0 && Date.now() <= boughtAt + 180000;
}

function attach(tabId) {
  try {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        files: ["shared.js", "content.js"],
      },
      function () {
        void chrome.runtime.lastError;
      }
    );
  } catch (error) {}
}

chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
  if (info.status !== "complete") return;
  const seen = (tab && tab.url) || info.url || "";
  function consider(url) {
    if (!isVmall(url)) return;
    chrome.storage.local.get(["armed", "clickProgress"], function (settings) {
      if (chrome.runtime.lastError || !settings) return;
      if (!settings.armed && !recentBuy(settings)) return;
      attach(tabId);
    });
  }
  if (seen) {
    consider(seen);
    return;
  }
  chrome.tabs.get(tabId, function (current) {
    if (chrome.runtime.lastError || !current) return;
    consider(current.url || "");
  });
});

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
