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
      "autoSubmit",
      "mode",
      "restockPhase",
      "productUrl",
    ]);
  }

  let autoSubmitEnabled = true;
  let restockRunning = false;

  function notifyBackground(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        void chrome.runtime.lastError;
      });
    } catch (error) {}
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function autoSubmitOn(settings) {
    return !settings || settings.autoSubmit !== false;
  }

  function boughtRecently(settings) {
    const progress = settings && settings.clickProgress;
    if (!progress || Number(progress.primaryClicks) < 1) return false;
    const boughtAt = Number(progress.lastClickAt) || 0;
    return boughtAt > 0 && Date.now() <= boughtAt + SaleClick.LIMITS.afterBuyWindowMs;
  }

  function isOrderConfirm() {
    return /orderConfirm/i.test(location.pathname) || /\/bp\/orderConfirm/i.test(location.href);
  }

  function needsSubmit(settings) {
    if (!autoSubmitOn(settings)) return false;
    const progress = settings && settings.clickProgress;
    if (!progress || Number(progress.primaryClicks) < 1 || Number(progress.secondaryClicks) >= 1) return false;
    const boughtAt = Number(progress.lastClickAt) || 0;
    return boughtAt > 0 && Date.now() <= boughtAt + SaleClick.LIMITS.afterBuyWindowMs;
  }

  function isPaymentPage() {
    return /\/payment\/|\/multiPay/i.test(location.pathname);
  }

  function shouldSubmitOnly(settings) {
    if (settings && settings.mode === "restock" && settings.restockPhase === "ordering" && isOrderConfirm()) return true;
    if (!autoSubmitOn(settings)) return false;
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

  function isOurUi(el) {
    if (!el) return true;
    if (el.id === "sale-click-banner") return true;
    return Boolean(el.closest && el.closest("#sale-click-banner, [data-sale-click-ui='1']"));
  }

  function chipDisabled(el) {
    if (!controlEnabled(el)) return true;
    const className = String(el.className || "");
    if (/disabled|sold-?out|unavailable|btn-gray|btn-grey/i.test(className)) return true;
    return /缺货|售罄|到货通知/.test(el.textContent || "");
  }

  const chipGroups = new WeakMap();
  let chipGroupSeq = 1;

  function chipGroup(el) {
    if (!el) return 0;
    if (!chipGroups.has(el)) chipGroups.set(el, chipGroupSeq++);
    return chipGroups.get(el);
  }

  function collectChips(root) {
    const nodes = root.querySelectorAll("div, button, a");
    const raw = [];
    Array.prototype.forEach.call(nodes, function (el) {
      if (isOurUi(el)) return;
      const text = SaleClick.normalizeText(el.textContent);
      if (!text || text.length > 16) return;
      if (!elementVisible(el)) return;
      const rect = el.getBoundingClientRect();
      raw.push({
        el: el,
        text: text,
        disabled: chipDisabled(el),
        group: chipGroup(el.parentElement),
        area: Math.max(0, rect.width) * Math.max(0, rect.height),
      });
    });
    return raw
      .filter(function (item) {
        return !raw.some(function (other) {
          return other !== item && item.el.contains(other.el) && other.text === item.text;
        });
      })
      .map(function (item) {
        return { text: item.text, disabled: item.disabled, group: item.group };
      });
  }

  function findBuyText() {
    const labels = ["立即购买", "暂时缺货", "到货通知", "预约购买", "已售完"];
    const nodes = document.querySelectorAll("div, button, a, span");
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (isOurUi(el) || !elementVisible(el)) continue;
      const text = SaleClick.normalizeText(el.textContent);
      if (labels.indexOf(text) !== -1) return text;
    }
    return "";
  }

  function readRestockSnapshot(optionText) {
    const versionLabel = SaleClick.restockVersionLabel(optionText);
    const versionEl = findOptionElement(versionLabel);
    if (!versionEl) return null;
    let root = versionEl.parentElement;
    let chips = [];
    for (let depth = 0; root && depth < 8; depth += 1) {
      chips = collectChips(root);
      const hasVersion = chips.some(function (chip) {
        return SaleClick.normalizeText(chip.text) === versionLabel;
      });
      const hasOther = chips.some(function (chip) {
        return SaleClick.normalizeText(chip.text) !== versionLabel;
      });
      if (hasVersion && hasOther) break;
      root = root.parentElement;
    }
    if (!chips.length) return null;
    return { versionLabel: versionLabel, chips: chips, buyText: findBuyText() };
  }

  async function clickOptionLabel(label) {
    const want = SaleClick.normalizeText(label);
    if (readSelected().indexOf(want) !== -1) return true;
    const el = findOptionElement(label);
    if (!el || chipDisabled(el)) return false;
    el.click();
    const until = Date.now() + 800;
    while (Date.now() < until) {
      if (readSelected().indexOf(want) !== -1) return true;
      await sleep(30);
    }
    return readSelected().indexOf(want) !== -1;
  }

  function ownText(el) {
    if (!el || !el.childNodes) return "";
    let raw = "";
    for (let i = 0; i < el.childNodes.length; i += 1) {
      const node = el.childNodes[i];
      if (node.nodeType === 3) raw += node.nodeValue || "";
    }
    return SaleClick.normalizeText(raw);
  }

  function overlayInfo(el) {
    if (!el || el === document.body || el === document.documentElement || isOurUi(el) || !elementVisible(el)) return null;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return null;
    const style = view.getComputedStyle(el);
    const role = el.getAttribute("role");
    const modal = el.getAttribute("aria-modal") === "true" || role === "dialog" || role === "alertdialog";
    const positioned = style.position === "fixed" || style.position === "absolute";
    if (!modal && !positioned) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return null;
    const screen = rect.width > view.innerWidth * 0.92 && rect.height > view.innerHeight * 0.92;
    return { screen: screen, rect: rect };
  }

  function dialogSurfaces() {
    const surfaces = [];
    if (!document.elementsFromPoint) return surfaces;
    const points = [
      [window.innerWidth / 2, Math.max(88, window.innerHeight * 0.35)],
      [window.innerWidth / 2, window.innerHeight / 2],
    ];
    points.forEach(function (point) {
      const stack = document.elementsFromPoint(point[0], point[1]) || [];
      const above = [];
      for (let i = 0; i < stack.length; i += 1) {
        const el = stack[i];
        if (!el || el === document.body || el === document.documentElement || isOurUi(el)) continue;
        const info = overlayInfo(el);
        if (!info) {
          above.push(el);
          continue;
        }
        if (!info.screen && info.rect.width >= 80 && info.rect.height >= 32) {
          surfaces.push({ box: el, above: [] });
          return;
        }
        if (info.screen) {
          surfaces.push({ box: el, above: above.slice() });
          return;
        }
      }
    });
    return surfaces;
  }

  function pushDialogText(texts, seen, value) {
    const text = SaleClick.normalizeText(value);
    if (!text || text.length > 120 || seen[text]) return;
    seen[text] = true;
    texts.push(text);
  }

  function readDialogTexts() {
    const texts = [];
    const seen = Object.create(null);
    dialogSurfaces().forEach(function (surface) {
      const full = SaleClick.normalizeText(surface.box.innerText || surface.box.textContent || "");
      const compact = full.length > 0 && full.length <= 120;
      if (compact) pushDialogText(texts, seen, full);
      const bits = surface.above.slice();
      if (compact) {
        const nested = surface.box.querySelectorAll("button, a, span, p, div");
        for (let i = 0; i < nested.length; i += 1) bits.push(nested[i]);
      }
      bits.forEach(function (el) {
        if (!el || isOurUi(el) || !elementVisible(el)) return;
        const own = ownText(el);
        if (own) pushDialogText(texts, seen, own);
      });
    });
    return texts;
  }

  function clickDialogClose(label) {
    const want = SaleClick.normalizeText(label);
    if (!want) return false;
    let best = null;
    let bestArea = Infinity;
    dialogSurfaces().forEach(function (surface) {
      const full = SaleClick.normalizeText(surface.box.innerText || surface.box.textContent || "");
      const nodes = surface.above.slice();
      if (full.length > 0 && full.length <= 120) {
        nodes.push(surface.box);
        const nested = surface.box.querySelectorAll("button, a, div, span");
        for (let n = 0; n < nested.length; n += 1) nodes.push(nested[n]);
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        if (!el || isOurUi(el) || SaleClick.normalizeText(el.textContent) !== want) continue;
        if (!elementVisible(el) || !controlEnabled(el)) continue;
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > 0 && area < bestArea) {
          best = el;
          bestArea = area;
        }
      }
    });
    if (!best) return false;
    best.click();
    return true;
  }

  function onProductPage() {
    return /\/product\/comdetail|item\.vmall\.com\/product/i.test(location.href);
  }

  async function waitForRestockResume(isArmed) {
    publishStatus({ phase: "clicked-buy", message: "已点购买，正在等订单页。货没了会关掉再刷。" });
    const until = Date.now() + SaleClick.LIMITS.afterBuyWindowMs;
    while (isArmed() && Date.now() < until) {
      const latest = await readSettings();
      if (!latest || latest.mode !== "restock") return;
      if (latest.restockPhase === "paying") return;
      if (latest.restockPhase === "scan") {
        location.reload();
        return;
      }
      if (isOrderConfirm() || isPaymentPage()) return;
      const plan = SaleClick.planProductHold(readDialogTexts());
      if (plan.action === "retry") {
        const labels = plan.closeText ? [plan.closeText] : ["我知道了", "知道了", "确定", "关闭", "好的"];
        for (let i = 0; i < labels.length; i += 1) {
          if (clickDialogClose(labels[i])) break;
        }
        publishStatus({ phase: "searching", message: "商品页提示这一轮没买到，关掉后继续刷新" });
        await chrome.storage.local.set({ restockPhase: "scan", clickProgress: null });
        await sleep(SaleClick.restockGapMs());
        if (!isArmed()) return;
        if (isOrderConfirm() || isPaymentPage()) return;
        if (!onProductPage() && latest.productUrl) {
          location.assign(latest.productUrl);
          return;
        }
        location.reload();
        return;
      }
      await sleep(SaleClick.LIMITS.submitPollMs);
    }
  }

  async function runRestockLoop(isArmed, settings) {
    publishStatus({ phase: "searching", message: "正在等商品页刷出规格" });
    const readyDeadline = Date.now() + SaleClick.LIMITS.restockReadyMs;
    let snapshot = null;
    while (isArmed() && Date.now() < readyDeadline) {
      snapshot = readRestockSnapshot(settings.optionText);
      if (snapshot) break;
      await sleep(30);
    }
    if (!isArmed()) return;
    if (addressPromptVisible()) {
      publishStatus({
        phase: "error",
        message: "页面还写着「请选择收货地址」。请先登录并选好地址，插件不会新添地址。",
      });
      await chrome.storage.local.set({ armed: false, mode: "sale", restockPhase: "" });
      return;
    }
    const plan = snapshot ? SaleClick.planRestock(snapshot) : { action: "reload", reason: "页面还没刷出规格" };
    if (!plan || plan.action !== "buy") {
      const reason = (plan && plan.reason) || "没有可买的颜色";
      publishStatus({ phase: "searching", message: reason + "，马上再刷新" });
      await sleep(SaleClick.restockGapMs());
      if (isArmed()) location.reload();
      return;
    }
    publishStatus({ phase: "searching", message: "选「" + plan.version + "」和有货的「" + plan.color + "」" });
    const versionOk = await clickOptionLabel(plan.version);
    const colorOk = versionOk && (await clickOptionLabel(plan.color));
    if (!isArmed()) return;
    if (!versionOk || !colorOk) {
      publishStatus({ phase: "searching", message: "规格没点上，马上再刷新" });
      await sleep(SaleClick.restockGapMs());
      if (isArmed()) location.reload();
      return;
    }
    const buyDeadline = Date.now() + 1000;
    let buy = null;
    while (isArmed() && Date.now() < buyDeadline) {
      const found = SaleClick.pickEnabled(SaleClick.collectCandidates(document), ["立即购买"]);
      if (found && found.exact) {
        buy = found;
        break;
      }
      await sleep(30);
    }
    if (!buy || !buy.el) {
      publishStatus({ phase: "searching", message: "这组规格还不能买，马上再刷新" });
      await sleep(SaleClick.restockGapMs());
      if (isArmed()) location.reload();
      return;
    }
    buy.el.scrollIntoView({ block: "center", inline: "nearest" });
    buy.el.click();
    const saleAtMs = Number(settings.saleAtMs) || Date.now();
    await chrome.storage.local.set({
      restockPhase: "ordering",
      clickProgress: {
        saleAtMs: saleAtMs,
        primaryClicks: 1,
        secondaryClicks: 0,
        lastClickAt: Date.now(),
      },
    });
    publishStatus({ phase: "clicked-buy", message: "已点击「立即购买」。订单页会继续提交。" });
    await waitForRestockResume(isArmed);
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

  let orderSignalsAt = 0;

  function controlEnabled(el) {
    if (!el || !elementVisible(el)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(el);
    if (style.pointerEvents === "none") return false;
    const opacity = Number(style.opacity);
    return !(Number.isFinite(opacity) && opacity < 0.5);
  }

  function footerHasPrice(button) {
    const finalPrice = document.getElementById("finalPrice");
    if (finalPrice && elementVisible(finalPrice) && /\d/.test(finalPrice.textContent || "")) return true;
    let node = button.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1) {
      if (/[¥￥]\s*\d/.test(node.innerText || "")) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isRiskScript(src) {
    return /ars_client|\/ars\/|riskars/i.test(src || "");
  }

  function resourceEntries() {
    try {
      return performance.getEntriesByType("resource");
    } catch (error) {
      return [];
    }
  }

  function watchScript(script) {
    if (script.__saleClickWatch) return;
    script.__saleClickWatch = true;
    if (script.readyState === "complete" || script.readyState === "loaded") script.__saleClickLoaded = true;
    script.addEventListener("load", function () {
      script.__saleClickLoaded = true;
    });
    script.addEventListener("error", function () {
      script.__saleClickLoaded = true;
    });
  }

  function scriptFinished(script) {
    const src = script.src || "";
    if (!src) return false;
    watchScript(script);
    if (script.__saleClickLoaded) return true;
    if (script.readyState === "complete" || script.readyState === "loaded") return true;
    const entries = resourceEntries();
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].name === src && Number(entries[i].responseEnd) > 0) return true;
    }
    return false;
  }

  function riskScripts() {
    const found = [];
    const all = document.getElementsByTagName("script");
    for (let i = 0; i < all.length; i += 1) {
      const src = all[i].src || "";
      if (!src || src.indexOf("chrome-extension://") === 0) continue;
      if (!isRiskScript(src)) continue;
      watchScript(all[i]);
      found.push(all[i]);
    }
    return found;
  }

  function noticeOpen(snippet) {
    const nodes = document.querySelectorAll("div, p, span");
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (el.closest && el.closest("#sale-click-banner, [data-sale-click-ui='1']")) continue;
      const text = el.textContent || "";
      if (text.indexOf(snippet) === -1 || text.length > 80) continue;
      if (elementVisible(el)) return true;
    }
    return false;
  }

  function hotSaleOpen() {
    return noticeOpen("火爆销售中");
  }

  function missedSaleOpen() {
    return noticeOpen("本次没有买到") || noticeOpen("买完了");
  }

  function markRetryBaseline() {}

  function permanentBlockOpen() {
    const nodes = document.querySelectorAll("div, p, span");
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (el.closest && el.closest("#sale-click-banner, [data-sale-click-ui='1']")) continue;
      const text = el.textContent || "";
      if (text.length > 80) continue;
      if (text.indexOf("账号由于安全原因") === -1 && text.indexOf("超过购买上限") === -1) continue;
      if (elementVisible(el)) return true;
    }
    return false;
  }

  function orderPageReady() {
    if (hotSaleOpen() || missedSaleOpen()) return false;
    const button = document.getElementById("confirmSubmit");
    if (!controlEnabled(button) || !footerHasPrice(button)) {
      orderSignalsAt = 0;
      return false;
    }
    if (!orderSignalsAt) orderSignalsAt = Date.now();
    const scripts = riskScripts();
    if (!scripts.length) {
      return Date.now() - orderSignalsAt >= SaleClick.LIMITS.riskScriptAppearMs;
    }
    const pending = scripts.some(function (script) {
      return !scriptFinished(script);
    });
    if (pending) {
      return Date.now() - orderSignalsAt >= SaleClick.LIMITS.riskScriptAppearMs + SaleClick.LIMITS.riskInitCapMs;
    }
    return true;
  }

  function primeSubmitPointer(el) {
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view || typeof view.MouseEvent !== "function") return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.max(8, Math.min(rect.width / 2, 48));
    const y = rect.top + Math.max(8, Math.min(rect.height / 2, 18));
    ["mousemove", "mousemove", "mousedown"].forEach(function (type, index) {
      el.dispatchEvent(
        new view.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x + index * 4,
          clientY: y + index,
          button: 0,
        })
      );
    });
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
    autoSubmitEnabled = autoSubmitOn(settings);
    restockRunning = settings.mode === "restock";
    const isArmedNow = function () {
      return gen === generation;
    };
    if (restockRunning && isPaymentPage()) {
      notifyBackground({ type: "RING_START" });
      publishStatus({
        phase: "done",
        message: "已进入支付页，铃声会一直响。请在 8 分钟内付款，点「停止」关掉铃声。",
      });
      return;
    }
    if (restockRunning && !isOrderConfirm()) {
      if (settings.restockPhase === "paying") {
        publishStatus({
          phase: "done",
          message: "已进入支付页，铃声会一直响。请在 8 分钟内付款，点「停止」关掉铃声。",
        });
        return;
      }
      if (settings.restockPhase === "ordering") {
        await waitForRestockResume(isArmedNow);
        return;
      }
      await runRestockLoop(isArmedNow, settings);
      return;
    }
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
      leaveOnMissed: restockRunning,
      onLeaveToProduct: function () {
        notifyBackground({ type: "RESTOCK_RESUME" });
      },
      autoSubmit: function () {
        return restockRunning || autoSubmitEnabled;
      },
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
      isOrderReady: orderPageReady,
      hotSaleOpen: hotSaleOpen,
      missedSaleOpen: missedSaleOpen,
      permanentBlockOpen: permanentBlockOpen,
      markRetryBaseline: markRetryBaseline,
      click: function (candidate) {
        if (!candidate || !candidate.el || SaleClick.isBlockedText(candidate.text)) return false;
        if (candidate.el.id === "sale-click-banner" || (candidate.el.closest && candidate.el.closest("#sale-click-banner, [data-sale-click-ui='1']"))) {
          return false;
        }
        if (/缺货|售罄|到货通知/.test(candidate.text)) return false;
        candidate.el.scrollIntoView({ block: "center", inline: "nearest" });
        if (candidate.el.id === "confirmSubmit") primeSubmitPointer(candidate.el);
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
    if (!isArmed()) {
      const current = await chrome.storage.local.get(["activeRun", "armed"]);
      if (current.activeRun === runToken && current.armed === false) {
        publishStatus({ phase: "stopped", message: "已停止" });
      }
      return;
    }
    if (restockRunning) {
      publishStatus(result);
      if (result.phase === "not-found" || result.phase === "error") {
        await chrome.storage.local.set({ armed: false, mode: "sale", restockPhase: "" });
        notifyBackground({ type: "RING_STOP" });
      }
      return;
    }
    lastStatusKey = "";
    publishStatus(result);
    const keepArmed = autoSubmitEnabled && (result.phase === "buy-only" || result.phase === "clicked-buy");
    if (keepArmed) return;
    await disarmIfCurrent(runToken);
    if (result.phase === "done" || result.phase === "stopped") {
      chrome.storage.local.set({ clickProgress: null });
    }
  }

  function maybeResume() {
    readSettings().then(function (settings) {
      if (settings.mode === "restock") {
        if (!settings.armed && settings.restockPhase !== "paying") return;
        if (isPaymentPage() || settings.restockPhase === "paying") {
          notifyBackground({ type: "RING_START" });
          publishStatus({
            phase: "done",
            message: "已进入支付页，铃声会一直响。请在 8 分钟内付款，点「停止」关掉铃声。",
          });
          return;
        }
        void start(false);
        return;
      }
      if (settings.autoSubmit === false && isOrderConfirm() && (settings.armed || boughtRecently(settings))) {
        publishStatus({ phase: "buy-only", message: "自动提交已关闭。请自己点提交订单" });
        if (settings.armed) chrome.storage.local.set({ armed: false });
        return;
      }
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
          ? "已进入确认订单页，正在确认页面是否加载完成。"
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
    if (changes.autoSubmit) autoSubmitEnabled = changes.autoSubmit.newValue !== false;
    if (changes.armed && changes.armed.newValue === false) generation += 1;
    if (changes.runNonce && changes.runNonce.newValue) void start(true);
  });

  maybeResume();
})();
