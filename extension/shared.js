(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.SaleClick = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULTS = {
    saleAtLocal: "2026-10-03T10:08:00",
    optionText: "曜石黑\n16GB+1TB 典藏版",
    primaryText: "立即购买",
    secondaryText: "提交订单\n确认订单",
  };

  const LIMITS = {
    pollMs: 200,
    searchWindowMs: 120000,
    afterBuyWindowMs: 180000,
    maxPrimaryClicks: 1,
    maxSecondaryClicks: 1,
    minClickGapMs: 500,
    submitPollMs: 30,
    riskScriptAppearMs: 2000,
    riskInitCapMs: 1000,
    retryGapMs: 800,
    dialogWatchMs: 1200,
    restockGapMinMs: 30,
    restockGapMaxMs: 50,
    restockReadyMs: 8000,
  };

  function restockVersionLabel(optionText) {
    const parts = String(optionText == null ? "" : optionText).split(/[\n,，]/);
    for (let i = 0; i < parts.length; i += 1) {
      const text = normalizeText(parts[i]);
      if (text) return text;
    }
    return "";
  }

  function restockGapMs(random) {
    const span = LIMITS.restockGapMaxMs - LIMITS.restockGapMinMs;
    const roll = typeof random === "function" ? random() : Math.random();
    const clamped = Math.min(0.999999, Math.max(0, Number(roll) || 0));
    return LIMITS.restockGapMinMs + Math.floor(clamped * (span + 1));
  }

  function isRestockColorText(text) {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 16) return false;
    if (/^(颜色|版本|规格|容量|内存|套餐|已选|选择|购买方式|服务|数量|立即购买|暂时缺货|到货通知|预约购买|已售完|加入购物车)$/.test(normalized)) {
      return false;
    }
    if (/^[¥￥]\d+$/.test(normalized)) return false;
    if (/\d+GB/i.test(normalized) || /\d+TB/i.test(normalized) || normalized.indexOf("典藏") !== -1) return false;
    return true;
  }

  function chipContainsAnother(chip, chips) {
    const text = normalizeText(chip && chip.text);
    if (!text) return false;
    return (chips || []).some(function (other) {
      if (!other || other === chip) return false;
      const part = normalizeText(other.text);
      return part.length >= 2 && part !== text && text.indexOf(part) !== -1;
    });
  }

  function restockScopeReady(chips, versionLabel) {
    const version = restockVersionLabel(versionLabel);
    if (!version) return false;
    const list = chips || [];
    const hasVersion = list.some(function (chip) {
      return chip && normalizeText(chip.text) === version;
    });
    const hasColor = list.some(function (chip) {
      return chip && isRestockColorText(chip.text);
    });
    return hasVersion && hasColor;
  }

  function planRestock(input) {
    const source = input || {};
    const versionLabel = restockVersionLabel(source.versionLabel);
    const chips = source.chips || [];
    if (!versionLabel) return { action: "reload", reason: "还没填写容量规格" };
    const version = chips.find(function (chip) {
      return chip && normalizeText(chip.text) === versionLabel;
    });
    if (!version) return { action: "reload", reason: "页面上还没有「" + versionLabel + "」" };
    if (version.disabled) return { action: "reload", reason: "「" + version.text + "」不可选" };
    function isColor(chip) {
      return chip && chip !== version && isRestockColorText(chip.text) && !chipContainsAnother(chip, chips);
    }
    let colors = chips.filter(function (chip) {
      return isColor(chip) && chip.group !== version.group;
    });
    if (!colors.length) colors = chips.filter(isColor);
    const selectedText = normalizeText(source.selectedText || "");
    function colorEnabled(chip) {
      return chip && !chip.disabled && !/缺货|售罄|到货通知/.test(normalizeText(chip.text));
    }
    const color =
      colors.find(function (chip) {
        return colorEnabled(chip) && selectedText.indexOf(normalizeText(chip.text)) !== -1;
      }) ||
      colors.find(colorEnabled);
    const buy = normalizeText(source.buyText || "");
    if (buy && buy !== "立即购买" && /缺货|售罄|到货|预约|通知/.test(buy)) {
      return { action: "reload", reason: buy };
    }
    if (!color) {
      if (colors.length) return { action: "reload", reason: "没有有货的颜色" };
      return { action: "buy", version: version.text, color: "" };
    }
    return { action: "buy", version: version.text, color: color.text };
  }

  function planProductHold(texts) {
    const closeLabels = ["我知道了", "知道了", "确定", "关闭", "好的"];
    const buttonLabels = ["立即购买", "缺货", "暂时缺货", "到货通知", "预约购买", "已售完"];
    const gonePattern = /售罄|售完|卖完|没货|无货|库存不足|没有库存|库存为0|抢光|抢完|来晚了|手慢|买完了|本次没有买到|已售完|已被抢|无法购买|购买失败|下单失败|未能购买|没抢到|不可购买|缺货/;
    const list = [];
    (texts || []).forEach(function (value) {
      const text = normalizeText(value);
      if (!text || text.length > 120 || list.indexOf(text) !== -1) return;
      list.push(text);
    });
    function isClose(text) {
      return closeLabels.indexOf(text) !== -1;
    }
    const goneSentence = list.some(function (text) {
      if (isClose(text) || buttonLabels.indexOf(text) !== -1) return false;
      return gonePattern.test(text);
    });
    const bareSoldOut = list.some(function (text) {
      return text === "缺货" || text === "暂时缺货" || text === "已售完" || text === "售罄";
    });
    const hasClose = list.some(isClose);
    const queue = list.some(function (text) {
      return /排队/.test(text) && !gonePattern.test(text);
    });
    if (goneSentence || (bareSoldOut && hasClose && !queue)) {
      let closeText = "";
      for (let i = 0; i < closeLabels.length; i += 1) {
        if (list.indexOf(closeLabels[i]) !== -1) {
          closeText = closeLabels[i];
          break;
        }
      }
      return { action: "retry", closeText: closeText };
    }
    if (queue) return { action: "wait", closeText: "" };
    return { action: "hold", closeText: "" };
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function isBlockedText(value) {
    const text = normalizeText(value);
    if (!text) return true;
    return /支付|付款|密码|收银台/.test(text);
  }

  function classifyLabels(text) {
    const parts = String(text || "")
      .split(/[\n,，]/)
      .map(normalizeText)
      .filter(Boolean);
    const labels = [];
    const rejected = [];
    parts.forEach(function (part) {
      if (part.length > 16 || isBlockedText(part)) {
        rejected.push(part);
        return;
      }
      if (!labels.includes(part)) labels.push(part);
    });
    return { labels: labels, rejected: rejected };
  }

  function resolveLabels(text, fallbackText) {
    if (!String(text || "").trim()) return classifyLabels(fallbackText);
    return classifyLabels(text);
  }

  function resolveOptionLabels(text) {
    if (text == null) return classifyLabels(DEFAULTS.optionText).labels;
    if (!String(text).trim()) return [];
    return classifyLabels(String(text)).labels;
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function parseSaleInput(value) {
    if (!value) return NaN;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : NaN;
  }

  function formatSaleInput(ms) {
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
      "T" +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes()) +
      ":" +
      pad(date.getSeconds())
    );
  }

  function rankCandidates(candidates, labels) {
    const ranked = [];
    (candidates || []).forEach(function (candidate) {
      if (!candidate || !candidate.visible) return;
      const text = normalizeText(candidate.text);
      if (!text || isBlockedText(text)) return;
      let matchedLabel = "";
      let exact = false;
      (labels || []).forEach(function (label) {
        if (exact) return;
        if (text === label) {
          matchedLabel = label;
          exact = true;
          return;
        }
        if (!matchedLabel && text.includes(label)) matchedLabel = label;
      });
      if (!matchedLabel) return;
      ranked.push({
        text: text,
        disabled: Boolean(candidate.disabled),
        visible: true,
        area: candidate.area || 0,
        inViewport: Boolean(candidate.inViewport),
        depth: candidate.depth || 0,
        el: candidate.el || null,
        matchedLabel: matchedLabel,
        exact: exact,
        score:
          (exact ? 1000 : 100) +
          Math.min(candidate.area || 0, 40000) / 40 +
          (candidate.inViewport ? 80 : 0),
      });
    });
    ranked.sort(function (a, b) {
      return b.score - a.score || b.depth - a.depth;
    });
    return ranked;
  }

