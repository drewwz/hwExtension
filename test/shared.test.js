const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const SaleClick = require("../extension/shared.js");

function candidate(text, extra) {
  return Object.assign(
    {
      text: text,
      disabled: false,
      visible: true,
      area: 2000,
      inViewport: true,
      depth: 4,
    },
    extra || {}
  );
}

function harness(overrides) {
  const clicks = [];
  let armed = true;
  const ctx = Object.assign(
    {
      saleAtMs: Date.now() + 80,
      primaryText: "立即抢购",
      secondaryText: "提交订单",
      searchWindowMs: 1200,
      afterBuyWindowMs: 700,
      now: function () {
        return Date.now();
      },
      sleep: function (ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      },
      isArmed: function () {
        return armed;
      },
      findCandidates: function () {
        return [candidate("立即抢购")];
      },
      click: function (item) {
        clicks.push(item.text);
        return true;
      },
      persistState: function () {},
      onStatus: function () {},
    },
    overrides || {}
  );
  return {
    clicks: clicks,
    ctx: ctx,
    disarm: function () {
      armed = false;
    },
  };
}

test("rejects payment labels and dedupes the rest", function () {
  const result = SaleClick.classifyLabels("立即抢购\n立即支付\n立即抢购\n确认付款");
  assert.deepEqual(result.labels, ["立即抢购"]);
  assert.deepEqual(result.rejected, ["立即支付", "确认付款"]);
});

test("picks the larger exact buy button and skips disabled or payment controls", function () {
  const picked = SaleClick.pickEnabled(
    [
      candidate("推荐里的立即购买", { area: 400, depth: 8 }),
      candidate("立即抢购", { area: 900, disabled: true, depth: 6 }),
      candidate("立即抢购", { area: 8000, depth: 5 }),
      candidate("立即支付", { area: 20000, depth: 9 }),
    ],
    ["立即抢购", "立即购买"]
  );
  assert.equal(picked.text, "立即抢购");
  assert.equal(picked.area, 8000);
  assert.equal(picked.disabled, false);
});

test("clicks the buy button once after the sale time, then the submit button once", async function () {
  let buyEnabled = false;
  let submitted = false;
  const saleAtMs = Date.now() + 180;
  const started = Date.now();
  const run = harness({
    saleAtMs: saleAtMs,
    findCandidates: function () {
      const items = [candidate("立即支付", { area: 9000 }), candidate("确认支付")];
      if (!submitted) {
        items.push(candidate("立即抢购", { disabled: !buyEnabled, area: 5000 }));
      }
      if (buyEnabled) items.push(candidate("提交订单", { disabled: !submitted && false }));
      return items;
    },
    click: function (item) {
      if (item.text === "立即抢购") buyEnabled = true;
      if (item.text === "提交订单") submitted = true;
      this.clicks.push({ text: item.text, at: Date.now() });
      return true;
    },
  });
  run.ctx.click = function (item) {
    if (item.text === "立即抢购") buyEnabled = true;
    if (item.text === "提交订单") submitted = true;
    run.clicks.push({ text: item.text, at: Date.now() });
    return true;
  };
  setTimeout(function () {
    buyEnabled = true;
  }, 360);

  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "done");
  assert.deepEqual(
    run.clicks.map(function (click) {
      return click.text;
    }),
    ["立即抢购", "提交订单"]
  );
  assert.ok(run.clicks[0].at >= saleAtMs - 40, "clicked too early");
  assert.ok(run.clicks[0].at - started < 5000);
  assert.equal(result.primaryClicks, 1);
  assert.equal(result.secondaryClicks, 1);
});

test("waits when the main buy button is still disabled", function () {
  const picked = SaleClick.pickEnabled(
    [
      candidate("立即抢购", { area: 8000, disabled: true }),
      candidate("立即购买", { area: 500 }),
    ],
    ["立即抢购", "立即购买"]
  );
  assert.equal(picked, null);
});

test("does not click buy until the requested sku is selected", async function () {
  let attempts = 0;
  const run = harness({
    saleAtMs: Date.now() + 30,
    optionText: "曜石黑\n16GB+1TB 典藏版",
    primaryText: "立即购买",
    searchWindowMs: 1500,
    findCandidates: function () {
      return [candidate("立即购买"), candidate("立即支付")];
    },
    selectMissingOptions: function () {
      attempts += 1;
      if (attempts < 2) {
        return Promise.resolve({
          ok: false,
          missing: ["16GB+1TB 典藏版"],
          blockedReason: "规格还没选上：16GB+1TB 典藏版",
        });
      }
      return Promise.resolve({ ok: true, missing: [], summary: "曜石黑16GB+1TB典藏版" });
    },
  });
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.primaryClicks, 1);
  assert.ok(attempts >= 2);
  assert.deepEqual(run.clicks, ["立即购买"]);
});

