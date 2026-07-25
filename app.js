/**
 * ChronoPulse - PWA Alarm Clock, Stopwatch & Timer Application
 * Vanilla JavaScript (ES6+) with Mobile-Optimized Web Audio API Sound Synthesis
 * 
 * Features:
 * - Live digital clock with 12h/24h format switching
 * - Mobile audio unlock with silent buffer playback trick & resume() safety checks
 * - Test Sound button with temporary audio confirmation toast
 * - Alarms with Web Audio API synthesized tones (no external audio files)
 * - Full-screen ringing alert overlay with Snooze & Vibration
 * - Precision Stopwatch with Lap recording and Best/Worst lap detection
 * - Countdown Timer with SVG progress ring and quick increment chips
 * - LocalStorage state persistence & Offline Service Worker PWA registration
 */

document.addEventListener('DOMContentLoaded', () => {
  AppController.init();
});

/* ==========================================================================
   1. MOBILE-OPTIMIZED WEB AUDIO API SYNTHESIZER
   Handles audio unlocking, silent buffer trick, and 4 synthesized tone presets.
   ========================================================================== */
const AudioSynth = {
  ctx: null,
  activeLoopInterval: null,

  // Initialize Web Audio Context and apply silent buffer trick for mobile devices
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }

    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }

    this.playSilentBuffer();
  },

  // Silent buffer trick: forces iOS Safari / Android Chrome to register active audio playback
  playSilentBuffer() {
    if (!this.ctx) return;
    try {
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
    } catch (e) {
      // Ignore initial silent buffer errors if context is suspended
    }
  },

  // Explicitly resume AudioContext before playing any note burst
  ensureContextRunning() {
    this.init();
    if (this.ctx && this.ctx.state !== 'running') {
      return this.ctx.resume();
    }
    return Promise.resolve();
  },

  // Play a single note burst with given frequency, wave type, duration, and volume
  playNote(freq, type = 'sine', duration = 0.3, volume = 0.5) {
    this.ensureContextRunning().then(() => {
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      // Envelope: Attack and Exponential Decay
      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      // Connect nodes safely to destination
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + duration);
    });
  },

  // Sound Preset 1: Digital Chime (Upbeat Chord Sequence)
  playChime() {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playNote(freq, 'sine', 0.4, 0.4), idx * 120);
    });
  },

  // Sound Preset 2: Classic Digital Beep
  playBeep() {
    this.playNote(880, 'square', 0.15, 0.3);
    setTimeout(() => this.playNote(880, 'square', 0.15, 0.3), 200);
  },

  // Sound Preset 3: Gentle Bell
  playBell() {
    this.playNote(440, 'sine', 1.2, 0.6); // Warm A4 sine tone
  },

  // Sound Preset 4: Energetic Pulse (Frequency Sweep)
  playPulse() {
    this.ensureContextRunning().then(() => {
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + 0.35);
    });
  },

  // Trigger sound by type key
  playSoundPreset(presetName = 'chime') {
    switch (presetName) {
      case 'beep': this.playBeep(); break;
      case 'bell': this.playBell(); break;
      case 'pulse': this.playPulse(); break;
      case 'chime':
      default:
        this.playChime();
        break;
    }
  },

  // Loop alarm sound continuously until stopped
  startAlarmLoop(presetName = 'chime') {
    this.stopAlarmLoop();
    this.ensureContextRunning().then(() => {
      this.playSoundPreset(presetName);
      this.activeLoopInterval = setInterval(() => {
        this.ensureContextRunning();
        this.playSoundPreset(presetName);
      }, 1200);
    });
  },

  // Stop looping alarm sound
  stopAlarmLoop() {
    if (this.activeLoopInterval) {
      clearInterval(this.activeLoopInterval);
      this.activeLoopInterval = null;
    }
  }
};

/* ==========================================================================
   2. APP CONTROLLER & GLOBAL STATE
   ========================================================================== */
