const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const SHARED = path.join(__dirname, "../extension/shared.js");
const CONTENT = path.join(__dirname, "../extension/content.js");

function serve(root) {
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const filePath = url.pathname === "/" ? path.join(root, "fixture.html") : path.join(root, path.basename(url.pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, function (error, body) {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }
      const type = filePath.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
      res.writeHead(200, { "content-type": type });
      res.end(body);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({
        server: server,
        url: "http://127.0.0.1:" + server.address().port + "/",
      });
    });
  });
}

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    timeout: 20000,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

async function installChromeStub(page) {
  await page.evaluateOnNewDocument(function () {
    const data = {};
    const listeners = [];
    function notify(changes) {
      listeners.slice().forEach(function (listener) {
        listener(changes, "local");
      });
    }
    globalThis.chrome = {
      storage: {
        local: {
          get: function (keys) {
            const names = Array.isArray(keys) ? keys : Object.keys(data);
            const out = {};
            names.forEach(function (key) {
              if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
            });
            return Promise.resolve(out);
          },
          set: function (values) {
            const changes = {};
            Object.keys(values).forEach(function (key) {
              changes[key] = { oldValue: data[key], newValue: values[key] };
              data[key] = values[key];
            });
            notify(changes);
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: function (listener) {
            listeners.push(listener);
          },
        },
      },
      runtime: {
        onMessage: { addListener: function () {} },
      },
      tabs: {
        query: function () {
          return Promise.resolve([{ id: 1, url: "https://www.vmall.com/product/demo.html" }]);
        },
        sendMessage: function () {
          return Promise.resolve({ ok: true, matches: [] });
        },
      },
    };
  });
}

test("content script clicks buy once and submit once, never payment", { timeout: 30000 }, async function () {
  const fixture = await serve(__dirname);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", function (error) {
      console.error("PAGEERROR", error);
    });
    await installChromeStub(page);
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ path: SHARED });
    await page.addScriptTag({ path: CONTENT });
    await page.evaluate(function () {
      return chrome.storage.local.set({
        armed: true,
        runNonce: Date.now(),
        saleAtMs: Date.now() + 400,
        optionText: "曜石黑\n16GB+1TB 典藏版",
        primaryText: "立即购买",
        secondaryText: "提交订单\n确认订单",
        searchWindowMs: 5000,
        afterBuyWindowMs: 4000,
      });
    });
    await page.waitForFunction(
      function () {
        return window.__counts().submit === 1;
      },
      { timeout: 8000 }
    );
    const counts = await page.evaluate(function () {
      return window.__counts();
    });
    assert.equal(counts.buy, 1);
    assert.equal(counts.submit, 1);
    assert.equal(counts.pay, 0);
    assert.equal(counts.decoy, 0);
  } finally {
    await browser.close();
    fixture.server.close();
  }
});

test("refresh after the sale time still clicks while inside the window", { timeout: 30000 }, async function () {
  const fixture = await serve(__dirname);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(function () {
      return chrome.storage.local.set({
        armed: true,
        saleAtMs: Date.now() - 800,
        optionText: "曜石黑\n16GB+1TB 典藏版",
        primaryText: "立即购买",
        secondaryText: "提交订单\n确认订单",
        searchWindowMs: 8000,
        afterBuyWindowMs: 4000,
      });
    });
    await page.addScriptTag({ path: SHARED });
    await page.addScriptTag({ path: CONTENT });
    await page.waitForFunction(
      function () {
        return window.__counts().submit === 1;
      },
      { timeout: 8000 }
    );
    const banner = await page.$eval("#sale-click-banner", function (el) {
      return el.textContent;
    });
    assert.match(banner, /开售点按/);
    const counts = await page.evaluate(function () {
      return window.__counts();
    });
    assert.equal(counts.buy, 1);
    assert.equal(counts.submit, 1);
    assert.equal(counts.pay, 0);
  } finally {
    await browser.close();
    fixture.server.close();
  }
});