test("does not click buy while the page still asks for an address", async function () {
  const run = harness({
    saleAtMs: Date.now() + 20,
    optionText: "曜石黑",
    primaryText: "立即购买",
    searchWindowMs: 500,
    selectMissingOptions: function () {
      return Promise.resolve({
        ok: false,
        missing: [],
        blockedReason: "页面还写着「请选择收货地址」。",
      });
    },
  });
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "not-found");
  assert.deepEqual(run.clicks, []);
});

test("does not keep clicking when the page ignores the scripted click", async function () {
  const run = harness({
    saleAtMs: Date.now() + 30,
    afterBuyWindowMs: 500,
    findCandidates: function () {
      return [candidate("立即抢购")];
    },
  });
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "ignored");
  assert.deepEqual(run.clicks, ["立即抢购"]);
});

test("does not treat the status bar as the submit button", async function () {
  let shown = false;
  const run = harness({
    saleAtMs: Date.now() - 1000,
    submitOnly: true,
    primaryText: "立即购买",
    secondaryText: "提交订单",
    afterBuyWindowMs: 2500,
    findCandidates: function () {
      const items = [candidate("开售点按：正在找「提交订单」", { area: 20000, depth: 2 })];
      if (shown) items.push(candidate("提交订单", { area: 4000, depth: 6 }));
      return items;
    },
  });
  setTimeout(function () {
    shown = true;
  }, 400);
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "done");
  assert.deepEqual(run.clicks, ["提交订单"]);
});

test("dismisses the hot-sale notice and submits once more", async function () {
  let submits = 0;
  let dialog = false;
  const run = harness({
    saleAtMs: Date.now() - 1000,
    submitOnly: true,
    primaryText: "立即购买",
    secondaryText: "提交订单",
    afterBuyWindowMs: 5000,
    findCandidates: function () {
      const items = [candidate("提交订单")];
      if (dialog) {
        items.push(candidate("您下单的商品火爆销售中，请稍后再试。"));
        items.push(candidate("知道了"));
      }
      return items;
    },
    click: function (item) {
      run.clicks.push(item.text);
      if (item.text === "提交订单") {
        submits += 1;
        dialog = submits === 1;
      }
      if (item.text === "知道了") dialog = false;
      return true;
    },
  });
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "done");
  assert.deepEqual(run.clicks, ["提交订单", "知道了", "提交订单"]);
  assert.equal(result.secondaryClicks, 2);
});

test("order page clicks submit without buying again or selecting a sku", async function () {
  let optionChecks = 0;
  const run = harness({
    saleAtMs: Date.now() - 10 * 60 * 1000,
    submitOnly: true,
    optionText: "晶钻白\n12GB+512GB",
    primaryText: "立即购买",
    secondaryText: "提交订单",
    searchWindowMs: 1000,
    afterBuyWindowMs: 3000,
    initialState: { primaryClicks: 1, secondaryClicks: 0, lastClickAt: Date.now() - 5000 },
    findCandidates: function () {
      return [candidate("立即购买"), candidate("提交订单"), candidate("立即支付")];
    },
    selectMissingOptions: function () {
      optionChecks += 1;
      return Promise.resolve({ ok: false, missing: ["晶钻白"], blockedReason: "规格还没选上" });
    },
  });
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "done");
  assert.deepEqual(run.clicks, ["提交订单"]);
  assert.equal(optionChecks, 0);
  assert.equal(result.secondaryClicks, 1);
});

test("stops before any click when disarmed", async function () {
  const run = harness({ saleAtMs: Date.now() + 5000 });
  setTimeout(run.disarm, 80);
  const result = await SaleClick.runSaleClick(run.ctx);
  assert.equal(result.phase, "stopped");
  assert.deepEqual(run.clicks, []);
});

test("extension source does not call the network", function () {
  const dir = path.join(__dirname, "../extension");
  const files = ["shared.js", "content.js", "background.js", "popup.js"];
  files.forEach(function (file) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    assert.equal(source.includes("fetch("), false, file);
    assert.equal(source.includes("XMLHttpRequest"), false, file);
    assert.equal(source.includes("WebSocket"), false, file);
  });
  assert.equal(SaleClick.LIMITS.maxPrimaryClicks, 1);
  assert.equal(SaleClick.LIMITS.maxSecondaryClicks, 1);
  assert.ok(SaleClick.LIMITS.pollMs >= 200);
  assert.ok(SaleClick.LIMITS.minClickGapMs >= 500);
});