const AppController = {
  // App State
  use24HourFormat: false,
  alarms: [],
  activeRingingAlarm: null,

  init() {
    this.loadState();
    this.setupGlobalAudioUnlocking();
    this.setupTestSoundButton();
    this.setupTabNavigation();
    this.setupFormatToggle();

    // Sub-modules Initialization
    LiveClockModule.init(this);
    AlarmsModule.init(this);
    StopwatchModule.init(this);
    TimerModule.init(this);
    PwaModule.init();
  },

  loadState() {
    const savedFormat = localStorage.getItem('chrono_24h');
    if (savedFormat !== null) {
      this.use24HourFormat = JSON.parse(savedFormat);
    }

    const savedAlarms = localStorage.getItem('chrono_alarms');
    if (savedAlarms) {
      try {
        this.alarms = JSON.parse(savedAlarms);
      } catch (e) {
        this.alarms = [];
      }
    } else {
      // Default sample alarms
      this.alarms = [
        {
          id: 'alarm-sample-1',
          time: '07:00',
          label: 'Morning Workout',
          days: [1, 2, 3, 4, 5],
          sound: 'chime',
          vibrate: true,
          enabled: true
        },
        {
          id: 'alarm-sample-2',
          time: '08:30',
          label: 'Team Sync Meeting',
          days: [1, 3, 5],
          sound: 'beep',
          vibrate: true,
          enabled: false
        }
      ];
      this.saveAlarms();
    }

    this.updateFormatUI();
  },

  saveAlarms() {
    localStorage.setItem('chrono_alarms', JSON.stringify(this.alarms));
  },

  saveFormatPreference() {
    localStorage.setItem('chrono_24h', JSON.stringify(this.use24HourFormat));
  },

  // 1. Global Audio Unlocking: pointerdown, touchstart, click listeners
  setupGlobalAudioUnlocking() {
    const toast = document.getElementById('audio-toast');
    toast.style.display = 'flex';

    const handleFirstUserInteraction = () => {
      AudioSynth.init();
      if (AudioSynth.ctx && AudioSynth.ctx.state === 'running') {
        toast.style.display = 'none';
        this.removeGlobalAudioListeners(handleFirstUserInteraction);
      } else if (AudioSynth.ctx) {
        AudioSynth.ctx.resume().then(() => {
          if (AudioSynth.ctx.state === 'running') {
            toast.style.display = 'none';
            this.removeGlobalAudioListeners(handleFirstUserInteraction);
          }
        });
      }
    };

    ['pointerdown', 'touchstart', 'click'].forEach(evtType => {
      document.addEventListener(evtType, handleFirstUserInteraction, { passive: true });
    });
  },

  removeGlobalAudioListeners(handler) {
    ['pointerdown', 'touchstart', 'click'].forEach(evtType => {
      document.removeEventListener(evtType, handler);
    });
  },

  // 2. Test Sound Button Handler
  setupTestSoundButton() {
    const testBtn = document.getElementById('btn-test-sound');
    const toast = document.getElementById('audio-toast');
    const toastText = document.getElementById('audio-toast-text');

    testBtn.addEventListener('click', () => {
      AudioSynth.init();
      AudioSynth.playChime();

      // Show visual confirmation badge
      toastText.textContent = 'Audio Enabled! 🔔 Playing test tone';
      toast.style.display = 'flex';

      setTimeout(() => {
        if (AudioSynth.ctx && AudioSynth.ctx.state === 'running') {
          toast.style.display = 'none';
        }
      }, 3000);
    });
  },

  setupTabNavigation() {
    const navButtons = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');

        navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabContents.forEach(tab => {
          if (tab.id === `tab-${targetTab}`) {
            tab.classList.add('active');
          } else {
            tab.classList.remove('active');
          }
        });
      });
    });
  },

  setupFormatToggle() {
    const toggleBtn = document.getElementById('format-toggle');
    toggleBtn.addEventListener('click', () => {
      this.use24HourFormat = !this.use24HourFormat;
      this.saveFormatPreference();
      this.updateFormatUI();
      LiveClockModule.render();
      AlarmsModule.renderAlarms();
    });
  },

  updateFormatUI() {
    const label = document.getElementById('format-label');
    label.textContent = this.use24HourFormat ? '24H' : '12H';
  },

  formatTimeString(time24) {
    if (!time24) return '';
    if (this.use24HourFormat) return time24;

    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const padHour = String(h12).padStart(2, '0');
    return `${padHour}:${String(m).padStart(2, '0')} ${period}`;
  }
};

