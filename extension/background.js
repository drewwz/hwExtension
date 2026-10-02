const DEFAULTS = {
  armed: false,
  saleAtLocal: "2026-10-03T10:08:00",
  primaryText: "立即抢购\n立即购买\n马上抢购\n立即下单",
  secondaryText: "提交订单\n确认订单",
};

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(["saleAtMs", "primaryText"]).then(function (current) {
    if (current.saleAtMs && current.primaryText) return;
    const saleAtMs = new Date(DEFAULTS.saleAtLocal).getTime();
    chrome.storage.local.set({
      armed: false,
      saleAtMs: saleAtMs,
      primaryText: DEFAULTS.primaryText,
      secondaryText: DEFAULTS.secondaryText,
      status: { phase: "idle", message: "还没开始", at: Date.now() },
    });
  });
});
