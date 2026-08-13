(() => {
  const STORAGE_KEY = "nexusmd-console-config";
  const POLL_MS = 20000;

  const el = {
    clock: document.getElementById("clock"),
    statusWord: document.getElementById("statusWord"),
    trace: document.getElementById("trace"),
    tracePath: document.getElementById("tracePath"),
    phoneValue: document.getElementById("phoneValue"),
    uptimeValue: document.getElementById("uptimeValue"),
    lastPollValue: document.getElementById("lastPollValue"),
    latencyValue: document.getElementById("latencyValue"),
    refreshBtn: document.getElementById("refreshBtn"),
    pairBtn: document.getElementById("pairBtn"),
    baseUrlInput: document.getElementById("baseUrlInput"),
    sessionIdInput: document.getElementById("sessionIdInput"),
    saveConfigBtn: document.getElementById("saveConfigBtn"),
    saveNote: document.getElementById("saveNote"),
    setupToggle: document.getElementById("setupToggle"),
    setupBody: document.getElementById("setupBody"),
    setupChev: document.getElementById("setupChev"),
    cmdToggle: document.getElementById("cmdToggle"),
    cmdBody: document.getElementById("cmdBody"),
    cmdChev: document.getElementById("cmdChev"),
    pollIntervalLabel: document.getElementById("pollIntervalLabel"),
  };

  let config = loadConfig();
  let connectedAt = null;
  let pollTimer = null;

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { baseUrl: "", sessionId: "" };
    } catch {
      return { baseUrl: "", sessionId: "" };
    }
  }

  function saveConfig(next) {
    config = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function normalizeBaseUrl(u) {
    return u.trim().replace(/\/+$/, "");
  }

  // ---- Clock ----
  function tickClock() {
    const now = new Date();
    el.clock.textContent = now.toLocaleTimeString([], { hour12: false });
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---- Uptime ----
  function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(d + "d");
    if (h || d) parts.push(h + "h");
    parts.push(m + "m");
    return parts.join(" ");
  }
  function tickUptime() {
    if (connectedAt) {
      el.uptimeValue.textContent = formatDuration(Date.now() - connectedAt);
    }
  }
  setInterval(tickUptime, 30000);

  // ---- Trace (signature pulse) ----
  function drawTrace(ok) {
    const w = 300, h = 60, mid = 30;
    let pts;
    if (ok) {
      // heartbeat-style spike
      pts = [
        [0, mid], [70, mid], [95, mid - 4], [115, mid + 22], [130, mid - 26],
        [145, mid + 8], [165, mid], [300, mid],
      ];
    } else {
      // flatline with a small stutter
      pts = [
        [0, mid], [120, mid], [135, mid + 6], [150, mid - 6], [165, mid], [300, mid],
      ];
    }
    el.tracePath.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    el.trace.classList.toggle("ok", ok);
    el.trace.classList.remove("pulse");
    void el.trace.offsetWidth; // restart animation
    el.trace.classList.add("pulse");
  }

  // ---- Status rendering ----
  function setState(state) {
    el.statusWord.dataset.state = state;
    const labels = {
      connected: "CONNECTED",
      pairing: "LINKING…",
      none: "NOT LINKED",
      offline: "UNREACHABLE",
      unconfigured: "UNCONFIGURED",
    };
    el.statusWord.textContent = labels[state] || state.toUpperCase();
  }

  async function poll(manual) {
    if (!config.baseUrl || !config.sessionId) {
      setState("unconfigured");
      el.phoneValue.textContent = "—";
      el.uptimeValue.textContent = "—";
      drawTrace(false);
      return;
    }

    const started = performance.now();
    if (manual) {
      el.refreshBtn.disabled = true;
      el.refreshBtn.textContent = "Checking…";
    }

    try {
      const url = `${normalizeBaseUrl(config.baseUrl)}/api/status/${encodeURIComponent(config.sessionId)}`;
      const res = await fetch(url, { cache: "no-store" });
      const latency = Math.round(performance.now() - started);
      el.latencyValue.textContent = latency + " ms";

      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      setState(data.status || "none");
      el.phoneValue.textContent = data.phone ? "+" + data.phone : "—";
      connectedAt = data.connectedAt ? new Date(data.connectedAt).getTime() : null;
      tickUptime();
      if (!connectedAt) el.uptimeValue.textContent = "—";

      drawTrace(data.status === "connected");
      el.lastPollValue.textContent = new Date().toLocaleTimeString([], { hour12: false });
    } catch (err) {
      setState("offline");
      el.latencyValue.textContent = "—";
      drawTrace(false);
      el.lastPollValue.textContent = new Date().toLocaleTimeString([], { hour12: false }) + " (failed)";
    } finally {
      if (manual) {
        el.refreshBtn.disabled = false;
        el.refreshBtn.textContent = "Check now";
      }
    }
  }

  function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    poll(false);
    pollTimer = setInterval(() => poll(false), POLL_MS);
  }

  // ---- Setup card ----
  function applyConfigToInputs() {
    el.baseUrlInput.value = config.baseUrl || "";
    el.sessionIdInput.value = config.sessionId || "";
  }
  applyConfigToInputs();

  el.saveConfigBtn.addEventListener("click", () => {
    const baseUrl = el.baseUrlInput.value.trim();
    const sessionId = el.sessionIdInput.value.trim().replace(/[^0-9]/g, "");
    if (!baseUrl || !sessionId) {
      el.saveNote.textContent = "Enter both fields.";
      el.saveNote.style.color = "var(--signal-bad-bright)";
      return;
    }
    saveConfig({ baseUrl, sessionId });
    el.saveNote.textContent = "Saved.";
    el.saveNote.style.color = "var(--signal-ok-bright)";
    setTimeout(() => (el.saveNote.textContent = ""), 2000);
    restartPolling();
  });

  el.refreshBtn.addEventListener("click", () => poll(true));

  el.pairBtn.addEventListener("click", () => {
    if (config.baseUrl) {
      window.open(normalizeBaseUrl(config.baseUrl), "_blank", "noopener");
    } else {
      el.setupBody.classList.remove("collapsed");
      el.setupChev.classList.add("open");
      el.baseUrlInput.focus();
    }
  });

  // ---- Collapsible cards ----
  function wireToggle(toggleBtn, body, chev, startOpen) {
    if (!startOpen) body.classList.add("collapsed");
    chev.classList.toggle("open", startOpen);
    toggleBtn.setAttribute("aria-expanded", String(startOpen));
    toggleBtn.addEventListener("click", () => {
      const isOpen = !body.classList.contains("collapsed");
      body.classList.toggle("collapsed", isOpen);
      chev.classList.toggle("open", !isOpen);
      toggleBtn.setAttribute("aria-expanded", String(!isOpen));
    });
  }
  wireToggle(el.setupToggle, el.setupBody, el.setupChev, !(config.baseUrl && config.sessionId));
  wireToggle(el.cmdToggle, el.cmdBody, el.cmdChev, false);

  el.pollIntervalLabel.textContent = `Polling every ${POLL_MS / 1000}s`;

  // ---- Boot ----
  drawTrace(false);
  restartPolling();

  // ---- Service worker ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