function pickEnabled(candidates, labels) {
  const ranked = rankCandidates(candidates, labels);
  const pool = ranked.filter(function (item) {
    if (!item.el) return true;
    return !ranked.some(function (other) {
      return other !== item && other.el && item.el.contains(other.el);
    });
  });
  if (!pool.length) return null;
  pool.sort(function (a, b) {
    return b.score - a.score || b.depth - a.depth;
  });
  if (pool[0].disabled) return null;
  return pool[0];
}

  function readElementText(el) {
    const tag = el.tagName;
    const raw =
      tag === "INPUT" || tag === "TEXTAREA"
        ? el.value || el.getAttribute("aria-label") || ""
        : el.textContent || el.getAttribute("aria-label") || "";
    return normalizeText(raw);
  }

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    const className = String(el.className || "");
    if (/disabled|sold-?out|unavailable|btn-gray|btn-grey/i.test(className)) return true;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(el);
    if (style.pointerEvents === "none") return true;
    const opacity = Number(style.opacity);
    return Number.isFinite(opacity) && opacity < 0.5;
  }

  function isOurUi(el) {
    if (!el) return true;
    if (el.id === "sale-click-banner") return true;
    if (el.getAttribute && el.getAttribute("data-sale-click-ui") === "1") return true;
    return Boolean(el.closest && el.closest("#sale-click-banner, [data-sale-click-ui='1']"));
  }

  function isVisible(el) {
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }

  function elementDepth(el) {
    let depth = 0;
    let node = el;
    while (node && node.parentElement) {
      depth += 1;
      node = node.parentElement;
    }
    return depth;
  }

  function collectCandidates(doc) {
    const nodes = doc.querySelectorAll('button, a, input, [role="button"], div, span');
    const raw = [];
    Array.prototype.forEach.call(nodes, function (el) {
      if (isOurUi(el)) return;
      const text = readElementText(el);
      if (!text || text.indexOf("开售点按") === 0) return;
      if (
        text.length > 24 &&
        text.indexOf("火爆销售中") === -1 &&
        text.indexOf("本次没有买到") === -1 &&
        text.indexOf("买完了") === -1
      ) {
        return;
      }
      if (text.length > 80) return;
      const rect = el.getBoundingClientRect();
      const view = doc.defaultView;
      const inViewport = Boolean(
        view &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < view.innerHeight &&
          rect.left < view.innerWidth
      );
      raw.push({
        el: el,
        text: text,
        disabled: isDisabled(el),
        visible: isVisible(el),
        area: Math.max(0, rect.width) * Math.max(0, rect.height),
        inViewport: inViewport,
        depth: elementDepth(el),
      });
    });
    const confirm = doc.getElementById && doc.getElementById("confirmSubmit");
    if (confirm && !isOurUi(confirm) && !raw.some(function (item) { return item.el === confirm; })) {
      const ownText = readElementText(confirm);
      const label =
        ownText === "确认订单" || (ownText.indexOf("确认订单") !== -1 && ownText.indexOf("提交订单") === -1)
          ? "确认订单"
          : "提交订单";
      const rect = confirm.getBoundingClientRect();
      raw.push({
        el: confirm,
        text: label,
        disabled: isDisabled(confirm),
        visible: isVisible(confirm),
        area: Math.max(rect.width * rect.height, 8000),
        inViewport: true,
        depth: elementDepth(confirm) + 5,
      });
    }
    return raw.filter(function (item) {
      return !raw.some(function (other) {
        return other !== item && item.el.contains(other.el) && other.text === item.text;
      });
    });
  }

  async function pausable(ctx, ms) {
    let left = ms;
    while (left > 0 && ctx.isArmed()) {
      const slice = left > 5000 ? Math.min(1000, left) : Math.min(50, left);
      await ctx.sleep(slice);
      left -= slice;
    }
  }

  async function runSaleClick(ctx) {
    const primary = resolveLabels(ctx.primaryText, DEFAULTS.primaryText).labels;
    const secondary = resolveLabels(ctx.secondaryText, DEFAULTS.secondaryText).labels;
    const optionLabels = resolveOptionLabels(ctx.optionText);
    let lastOptionAt = 0;
    let lastOptionResult = { ok: !optionLabels.length || !ctx.selectMissingOptions };

    async function prepareOptions(force) {
      if (!ctx.selectMissingOptions || !optionLabels.length) return { ok: true };
      if (!force && ctx.now() - lastOptionAt < 800 && lastOptionResult) return lastOptionResult;
      lastOptionAt = ctx.now();
      lastOptionResult = await ctx.selectMissingOptions(optionLabels);
      return lastOptionResult || { ok: false, blockedReason: "规格还没选上" };
    }

    function optionMessage(ready) {
      if (!ready) return "规格还没选上";
      if (ready.blockedReason) return ready.blockedReason;
      if (ready.missing && ready.missing.length) return "规格还没选上：" + ready.missing.join("、");
      return "规格还没选上";
    }
    const saleAt = Number(ctx.saleAtMs);
    const searchWindowMs = clamp(ctx.searchWindowMs, 500, LIMITS.searchWindowMs, LIMITS.searchWindowMs);
    const afterBuyWindowMs = clamp(
      ctx.afterBuyWindowMs,
      500,
      LIMITS.afterBuyWindowMs,
      LIMITS.afterBuyWindowMs
    );
    const state = {
      primaryClicks: 0,
      secondaryClicks: 0,
      lastClickAt: 0,
    };
    if (ctx.initialState) {
      state.primaryClicks = ctx.initialState.primaryClicks || 0;
      state.secondaryClicks = ctx.initialState.secondaryClicks || 0;
      state.lastClickAt = ctx.initialState.lastClickAt || 0;
    }

    function finish(phase, message) {
      return {
        phase: phase,
        message: message,
        primaryClicks: state.primaryClicks,
        secondaryClicks: state.secondaryClicks,
      };
    }

    const submitOnly = Boolean(ctx.submitOnly);
    if (submitOnly) {
      state.primaryClicks = Math.max(state.primaryClicks, 1);
      if (!state.lastClickAt) state.lastClickAt = ctx.now();
    }

    if (!Number.isFinite(saleAt)) return finish("error", "开售时间无效");
    if (!ctx.isArmed()) return finish("stopped", "已停止");
    if (!submitOnly && ctx.now() > saleAt + searchWindowMs) return finish("too-late", "已过开售时间，没有点击");

    while (!submitOnly && ctx.isArmed() && ctx.now() < saleAt) {
      const ready = await prepareOptions(false);
      const left = saleAt - ctx.now();
      ctx.onStatus({
        phase: "waiting",
        message:
          ready && ready.ok === false
            ? optionMessage(ready)
            : left < 5000 && ctx.isHidden && ctx.isHidden()
              ? "请把商品页保持在前台"
              : "等待开售",
        remainingMs: left,
      });
      const delay = left > 5000 ? Math.min(1000, left) : Math.max(10, Math.min(50, left));
      await pausable(ctx, delay);
    }

    if (!ctx.isArmed()) return finish("stopped", "已停止");

    const searchDeadline = saleAt + searchWindowMs;
    while (!submitOnly && ctx.isArmed() && state.primaryClicks < LIMITS.maxPrimaryClicks && ctx.now() < searchDeadline) {
      const ready = await prepareOptions(true);
      if (!ready || ready.ok === false) {
        ctx.onStatus({ phase: "searching", message: optionMessage(ready) });
        await pausable(ctx, LIMITS.pollMs);
        continue;
      }
      const found = pickEnabled(ctx.findCandidates(), primary);
      if (found && ctx.now() - state.lastClickAt >= LIMITS.minClickGapMs) {
        if (ctx.click(found) !== false) {
          state.primaryClicks += 1;
          state.lastClickAt = ctx.now();
          if (ctx.persistState) ctx.persistState(state);
          ctx.onStatus({ phase: "clicked-buy", message: "已点击「" + found.text + "」" });
          break;
        }
      } else {
        ctx.onStatus({ phase: "searching", message: "正在等购买按钮变成可点" });
      }
      await pausable(ctx, LIMITS.pollMs);
    }

    if (!ctx.isArmed()) return finish("stopped", "已停止");
    if (state.primaryClicks < 1) return finish("not-found", "没有找到可点的购买按钮，请手点");

    function wantsAutoSubmit() {
      if (typeof ctx.autoSubmit === "function") return ctx.autoSubmit() !== false;
      return ctx.autoSubmit !== false;
    }

    if (!wantsAutoSubmit()) {
      const message = submitOnly
        ? "自动提交已关闭。请自己点提交订单"
        : "已点击购买。自动提交已关闭，请自己点提交订单";
      ctx.onStatus({ phase: "buy-only", message: message });
      return finish("buy-only", message);
    }

    const submitDeadline = state.lastClickAt + afterBuyWindowMs;
    let dismissedThisDialog = false;
    let watchingUntil = 0;
    let holdSubmitUntil = 0;
    let lastSubmitText = "提交订单";
    ctx.onStatus({
      phase: "clicked-buy",
      message: submitOnly ? "确认页还在加载" : "正在确认页查找下单按钮",
    });
    while (ctx.isArmed() && (submitOnly || ctx.now() < submitDeadline)) {
      if (!wantsAutoSubmit()) {
        const message = "自动提交已关闭。请自己点提交订单";
        ctx.onStatus({ phase: "buy-only", message: message });
        return finish("buy-only", message);
      }
      const candidates = ctx.findCandidates();
      const hotSale =
        submitOnly &&
        ((ctx.hotSaleOpen && ctx.hotSaleOpen()) ||
          candidates.some(function (item) {
            return item.visible && String(item.text || "").indexOf("火爆销售中") !== -1;
          }));
      const missedSale =
        submitOnly &&
        ((ctx.missedSaleOpen && ctx.missedSaleOpen()) ||
          candidates.some(function (item) {
            const text = String(item.text || "");
            return item.visible && (text.indexOf("本次没有买到") !== -1 || text.indexOf("买完了") !== -1);
          }));
      if (submitOnly && ctx.permanentBlockOpen && ctx.permanentBlockOpen()) {
        return finish("not-found", "官方限制了这次下单，请手点");
      }
      if (missedSale && !hotSale && ctx.leaveOnMissed) {
        if (ctx.onLeaveToProduct) ctx.onLeaveToProduct();
        const message = "这次没买到，回到商品页继续刷新";
        ctx.onStatus({ phase: "buy-only", message: message });
        return finish("buy-only", message);
      }
      if (hotSale || missedSale) {
        watchingUntil = 0;
        if (!dismissedThisDialog) {
          const dismiss = pickEnabled(candidates, [hotSale ? "知道了" : "返回"]);
          if (dismiss && dismiss.exact && ctx.click(dismiss) !== false) {
            dismissedThisDialog = true;
            holdSubmitUntil = ctx.now() + LIMITS.retryGapMs;
            if (ctx.markRetryBaseline) ctx.markRetryBaseline();
            ctx.onStatus({
              phase: "clicked-buy",
              message: "已点「" + dismiss.text + "」，继续重试。要结束请点插件的「停止」",
            });
          }
        }
        await pausable(ctx, LIMITS.submitPollMs);
        continue;
      }
      dismissedThisDialog = false;
      if (submitOnly && ctx.now() < holdSubmitUntil) {
        ctx.onStatus({ phase: "clicked-buy", message: "继续重试。要结束请点插件的「停止」" });
        await pausable(ctx, LIMITS.submitPollMs);
        continue;
      }
      if (watchingUntil) {
        if (ctx.now() < watchingUntil) {
          await pausable(ctx, LIMITS.submitPollMs);
          continue;
        }
        const message = "已点击「" + lastSubmitText + "」。请自己完成付款";
        ctx.onStatus({ phase: "done", message: message });
        return finish("done", message);
      }
      const found = pickEnabled(candidates, secondary);
      const reportedReady = !submitOnly || !ctx.isOrderReady || ctx.isOrderReady() === true;
      if (!(found && found.exact && reportedReady)) {
        if (submitOnly) ctx.onStatus({ phase: "clicked-buy", message: "确认页还在加载" });
        await pausable(ctx, submitOnly ? LIMITS.submitPollMs : LIMITS.pollMs);
        continue;
      }
      if (ctx.click(found) === false) {
        await pausable(ctx, submitOnly ? LIMITS.submitPollMs : LIMITS.pollMs);
        continue;
      }
      state.secondaryClicks += 1;
      state.lastClickAt = ctx.now();
      lastSubmitText = found.text;
      if (ctx.persistState) ctx.persistState(state);
      if (!submitOnly) {
        const message = "已点击「" + found.text + "」。请自己完成付款";
        ctx.onStatus({ phase: "done", message: message });
        return finish("done", message);
      }
      watchingUntil = ctx.now() + LIMITS.dialogWatchMs;
    }
    if (!ctx.isArmed()) return finish("stopped", "已停止");
    if (state.secondaryClicks > 0) {
      const message = "已点击「" + lastSubmitText + "」。请自己完成付款";
      return finish("done", message);
    }

    if (!ctx.isArmed()) return finish("stopped", "已停止");
    if (submitOnly) return finish("not-found", "没有找到可点的「提交订单」，请手点");
    if (pickEnabled(ctx.findCandidates(), primary)) {
      return finish("ignored", "购买按钮仍在，页面可能忽略了脚本点击，请手点");
    }
    return finish("buy-only", "已点击购买。正在等确认订单页的「提交订单」");
  }

  return {
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    normalizeText: normalizeText,
    isBlockedText: isBlockedText,
    classifyLabels: classifyLabels,
    resolveLabels: resolveLabels,
    resolveOptionLabels: resolveOptionLabels,
    parseSaleInput: parseSaleInput,
    restockVersionLabel: restockVersionLabel,
    restockGapMs: restockGapMs,
    isRestockColorText: isRestockColorText,
    restockScopeReady: restockScopeReady,
    planRestock: planRestock,
    planProductHold: planProductHold,
    formatSaleInput: formatSaleInput,
    rankCandidates: rankCandidates,
    pickEnabled: pickEnabled,
    collectCandidates: collectCandidates,
    runSaleClick: runSaleClick,
  };
});
