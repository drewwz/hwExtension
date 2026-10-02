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
      "saleAtMs",
      "primaryText",
      "secondaryText",
      "searchWindowMs",
      "afterBuyWindowMs",
    ]);
  }

  let lastStatusKey = "";

  function publishStatus(status) {
    const key = status.phase + "|" + status.message;
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
      const labels = primary.labels.concat(secondary.labels);
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

  async function start(reset) {
    const gen = ++generation;
    const settings = await readSettings();
    if (!settings.armed || gen !== generation) return;
    const saleAtMs = Number(settings.saleAtMs);
    if (!Number.isFinite(saleAtMs)) {
      publishStatus({ phase: "error", message: "开售时间无效" });
      return;
    }
    if (reset) clearState(saleAtMs);
    const isArmed = function () {
      return gen === generation;
    };
    const result = await SaleClick.runSaleClick({
      saleAtMs: saleAtMs,
      primaryText: settings.primaryText,
      secondaryText: settings.secondaryText,
      searchWindowMs: settings.searchWindowMs,
      afterBuyWindowMs: settings.afterBuyWindowMs,
      initialState: reset ? null : readState(saleAtMs),
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
        candidate.el.scrollIntoView({ block: "center", inline: "nearest" });
        candidate.el.click();
        return true;
      },
      persistState: function (state) {
        writeState(saleAtMs, state);
      },
      onStatus: function (status) {
        if (!isArmed()) return;
        publishStatus(status);
      },
    });
    if (!isArmed()) return;
    lastStatusKey = "";
    publishStatus(result);
    await chrome.storage.local.set({ armed: false });
  }

  function maybeResume() {
    readSettings().then(function (settings) {
      if (!settings.armed) return;
      const saleAtMs = Number(settings.saleAtMs);
      if (!Number.isFinite(saleAtMs)) return;
      if (Date.now() > saleAtMs + SaleClick.LIMITS.searchWindowMs) return;
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
