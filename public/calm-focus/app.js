// ------- МОДЕЛЬ РЕЖИМОВ -------
    const presets = {
      box: {
        name: "Коробочное 4-4-4-4",
        description: "Равномерный квадрат дыхания: помогает быстро успокоить нервную систему и вернуть концентрацию.",
        tags: ["Антистресс", "Ровный ритм"],
        phases: [4,4,4,4]
      },
      "478": {
        name: "4-7-8 (успокоение)",
        description: "Популярная вечерняя техника: удлинённый выдох активирует парасимпатическую систему и снижает напряжение.",
        tags: ["Сон", "Расслабление"],
        phases: [4,7,8,0]
      },
      coherent: {
        name: "Когерентное 5-5 (фокус)",
        description: "Синхронизирует дыхание и сердечный ритм, мягко повышая собранность и устойчивое внимание.",
        tags: ["Фокус", "Энергия"],
        phases: [5,0,5,0]
      }
    };
    const customInfo = {
      name: "Свой ритм",
      description: "Соберите подходящий вам цикл. Можно использовать дробные значения и отключать паузы, устанавливая их в 0 секунд.",
      tags: ["Персонально"]
    };
    const phaseLabels = [
      "Вдох",
      "Задержка на вдохе",
      "Выдох",
      "Задержка на выдохе"
    ];

    // ------- ЭЛЕМЕНТЫ UI -------
    const selMode   = document.getElementById('mode');
    const selSess   = document.getElementById('session');
    const chkSound  = document.getElementById('sound');
    const chkHap    = document.getElementById('haptics');
    const customBox = document.getElementById('customFields');
    const cIn  = document.getElementById('cIn');
    const cH1  = document.getElementById('cH1');
    const cOut = document.getElementById('cOut');
    const cH2  = document.getElementById('cH2');

    const btnStart = document.getElementById('start');
    const btnFinish = document.getElementById('finish');
    const btnSaveCustom = document.getElementById('saveCustom');
    const btnDeleteCustom = document.getElementById('deleteCustom');
    const btnTogglePanel = document.getElementById('togglePanel');
    const controlsPanel = document.querySelector('.controls');
    const customPanel = document.getElementById('customFields');
    const appRoot = document.querySelector('.app');

    const elPhase = document.getElementById('phase');
    const elSub   = document.getElementById('sub');
    const elBar   = document.getElementById('progress');
    const elBarTrack = document.getElementById('progressTrack');
    const ariaPhase = document.getElementById('ariaPhase');
    const elModeTitle = document.getElementById('modeInfoTitle');
    const elModeDesc = document.getElementById('modeInfoDesc');
    const elModeSteps = document.getElementById('modeSteps');
    const elModeTags = document.getElementById('modeTags');
    const customInputs = [cIn, cH1, cOut, cH2];
    const savedGroup = document.getElementById('savedModesGroup');
    const elGraphArea = document.getElementById('graphArea');
    const elGraphLine = document.getElementById('graphLine');
    const elGraphLineActive = document.getElementById('graphLineActive');
    const elGraphDot = document.getElementById('graphDot');

    // ------- СОСТОЯНИЕ -------
    const GRAPH_W = 100;
    const GRAPH_Y_BOTTOM = 82;
    const GRAPH_Y_TOP = 18;
    let running = false;
    let phaseIdx = 0;      // 0: inhale, 1: hold1, 2: exhale, 3: hold2
    let phaseElapsed = 0;  // ms
    let lastTick = 0;
    let totalMs = 0;
    let sessionTarget = 0; // ms
    let tickHandle = null;
    let toneFadeTimer = null;
    let graphPoints = [];
    let isPanelVisible = true;

    // audio
    const soundEngine = (() => {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        return {
          phaseCue() {},
          mute() {},
          complete() {}
        };
      }
      let ctx = null;
      let masterGain = null;
      let unlocking = false;
      let unlocked = false;
      function ensureCtx() {
        if (!ctx) {
          ctx = new AudioCtor();
          masterGain = ctx.createGain();
          masterGain.gain.value = 0.38;
          masterGain.connect(ctx.destination);
        }
      }
      function unlock() {
        ensureCtx();
        if (!ctx || unlocked) return;
        if (ctx.state === 'running') {
          unlocked = true;
          return;
        }
        if (!unlocking) {
          unlocking = true;
          ctx.resume().then(() => {
            unlocked = true;
            unlocking = false;
          }).catch(() => {
            unlocking = false;
          });
        }
      }
      function createCue(freq, { duration = 1.4, peak = 0.12, delay = 0 } = {}) {
        ensureCtx();
        unlock();
        const now = ctx.currentTime;
        const startAt = now + delay;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        osc.connect(gain);
        gain.connect(masterGain);
        gain.gain.linearRampToValueAtTime(peak, startAt + 0.18);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.1);
      }
      function playPhaseCue(idx) {
        if (!chkSound.checked) return;
        const freqMap = [432, 396, 352, 320];
        createCue(freqMap[idx] || 392, { duration: 1.5, peak: 0.11 });
      }
      function playCompleteCue() {
        if (!chkSound.checked) return;
        createCue(512, { duration: 1.8, peak: 0.12 });
        createCue(640, { duration: 2.1, peak: 0.1, delay: 0.22 });
      }
      return {
        phaseCue(idx) { playPhaseCue(idx); },
        mute() {},
        complete() { playCompleteCue(); },
        unlock
      };
    })();

    const supportsVibration = 'vibrate' in navigator && typeof navigator.vibrate === 'function';
    if (!supportsVibration) {
      chkHap.checked = false;
      chkHap.disabled = true;
      const hapOpt = chkHap.closest('.opt');
      if (hapOpt) {
        hapOpt.classList.add('disabled');
        hapOpt.setAttribute('title', 'Вибрация недоступна на этом устройстве');
      }
    }

    const calmDb = (() => {
      const DB_NAME = 'calm_focus_db';
      const DB_VERSION = 1;
      const LEGACY_KEYS = {
        settings: 'cf_breath_v1',
        presets: 'cf_saved_modes_v1',
        stats: 'cf_stats_v2',
        oldStats: 'cf_stats_v1',
        migration: 'cf_idb_migrated_v1',
        sessionFallback: 'cf_sessions_v1'
      };
      let dbPromise = null;

      function isSupported() {
        return 'indexedDB' in window;
      }

      function open() {
        if (!isSupported()) return Promise.reject(new Error('IndexedDB is unavailable'));
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('sessions')) {
              const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
              sessions.createIndex('startedAt', 'startedAt');
              sessions.createIndex('day', 'day');
              sessions.createIndex('modeId', 'modeId');
            }
            if (!db.objectStoreNames.contains('presets')) {
              const presetsStore = db.createObjectStore('presets', { keyPath: 'id' });
              presetsStore.createIndex('name', 'name');
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return dbPromise;
      }

      function readLegacyJson(key, fallback) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key));
          return parsed ?? fallback;
        } catch {
          return fallback;
        }
      }

      function createId(prefix = 'id') {
        if (crypto.randomUUID) return crypto.randomUUID();
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }

      function transaction(storeName, mode, callback) {
        return open().then(db => new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const storeRef = tx.objectStore(storeName);
          const result = callback(storeRef);
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }));
      }

      function getAll(storeName) {
        if (!isSupported()) return Promise.resolve([]);
        return open().then(db => new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const request = tx.objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        })).catch(() => []);
      }

      function putAll(storeName, list) {
        if (!isSupported()) return Promise.resolve();
        return transaction(storeName, 'readwrite', storeRef => {
          list.forEach(item => storeRef.put(item));
        }).catch(() => {});
      }

      function clearAndPut(storeName, list) {
        if (!isSupported()) return Promise.resolve();
        return transaction(storeName, 'readwrite', storeRef => {
          storeRef.clear();
          list.forEach(item => storeRef.put(item));
        }).catch(() => {});
      }

      function normalizePreset(item) {
        return {
          id: String(item.id || ''),
          name: String(item.name || '').trim(),
          phases: sanitizePhases(item.phases)
        };
      }

      function normalizeSession(item) {
        const startedAt = Number(item.startedAt) || Date.now();
        const durationMs = Math.max(0, Number(item.durationMs ?? item.elapsedMs) || 0);
        return {
          id: String(item.id || createId('session')),
          startedAt,
          day: item.day || new Date(startedAt).toISOString().slice(0, 10),
          durationMs,
          modeId: String(item.modeId || ''),
          modeName: String(item.modeName || ''),
          pattern: sanitizePhases(item.pattern || [4, 0, 4, 0]),
          completed: item.completed !== false
        };
      }

      function readLegacyPresets() {
        const raw = readLegacyJson(LEGACY_KEYS.presets, []);
        if (!Array.isArray(raw)) return [];
        return raw.map(normalizePreset).filter(item => item.id && item.name);
      }

      function readLegacyStatsSession() {
        const raw = readLegacyJson(LEGACY_KEYS.stats, null) || readLegacyJson(LEGACY_KEYS.oldStats, null);
        if (!raw) return null;
        const totalMinutes = Math.round(Math.max(0, Number(raw.totalMinutes ?? raw.total) || 0));
        if (!totalMinutes) return null;
        const lastDay = typeof raw.lastDay === 'string' && raw.lastDay ? raw.lastDay : new Date().toISOString().slice(0, 10);
        const startedAt = new Date(`${lastDay}T12:00:00`).getTime() || Date.now();
        return normalizeSession({
          id: 'legacy-total-minutes',
          startedAt,
          day: lastDay,
          durationMs: totalMinutes * 60000,
          modeId: 'legacy',
          modeName: 'Импортированная статистика',
          pattern: [4, 0, 4, 0],
          completed: true
        });
      }

      function readFallbackSessions() {
        const raw = readLegacyJson(LEGACY_KEYS.sessionFallback, []);
        return Array.isArray(raw) ? raw.map(normalizeSession) : [];
      }

      function writeFallbackSessions(list) {
        localStorage.setItem(LEGACY_KEYS.sessionFallback, JSON.stringify(list.map(normalizeSession)));
      }

      async function migrateLegacyData() {
        if (localStorage.getItem(LEGACY_KEYS.migration) === 'done') return;
        const [sessions, presetsList] = await Promise.all([
          getAll('sessions'),
          getAll('presets')
        ]);
        const legacySession = sessions.length ? null : readLegacyStatsSession();
        const legacyPresets = presetsList.length ? [] : readLegacyPresets();
        if (legacySession) await putAll('sessions', [legacySession]);
        if (legacyPresets.length) await putAll('presets', legacyPresets);
        localStorage.setItem(LEGACY_KEYS.migration, 'done');
      }

      async function requestPersistence() {
        if (!navigator.storage?.persist) return;
        try {
          await navigator.storage.persist();
        } catch {}
      }

      return {
        LEGACY_KEYS,
        async init() {
          if (!isSupported()) return;
          await open();
          await migrateLegacyData();
          requestPersistence();
        },
        async getPresets() {
          if (!isSupported()) return readLegacyPresets();
          await migrateLegacyData();
          return (await getAll('presets')).map(normalizePreset).filter(item => item.id && item.name);
        },
        async savePresets(list) {
          const normalized = list.map(normalizePreset).filter(item => item.id && item.name);
          localStorage.setItem(LEGACY_KEYS.presets, JSON.stringify(normalized));
          if (isSupported()) await clearAndPut('presets', normalized);
        },
        async getSessions() {
          if (!isSupported()) return readFallbackSessions();
          await migrateLegacyData();
          return (await getAll('sessions')).map(normalizeSession);
        },
        async addSession(session) {
          const normalized = normalizeSession(session);
          if (!isSupported()) {
            const current = readFallbackSessions();
            current.push(normalized);
            writeFallbackSessions(current);
            return normalized;
          }
          await putAll('sessions', [normalized]);
          return normalized;
        }
      };
    })();

    const savedModesStore = {
      async read() {
        return calmDb.getPresets();
      },
      async write(list) {
        return calmDb.savePresets(list);
      }
    };
    let savedModes = [];

    function getSavedMode(modeKey) {
      if (typeof modeKey !== 'string' || !modeKey.startsWith('saved:')) return null;
      const id = modeKey.slice(6);
      return savedModes.find(mode => mode.id === id) || null;
    }

    function renderSavedOptions(nextValue) {
      if (!savedGroup) return;
      const valueToRestore = nextValue || selMode.value;
      savedGroup.innerHTML = '';
      if (!savedModes.length) {
        savedGroup.setAttribute('hidden', '');
        savedGroup.style.display = 'none';
      } else {
        savedGroup.removeAttribute('hidden');
        savedGroup.style.display = '';
        savedModes
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
          .forEach(mode => {
            const opt = document.createElement('option');
            opt.value = `saved:${mode.id}`;
            opt.textContent = mode.name;
            savedGroup.appendChild(opt);
          });
      }
      if (valueToRestore && selMode.querySelector(`option[value="${valueToRestore}"]`)) {
        selMode.value = valueToRestore;
      } else if (!selMode.querySelector(`option[value="${selMode.value}"]`)) {
        selMode.value = 'custom';
      }
      updateDeleteButtonVisibility();
    }

    // ------- ХРАНИЛКА -------
    const store = {
      save() {
        const data = {
          mode: selMode.value,
          session: selSess.value,
          sound: chkSound.checked,
          haptics: chkHap.checked,
          custom: [cIn.valueAsNumber, cH1.valueAsNumber, cOut.valueAsNumber, cH2.valueAsNumber],
          panelHidden: !isPanelVisible
        };
        localStorage.setItem('cf_breath_v1', JSON.stringify(data));
      },
      load() {
        const raw = localStorage.getItem('cf_breath_v1');
        if (!raw) return;
        try {
          const d = JSON.parse(raw);
          if (d.mode) selMode.value = d.mode;
          if (!selMode.querySelector(`option[value="${selMode.value}"]`)) {
            selMode.value = 'custom';
          }
          if (d.session) selSess.value = d.session;
          if (typeof d.sound === 'boolean') chkSound.checked = d.sound;
          if (typeof d.haptics === 'boolean' && supportsVibration) chkHap.checked = d.haptics;
          if (Array.isArray(d.custom) && d.custom.length === 4) {
            [cIn.value, cH1.value, cOut.value, cH2.value] = d.custom.map(n => Math.max(0, Number(n)||0));
          }
          if (typeof d.panelHidden === 'boolean') {
            isPanelVisible = !d.panelHidden;
          }
        } catch {}
        toggleCustom();
        if (selMode.value !== 'custom') {
          const meta = getModeMeta(selMode.value);
          setCustomInputs(meta.phases);
        }
        updateModeInfo();
        applyPanelState();
      }
    };

    // ------- СТАТИСТИКА -------
    const stats = {
      key: 'cf_stats_v2',
      legacyKey: 'cf_stats_v1',
      read() {
        const fallback = { totalMinutes: 0, todayMinutes: 0, lastDay: '' };
        const parse = (raw) => {
          if (!raw) return null;
          try { return JSON.parse(raw); }
          catch { return null; }
        };
        const raw = localStorage.getItem(this.key);
        let state = parse(raw);
        if (state) {
          state = {
            totalMinutes: Number(state.totalMinutes) > 0 ? Number(state.totalMinutes) : 0,
            todayMinutes: Number(state.todayMinutes) > 0 ? Number(state.todayMinutes) : 0,
            lastDay: typeof state.lastDay === 'string' ? state.lastDay : ''
          };
        } else {
          const legacyRaw = localStorage.getItem(this.legacyKey);
          const legacy = parse(legacyRaw);
          if (legacy) {
            state = {
              totalMinutes: Number(legacy.totalMinutes ?? legacy.total) || 0,
              todayMinutes: Number(legacy.todayMinutes ?? legacy.today) || 0,
              lastDay: typeof legacy.lastDay === 'string' ? legacy.lastDay : ''
            };
          } else {
            state = { ...fallback };
          }
        }
        state.totalMinutes = Math.round(Math.max(0, Number(state.totalMinutes) || 0));
        state.todayMinutes = Math.round(Math.max(0, Number(state.todayMinutes) || 0));

        const today = new Date().toISOString().slice(0,10);
        if (state.lastDay !== today) {
          state.lastDay = today;
          state.todayMinutes = 0;
          this.write(state);
        }
        return state;
      },
      write(s) {
        localStorage.setItem(this.key, JSON.stringify(s));
        localStorage.removeItem(this.legacyKey);
      },
      async readFromSessions() {
        const sessions = await calmDb.getSessions();
        const today = new Date().toISOString().slice(0, 10);
        return sessions.reduce((acc, session) => {
          const minutes = Math.round(Math.max(0, Number(session.durationMs) || 0) / 60000);
          acc.totalMinutes += minutes;
          if (session.day === today) acc.todayMinutes += minutes;
          return acc;
        }, { totalMinutes: 0, todayMinutes: 0, lastDay: today });
      },
      async addSession(session) {
        const durationMs = Math.max(0, Number(session.durationMs) || 0);
        if (Math.round(durationMs / 60000) <= 0) return;
        await calmDb.addSession(session);
        renderStats();
      }
    };
    async function renderStats() {
      const s = await stats.readFromSessions();
      document.getElementById('statToday').textContent = `Сегодня: ${formatMinutes(s.todayMinutes)}`;
      document.getElementById('statTotal').textContent = `Всего: ${formatMinutes(s.totalMinutes)}`;
    }

    // ------- УТИЛИТЫ -------
    const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
    const nfFrac = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    function formatValue(val) {
      if (!Number.isFinite(val)) return '—';
      const rounded = Math.round(val * 10) / 10;
      if (Math.abs(rounded - Math.round(rounded)) < 1e-4) {
        return nfInt.format(Math.round(rounded));
      }
      return nfFrac.format(rounded);
    }
    function formatMinutes(val) {
      const safe = Math.max(0, Number(val) || 0);
      const whole = Math.round(safe);
      return `${nfInt.format(whole)} мин`;
    }
    function isEditableTarget(node) {
      if (!node) return false;
      let el = node;
      if (!(el instanceof Element)) {
        el = el.parentElement;
      }
      while (el && !(el instanceof Element)) {
        el = el.parentElement;
      }
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (!tag) return false;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    }
    function toFourArray(phases) {
      const arr = Array.from(phases || []).slice(0, 4);
      while (arr.length < 4) arr.push(0);
      return arr;
    }
    function clampPhaseValue(val) {
      const num = Number(val);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.round(num * 100) / 100);
    }
    function sanitizePhases(phases) {
      const clean = toFourArray(phases).map(clampPhaseValue);
      const total = clean.reduce((sum, val) => sum + val, 0);
      if (total <= 0) {
        clean[0] = 4;
        clean[2] = 4;
      }
      return clean;
    }
    function getCustomInputValues() {
      return customInputs.map(input => clampPhaseValue(input.value));
    }
    function toInputString(num) {
      const rounded = clampPhaseValue(num);
      if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded));
      return rounded.toString();
    }
    function setCustomInputs(phases) {
      const values = toFourArray(phases).map(clampPhaseValue);
      customInputs.forEach((input, idx) => {
        input.value = toInputString(values[idx] || 0);
      });
    }
    function renderTags(tags) {
      elModeTags.textContent = '';
      tags.forEach(text => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = text;
        elModeTags.appendChild(span);
      });
    }
    function formatSteps(pattern) {
      const steps = pattern
        .map((dur, idx) => dur > 0 ? `${phaseLabels[idx]} ${formatValue(dur)} с` : null)
        .filter(Boolean);
      return steps.length ? steps.join(' → ') : 'Добавьте длительности фаз, чтобы построить ритм.';
    }
    function getModeMeta(key) {
      const fallback = {
        name: customInfo.name,
        description: customInfo.description,
        tags: customInfo.tags,
        phases: sanitizePhases(getCustomInputValues())
      };
      if (key === 'custom') return fallback;
      if (presets[key]) {
        const preset = presets[key];
        return {
          name: preset.name,
          description: preset.description,
          tags: preset.tags,
          phases: sanitizePhases(preset.phases)
        };
      }
      const saved = getSavedMode(key);
      if (saved) {
        return {
          name: saved.name,
          description: 'Сохранённый пользовательский ритм дыхания.',
          tags: ['Мой режим'],
          phases: sanitizePhases(saved.phases)
        };
      }
      return fallback;
    }
    function buildGraphData(patternSec) {
      const durations = patternSec.map(n => Math.max(0, Number(n) || 0));
      let total = durations.reduce((sum, val) => sum + val, 0);
      if (total <= 0) {
        total = 1;
      }
      const linePoints = [];
      let x = 0;
      let y = GRAPH_Y_BOTTOM;
      linePoints.push({ x, y });
      durations.forEach((dur, idx) => {
        if (dur <= 0) return;
        x += (dur / total) * GRAPH_W;
        x = Math.min(GRAPH_W, x);
        if (idx === 0) {
          y = GRAPH_Y_TOP;
        } else if (idx === 2) {
          y = GRAPH_Y_BOTTOM;
        } // holds keep current y
        linePoints.push({ x, y });
      });
      if (linePoints[linePoints.length - 1].x < GRAPH_W) {
        linePoints.push({ x: GRAPH_W, y });
      }
      if (linePoints[linePoints.length - 1].y !== GRAPH_Y_BOTTOM) {
        linePoints.push({ x: GRAPH_W, y: GRAPH_Y_BOTTOM });
      }
      return {
        linePoints,
        durations,
        total
      };
    }
    function renderGraph(patternSec) {
      const data = buildGraphData(patternSec);
      graphPoints = data.linePoints.map(p => ({ x: p.x, y: p.y }));
      const lineStr = graphPoints.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      const areaStr = `${lineStr} ${GRAPH_W.toFixed(2)},${GRAPH_Y_BOTTOM.toFixed(2)} ${GRAPH_W.toFixed(2)},100 0,100`;
      elGraphLine.setAttribute('points', lineStr);
      if (graphPoints.length) {
        elGraphLineActive.setAttribute('points', `${graphPoints[0].x.toFixed(2)},${graphPoints[0].y.toFixed(2)}`);
      }
      elGraphArea.setAttribute('points', areaStr);
    }
    function getGraphPoint(patternSec, progress) {
      const durations = patternSec.map(n => Math.max(0, Number(n) || 0));
      const total = durations.reduce((sum, val) => sum + val, 0);
      if (total <= 0) {
        return { x: 0, y: GRAPH_Y_BOTTOM };
      }
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const target = clampedProgress * total;
      let passed = 0;
      for (let i = 0; i < durations.length; i += 1) {
        const dur = durations[i];
        if (dur <= 0) continue;
        if (target <= passed + dur + 1e-6) {
          const localT = Math.max(0, Math.min(1, (target - passed) / dur));
          let y;
          if (i === 0) {
            y = GRAPH_Y_BOTTOM - (GRAPH_Y_BOTTOM - GRAPH_Y_TOP) * localT;
          } else if (i === 2) {
            y = GRAPH_Y_TOP + (GRAPH_Y_BOTTOM - GRAPH_Y_TOP) * localT;
          } else {
            y = i === 1 ? GRAPH_Y_TOP : GRAPH_Y_BOTTOM;
          }
          return { x: clampedProgress * GRAPH_W, y };
        }
        passed += dur;
      }
      return { x: GRAPH_W, y: GRAPH_Y_BOTTOM };
    }
    function updateGraphIndicator(patternSec, progress) {
      const { x, y } = getGraphPoint(patternSec, progress);
      elGraphDot.setAttribute('cx', x.toFixed(2));
      elGraphDot.setAttribute('cy', y.toFixed(2));
      const clamped = Math.max(0, Math.min(1, progress));
      if (graphPoints.length <= 1) {
        elGraphLineActive.setAttribute('points', `${x.toFixed(2)},${y.toFixed(2)}`);
        return;
      }
      const active = [];
      const targetX = clamped * GRAPH_W;
      active.push({ x: graphPoints[0].x, y: graphPoints[0].y });
      for (let i = 0; i < graphPoints.length - 1; i += 1) {
        const start = graphPoints[i];
        const end = graphPoints[i + 1];
        if (targetX >= end.x - 0.001) {
          active.push({ x: end.x, y: end.y });
          continue;
        }
        const spanX = end.x - start.x;
        const spanY = end.y - start.y;
        let ratio;
        if (Math.abs(spanX) < 0.0001) {
          ratio = clamped >= end.x / GRAPH_W ? 1 : 0;
        } else {
          ratio = Math.max(0, Math.min(1, (targetX - start.x) / spanX));
        }
        const partialX = start.x + spanX * ratio;
        const partialY = start.y + spanY * ratio;
        active.push({ x: partialX, y: partialY });
        break;
      }
      const activeStr = active.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      elGraphLineActive.setAttribute('points', activeStr);
    }
    function updateDeleteButtonVisibility() {
      if (!btnDeleteCustom) return;
      if (selMode.value && selMode.value.startsWith('saved:') && getSavedMode(selMode.value)) {
        btnDeleteCustom.style.display = '';
      } else {
        btnDeleteCustom.style.display = 'none';
      }
    }
    function applyPanelState() {
      if (!btnTogglePanel || !appRoot) return;
      btnTogglePanel.textContent = isPanelVisible ? 'Скрыть настройки' : 'Показать настройки';
      btnTogglePanel.setAttribute('aria-expanded', String(isPanelVisible));
      if (controlsPanel) controlsPanel.setAttribute('aria-hidden', String(!isPanelVisible));
      if (customPanel) customPanel.setAttribute('aria-hidden', String(!isPanelVisible || customPanel.dataset.customVisible !== 'true'));
      if (isPanelVisible) {
        appRoot.classList.remove('collapsed');
      } else {
        appRoot.classList.add('collapsed');
      }
    }
    function updateModeInfo() {
      const info = getModeMeta(selMode.value);
      elModeTitle.textContent = info.name;
      elModeDesc.textContent = info.description;
      const pattern = info.phases.slice();
      elModeSteps.textContent = formatSteps(pattern);
      const total = pattern.reduce((sum, val) => sum + Math.max(0, Number(val) || 0), 0);
      const tagList = [...(info.tags || [])];
      if (total > 0.0001) {
        tagList.push(`Цикл: ${formatValue(total)} с`);
        tagList.push(`~${formatValue(60 / total)} дыхания/мин`);
      } else {
        tagList.push('Цикл: —');
      }
      const sessionMin = Number(selSess.value) || 0;
      if (sessionMin) tagList.push(`Сессия: ${sessionMin} мин`);
      renderTags(tagList);
      renderGraph(pattern);
      updateGraphIndicator(pattern, 0);
      updateDeleteButtonVisibility();
    }
    function getPattern() {
      return getModeMeta(selMode.value).phases.slice();
    }
    function ms(sec){ return sec * 1000; }
    function buzz() {
      if (chkHap.checked && supportsVibration) navigator.vibrate(20);
    }
    function setPhaseLabel(idx, seconds) {
      const titles = ['Вдох', 'Задержка', 'Выдох', 'Задержка'];
      const hints = [
        'Наберите воздух через нос',
        'Сохраняйте мягкое внимание за вдохом',
        'Плавно отпускайте воздух через нос или рот',
        'Почувствуйте паузу и расслабление'
      ];
      const label = titles[idx] || '';
      elPhase.textContent = label;
      ariaPhase.textContent = label;
      if (seconds === undefined) {
        elSub.textContent = hints[idx] || '';
        return;
      }
      const sec = Number(seconds);
      const hasDuration = Number.isFinite(sec) && sec > 0;
      const hint = hints[idx] || '';
      if (!hasDuration) {
        elSub.textContent = hint;
        return;
      }
      const durationLabel = `${formatValue(sec)} с`;
      elSub.textContent = hint ? `${hint} · ${durationLabel}` : durationLabel;
    }
    function setButtons() {
      btnStart.textContent = running ? 'Пауза' : 'Старт';
      btnFinish.disabled = totalMs < 1000;
    }

    // ------- ЦИКЛ -------
    function start() {
      if (running) return;
      if (toneFadeTimer) {
        clearTimeout(toneFadeTimer);
        toneFadeTimer = null;
      }
      // инициализация
      const sessionMin = Number(selSess.value) || 3;
      sessionTarget = ms(sessionMin*60);
      totalMs = totalMs || 0;
      lastTick = performance.now();
      if (totalMs === 0) { // новая сессия
        phaseIdx = 0;
        phaseElapsed = 0;
        const patternSec = getPattern();
        updateGraphIndicator(patternSec, 0);
        setPhaseLabel(phaseIdx, patternSec[phaseIdx]);
        soundEngine.phaseCue(phaseIdx);
        buzz();
      }
      running = true;
      setButtons();
      tickHandle = requestAnimationFrame(loop);
    }
    function pause(options = {}) {
      running = false;
      setButtons();
      if (tickHandle) cancelAnimationFrame(tickHandle);
      if (toneFadeTimer) {
        clearTimeout(toneFadeTimer);
        toneFadeTimer = null;
      }
      if (!options.keepSound) soundEngine.mute();
    }
    function reset() {
      pause();
      totalMs = 0; phaseIdx = 0; phaseElapsed = 0;
      elBar.style.width = '0%';
      if (elBarTrack) elBarTrack.setAttribute('aria-valuenow', '0');
      updateGraphIndicator(getPattern(), 0);
      elPhase.textContent = 'Готовы?';
      elSub.textContent = 'Выберите режим и нажмите Старт';
      setButtons();
    }
    function finish() {
      if (totalMs <= 0) {
        reset();
        return;
      }
      const elapsedMs = totalMs;
      const finishedMode = getModeMeta(selMode.value);
      const finishedPattern = finishedMode.phases.slice();
      const startedAt = Date.now() - Math.round(elapsedMs);
      pause({ keepSound: true });
      soundEngine.complete();
      stats.addSession({
        id: crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now().toString(36)}`,
        startedAt,
        day: new Date(startedAt).toISOString().slice(0, 10),
        durationMs: elapsedMs,
        modeId: selMode.value,
        modeName: finishedMode.name,
        pattern: finishedPattern,
        completed: true
      });
      elPhase.textContent = 'Готово ✔';
      ariaPhase.textContent = 'Готово';
      elSub.textContent = 'Отметьте ощущения и плавно вернитесь к делам';
      totalMs = 0;
      phaseIdx = 0;
      phaseElapsed = 0;
      elBar.style.width = '0%';
      if (elBarTrack) elBarTrack.setAttribute('aria-valuenow', '0');
      updateGraphIndicator(getPattern(), 0);
      setButtons();
      if (toneFadeTimer) clearTimeout(toneFadeTimer);
      toneFadeTimer = setTimeout(() => {
        soundEngine.mute();
        toneFadeTimer = null;
      }, 1300);
    }
    function loop(now) {
      if (!running) return;
      const dt = Math.min(100, now - lastTick); // защита от вкладок в фоне
      lastTick = now;
      const patternSec = getPattern();
      const pattern = patternSec.map(ms);
      const curDur = Math.max(1, pattern[phaseIdx]);
      phaseElapsed += dt;
      totalMs += dt;

      setPhaseLabel(phaseIdx, patternSec[phaseIdx]);
      const cycleTotal = pattern.reduce((sum, val) => sum + Math.max(0, val), 0);
      if (cycleTotal > 0) {
        const prior = pattern.slice(0, phaseIdx).reduce((sum, val) => sum + Math.max(0, val), 0);
        const cycleProgress = Math.max(0, Math.min(1, (prior + phaseElapsed) / cycleTotal));
        updateGraphIndicator(patternSec, cycleProgress);
      } else {
        updateGraphIndicator(patternSec, 0);
      }

      // прогресс сессии
      const sessionProgress = Math.min(100, (totalMs / sessionTarget)*100);
      elBar.style.width = `${sessionProgress}%`;
      if (elBarTrack) {
        elBarTrack.setAttribute('aria-valuenow', sessionProgress.toFixed(0));
      }

      setButtons();

      // переход фазы
      if (phaseElapsed >= curDur) {
        phaseElapsed = 0;
        phaseIdx = (phaseIdx + 1) % 4;
        // если фаза с нулевой длительностью — шагнем дальше
        let safety = 0;
        while (pattern[phaseIdx] <= 1 && safety++ < 4) {
          phaseIdx = (phaseIdx + 1) % 4;
        }
        soundEngine.phaseCue(phaseIdx);
        buzz();
      }
      // окончание сессии
      if (totalMs >= sessionTarget) {
        finish();
        return;
      }
      tickHandle = requestAnimationFrame(loop);
    }

    // ------- СВЯЗИ UI -------
    function toggleCustom() {
      const isCustom = selMode.value === 'custom' || selMode.value.startsWith('saved:');
      customPanel.style.display = isCustom ? 'block' : 'none';
      customPanel.dataset.customVisible = isCustom ? 'true' : 'false';
    }

    selMode.addEventListener('change', () => {
      toggleCustom();
      if (selMode.value !== 'custom') {
        const info = getModeMeta(selMode.value);
        setCustomInputs(info.phases);
      }
      store.save();
      reset();
      updateModeInfo();
    });
    selSess.addEventListener('change', () => {
      store.save();
      reset();
      updateModeInfo();
    });
    chkSound.addEventListener('change', () => {
      store.save();
      if (!chkSound.checked) {
        soundEngine.mute();
      } else {
        soundEngine.unlock();
        if (running) {
          soundEngine.phaseCue(phaseIdx);
        }
      }
    });
    chkHap.addEventListener('change', () => { store.save(); });
    customInputs.forEach(el => {
      el.addEventListener('input', updateModeInfo);
      el.addEventListener('change', () => {
        store.save();
        reset();
        updateModeInfo();
      });
    });

    if (btnTogglePanel) {
      btnTogglePanel.addEventListener('click', () => {
        isPanelVisible = !isPanelVisible;
        applyPanelState();
        store.save();
      });
    }

    btnSaveCustom.addEventListener('click', async () => {
      const rawPhases = getCustomInputValues();
      const total = rawPhases.reduce((sum, val) => sum + val, 0);
      if (total <= 0) {
        alert('Добавьте длительности фаз, чтобы сохранить режим.');
        return;
      }
      let name = prompt('Название для вашего режима', '');
      if (name === null) return;
      name = name.trim();
      if (!name) {
        alert('Название не может быть пустым.');
        return;
      }
      const clean = sanitizePhases(rawPhases);
      const existing = savedModes.find(mode => mode.name.toLowerCase() === name.toLowerCase());
      let modeId;
      if (existing) {
        existing.name = name;
        existing.phases = clean;
        modeId = existing.id;
      } else {
        modeId = Date.now().toString(36);
        savedModes.push({ id: modeId, name, phases: clean });
      }
      await savedModesStore.write(savedModes);
      savedModes = await savedModesStore.read();
      renderSavedOptions(`saved:${modeId}`);
      setCustomInputs(clean);
      selMode.value = `saved:${modeId}`;
      toggleCustom();
      store.save();
      reset();
      updateModeInfo();
    });

    btnDeleteCustom.addEventListener('click', async () => {
      if (!selMode.value.startsWith('saved:')) return;
      const mode = getSavedMode(selMode.value);
      if (!mode) return;
      const ok = confirm(`Удалить режим «${mode.name}»?`);
      if (!ok) return;
      savedModes = savedModes.filter(item => item.id !== mode.id);
      await savedModesStore.write(savedModes);
      renderSavedOptions('custom');
      selMode.value = 'custom';
      toggleCustom();
      store.save();
      reset();
      updateModeInfo();
    });

    btnStart.addEventListener('click', () => {
      soundEngine.unlock();
      if (running) pause(); else start();
    });
    btnFinish.addEventListener('click', () => {
      if (totalMs <= 0) return;
      finish();
    });

    const unlockAudioOnce = () => { soundEngine.unlock(); };
    window.addEventListener('pointerdown', unlockAudioOnce, { once: true });
    window.addEventListener('touchstart', unlockAudioOnce, { once: true });
    window.addEventListener('keydown', unlockAudioOnce, { once: true });

    // Клавиатура
    window.addEventListener('keydown', (e) => {
      const typing = isEditableTarget(e.target);
      if (e.code === 'Space') {
        if (typing) return;
        e.preventDefault();
        running ? pause() : start();
        return;
      }
      if (typing) return;
      if (['Digit1','Digit2','Digit3','Digit4'].includes(e.code)) {
        const map = ['box', '478', 'coherent', 'custom'];
        selMode.value = map[Number(e.code.slice(-1))-1];
        toggleCustom(); store.save(); reset();
      }
    });

    // ------- ИНИЦ ------
    async function initApp() {
      await calmDb.init().catch(() => {});
      savedModes = await savedModesStore.read();
      renderSavedOptions();
      updateDeleteButtonVisibility();
      store.load();
      applyPanelState();
      updateModeInfo();
      await renderStats();
      setButtons();

      // Подсказки для SR (первый фокус)
      setTimeout(() => { ariaPhase.textContent = 'Приложение готово. Выберите режим и нажмите Старт.'; }, 200);
    }

    initApp();

    // ------- PWA -------
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/calm-focus/service-worker.js', { scope: '/calm-focus/' }).catch(() => {
          // тихо игнорируем ошибку регистрации, чтобы не мешать работе приложения
        });
      });
    }
