(function () {
  const SaleClick = globalThis.SaleClick;
  const saleAtInput = document.querySelector("#sale-at");
  const optionInput = document.querySelector("#option-text");
  const primaryInput = document.querySelector("#primary-text");
  const secondaryInput = document.querySelector("#secondary-text");
  const rejected = document.querySelector("#rejected");
  const pageHint = document.querySelector("#page-hint");
  const countdown = document.querySelector("#countdown");
  const startButton = document.querySelector("#start");
  const stopButton = document.querySelector("#stop");
  const phase = document.querySelector("#phase");
  const statusText = document.querySelector("#status-text");
  const probeButton = document.querySelector("#probe");
  const matches = document.querySelector("#matches");

  const PHASES = {
    idle: "未开始",
    waiting: "等待中",
    searching: "查找按钮",
    "clicked-buy": "已点购买",
    done: "已点提交",
    "buy-only": "已点购买",
    ignored: "需要手点",
    "not-found": "没找到",
    "too-late": "时间已过",
    stopped: "已停止",
    error: "无法开始",
  };

  let saleAtMs = SaleClick.parseSaleInput(SaleClick.DEFAULTS.saleAtLocal);
  let armed = false;

  function renderCountdown() {
    if (!Number.isFinite(saleAtMs)) {
      countdown.textContent = "--:--:--";
      return;
    }
    const left = saleAtMs - Date.now();
    if (left <= 0) {
      countdown.textContent = "00:00:00";
      return;
    }
    const total = Math.floor(left / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = function (n) {
      return String(n).padStart(2, "0");
    };
    countdown.textContent = (hours > 99 ? String(hours) : pad(hours)) + ":" + pad(minutes) + ":" + pad(seconds);
  }

  function renderRejected() {
    const primary = SaleClick.classifyLabels(primaryInput.value);
    const secondary = SaleClick.classifyLabels(secondaryInput.value);
    const options = SaleClick.classifyLabels(optionInput.value);
    const blocked = primary.rejected.concat(secondary.rejected, options.rejected);
    if (!blocked.length) {
      rejected.hidden = true;
      rejected.textContent = "";
      return;
    }
    rejected.hidden = false;
    rejected.textContent = "这些不会自动点：" + blocked.join("、") + "。付款和定金请自己确认。";
  }

  function renderStatus(status) {
    const name = status && status.phase ? status.phase : "idle";
    phase.textContent = PHASES[name] || "未开始";
    phase.className = "phase";
    if (name === "waiting" || name === "searching" || name === "done" || name === "clicked-buy" || name === "buy-only") {
      phase.classList.add("live");
    }
    if (name === "ignored" || name === "not-found" || name === "error" || name === "too-late") {
      phase.classList.add("bad");
    }
    statusText.textContent = (status && status.message) || "打开商品页，选好版本和颜色后再开始。";
    startButton.disabled = armed && (name === "waiting" || name === "searching" || name === "clicked-buy");
  }

  function currentTab() {
    return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      return tabs[0] || null;
    });
  }

  function isVmall(url) {
    try {
      const host = new URL(url).hostname;
      return host === "vmall.com" || host.endsWith(".vmall.com");
    } catch (error) {
      return false;
    }
  }

  async function refreshPageHint() {
    const tab = await currentTab();
    if (!tab || !isVmall(tab.url || "")) {
      pageHint.textContent = "当前标签不是华为商城。先打开商品页，再点开始。";
      return tab;
    }
    pageHint.textContent = "将在这个商品页里选规格并点「立即购买」。地址要用你已经选好的那个。";
    return tab;
  }

  async function load() {
    const stored = await chrome.storage.local.get([
      "armed",
      "saleAtMs",
      "optionText",
      "primaryText",
      "secondaryText",
      "status",
    ]);
    armed = Boolean(stored.armed);
    saleAtMs = Number.isFinite(stored.saleAtMs)
      ? stored.saleAtMs
      : SaleClick.parseSaleInput(SaleClick.DEFAULTS.saleAtLocal);
    saleAtInput.value = SaleClick.formatSaleInput(saleAtMs);
    optionInput.value = stored.optionText == null ? SaleClick.DEFAULTS.optionText : stored.optionText;
    primaryInput.value = stored.primaryText || SaleClick.DEFAULTS.primaryText;
    secondaryInput.value = stored.secondaryText || SaleClick.DEFAULTS.secondaryText;
    renderRejected();
    renderCountdown();
    renderStatus(stored.status);
    await refreshPageHint();
  }

  function collectForm() {
    saleAtMs = SaleClick.parseSaleInput(saleAtInput.value);
    return {
      saleAtMs: saleAtMs,
      optionText: optionInput.value,
      primaryText: primaryInput.value,
      secondaryText: secondaryInput.value,
    };
  }

  async function saveDraft() {
    const form = collectForm();
    if (!Number.isFinite(form.saleAtMs)) return;
    await chrome.storage.local.set(form);
  }

  startButton.addEventListener("click", async function () {
    renderRejected();
    const form = collectForm();
    const primary = SaleClick.resolveLabels(form.primaryText, SaleClick.DEFAULTS.primaryText);
    if (!Number.isFinite(form.saleAtMs)) {
      renderStatus({ phase: "error", message: "请填写开售时间。" });
      return;
    }
    if (!primary.labels.length) {
      renderStatus({ phase: "error", message: "没有可点的购买按钮文字。" });
      return;
    }
    if (Date.now() > form.saleAtMs + SaleClick.LIMITS.searchWindowMs) {
      renderStatus({ phase: "too-late", message: "这个时间已经过了，没有点击。" });
      return;
    }
    const tab = await refreshPageHint();
    if (!tab || !isVmall(tab.url || "")) {
      renderStatus({ phase: "error", message: "请先打开华为商城商品页。" });
      return;
    }
    try {
      const ready = await chrome.tabs.sendMessage(tab.id, { type: "PROBE" });
      if (!ready || !ready.ok) throw new Error("missing");
    } catch (error) {
      renderStatus({ phase: "error", message: "页面还没准备好。刷新商品页后再开始。" });
      return;
    }
    armed = true;
    await chrome.storage.local.set({
      armed: true,
      runNonce: Date.now(),
      saleAtMs: form.saleAtMs,
      optionText: form.optionText,
      primaryText: form.primaryText,
      secondaryText: form.secondaryText,
      status: { phase: "waiting", message: "等待开售", at: Date.now() },
    });
    renderStatus({ phase: "waiting", message: "等待开售。请把商品页留在前台。" });
  });

  stopButton.addEventListener("click", async function () {
    armed = false;
    startButton.disabled = false;
    await chrome.storage.local.set({
      armed: false,
      status: { phase: "stopped", message: "已停止", at: Date.now() },
    });
    const tab = await currentTab();
    if (tab && isVmall(tab.url || "")) {
      chrome.tabs.sendMessage(tab.id, { type: "STOP" }).catch(function () {});
    }
    renderStatus({ phase: "stopped", message: "已停止" });
  });

  probeButton.addEventListener("click", async function () {
    await saveDraft();
    const tab = await refreshPageHint();
    matches.replaceChildren();
    if (!tab || !isVmall(tab.url || "")) {
      renderStatus({ phase: "error", message: "请先打开华为商城商品页。" });
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "PROBE" });
      if (!response || !response.ok) throw new Error("no response");
      if (!response.matches.length) {
        const item = document.createElement("li");
        item.textContent = "当前页没找到这些按钮。";
        matches.appendChild(item);
        return;
      }
      response.matches.forEach(function (match) {
        const item = document.createElement("li");
        item.textContent = "「" + match.text + "」" + (match.disabled ? "，还不能点" : "，可以点");
        matches.appendChild(item);
      });
    } catch (error) {
      renderStatus({ phase: "error", message: "页面还没准备好。刷新商品页后再查找。" });
    }
  });

  [saleAtInput, optionInput, primaryInput, secondaryInput].forEach(function (input) {
    input.addEventListener("input", function () {
      renderRejected();
      renderCountdown();
      saveDraft().catch(function () {});
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.armed) armed = Boolean(changes.armed.newValue);
    if (changes.status && changes.status.newValue) renderStatus(changes.status.newValue);
  });

  setInterval(renderCountdown, 250);
  load().catch(function (error) {
    renderStatus({ phase: "error", message: "插件设置没有读出来。" });
    console.error(error);
  });
})();
