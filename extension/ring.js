(function () {
  const status = document.getElementById("status");
  const token = String(Date.now()) + ":" + Math.random().toString(16).slice(2);
  let context = null;
  let timer = 0;
  let playing = false;
  let wanted = false;

  function showStatus(text) {
    if (status) status.textContent = text;
  }

  function ensureContext() {
    if (context) return context;
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return null;
    context = new AudioCtx();
    return context;
  }

  function tone(ctx, frequency, when, duration) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(1, when + 0.02);
    gain.gain.setValueAtTime(1, when + duration - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(when);
    oscillator.stop(when + duration);
  }

  function ringOnce() {
    const ctx = ensureContext();
    if (!ctx) {
      showStatus("这台浏览器不能播放铃声。");
      return;
    }
    if (ctx.state === "suspended") {
      showStatus("点下面的按钮后才会出声。");
      ctx.resume().catch(function () {});
      return;
    }
    showStatus("正在按电脑当前音量循环响铃。点插件里的「停止」可关掉。");
    const now = ctx.currentTime;
    tone(ctx, 880, now, 0.35);
    tone(ctx, 660, now + 0.4, 0.35);
  }

  function start() {
    wanted = true;
    if (playing) {
      ringOnce();
      return;
    }
    playing = true;
    ringOnce();
    timer = setInterval(ringOnce, 1400);
  }

  function stop() {
    wanted = false;
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
    if (context && context.state !== "closed") {
      context.suspend().catch(function () {});
    }
    showStatus("铃声已停。继续补货时请留着这个窗口。");
  }

  function unlock() {
    const ctx = ensureContext();
    if (!ctx) {
      showStatus("这台浏览器不能播放铃声。");
      return;
    }
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    try {
      source.start(0);
    } catch (error) {}
    ctx.resume().then(
      function () {
        if (wanted) start();
        else showStatus("铃声已准备好。请留着这个窗口，进入支付页后会循环响。");
      },
      function () {
        showStatus("点下面的按钮后才会出声。");
      }
    );
  }

  document.getElementById("unlock").addEventListener("click", function () {
    unlock();
    if (wanted) start();
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;
    if (message.type === "RING_PLAY" || message.type === "RING_START") start();
    if (message.type === "RING_HALT" || message.type === "RING_STOP" || message.type === "STOP_ALL") stop();
  });

  chrome.storage.local.set({ ringToken: token, ringReady: true }, function () {
    void chrome.runtime.lastError;
  });
  unlock();

  window.addEventListener("pagehide", function () {
    chrome.storage.local.get(["ringToken"], function (settings) {
      if (chrome.runtime.lastError || !settings || settings.ringToken !== token) return;
      chrome.storage.local.set({ ringToken: "", ringReady: false });
    });
  });
})();
