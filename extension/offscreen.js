(function () {
  let context = null;
  let timer = 0;
  let playing = false;

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
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
    const now = ctx.currentTime;
    tone(ctx, 880, now, 0.35);
    tone(ctx, 660, now + 0.4, 0.35);
  }

  function start() {
    if (playing) return;
    playing = true;
    ringOnce();
    timer = setInterval(ringOnce, 1400);
  }

  function stop() {
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
    if (context && context.state !== "closed") {
      context.suspend().catch(function () {});
    }
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;
    if (message.type === "RING_PLAY" || message.type === "RING_START") start();
    if (message.type === "RING_HALT" || message.type === "RING_STOP" || message.type === "STOP_ALL") stop();
  });
})();
