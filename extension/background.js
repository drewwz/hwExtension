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

function isPaymentUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host !== "vmall.com" && !host.endsWith(".vmall.com")) return false;
    return /\/payment\/|\/multiPay/i.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function sendExtension(message) {
  try {
    chrome.runtime.sendMessage(message, function () {
      void chrome.runtime.lastError;
    });
  } catch (error) {}
}

let ringing = false;

function startRing() {
  function ping() {
    sendExtension({ type: "RING_PLAY" });
  }
  if (ringing) {
    ping();
    return;
  }
  ringing = true;
  try {
    const maybe = chrome.offscreen.hasDocument();
    if (maybe && typeof maybe.then === "function") {
      maybe.then(
        function (exists) {
          if (exists) {
            ping();
            return;
          }
          chrome.offscreen.createDocument(
            {
              url: "offscreen.html",
              reasons: ["AUDIO_PLAYBACK"],
              justification: "支付页打开后循环播放铃声，直到手动停止",
            },
            function () {
              void chrome.runtime.lastError;
              ping();
            }
          );
        },
        function () {
          ringing = false;
        }
      );
      return;
    }
  } catch (error) {}
  ringing = false;
}

function stopRing() {
  ringing = false;
  sendExtension({ type: "RING_HALT" });
}

function markPaying() {
  chrome.storage.local.set({
    mode: "restock",
    restockPhase: "paying",
    armed: true,
    status: {
      phase: "done",
      message: "已进入支付页，铃声会一直响。请在 8 分钟内付款，点「停止」关掉铃声。",
      at: Date.now(),
    },
  });
  startRing();
}

chrome.runtime.onMessage.addListener(function (message, sender) {
  if (!message || !message.type) return;
  if (message.type === "RING_START") {
    startRing();
    return;
  }
  if (message.type === "RING_STOP" || message.type === "STOP_ALL") {
    stopRing();
    return;
  }
  if (message.type === "RESTOCK_ARM") {
    chrome.storage.local.set({
      restockTabId: message.tabId || (sender.tab && sender.tab.id) || 0,
      productUrl: message.productUrl || "",
    });
    return;
  }
  if (message.type === "RESTOCK_RESUME") {
    chrome.storage.local.get(["restockTabId", "productUrl"], function (settings) {
      if (chrome.runtime.lastError || !settings) return;
      const tabId = sender.tab && sender.tab.id;
      chrome.storage.local.set(
        {
          mode: "restock",
          restockPhase: "scan",
          armed: true,
          clickProgress: null,
          status: {
            phase: "searching",
            message: "这次没买到，回到商品页继续刷新",
            at: Date.now(),
          },
        },
        function () {
          void chrome.runtime.lastError;
          if (!tabId || !settings.productUrl) return;
          if (settings.restockTabId && tabId !== settings.restockTabId) {
            chrome.tabs.reload(settings.restockTabId);
            chrome.tabs.update(settings.restockTabId, { active: true });
            chrome.tabs.remove(tabId);
            return;
          }
          chrome.tabs.update(tabId, { url: settings.productUrl });
        }
      );
    });
  }
});

chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
  const seenEarly = (tab && tab.url) || info.url || "";
  if (seenEarly && isPaymentUrl(seenEarly)) {
    chrome.storage.local.get(["mode", "restockPhase"], function (settings) {
      if (chrome.runtime.lastError || !settings) return;
      if (settings.mode !== "restock") return;
      if (settings.restockPhase !== "ordering" && settings.restockPhase !== "paying") return;
      markPaying();
    });
  }
  if (info.status !== "complete") return;
  const seen = seenEarly;
  function consider(url) {
    if (!isVmall(url)) return;
    chrome.storage.local.get(["armed", "clickProgress", "mode"], function (settings) {
      if (chrome.runtime.lastError || !settings) return;
      if (settings.mode === "restock" || settings.armed || recentBuy(settings)) attach(tabId);
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