/* ==========================================================================
   3. LIVE CLOCK MODULE
   ========================================================================== */
const LiveClockModule = {
  parent: null,
  timerId: null,
  lastTriggeredMinute: '',

  init(parent) {
    this.parent = parent;
    this.startClock();
  },

  startClock() {
    this.render();
    this.timerId = setInterval(() => this.render(), 1000);
  },

  render() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const dayOfWeek = now.getDay();

    let displayHours = hours;
    let period = '';

    if (!this.parent.use24HourFormat) {
      period = hours >= 12 ? 'PM' : 'AM';
      displayHours = hours % 12 || 12;
    }

    const padHours = String(displayHours).padStart(2, '0');
    const padMinutes = String(minutes).padStart(2, '0');
    const padSeconds = String(seconds).padStart(2, '0');

    document.getElementById('live-clock-time').textContent = `${padHours}:${padMinutes}:${padSeconds}`;
    const periodEl = document.getElementById('live-clock-period');
    periodEl.textContent = period;
    periodEl.style.display = this.parent.use24HourFormat ? 'none' : 'inline';

    const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
    document.getElementById('live-clock-date').textContent = now.toLocaleDateString('en-US', options);

    const currentHHMM = `${String(hours).padStart(2, '0')}:${padMinutes}`;
    const minuteKey = `${now.toDateString()}_${currentHHMM}`;

    if (seconds === 0 && this.lastTriggeredMinute !== minuteKey) {
      this.checkAlarms(currentHHMM, dayOfWeek);
      this.lastTriggeredMinute = minuteKey;
    }
  },

  checkAlarms(currentHHMM, dayOfWeek) {
    this.parent.alarms.forEach(alarm => {
      if (!alarm.enabled) return;

      if (alarm.time === currentHHMM) {
        if (!alarm.days || alarm.days.length === 0 || alarm.days.includes(dayOfWeek)) {
          this.triggerAlarm(alarm);
        }
      }
    });
  },

  triggerAlarm(alarm) {
    this.parent.activeRingingAlarm = alarm;

    const ringOverlay = document.getElementById('alarm-ring-overlay');
    const ringTime = document.getElementById('ring-time');
    const ringLabel = document.getElementById('ring-label');

    ringTime.textContent = this.parent.formatTimeString(alarm.time);
    ringLabel.textContent = alarm.label || 'Alarm';
    ringOverlay.classList.add('active');

    // 3. Mobile Audio Safety Check: ensure AudioContext is resumed before looping
    AudioSynth.startAlarmLoop(alarm.sound || 'chime');

    if (alarm.vibrate && 'vibrate' in navigator) {
      navigator.vibrate([500, 250, 500, 250, 500]);
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Alarm: ${alarm.label || 'ChronoPulse'}`, {
        body: `Time to wake up! (${this.parent.formatTimeString(alarm.time)})`,
        icon: 'icon-192.png'
      });
    }
  }
};

/* ==========================================================================
   4. ALARMS MODULE
   ========================================================================== */
const AlarmsModule = {
  parent: null,
  selectedDays: [],

  init(parent) {
    this.parent = parent;
    this.setupEventListeners();
    this.renderAlarms();
    this.requestNotificationPermission();
  },

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  },

  setupEventListeners() {
    document.getElementById('btn-add-alarm').addEventListener('click', () => {
      this.openModal();
    });

    document.getElementById('btn-modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('btn-modal-cancel').addEventListener('click', () => this.closeModal());

    const dayBtns = document.querySelectorAll('.day-btn');
    dayBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.getAttribute('data-day'));
        if (this.selectedDays.includes(day)) {
          this.selectedDays = this.selectedDays.filter(d => d !== day);
          btn.classList.remove('selected');
        } else {
          this.selectedDays.push(day);
          btn.classList.add('selected');
        }
      });
    });

    document.getElementById('alarm-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveAlarmFromForm();
    });

    document.getElementById('btn-ring-dismiss').addEventListener('click', () => {
      this.dismissRingingAlarm();
    });

    document.getElementById('btn-ring-snooze').addEventListener('click', () => {
      this.snoozeRingingAlarm();
    });
  },

  openModal(alarm = null) {
    const modal = document.getElementById('alarm-modal');
    const modalTitle = document.getElementById('modal-title');
    const idInput = document.getElementById('alarm-id');
    const timeInput = document.getElementById('alarm-time-input');
    const labelInput = document.getElementById('alarm-label-input');
    const soundSelect = document.getElementById('alarm-sound-select');
    const vibrateCheckbox = document.getElementById('alarm-vibrate-checkbox');

    if (alarm) {
      modalTitle.textContent = 'Edit Alarm';
      idInput.value = alarm.id;
      timeInput.value = alarm.time;
      labelInput.value = alarm.label || '';
      soundSelect.value = alarm.sound || 'chime';
      vibrateCheckbox.checked = alarm.vibrate !== false;
      this.selectedDays = [...(alarm.days || [])];
    } else {
      modalTitle.textContent = 'Add Alarm';
      idInput.value = '';
      
      const now = new Date();
      now.setMinutes(now.getMinutes() + 5);
      const defaultHH = String(now.getHours()).padStart(2, '0');
      const defaultMM = String(now.getMinutes()).padStart(2, '0');
      timeInput.value = `${defaultHH}:${defaultMM}`;
      
      labelInput.value = '';
      soundSelect.value = 'chime';
      vibrateCheckbox.checked = true;
      this.selectedDays = [0, 1, 2, 3, 4, 5, 6];
    }

    document.querySelectorAll('.day-btn').forEach(btn => {
      const day = parseInt(btn.getAttribute('data-day'));
      if (this.selectedDays.includes(day)) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });

    modal.classList.add('active');
  },

  closeModal() {
    document.getElementById('alarm-modal').classList.remove('active');
  },

  saveAlarmFromForm() {
    const id = document.getElementById('alarm-id').value;
    const time = document.getElementById('alarm-time-input').value;
    const label = document.getElementById('alarm-label-input').value.trim();
    const sound = document.getElementById('alarm-sound-select').value;
    const vibrate = document.getElementById('alarm-vibrate-checkbox').checked;

    if (id) {
      const alarm = this.parent.alarms.find(a => a.id === id);
      if (alarm) {
        alarm.time = time;
        alarm.label = label;
        alarm.sound = sound;
        alarm.vibrate = vibrate;
        alarm.days = [...this.selectedDays];
        alarm.enabled = true;
      }
    } else {
      const newAlarm = {
        id: 'alarm-' + Date.now(),
        time,
        label,
        sound,
        vibrate,
        days: [...this.selectedDays],
        enabled: true
      };
      this.parent.alarms.push(newAlarm);
    }

    this.parent.saveAlarms();
    this.renderAlarms();
    this.closeModal();
  },

  toggleAlarm(id) {
    const alarm = this.parent.alarms.find(a => a.id === id);
    if (alarm) {
      alarm.enabled = !alarm.enabled;
      this.parent.saveAlarms();
      this.renderAlarms();
    }
  },

  deleteAlarm(id) {
    this.parent.alarms = this.parent.alarms.filter(a => a.id !== id);
    this.parent.saveAlarms();
    this.renderAlarms();
  },

  dismissRingingAlarm() {
    AudioSynth.stopAlarmLoop();
    document.getElementById('alarm-ring-overlay').classList.remove('active');
    this.parent.activeRingingAlarm = null;
  },

  snoozeRingingAlarm() {
    this.dismissRingingAlarm();

    const snoozeDate = new Date();
    snoozeDate.setMinutes(snoozeDate.getMinutes() + 5);

    const snoozeHH = String(snoozeDate.getHours()).padStart(2, '0');
    const snoozeMM = String(snoozeDate.getMinutes()).padStart(2, '0');

    const snoozeAlarm = {
      id: 'alarm-snooze-' + Date.now(),
      time: `${snoozeHH}:${snoozeMM}`,
      label: 'Snoozed Alarm (5m)',
      sound: 'chime',
      vibrate: true,
      days: [0, 1, 2, 3, 4, 5, 6],
      enabled: true
    };

    this.parent.alarms.push(snoozeAlarm);
    this.parent.saveAlarms();
    this.renderAlarms();
  },

  renderAlarms() {
    const listContainer = document.getElementById('alarms-list');
    listContainer.innerHTML = '';

    if (this.parent.alarms.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
          </svg>
          <p>No alarms configured. Tap "+ Add Alarm" above to get started.</p>
        </div>
      `;
      return;
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    this.parent.alarms.forEach(alarm => {
      const card = document.createElement('div');
      card.className = `alarm-card ${alarm.enabled ? '' : 'disabled'}`;

      let daysText = 'Everyday';
      if (alarm.days && alarm.days.length > 0 && alarm.days.length < 7) {
        daysText = alarm.days.map(d => dayNames[d]).join(', ');
      } else if (!alarm.days || alarm.days.length === 0) {
        daysText = 'Once';
      }

      const formattedTime = this.parent.formatTimeString(alarm.time);
      const timeParts = formattedTime.split(' ');
      const mainTimeStr = timeParts[0];
      const periodStr = timeParts[1] ? ` <span class="alarm-period">${timeParts[1]}</span>` : '';

      card.innerHTML = `
        <div class="alarm-info">
          <div class="alarm-time">${mainTimeStr}${periodStr}</div>
          <div class="alarm-meta">
            <span class="alarm-label">${this.escapeHtml(alarm.label || 'Alarm')}</span>
            <span class="alarm-days">${daysText}</span>
          </div>
        </div>
        <div class="alarm-actions">
          <label class="toggle-switch">
            <input type="checkbox" ${alarm.enabled ? 'checked' : ''} data-toggle-id="${alarm.id}">
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-icon btn-edit" data-edit-id="${alarm.id}" title="Edit Alarm">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="btn-icon btn-delete" data-delete-id="${alarm.id}" title="Delete Alarm">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      `;

      card.querySelector(`[data-toggle-id="${alarm.id}"]`).addEventListener('change', () => {
        this.toggleAlarm(alarm.id);
      });

      card.querySelector(`[data-edit-id="${alarm.id}"]`).addEventListener('click', () => {
        this.openModal(alarm);
      });

      card.querySelector(`[data-delete-id="${alarm.id}"]`).addEventListener('click', () => {
        this.deleteAlarm(alarm.id);
      });

      listContainer.appendChild(card);
    });
  },

  escapeHtml(str) {
    return str.replace(/[&<>"']/g, match => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
    });
  }
};

