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
    searchWindowMs: 30000,
    afterBuyWindowMs: 30000,
    maxPrimaryClicks: 1,
    maxSecondaryClicks: 1,
    minClickGapMs: 500,
  };

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
    return style.pointerEvents === "none";
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
      const text = readElementText(el);
      if (!text || text.length > 24) return;
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

    if (!Number.isFinite(saleAt)) return finish("error", "开售时间无效");
    if (!ctx.isArmed()) return finish("stopped", "已停止");
    if (ctx.now() > saleAt + searchWindowMs) return finish("too-late", "已过开售时间，没有点击");

    while (ctx.isArmed() && ctx.now() < saleAt) {
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
    while (ctx.isArmed() && state.primaryClicks < LIMITS.maxPrimaryClicks && ctx.now() < searchDeadline) {
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

    const submitDeadline = state.lastClickAt + afterBuyWindowMs;
    while (ctx.isArmed() && state.secondaryClicks < LIMITS.maxSecondaryClicks && ctx.now() < submitDeadline) {
      const found = pickEnabled(ctx.findCandidates(), secondary);
      if (found && ctx.click(found) !== false) {
        state.secondaryClicks += 1;
        state.lastClickAt = ctx.now();
        if (ctx.persistState) ctx.persistState(state);
        const message = "已点击「" + found.text + "」。请自己完成付款";
        ctx.onStatus({ phase: "done", message: message });
        return finish("done", message);
      }
      await pausable(ctx, LIMITS.pollMs);
    }

    if (!ctx.isArmed()) return finish("stopped", "已停止");
    if (pickEnabled(ctx.findCandidates(), primary)) {
      return finish("ignored", "购买按钮仍在，页面可能忽略了脚本点击，请手点");
    }
    return finish("buy-only", "已点击购买。付款请自己完成");
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
    formatSaleInput: formatSaleInput,
    rankCandidates: rankCandidates,
    pickEnabled: pickEnabled,
    collectCandidates: collectCandidates,
    runSaleClick: runSaleClick,
  };
});
