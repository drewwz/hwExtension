const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const EXTENSION_DIR = path.join(__dirname, "../extension");

function copyExtension(target) {
  fs.cpSync(EXTENSION_DIR, target, { recursive: true });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const localMatches = ["http://127.0.0.1/*", "http://localhost/*"];
  manifest.host_permissions = manifest.host_permissions.concat(localMatches);
  manifest.content_scripts[0].matches = manifest.content_scripts[0].matches.concat(localMatches);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function serveFixture() {
  const fixture = fs.readFileSync(path.join(__dirname, "fixture.html"));
  const server = http.createServer(function (_req, res) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fixture);
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

async function launch(extensionPath) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions-except=" + extensionPath,
      "--load-extension=" + extensionPath,
    ],
  });
  const target = await browser.waitForTarget(function (item) {
    return item.type() === "service_worker" && item.url().startsWith("chrome-extension://");
  });
  return { browser: browser, worker: await target.worker(), extensionId: new URL(target.url()).host };
}

test("content script clicks buy once and submit once, never payment", { timeout: 40000 }, async function () {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sale-click-"));
  copyExtension(tempDir);
  const fixture = await serveFixture();
  const launched = await launch(tempDir);
  try {
    const page = await launched.browser.newPage();
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await launched.worker.evaluate(function () {
      return chrome.storage.local.set({
        armed: true,
        runNonce: Date.now(),
        saleAtMs: Date.now() + 250,
        primaryText: "立即抢购\n立即购买",
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
    await launched.browser.close();
    fixture.server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