/* ==========================================================================
   5. STOPWATCH MODULE
   ========================================================================== */
const StopwatchModule = {
  parent: null,
  isRunning: false,
  startTime: 0,
  elapsedTime: 0,
  animationFrameId: null,
  laps: [],
  lastLapTotalTime: 0,

  init(parent) {
    this.parent = parent;
    this.setupEventListeners();
  },

  setupEventListeners() {
    const startBtn = document.getElementById('sw-start-btn');
    const resetBtn = document.getElementById('sw-reset-btn');
    const lapBtn = document.getElementById('sw-lap-btn');

    startBtn.addEventListener('click', () => {
      if (this.isRunning) {
        this.pause();
      } else {
        this.start();
      }
    });

    resetBtn.addEventListener('click', () => this.reset());
    lapBtn.addEventListener('click', () => this.recordLap());
  },

  start() {
    AudioSynth.init();
    this.isRunning = true;
    this.startTime = performance.now() - this.elapsedTime;

    const startBtn = document.getElementById('sw-start-btn');
    startBtn.textContent = 'Pause';
    startBtn.className = 'btn-circle btn-pause';

    document.getElementById('sw-reset-btn').disabled = false;
    document.getElementById('sw-lap-btn').disabled = false;

    this.updateLoop();
  },

  pause() {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);

    const startBtn = document.getElementById('sw-start-btn');
    startBtn.textContent = 'Resume';
    startBtn.className = 'btn-circle btn-start';

    document.getElementById('sw-lap-btn').disabled = true;
  },

  reset() {
    this.pause();
    this.elapsedTime = 0;
    this.lastLapTotalTime = 0;
    this.laps = [];

    const startBtn = document.getElementById('sw-start-btn');
    startBtn.textContent = 'Start';
    startBtn.className = 'btn-circle btn-start';

    document.getElementById('sw-reset-btn').disabled = true;
    document.getElementById('sw-lap-btn').disabled = true;

    this.renderDisplay(0);
    this.renderLaps();
  },

  recordLap() {
    if (!this.isRunning) return;

    const currentTotal = this.elapsedTime;
    const lapTime = currentTotal - this.lastLapTotalTime;
    this.lastLapTotalTime = currentTotal;

    this.laps.unshift({
      lapNum: this.laps.length + 1,
      lapTime,
      totalTime: currentTotal
    });

    this.renderLaps();
  },

  updateLoop() {
    if (!this.isRunning) return;

    this.elapsedTime = performance.now() - this.startTime;
    this.renderDisplay(this.elapsedTime);

    this.animationFrameId = requestAnimationFrame(() => this.updateLoop());
  },

  renderDisplay(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSecs / 60);
    const seconds = totalSecs % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);

    document.getElementById('sw-minutes').textContent = String(minutes).padStart(2, '0');
    document.getElementById('sw-seconds').textContent = String(seconds).padStart(2, '0');
    document.getElementById('sw-milliseconds').textContent = String(milliseconds).padStart(2, '0');
  },

  formatMs(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSecs / 60);
    const seconds = totalSecs % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}`;
  },

  renderLaps() {
    const lapsList = document.getElementById('sw-laps-list');
    lapsList.innerHTML = '';

    if (this.laps.length === 0) return;

    let bestLapTime = Infinity;
    let worstLapTime = -1;

    if (this.laps.length > 1) {
      this.laps.forEach(l => {
        if (l.lapTime < bestLapTime) bestLapTime = l.lapTime;
        if (l.lapTime > worstLapTime) worstLapTime = l.lapTime;
      });
    }

    this.laps.forEach(lap => {
      const item = document.createElement('div');
      item.className = 'lap-item';

      if (this.laps.length > 1) {
        if (lap.lapTime === bestLapTime) item.classList.add('best-lap');
        else if (lap.lapTime === worstLapTime) item.classList.add('worst-lap');
      }

      item.innerHTML = `
        <span>Lap ${lap.lapNum}</span>
        <span>${this.formatMs(lap.lapTime)}</span>
        <span>${this.formatMs(lap.totalTime)}</span>
      `;

      lapsList.appendChild(item);
    });
  }
};

/* ==========================================================================
   6. TIMER MODULE
   ========================================================================== */
const TimerModule = {
  parent: null,
  totalSeconds: 300,
  remainingSeconds: 300,
  isRunning: false,
  timerInterval: null,
  ringCircumference: 691,

  init(parent) {
    this.parent = parent;
    this.populateTimeDropdowns();
    this.setupEventListeners();
    this.updateDisplay();
  },

  populateTimeDropdowns() {
    const hoursSelect = document.getElementById('timer-hours');
    const minsSelect = document.getElementById('timer-minutes');
    const secsSelect = document.getElementById('timer-seconds');

    for (let h = 0; h <= 23; h++) {
      hoursSelect.options.add(new Option(String(h).padStart(2, '0'), h));
    }
    for (let m = 0; m <= 59; m++) {
      minsSelect.options.add(new Option(String(m).padStart(2, '0'), m));
    }
    for (let s = 0; s <= 59; s++) {
      secsSelect.options.add(new Option(String(s).padStart(2, '0'), s));
    }

    hoursSelect.value = 0;
    minsSelect.value = 5;
    secsSelect.value = 0;
  },

  setupEventListeners() {
    const startBtn = document.getElementById('timer-start-btn');
    const resetBtn = document.getElementById('timer-reset-btn');

    startBtn.addEventListener('click', () => {
      if (this.isRunning) {
        this.pause();
      } else {
        this.start();
      }
    });

    resetBtn.addEventListener('click', () => this.reset());

    ['timer-hours', 'timer-minutes', 'timer-seconds'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        this.readInputValues();
      });
    });

    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const addSecs = btn.getAttribute('data-add');
        if (addSecs) {
          this.remainingSeconds += parseInt(addSecs);
          if (!this.isRunning) this.totalSeconds = this.remainingSeconds;
          this.updateDisplay();
        }
      });
    });

    document.getElementById('timer-clear-chip').addEventListener('click', () => {
      this.reset();
      this.totalSeconds = 0;
      this.remainingSeconds = 0;
      this.updateDisplay();
    });
  },

  readInputValues() {
    if (this.isRunning) return;
    const h = parseInt(document.getElementById('timer-hours').value) || 0;
    const m = parseInt(document.getElementById('timer-minutes').value) || 0;
    const s = parseInt(document.getElementById('timer-seconds').value) || 0;

    this.totalSeconds = h * 3600 + m * 60 + s;
    this.remainingSeconds = this.totalSeconds;
    this.updateDisplay();
  },

  start() {
    if (this.remainingSeconds <= 0) return;
    AudioSynth.init();

    this.isRunning = true;
    const startBtn = document.getElementById('timer-start-btn');
    startBtn.textContent = 'Pause';
    startBtn.className = 'btn-circle btn-pause';

    document.getElementById('timer-input-group').style.display = 'none';

    this.timerInterval = setInterval(() => {
      this.remainingSeconds--;
      this.updateDisplay();

      if (this.remainingSeconds <= 0) {
        this.onTimerComplete();
      }
    }, 1000);
  },

  pause() {
    this.isRunning = false;
    clearInterval(this.timerInterval);

    const startBtn = document.getElementById('timer-start-btn');
    startBtn.textContent = 'Resume';
    startBtn.className = 'btn-circle btn-start';
  },

  reset() {
    this.pause();
    this.readInputValues();

    const startBtn = document.getElementById('timer-start-btn');
    startBtn.textContent = 'Start';
    startBtn.className = 'btn-circle btn-start';

    document.getElementById('timer-input-group').style.display = 'flex';
  },

  onTimerComplete() {
    this.pause();
    this.remainingSeconds = 0;
    this.updateDisplay();

    AudioSynth.startAlarmLoop('chime');

    const ringOverlay = document.getElementById('alarm-ring-overlay');
    document.getElementById('ring-time').textContent = '00:00:00';
    document.getElementById('ring-label').textContent = 'Timer Finished!';
    ringOverlay.classList.add('active');

    if ('vibrate' in navigator) {
      navigator.vibrate([400, 200, 400, 200, 400]);
    }
  },

  updateDisplay() {
    const h = Math.floor(this.remainingSeconds / 3600);
    const m = Math.floor((this.remainingSeconds % 3600) / 60);
    const s = this.remainingSeconds % 60;

    let text = '';
    if (h > 0) {
      text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
      text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    document.getElementById('timer-digits').textContent = text;
    document.getElementById('timer-sublabel').textContent = this.isRunning ? 'Countdown' : 'Set Time';

    const circle = document.getElementById('timer-circle-progress');
    if (this.totalSeconds > 0) {
      const progressFraction = Math.max(0, this.remainingSeconds / this.totalSeconds);
      const dashOffset = this.ringCircumference * (1 - progressFraction);
      circle.style.strokeDashoffset = dashOffset;
    } else {
      circle.style.strokeDashoffset = 0;
    }
  }
};

/* ==========================================================================
   7. PWA SERVICE WORKER REGISTRATION
   ========================================================================== */
const PwaModule = {
  init() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(registration => {
            console.log('[PWA] Service Worker registered:', registration.scope);
          })
          .catch(error => {
            console.warn('[PWA] Service Worker registration failed:', error);
          });
      });
    }
  }
};