test("order confirm page clicks submit once after the buy click", { timeout: 30000 }, async function () {
  const fixture = await serve(__dirname);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(function () {
      const decoy = document.createElement("div");
      decoy.id = "sale-click-banner";
      decoy.setAttribute("data-sale-click-ui", "1");
      decoy.textContent = "开售点按：正在找「提交订单」";
      decoy.style.cssText = "position:fixed;top:0;left:0;right:0;height:40px;background:#1f3d2b;color:#fff;";
      document.body.appendChild(decoy);
      const submit = document.querySelector("#submit");
      submit.id = "confirmSubmit";
      submit.hidden = true;
      const price = document.createElement("b");
      price.id = "finalPrice";
      price.textContent = "¥ 4999";
      price.hidden = true;
      submit.insertAdjacentElement("beforebegin", price);
      window.__clickedStage = "";
      submit.addEventListener("click", function () {
        window.__clickedStage = window.__orderStage || "";
        window.__clickedAt = Date.now();
      });
      window.__orderStage = "hidden";
      setTimeout(function () {
        window.__orderStage = "button";
        submit.hidden = false;
      }, 250);
      setTimeout(function () {
        window.__orderStage = "ready";
        window.__readyAt = Date.now();
        price.hidden = false;
        const script = document.createElement("script");
        script.src = new URL("ars_client.js", location.href).href;
        document.body.appendChild(script);
      }, 500);
      return chrome.storage.local.set({
        armed: true,
        saleAtMs: Date.now() - 10 * 60 * 1000,
        optionText: "晶钻白\n12GB+512GB",
        primaryText: "立即购买",
        secondaryText: "提交订单\n确认订单",
        searchWindowMs: 1000,
        afterBuyWindowMs: 4000,
        clickProgress: {
          primaryClicks: 1,
          secondaryClicks: 0,
          lastClickAt: Date.now(),
          saleAtMs: Date.now() - 10 * 60 * 1000,
        },
      });
    });
    await page.addScriptTag({ path: SHARED });
    await page.addScriptTag({ path: CONTENT });
    await page.waitForFunction(
      function () {
        return window.__counts().submit === 1;
      },
      { timeout: 8000 }
    );
    const counts = await page.evaluate(function () {
      return window.__counts();
    });
    const timing = await page.evaluate(function () {
      return {
        stage: window.__clickedStage,
        readyAt: window.__readyAt,
        clickedAt: window.__clickedAt,
        ars: window.__arsLoaded === true,
      };
    });
    assert.equal(counts.buy, 0);
    assert.equal(counts.submit, 1);
    assert.equal(counts.pay, 0);
    assert.equal(timing.stage, "ready");
    assert.equal(timing.ars, true);
    assert.ok(timing.clickedAt >= timing.readyAt - 5);
    assert.ok(timing.clickedAt - timing.readyAt < 2200);
  } finally {
    await browser.close();
    fixture.server.close();
  }
});

test("refresh long after the sale time explains itself and does not click", { timeout: 30000 }, async function () {
  const fixture = await serve(__dirname);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(function () {
      return chrome.storage.local.set({
        armed: true,
        saleAtMs: Date.now() - 10 * 60 * 1000,
        optionText: "曜石黑\n16GB+1TB 典藏版",
        primaryText: "立即购买",
        secondaryText: "提交订单",
        searchWindowMs: 5000,
      });
    });
    await page.addScriptTag({ path: SHARED });
    await page.addScriptTag({ path: CONTENT });
    await page.waitForFunction(
      function () {
        const banner = document.querySelector("#sale-click-banner");
        return banner && banner.textContent.indexOf("不要再按 F5") !== -1;
      },
      { timeout: 4000 }
    );
    const counts = await page.evaluate(function () {
      return window.__counts();
    });
    const stored = await page.evaluate(function () {
      return chrome.storage.local.get(["armed"]);
    });
    assert.equal(counts.buy, 0);
    assert.equal(counts.submit, 0);
    assert.equal(stored.armed, false);
  } finally {
    await browser.close();
    fixture.server.close();
  }
});
