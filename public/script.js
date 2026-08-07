const stepInput = document.getElementById('step-input');
const stepCode = document.getElementById('step-code');
const stepConnected = document.getElementById('step-connected');
const phoneInput = document.getElementById('phone');
const pairBtn = document.getElementById('pairBtn');
const errorEl = document.getElementById('error');
const codeEl = document.getElementById('code');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

let pollTimer = null;
let currentSessionId = null;

function showStep(step) {
  [stepInput, stepCode, stepConnected].forEach((s) => s.classList.add('hidden'));
  step.classList.remove('hidden');
}

async function requestPairing() {
  errorEl.textContent = '';
  const phone = phoneInput.value.replace(/[^0-9]/g, '');
  if (!phone) {
    errorEl.textContent = 'Enter your number with country code.';
    return;
  }

  pairBtn.disabled = true;
  pairBtn.textContent = 'Generating code…';

  try {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Something went wrong.';
      return;
    }

    currentSessionId = data.sessionId;

    if (data.alreadyLinked) {
      showStep(stepConnected);
      return;
    }

    codeEl.textContent = data.pairingCode;
    showStep(stepCode);
    startPolling();
  } catch (err) {
    errorEl.textContent = 'Network error. Please try again.';
  } finally {
    pairBtn.disabled = false;
    pairBtn.textContent = 'Get Pairing Code';
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!currentSessionId) return;
    const res = await fetch(`/api/status/${currentSessionId}`);
    const data = await res.json();

    if (data.status === 'connected') {
      clearInterval(pollTimer);
      showStep(stepConnected);
    } else if (data.status === 'disconnected') {
      statusText.textContent = 'Reconnecting…';
      statusDot.classList.remove('connected');
    } else {
      statusText.textContent = 'Waiting for link…';
    }
  }, 2500);
}

function reset() {
  clearInterval(pollTimer);
  currentSessionId = null;
  phoneInput.value = '';
  errorEl.textContent = '';
  showStep(stepInput);
}

pairBtn.addEventListener('click', requestPairing);
phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') requestPairing(); });
document.getElementById('resetBtn').addEventListener('click', reset);
document.getElementById('resetBtn2').addEventListener('click', reset);
