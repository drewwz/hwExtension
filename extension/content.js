(function () {
  if (globalThis.__saleClickContent) return;
  globalThis.__saleClickContent = true;

  const SaleClick = globalThis.SaleClick;
  const highlighted = [];
  let generation = 0;

  function stateKey(saleAtMs) {
    return "sale-click-state:" + saleAtMs;
  }

  function readState(saleAtMs) {
    try {
      const raw = sessionStorage.getItem(stateKey(saleAtMs));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeState(saleAtMs, state) {
    sessionStorage.setItem(stateKey(saleAtMs), JSON.stringify(state));
  }

  function clearState(saleAtMs) {
    sessionStorage.removeItem(stateKey(saleAtMs));
  }

  function readSettings() {
    return chrome.storage.local.get([
      "armed",
      "activeRun",
      "saleAtMs",
      "optionText",
      "primaryText",
      "secondaryText",
      "searchWindowMs",
      "afterBuyWindowMs",
      "clickProgress",
    ]);
  }

  function isOrderConfirm() {
    return /orderConfirm/i.test(location.pathname) || /\/bp\/orderConfirm/i.test(location.href);
  }

  function needsSubmit(settings) {
    const progress = settings && settings.clickProgress;
    if (!progress || Number(progress.primaryClicks) < 1 || Number(progress.secondaryClicks) >= 1) return false;
    const boughtAt = Number(progress.lastClickAt) || 0;
    return boughtAt > 0 && Date.now() <= boughtAt + SaleClick.LIMITS.afterBuyWindowMs;
  }

  function shouldSubmitOnly(settings) {
    if (needsSubmit(settings)) return true;
    return Boolean(settings && settings.armed && isOrderConfirm() && Date.now() >= Number(settings.saleAtMs));
  }

  function elementVisible(el) {
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }

  function readSelected() {
    const text = document.body ? document.body.innerText : "";
    const match = text.match(/已选[:：]\s*([^\n]+)/);
    return match ? SaleClick.normalizeText(match[1]) : "";
  }

  function addressPromptVisible() {
    const nodes = document.querySelectorAll("div, button, a, span");
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (SaleClick.normalizeText(el.textContent) !== "请选择收货地址") continue;
      if (elementVisible(el)) return true;
    }
    return false;
  }

  function findOptionElement(label) {
    const want = SaleClick.normalizeText(label);
    const nodes = document.querySelectorAll('div, button, a, [role="button"]');
    let best = null;
    let bestScore = -1;
    Array.prototype.forEach.call(nodes, function (el) {
      if (SaleClick.normalizeText(el.textContent) !== want) return;
      if (!elementVisible(el)) return;
      const rect = el.getBoundingClientRect();
      const pressable = String(el.className || "").indexOf("r-1loqt21") !== -1 || el.tagName === "BUTTON";
      const score = rect.width * rect.height + (pressable ? 100000 : 0);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return best;
  }

  async function selectMissingOptions(labels) {
    const missing = [];
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      const want = SaleClick.normalizeText(label);
      const selected = readSelected();
      if (!selected || selected.indexOf(want) === -1) {
        const el = selected ? findOptionElement(label) : null;
        if (!selected || !el) {
          missing.push(label);
        } else {
          el.click();
          await new Promise(function (resolve) {
            setTimeout(resolve, 350);
          });
          if (readSelected().indexOf(want) === -1) missing.push(label);
        }
      }
    }
    if (addressPromptVisible()) {
      return {
        ok: false,
        missing: missing,
        summary: readSelected(),
        blockedReason: "页面还写着「请选择收货地址」。请先登录并选好地址，插件不会新添地址。",
      };
    }
    return {
      ok: missing.length === 0,
      missing: missing,
      summary: readSelected(),
      blockedReason: missing.length ? "规格还没选上：" + missing.join("、") : "",
    };
  }

  let lastStatusKey = "";

  function ensureBanner() {
    let banner = document.getElementById("sale-click-banner");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "sale-click-banner";
    banner.setAttribute("data-sale-click-ui", "1");
    banner.setAttribute("role", "status");
    banner.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "box-sizing:border-box",
      "padding:10px 16px",
      "background:#1f3d2b",
      "color:#fff",
      "font:600 14px/1.4 sans-serif",
      "text-align:center",
    ].join(";");
    (document.body || document.documentElement).appendChild(banner);
    return banner;
  }

  function publishStatus(status) {
    const key = status.phase + "|" + status.message;
    const banner = ensureBanner();
    banner.textContent = "开售点按：" + (status.message || status.phase || "");
    banner.style.background =
      status.phase === "ignored" || status.phase === "not-found" || status.phase === "too-late" || status.phase === "error"
        ? "#8a2e1b"
        : "#1f3d2b";
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    chrome.storage.local.set({
      status: {
        phase: status.phase,
        message: status.message,
        at: Date.now(),
      },
    });
    if (status.phase === "ignored" || status.phase === "not-found" || status.phase === "too-late") {
      markTitle("请手点");
    } else if (status.phase === "done" || status.phase === "buy-only" || status.phase === "clicked-buy") {
      markTitle("已点");
    }
  }

  function markTitle(label) {
    const clean = document.title.replace(/^【[^】]*】/, "");
    document.title = "【" + label + "】" + clean;
  }

  function rememberHighlight(el) {
    highlighted.push({ el: el, outline: el.style.outline, offset: el.style.outlineOffset });
    el.style.outline = "3px solid #a33b24";
    el.style.outlineOffset = "2px";
  }

  function clearHighlights() {
    highlighted.splice(0).forEach(function (item) {
      item.el.style.outline = item.outline;
      item.el.style.outlineOffset = item.offset;
    });
  }

  function probe() {
    clearHighlights();
    const settingsPromise = readSettings();
    return settingsPromise.then(function (settings) {
      const primary = SaleClick.resolveLabels(settings.primaryText, SaleClick.DEFAULTS.primaryText);
      const secondary = SaleClick.resolveLabels(settings.secondaryText, SaleClick.DEFAULTS.secondaryText);
      const options = SaleClick.resolveOptionLabels(settings.optionText);
      const labels = options.concat(primary.labels, secondary.labels);
      const ranked = SaleClick.rankCandidates(SaleClick.collectCandidates(document), labels).slice(0, 5);
      ranked.forEach(function (item) {
        if (item.el) rememberHighlight(item.el);
      });
      setTimeout(clearHighlights, 2500);
      return ranked.map(function (item) {
        return {
          text: item.text,
          disabled: item.disabled,
          matchedLabel: item.matchedLabel,
          exact: item.exact,
        };
      });
    });
  }

  function searchWindowOf(settings) {
    const value = Number(settings && settings.searchWindowMs);
    if (!Number.isFinite(value)) return SaleClick.LIMITS.searchWindowMs;
    return Math.min(SaleClick.LIMITS.searchWindowMs, Math.max(500, value));
  }

  async function disarmIfCurrent(runToken) {
    const current = await chrome.storage.local.get(["activeRun"]);
    if (current.activeRun !== runToken) return;
    await chrome.storage.local.set({ armed: false });
  }

  async function start(reset) {
    const gen = ++generation;
    const runToken = String(Date.now()) + ":" + Math.random().toString(16).slice(2);
    await chrome.storage.local.set({ activeRun: runToken });
    const settings = await readSettings();
    const submitOnly = shouldSubmitOnly(settings);
    if ((!settings.armed && !submitOnly) || gen !== generation) return;
    const saleAtMs = Number(settings.saleAtMs);
    if (!Number.isFinite(saleAtMs)) {
      publishStatus({ phase: "error", message: "开售时间无效" });
      return;
    }
    if (reset) clearState(saleAtMs);
    const progress = settings.clickProgress;
    const storedProgress =
      progress && Number(progress.primaryClicks) > 0
        ? progress
        : readState(saleAtMs);
    const isArmed = function () {
      return gen === generation;
    };
    const result = await SaleClick.runSaleClick({
      saleAtMs: saleAtMs,
      optionText: settings.optionText,
      primaryText: settings.primaryText,
      secondaryText: settings.secondaryText,
      selectMissingOptions: selectMissingOptions,
      searchWindowMs: settings.searchWindowMs,
      afterBuyWindowMs: settings.afterBuyWindowMs,
      submitOnly: submitOnly,
      initialState: reset ? null : storedProgress,
      now: function () {
        return Date.now();
      },
      sleep: function (ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      },
      isArmed: isArmed,
      isHidden: function () {
        return document.visibilityState === "hidden";
      },
      findCandidates: function () {
        return SaleClick.collectCandidates(document);
      },
      click: function (candidate) {
        if (!candidate || !candidate.el || SaleClick.isBlockedText(candidate.text)) return false;
        if (candidate.el.id === "sale-click-banner" || (candidate.el.closest && candidate.el.closest("#sale-click-banner, [data-sale-click-ui='1']"))) {
          return false;
        }
        if (/缺货|售罄|到货通知/.test(candidate.text)) return false;
        candidate.el.scrollIntoView({ block: "center", inline: "nearest" });
        candidate.el.click();
        return true;
      },
      persistState: function (state) {
        writeState(saleAtMs, state);
        chrome.storage.local.set({
          clickProgress: {
            saleAtMs: saleAtMs,
            primaryClicks: state.primaryClicks,
            secondaryClicks: state.secondaryClicks,
            lastClickAt: state.lastClickAt,
          },
        });
      },
      onStatus: function (status) {
        if (!isArmed()) return;
        publishStatus(status);
      },
    });
    if (!isArmed()) return;
    lastStatusKey = "";
    publishStatus(result);
    const keepArmed = result.phase === "buy-only" || result.phase === "clicked-buy";
    if (keepArmed) return;
    await disarmIfCurrent(runToken);
    if (result.phase === "done" || result.phase === "stopped") {
      chrome.storage.local.set({ clickProgress: null });
    }
  }

  function maybeResume() {
    readSettings().then(function (settings) {
      const pendingSubmit = shouldSubmitOnly(settings);
      if (!settings.armed && !pendingSubmit) return;
      const saleAtMs = Number(settings.saleAtMs);
      if (!Number.isFinite(saleAtMs)) return;
      if (!pendingSubmit && Date.now() > saleAtMs + searchWindowOf(settings)) {
        publishStatus({
          phase: "too-late",
          message: "刷新时开售时间已过，这次没有点击。请重新点「开始等待」，时间到了不要再按 F5。",
        });
        chrome.storage.local.set({ armed: false });
        return;
      }
      publishStatus({
        phase: pendingSubmit ? "searching" : Date.now() < saleAtMs ? "waiting" : "searching",
        message: pendingSubmit
          ? "已进入确认订单页，正在查找下单按钮。"
          : Date.now() < saleAtMs
            ? "页面刷新了，继续等待开售。时间到了不要再刷新。"
            : "页面刷新了，正在找可点的购买按钮。",
      });
      void start(false);
    });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === "PROBE") {
      probe().then(
        function (matches) {
          sendResponse({ ok: true, matches: matches });
        },
        function (error) {
          sendResponse({ ok: false, error: String(error) });
        }
      );
      return true;
    }
    if (message.type === "STOP") {
      generation += 1;
      sendResponse({ ok: true });
      return true;
    }
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.armed && changes.armed.newValue === false) generation += 1;
    if (changes.runNonce && changes.runNonce.newValue) void start(true);
  });

  maybeResume();
})();
