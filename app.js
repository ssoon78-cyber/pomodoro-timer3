(function () {
  'use strict';

  const FOCUS_SECONDS = 25 * 60;
  const BREAK_SECONDS = 5 * 60;
  const STORAGE_KEY = 'big_pomodoro_state_v1';

  const modeBadgeText = document.getElementById('modeBadgeText');
  const phaseLabel = document.getElementById('phaseLabel');
  const modeIcon = document.getElementById('modeIcon');
  const timerText = document.getElementById('timerText');
  const ringCircle = document.getElementById('timerRing');

  const btnReset = document.getElementById('btnReset');
  const btnStartPause = document.getElementById('btnStartPause');

  const RING_CIRCUMFERENCE = 289; // r=46 -> 2πr ≈ 288.97 (design uses 289)

  /** @type {'focus'|'break'} */
  let mode = 'focus';
  let remainingSeconds = FOCUS_SECONDS;
  let running = false;
  let endAtMs = null;

  let tickTimer = null;
  let audioCtx = null;

  const modeDurations = {
    focus: FOCUS_SECONDS,
    break: BREAK_SECONDS
  };

  const beepEnabled = true;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${pad2(m)}:${pad2(s)}`;
  }

  function applyModeUI() {
    const isFocus = mode === 'focus';
    modeBadgeText.textContent = isFocus ? 'CURRENT FOCUS' : 'SHORT BREAK';
    phaseLabel.textContent = isFocus ? 'Session 1/2' : 'Session 2/2';
    modeIcon.textContent = isFocus ? 'local_fire_department' : 'self_improvement';
  }

  function updateProgressRing() {
    const total = modeDurations[mode];
    const elapsed = total - remainingSeconds;
    const progress = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;

    // Progress ring
    // At progress=0 => dashoffset=circumference, progress=1 => dashoffset=0
    const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
    ringCircle.setAttribute('stroke-dashoffset', String(dashOffset));
  }

  function updateButtons() {
    if (running) {
      btnStartPause.textContent = 'Pause';
      btnStartPause.setAttribute('aria-pressed', 'true');
    } else {
      btnStartPause.textContent = mode === 'focus' ? 'Start Focus' : 'Start Break';
      btnStartPause.setAttribute('aria-pressed', 'false');
    }
  }

  function updateUI() {
    timerText.textContent = formatTime(remainingSeconds);
    updateProgressRing();
    applyModeUI();
    updateButtons();
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function saveState() {
    const payload = {
      mode,
      remainingSeconds,
      running,
      endAtMs
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || (parsed.mode !== 'focus' && parsed.mode !== 'break')) return;

      mode = parsed.mode;
      remainingSeconds = Number.isFinite(parsed.remainingSeconds)
        ? Math.max(0, Math.floor(parsed.remainingSeconds))
        : modeDurations[mode];
      running = Boolean(parsed.running);
      endAtMs = typeof parsed.endAtMs === 'number' ? parsed.endAtMs : null;
    } catch (e) {
      // ignore
    }
  }

  function ensureAudioReady() {
    if (!beepEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx && audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
        audioCtx.resume().catch(() => {});
      }
    } catch (e) {
      audioCtx = null;
    }
  }

  function playBeepSequence() {
    // iOS/Android: beeps should be triggered after a user gesture (handled by ensureAudioReady()).
    if (!beepEnabled) return;
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    master.connect(audioCtx.destination);

    const scheduleBeep = (t, freq) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 0.22);
    };

    // 3 beeps
    scheduleBeep(now + 0.0, 880);
    scheduleBeep(now + 0.30, 988);
    scheduleBeep(now + 0.60, 1046);
  }

  function finishPhase() {
    running = false;
    endAtMs = null;
    remainingSeconds = 0;
    stopTick();
    saveState();

    // 알림 소리
    playBeepSequence();

    // 다음 단계로 전환(자동 시작은 하지 않음)
    mode = mode === 'focus' ? 'break' : 'focus';
    remainingSeconds = modeDurations[mode];

    saveState();
    updateUI();
  }

  function tick() {
    if (!running || !endAtMs) return;
    const msLeft = endAtMs - Date.now();
    const nextRemaining = Math.max(0, Math.ceil(msLeft / 1000));
    remainingSeconds = nextRemaining;
    updateUI();
    saveState();
    if (nextRemaining <= 0) finishPhase();
  }

  function startOrPauseToggle() {
    if (running) {
      // Pause
      running = false;
      if (endAtMs) {
        const msLeft = endAtMs - Date.now();
        remainingSeconds = Math.max(0, Math.ceil(msLeft / 1000));
      }
      endAtMs = null;
      stopTick();
      saveState();
      updateUI();
      return;
    }

    // Start / Resume
    ensureAudioReady();

    if (remainingSeconds <= 0) remainingSeconds = modeDurations[mode];
    running = true;
    endAtMs = Date.now() + remainingSeconds * 1000;
    saveState();

    stopTick();
    // 주기(정확도 보정)
    tickTimer = setInterval(tick, 250);

    updateUI();
  }

  function reset() {
    running = false;
    endAtMs = null;
    stopTick();
    mode = 'focus';
    remainingSeconds = modeDurations.focus;
    saveState();
    updateUI();
  }

  btnStartPause.addEventListener('click', startOrPauseToggle);
  btnReset.addEventListener('click', reset);

  // 초기 로드
  loadState();
  applyModeUI();

  if (running && endAtMs) {
    // 저장된 상태가 "진행 중"이면 endAtMs 기준으로 재계산
    const msLeft = endAtMs - Date.now();
    remainingSeconds = Math.max(0, Math.ceil(msLeft / 1000));
    running = remainingSeconds > 0;
    if (running) {
      // tick loop 재시작
      endAtMs = Date.now() + remainingSeconds * 1000;
      tickTimer = setInterval(tick, 250);
    } else {
      // 이미 끝났으면 페이즈 전환 처리
      finishPhase();
    }
  }

  updateUI();

  // ---- Screen Navigation (Timer / Tasks / Stats / Settings) ----
  const SCREEN_STORAGE_KEY = 'big_pomodoro_screen_v1';
  const screens = [
    { key: 'timer', el: document.getElementById('screen-timer') },
    { key: 'tasks', el: document.getElementById('screen-tasks') },
    { key: 'stats', el: document.getElementById('screen-stats') },
    { key: 'settings', el: document.getElementById('screen-settings') }
  ];

  const navItems = Array.from(document.querySelectorAll('[data-screen]'));

  function setActiveScreen(nextKey) {
    screens.forEach(({ key, el }) => {
      if (!el) return;
      const isActive = key === nextKey;
      el.classList.toggle('hidden', !isActive);
    });

    navItems.forEach((a) => {
      const key = a.getAttribute('data-screen');
      const isActive = key === nextKey;
      a.classList.toggle('navItemActive', isActive);
      if (isActive) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    localStorage.setItem(SCREEN_STORAGE_KEY, nextKey);
  }

  navItems.forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const nextKey = a.getAttribute('data-screen');
      if (!nextKey) return;
      setActiveScreen(nextKey);
    });
  });

  const savedScreen = localStorage.getItem(SCREEN_STORAGE_KEY);
  const hasSaved = screens.some((s) => s.key === savedScreen);
  setActiveScreen(hasSaved ? savedScreen : 'timer');
})();

