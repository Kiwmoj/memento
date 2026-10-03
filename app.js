(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (selector, root = document) => root.querySelector(selector);
  const account = window.MEMENTO_ACCOUNT || null;

  // Same storage key the previous build used, so existing memories carry over.
  const MEMORY_KEY = account ? `memento-account-${account.id}:wdi-memories` : 'wdi-memories';
  const SPEAK_KEY = 'wdi-speak-answers';

  const SEED = [
    { id: 1, object: 'Passport', location: 'Blue drawer', reason: 'For the trip on Friday', date: 'Oct 04', category: 'Travel', pinned: true, created: '2 min ago' },
    { id: 2, object: 'Spare keys', location: 'Plant pot by the door', reason: 'For Maya when she gets home', date: 'Tonight', category: 'Home', pinned: false, created: 'Yesterday' },
    { id: 3, object: 'Umbrella', location: 'With Maria at the front desk', reason: 'Maria is borrowing it', date: 'Tomorrow', category: 'People', pinned: false, created: '2 days ago' },
    { id: 4, object: 'Warranty receipt', location: 'Gadget folder in Drive', reason: 'In case the blender needs replacing', date: 'No date', category: 'Paperwork', pinned: false, created: '3 days ago' },
  ];

  // Words that carry no meaning when someone asks a question.
  const STOP_WORDS = new Set((
    'a an the my our your their his her its me i we you it this that these those ' +
    'where wheres whats what which who whos whom has have had is are was were am be been ' +
    'do does did done can could would should will please tell show find locate remember recall ' +
    'put left leave leaving kept keep stored store placed place got get of in on at to for from by ' +
    'with about and or any some someone thing things stuff again now still know think ok okay hey ' +
    'memento wheredidi'
  ).split(' '));

  const state = { memories: [], filter: 'all', query: '', highlightId: null };

  /* ---------- helpers ---------- */

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  function formatDate(value) {
    if (!value || /^no date$/i.test(value)) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return value;
  }

  function savedLabel(memory) {
    if (memory.createdAt) {
      return new Date(memory.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    }
    return memory.created || '';
  }

  /* ---------- storage ---------- */

  function normalize(raw) {
    return {
      id: raw.id ?? Date.now() + Math.random(),
      object: String(raw.object || '').trim() || 'Untitled',
      location: String(raw.location || '').trim(),
      reason: String(raw.reason || '').trim(),
      date: String(raw.date || ''),
      category: String(raw.category || 'General').trim() || 'General',
      pinned: Boolean(raw.pinned),
      created: String(raw.created || ''),
      createdAt: raw.createdAt || '',
      photo: typeof raw.photo === 'string' ? raw.photo : '',
    };
  }

  function loadMemories() {
    try {
      let raw = localStorage.getItem(MEMORY_KEY);
      // The first account inherits memories saved before accounts existed.
      if (raw === null && account && String(account.id) === '1') raw = localStorage.getItem('wdi-memories');
      if (raw === null) return SEED.map(normalize);
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter((item) => item && typeof item === 'object').map(normalize) : [];
    } catch {
      return SEED.map(normalize);
    }
  }

  function persist(memories) {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
      return true;
    } catch {
      return false;
    }
  }

  /* ---------- search ---------- */

  const stem = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .replace(/'s\b/g, '')
      .split(/\s+/)
      .filter((word) => word && !STOP_WORDS.has(word));
  }

  const WEIGHTS = [['object', 6], ['category', 4], ['location', 3], ['reason', 2]];

  function scoreMemory(memory, tokens) {
    const fields = WEIGHTS.map(([name, weight]) => [
      tokenizeKeepAll(memory[name]).map(stem).join(' '),
      weight,
    ]);
    let score = 0;
    for (const token of tokens) {
      const needle = stem(token);
      let best = 0;
      for (const [text, weight] of fields) {
        if (text.includes(needle)) best = Math.max(best, weight);
      }
      score += best;
    }
    return score;
  }

  function tokenizeKeepAll(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
  }

  function rank(memories, tokens) {
    return memories
      .map((memory, index) => ({ memory, index, score: scoreMemory(memory, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.memory.pinned) - Number(a.memory.pinned) || a.index - b.index)
      .map((entry) => entry.memory);
  }

  /* ---------- elements ---------- */

  const els = {
    grid: $('#grid'), empty: $('#empty'), title: $('#list-title'), count: $('#result-count'),
    search: $('#search-input'), searchForm: $('#search-form'), searchClear: $('#search-clear'),
    categoryNav: $('#category-nav'), countAll: $('#count-all'), countPinned: $('#count-pinned'),
    sidebar: $('#sidebar'), scrim: $('#scrim'), menuBtn: $('#menu-btn'),
    toast: $('#toast'),
    answer: $('#answer'), answerText: $('#answer-text'), answerKicker: $('#answer-kicker'),
    voice: $('#voice'), voiceLabel: $('#voice-label'), voiceDetail: $('#voice-detail'), voiceIcon: $('#voice-icon-use'),
    micBtn: $('#mic-btn'), micLabel: $('#mic-label'),
    typeToggle: $('#type-toggle'), askForm: $('#ask-form'), askInput: $('#ask-input'), speakToggle: $('#speak-toggle'),
    dialog: $('#memory-dialog'), form: $('#memory-form'), dialogTitle: $('#dialog-title'), saveBtn: $('#save-btn'),
    confirm: $('#confirm-dialog'), confirmText: $('#confirm-text'),
    photoCamera: $('#photo-camera'), photoChoose: $('#photo-choose'), photoRemove: $('#photo-remove'), photoFile: $('#photo-file'),
    photoError: $('#photo-error'), cameraView: $('#camera-view'), video: $('#camera-video'),
    photoPreview: $('#photo-preview'), photoImg: $('#photo-img'),
  };

  /* ---------- rendering ---------- */

  function visibleMemories() {
    let list = state.memories;
    if (state.filter === 'pinned') list = list.filter((m) => m.pinned);
    else if (state.filter.startsWith('cat:')) {
      const category = state.filter.slice(4);
      list = list.filter((m) => m.category.toLowerCase() === category.toLowerCase());
    }
    const tokens = tokenize(state.query);
    if (tokens.length) return rank(list, tokens);
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }

  function categories() {
    const map = new Map();
    for (const memory of state.memories) {
      const key = memory.category.toLowerCase();
      const entry = map.get(key) || { name: memory.category, count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderNav() {
    const cats = categories();
    els.countAll.textContent = state.memories.length;
    els.countPinned.textContent = state.memories.filter((m) => m.pinned).length;

    els.categoryNav.replaceChildren(
      ...(cats.length
        ? cats.map((cat) =>
            h('li', {}, h('button', { type: 'button', class: 'nav-item', 'data-filter': `cat:${cat.name}` },
              icon('tag'), h('span', {}, cat.name), h('span', { class: 'count' }, cat.count))))
        : [h('li', { class: 'nav-empty' }, 'Categories appear once you save a memory.')]),
    );

    document.querySelectorAll('[data-filter]').forEach((button) => {
      const active = button.dataset.filter === state.filter;
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });

    $('#category-list').replaceChildren(...cats.map((cat) => h('option', { value: cat.name })));
  }

  function listTitle() {
    if (state.filter === 'pinned') return 'Pinned';
    if (state.filter.startsWith('cat:')) return state.filter.slice(4);
    return 'All memories';
  }

  function emptyState() {
    const hasQuery = tokenize(state.query).length > 0;
    if (hasQuery) {
      return h('div', { class: 'empty' },
        icon('search'),
        h('h3', {}, `No memories match “${state.query}”`),
        h('p', {}, 'Try fewer or different words, such as the item name, a place, or a category.'),
        h('button', { type: 'button', class: 'btn', onclick: clearSearch }, 'Clear search'));
    }
    if (state.filter === 'pinned') {
      return h('div', { class: 'empty' }, icon('pin'), h('h3', {}, 'Nothing pinned yet'),
        h('p', {}, 'Use the pin on a memory card to keep important things at the top.'));
    }
    if (state.filter.startsWith('cat:')) {
      return h('div', { class: 'empty' }, icon('tag'), h('h3', {}, `No memories in ${state.filter.slice(4)}`),
        h('button', { type: 'button', class: 'btn', onclick: () => setFilter('all') }, 'Show all memories'));
    }
    return h('div', { class: 'empty' }, icon('plus'), h('h3', {}, 'Nothing saved yet'),
      h('p', {}, 'Save your first memory: what it is, where it is and why it matters.'),
      h('button', { type: 'button', class: 'btn btn-primary', 'data-open-memory': true, onclick: () => openMemoryDialog() }, 'Add memory'));
  }

  function renderCard(memory) {
    const media = h('div', { class: memory.photo ? 'card-media' : 'card-media is-empty' });
    const placeholder = () => media.replaceChildren(icon('image'), h('span', {}, 'No photo'));
    if (memory.photo) {
      const image = h('img', { src: memory.photo, alt: `Photo of ${memory.object}`, loading: 'lazy' });
      image.addEventListener('error', () => { media.className = 'card-media is-empty'; placeholder(); });
      media.append(image);
    } else {
      placeholder();
    }

    const when = formatDate(memory.date);
    const facts = [
      h('div', {}, h('dt', {}, 'Where'), h('dd', {}, memory.location || 'Not set')),
      memory.reason && h('div', {}, h('dt', {}, 'Why it matters'), h('dd', {}, memory.reason)),
      when && h('div', {}, h('dt', {}, 'Date'), h('dd', {}, when)),
    ];

    const pinButton = h('button', {
      type: 'button', class: 'icon-btn', 'aria-pressed': String(memory.pinned),
      'aria-label': `${memory.pinned ? 'Unpin' : 'Pin'} ${memory.object}`, title: memory.pinned ? 'Unpin' : 'Pin',
      onclick: () => togglePin(memory.id),
    }, icon('pin'));

    const saved = savedLabel(memory);
    return h('article', { class: memory.id === state.highlightId ? 'card highlight' : 'card', 'data-id': memory.id },
      media,
      h('div', { class: 'card-body' },
        h('div', { class: 'card-top' },
          h('div', {}, h('span', { class: 'badge' }, memory.category), h('h3', {}, memory.object)),
          pinButton),
        h('dl', { class: 'facts' }, facts)),
      h('div', { class: 'card-foot' },
        h('span', {}, saved ? `Saved ${saved}` : ''),
        h('div', { class: 'card-actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${memory.object}`, title: 'Edit', onclick: () => openMemoryDialog(memory.id) }, icon('edit')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${memory.object}`, title: 'Delete', onclick: () => confirmDelete(memory.id) }, icon('trash')))));
  }

  function render() {
    renderNav();
    const items = visibleMemories();
    const hasQuery = tokenize(state.query).length > 0;

    els.title.textContent = listTitle();
    els.count.textContent = hasQuery
      ? `${plural(items.length, 'match')} for “${state.query}”`
      : plural(items.length, 'memory').replace('memorys', 'memories');
    els.searchClear.hidden = !els.search.value;

    els.grid.replaceChildren(...items.map(renderCard));
    els.grid.hidden = items.length === 0;
    els.empty.hidden = items.length > 0;
    if (!items.length) els.empty.replaceChildren(...emptyState().childNodes);

    if (state.highlightId != null) {
      const card = els.grid.querySelector('.highlight');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function setFilter(filter) {
    state.filter = filter;
    state.highlightId = null;
    closeMenu();
    render();
  }

  function clearSearch() {
    els.search.value = '';
    state.query = '';
    state.highlightId = null;
    render();
    els.search.focus();
  }

  let toastTimer;
  function toast(message, isError = false) {
    els.toast.textContent = isError ? `Problem: ${message}` : message;
    els.toast.classList.toggle('is-error', isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3800);
  }

  function commit(next, successMessage) {
    if (!persist(next)) {
      toast('Could not save: browser storage is full. Remove a photo or an old memory and try again.', true);
      return false;
    }
    state.memories = next;
    if (successMessage) toast(successMessage);
    return true;
  }

  function togglePin(id) {
    const next = state.memories.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m));
    if (commit(next)) {
      const memory = next.find((m) => m.id === id);
      render();
      toast(memory.pinned ? `Pinned ${memory.object}` : `Unpinned ${memory.object}`);
    }
  }

  /* ---------- mobile menu ---------- */

  const narrow = window.matchMedia('(max-width: 900px)');
  function syncSidebar() {
    const open = els.sidebar.classList.contains('is-open');
    els.sidebar.inert = narrow.matches && !open;
    els.scrim.hidden = !(narrow.matches && open);
    els.menuBtn.setAttribute('aria-expanded', String(open));
  }
  function openMenu() { els.sidebar.classList.add('is-open'); syncSidebar(); $('.nav-item', els.sidebar).focus(); }
  function closeMenu() {
    if (!els.sidebar.classList.contains('is-open')) return;
    els.sidebar.classList.remove('is-open');
    syncSidebar();
    if (narrow.matches) els.menuBtn.focus();
  }
  els.menuBtn.addEventListener('click', openMenu);
  els.scrim.addEventListener('click', closeMenu);
  narrow.addEventListener('change', () => { els.sidebar.classList.remove('is-open'); syncSidebar(); });
  els.sidebar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (button) setFilter(button.dataset.filter);
  });

  /* ---------- search and answers ---------- */

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    state.highlightId = null;
    render();
  });
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.search.value) { event.stopPropagation(); clearSearch(); }
  });
  els.searchClear.addEventListener('click', clearSearch);
  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (els.search.value.trim()) ask(els.search.value, { speak: false });
  });

  function describe(memory) {
    const where = /^(with|at|in|on|under|inside|behind|near|by|next to)\b/i.test(memory.location)
      ? memory.location.charAt(0).toLowerCase() + memory.location.slice(1)
      : `in ${memory.location}`;
    let sentence = `${memory.object} is ${where}.`;
    if (memory.reason) sentence += ` ${memory.reason.replace(/[.!?]+$/, '')}.`;
    return sentence;
  }

  function showAnswer(text, found) {
    els.answerKicker.textContent = found ? 'Answer' : 'No match';
    els.answerText.textContent = text;
    els.answer.classList.toggle('is-miss', !found);
    els.answer.setAttribute('role', 'status');
    els.answer.hidden = false;
  }

  // Returns the spoken/visible answer so callers can test it.
  function ask(question, { speak: shouldSpeak = true } = {}) {
    const tokens = tokenize(question);
    state.filter = 'all';
    state.query = tokens.join(' ');
    els.search.value = state.query;

    let text;
    if (!tokens.length) {
      text = 'Tell me what you are looking for, for example “where is my passport?”';
      state.highlightId = null;
      showAnswer(text, false);
      setVoice('error', 'I need a few more words', 'Mention the item, place or person.');
    } else {
      const results = rank(state.memories, tokens);
      if (results.length) {
        const [top] = results;
        state.highlightId = top.id;
        text = describe(top);
        if (results.length > 1) text += ` I also found ${plural(results.length - 1, 'other matching memory').replace('memorys', 'memories')}.`;
        showAnswer(text, true);
        setVoice('success', 'Answer ready', `You asked: “${question.trim()}”`);
      } else {
        state.highlightId = null;
        text = `I could not find a memory for “${tokens.join(' ')}”. Try different words, or save it with Add memory.`;
        showAnswer(text, false);
        setVoice('error', 'No match found', `You asked: “${question.trim()}”`);
      }
    }
    render();
    if (shouldSpeak) speak(text);
    return text;
  }

  els.answerClose = $('#answer-close');
  els.answerClose.addEventListener('click', () => { els.answer.hidden = true; });

  /* ---------- speech output ---------- */

  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  if (!canSpeak) els.speakToggle.closest('.switch').hidden = true;
  try { els.speakToggle.checked = localStorage.getItem(SPEAK_KEY) !== 'off'; } catch { /* keep default */ }
  els.speakToggle.addEventListener('change', () => {
    try { localStorage.setItem(SPEAK_KEY, els.speakToggle.checked ? 'on' : 'off'); } catch { /* ignore */ }
    if (!els.speakToggle.checked && canSpeak) window.speechSynthesis.cancel();
  });

  function speak(text) {
    if (!canSpeak || !els.speakToggle.checked) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language || 'en-US';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch { /* speech is optional; the answer is already on screen */ }
  }

  /* ---------- voice input ---------- */

  const VOICE_ICONS = { idle: 'mic', listening: 'mic', processing: 'loader', success: 'check', error: 'alert' };
  const voice = { rec: null, cancel: null };

  function setVoice(stateName, label, detail) {
    els.voice.dataset.state = stateName;
    els.voiceLabel.textContent = label;
    els.voiceDetail.textContent = detail;
    els.voiceIcon.setAttribute('href', `#i-${VOICE_ICONS[stateName]}`);
    const listening = stateName === 'listening';
    els.micBtn.setAttribute('aria-pressed', String(listening));
    els.micBtn.disabled = stateName === 'processing';
    els.micLabel.textContent = listening ? 'Stop listening' : 'Ask by voice';
  }

  function setTypedFallback(open) {
    els.askForm.hidden = !open;
    els.typeToggle.setAttribute('aria-expanded', String(open));
    if (open) els.askInput.focus();
  }

  const READY = ['idle', 'Voice ready', 'Press “Ask by voice” and say something like “where is my passport?”'];

  function voiceFailure(label, detail) {
    setVoice('error', label, detail);
    setTypedFallback(true);
  }

  // Fallback for browsers without SpeechRecognition (for example Firefox):
  // record the microphone, convert to 16 kHz mono PCM and transcribe on the local Flask server.
  function toPcm16(chunks, inputRate) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    const ratio = inputRate / 16000;
    const out = new Int16Array(Math.floor(total / ratio));
    for (let i = 0; i < out.length; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.min(total, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += merged[j];
      out[i] = Math.max(-1, Math.min(1, sum / (end - start))) * 0x7fff;
    }
    return out;
  }

  async function startRecordedVoice() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioCtx || window.isSecureContext === false) {
      voiceFailure('Voice is not supported in this browser', 'This browser cannot record audio on this page. Type your question below.');
      return;
    }

    setVoice('processing', 'Starting microphone…', 'Your browser may ask for permission. Choose Allow.');
    let status = null;
    try { status = (await (await fetch('/api/speech/status')).json()).status; } catch { /* server unreachable */ }
    if (status === 'loading') {
      voiceFailure('Voice engine is getting ready', 'The offline speech model is still downloading (about 40 MB, first run only). Try again in a minute, or type your question.');
      return;
    }
    if (status !== 'ready') {
      voiceFailure('Voice engine unavailable', 'Offline voice needs the vosk package and an internet connection once to fetch its model. Type your question below.');
      return;
    }

    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        voiceFailure('Microphone permission denied', 'Allow microphone access using the lock icon beside the address bar, then try again. You can type your question meanwhile.');
      } else if (error && error.name === 'NotFoundError') {
        voiceFailure('No microphone found', 'Connect a microphone or check your system sound settings, or type your question below.');
      } else {
        voiceFailure('Microphone could not start', 'Another app may be using it. Close it and try again, or type your question below.');
      }
      return;
    }

    const context = new AudioCtx();
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    const startedAt = Date.now();
    let lastVoiceAt = 0;
    let finished = false;

    const cleanup = () => {
      clearInterval(watchdog);
      processor.onaudioprocess = null;
      try { source.disconnect(); processor.disconnect(); } catch { /* already disconnected */ }
      media.getTracks().forEach((track) => track.stop());
      context.close().catch(() => {});
      voice.rec = null;
      voice.cancel = null;
    };

    processor.onaudioprocess = (event) => {
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i];
      if (Math.sqrt(energy / samples.length) > 0.015) lastVoiceAt = Date.now();
    };

    // Stop after speech ends, after 6 s of silence, or at 12 s total.
    const watchdog = setInterval(() => {
      const now = Date.now();
      const spoke = lastVoiceAt > 0;
      if ((spoke && now - lastVoiceAt > 1400) || (!spoke && now - startedAt > 6000) || now - startedAt > 12000) finish();
    }, 200);

    async function finish() {
      if (finished) return;
      finished = true;
      const pcm = toPcm16(chunks, context.sampleRate);
      cleanup();
      if (lastVoiceAt === 0) {
        voiceFailure('No speech detected', 'I did not hear anything. Check your microphone, move closer and try again, or type below.');
        return;
      }
      setVoice('processing', 'Transcribing on this computer…', 'Your audio is processed locally and not saved.');
      try {
        const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm.buffer });
        if (!response.ok) throw new Error(String(response.status));
        const text = String((await response.json()).text || '').trim();
        if (!text) {
          voiceFailure('No speech detected', 'I could not make out any words. Speak clearly and try again, or type below.');
          return;
        }
        setVoice('processing', 'Working on it…', `Heard: “${text}”`);
        setTimeout(() => ask(text, { speak: true }), 350);
      } catch {
        voiceFailure('Voice engine unavailable', 'The local transcription service did not respond. Type your question below.');
      }
    }

    voice.rec = { stop: finish };
    voice.cancel = () => { finished = true; cleanup(); setVoice(...READY); };
    processor.connect(context.destination);
    source.connect(processor);
    setVoice('listening', 'Listening… speak now', 'Say what you are looking for. It stops automatically when you finish, or press the button.');
  }

  function startVoice() {
    if (voice.rec) { stopVoice(); return; }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      startRecordedVoice();
      return;
    }
    if (window.isSecureContext === false) {
      voiceFailure('Voice needs a secure connection', 'Open the app at http://localhost:8080 or over HTTPS, or type your question below.');
      return;
    }

    let recognition;
    try { recognition = new Recognition(); } catch {
      voiceFailure('Voice could not start', 'Your browser blocked speech recognition. Type your question below.');
      return;
    }
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = '';
    let interimText = '';
    let handled = false;
    let timer = null;

    voice.rec = recognition;
    voice.cancel = () => { handled = true; try { recognition.abort(); } catch { /* already stopped */ } };

    const finish = () => {
      clearTimeout(timer);
      if (voice.rec === recognition) { voice.rec = null; voice.cancel = null; }
    };

    recognition.onstart = () => {
      setVoice('listening', 'Listening… speak now', 'Say what you are looking for. Press the button again to stop.');
      // Stop on our own so the microphone is never left open.
      timer = setTimeout(() => { try { recognition.stop(); } catch { /* ignore */ } }, 12000);
    };

    recognition.onresult = (event) => {
      finalText = '';
      interimText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      const heard = (finalText || interimText).trim();
      if (heard) els.voiceDetail.textContent = `Heard: “${heard}”`;
    };

    recognition.onerror = (event) => {
      if (handled) return;
      handled = true;
      finish();
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          voiceFailure('Microphone permission denied', 'Allow microphone access using the lock icon beside the address bar, then try again. You can type your question meanwhile.');
          break;
        case 'no-speech':
          voiceFailure('No speech detected', 'I did not hear anything. Check your microphone, move closer and try again, or type below.');
          break;
        case 'audio-capture':
          voiceFailure('No microphone found', 'Connect a microphone or check your system sound settings, or type your question below.');
          break;
        case 'network':
          voiceFailure('Voice service unreachable', 'Speech recognition needs an internet connection in this browser. Type your question below.');
          break;
        case 'aborted':
          setVoice(...READY);
          break;
        default:
          voiceFailure('Voice stopped unexpectedly', 'Please try again or type your question below.');
      }
    };

    recognition.onend = () => {
      finish();
      if (handled) return;
      handled = true;
      const text = (finalText || interimText).trim();
      if (!text) {
        voiceFailure('No speech detected', 'I did not hear anything. Check your microphone, move closer and try again, or type below.');
        return;
      }
      setVoice('processing', 'Working on it…', `Heard: “${text}”`);
      setTimeout(() => ask(text, { speak: true }), 350);
    };

    if (canSpeak) window.speechSynthesis.cancel();
    setVoice('processing', 'Starting microphone…', 'Your browser may ask for permission. Choose Allow.');
    try {
      recognition.start();
    } catch {
      handled = true;
      finish();
      voiceFailure('Voice could not start', 'Please try again or type your question below.');
    }
  }

  function stopVoice() {
    if (!voice.rec) return;
    setVoice('processing', 'Finishing…', 'Processing what I heard.');
    try { voice.rec.stop(); } catch { voice.cancel?.(); }
  }

  els.micBtn.addEventListener('click', startVoice);
  els.typeToggle.addEventListener('click', () => setTypedFallback(els.askForm.hidden));
  els.askForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = els.askInput.value.trim();
    if (!question) { els.askInput.focus(); return; }
    ask(question, { speak: true });
    els.askInput.value = '';
  });

  /* ---------- memory dialog ---------- */

  const fields = {
    object: $('#f-object'), location: $('#f-location'), reason: $('#f-reason'),
    category: $('#f-category'), date: $('#f-date'),
  };
  let editingId = null;
  let currentPhoto = '';
  let stream = null;

  function setFieldError(name, message) {
    const input = fields[name];
    const error = $(`#e-${name}`);
    if (!error) return;
    error.textContent = message ? `Error: ${message}` : '';
    error.hidden = !message;
    input.closest('.field').toggleAttribute('data-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }

  function showPhotoError(message) {
    els.photoError.textContent = message || '';
    els.photoError.hidden = !message;
  }

  function updatePhotoUI() {
    const hasPhoto = Boolean(currentPhoto);
    els.photoPreview.hidden = !hasPhoto;
    if (hasPhoto) els.photoImg.src = currentPhoto; else els.photoImg.removeAttribute('src');
    els.photoRemove.hidden = !hasPhoto;
    els.photoCamera.lastChild.textContent = hasPhoto ? 'Retake photo' : 'Take photo';
    els.photoChoose.lastChild.textContent = hasPhoto ? 'Replace image' : 'Choose image';
  }

  function openMemoryDialog(id = null) {
    closeMenu();
    editingId = id;
    const memory = id == null ? null : state.memories.find((m) => m.id === id);
    els.form.reset();
    for (const name of Object.keys(fields)) setFieldError(name, '');
    showPhotoError('');
    stopCamera();

    els.dialogTitle.textContent = memory ? 'Edit memory' : 'Save a memory';
    els.saveBtn.textContent = memory ? 'Save changes' : 'Save memory';
    if (memory) {
      fields.object.value = memory.object;
      fields.location.value = memory.location;
      fields.reason.value = memory.reason;
      fields.category.value = memory.category;
      fields.date.value = /^\d{4}-\d{2}-\d{2}$/.test(memory.date) ? memory.date : '';
    } else if (state.filter.startsWith('cat:')) {
      fields.category.value = state.filter.slice(4);
    }
    currentPhoto = memory ? memory.photo : '';
    updatePhotoUI();
    els.dialog.showModal();
    fields.object.focus();
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-memory]') && !event.target.closest('.empty')) openMemoryDialog();
  });
  els.dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => els.dialog.close()));
  els.dialog.addEventListener('close', stopCamera);

  for (const name of ['object', 'location', 'category']) {
    fields[name].addEventListener('input', () => setFieldError(name, ''));
  }

  function validate() {
    const rules = {
      object: 'Enter what the item is, for example “Passport”.',
      location: 'Enter where it is or who has it.',
      category: 'Choose or type a category, for example “Home”.',
    };
    let firstInvalid = null;
    for (const [name, message] of Object.entries(rules)) {
      const empty = !fields[name].value.trim();
      setFieldError(name, empty ? message : '');
      if (empty && !firstInvalid) firstInvalid = fields[name];
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validate()) return;

    const typedCategory = fields.category.value.trim();
    const existing = categories().find((c) => c.name.toLowerCase() === typedCategory.toLowerCase());
    const category = existing ? existing.name : typedCategory.charAt(0).toUpperCase() + typedCategory.slice(1);
    const values = {
      object: fields.object.value.trim(),
      location: fields.location.value.trim(),
      reason: fields.reason.value.trim(),
      category,
      date: fields.date.value,
      photo: currentPhoto,
    };

    stopCamera();
    if (editingId == null) {
      const memory = normalize({ ...values, id: Date.now(), pinned: false, created: 'Just now', createdAt: new Date().toISOString() });
      if (!commit([memory, ...state.memories], `Saved “${memory.object}”. You can find it anytime.`)) return;
      state.filter = 'all';
      state.query = '';
      els.search.value = '';
      state.highlightId = memory.id;
    } else {
      const next = state.memories.map((m) => (m.id === editingId ? { ...m, ...values } : m));
      if (!commit(next, `Updated “${values.object}”.`)) return;
      state.highlightId = editingId;
    }
    els.dialog.close();
    render();
  });

  /* ---------- delete ---------- */

  let pendingDelete = null;
  function confirmDelete(id) {
    const memory = state.memories.find((m) => m.id === id);
    if (!memory) return;
    pendingDelete = memory;
    els.confirmText.textContent = `“${memory.object}” will be removed from this device. This cannot be undone.`;
    els.confirm.returnValue = '';
    els.confirm.showModal();
  }
  els.confirm.addEventListener('close', () => {
    if (els.confirm.returnValue === 'delete' && pendingDelete) {
      const target = pendingDelete;
      if (commit(state.memories.filter((m) => m.id !== target.id), `Deleted “${target.object}”.`)) render();
    }
    pendingDelete = null;
  });

  /* ---------- camera and photos ---------- */

  function stopCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    els.video.srcObject = null;
    els.cameraView.hidden = true;
  }

  function cameraErrorMessage(error) {
    switch (error && error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied. Allow camera access with the lock icon beside the address bar, then try again, or choose an image from your device instead.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera was found on this device. You can choose an image instead.';
      case 'NotReadableError':
        return 'The camera is in use by another app. Close it and try again, or choose an image instead.';
      default:
        return 'The camera could not be started. You can choose an image from your device instead.';
    }
  }

  async function startCamera() {
    showPhotoError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || window.isSecureContext === false) {
      showPhotoError('This browser cannot open the camera on this page. Use “Choose image” to pick or take a photo instead.');
      return;
    }
    els.photoCamera.disabled = true;
    try {
      stopCamera();
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!els.dialog.open) { media.getTracks().forEach((track) => track.stop()); return; }
      stream = media;
      els.video.srcObject = media;
      els.cameraView.hidden = false;
      await els.video.play().catch(() => {});
      $('#camera-capture').focus();
    } catch (error) {
      showPhotoError(cameraErrorMessage(error));
    } finally {
      els.photoCamera.disabled = false;
    }
  }

  // Downscale so photos fit comfortably in localStorage.
  function toJpeg(source, width, height) {
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  $('#camera-capture').addEventListener('click', () => {
    if (!els.video.videoWidth) { showPhotoError('The camera is still starting. Try again in a moment.'); return; }
    currentPhoto = toJpeg(els.video, els.video.videoWidth, els.video.videoHeight);
    stopCamera();
    updatePhotoUI();
    els.photoChoose.focus();
  });
  $('#camera-cancel').addEventListener('click', () => { stopCamera(); els.photoCamera.focus(); });
  els.photoCamera.addEventListener('click', startCamera);
  els.photoChoose.addEventListener('click', () => els.photoFile.click());
  els.photoRemove.addEventListener('click', () => {
    currentPhoto = '';
    showPhotoError('');
    updatePhotoUI();
    els.photoChoose.focus();
  });

  els.photoFile.addEventListener('change', () => {
    const file = els.photoFile.files && els.photoFile.files[0];
    els.photoFile.value = '';
    if (!file) return;
    showPhotoError('');
    if (!file.type.startsWith('image/')) { showPhotoError('That file is not an image. Choose a JPG, PNG or WebP photo.'); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      currentPhoto = toJpeg(image, image.naturalWidth, image.naturalHeight);
      URL.revokeObjectURL(url);
      stopCamera();
      updatePhotoUI();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      showPhotoError('That image could not be read. Try a JPG or PNG file.');
    };
    image.src = url;
  });

  /* ---------- account ---------- */

  if (account) {
    $('#account-name').textContent = account.name || 'Account';
    $('#account-email').textContent = account.email || '';
    $('#account-initial').textContent = (account.name || '?').trim().charAt(0).toUpperCase() || '?';
  }
  $('#signout-btn').addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* leave the page regardless */ }
    window.location.assign('/login');
  });

  /* ---------- global keys ---------- */

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) { event.preventDefault(); openDialog.close(); return; }
    if (voice.rec) { voice.cancel?.(); return; }
    if (els.sidebar.classList.contains('is-open')) closeMenu();
  });

  /* ---------- start ---------- */

  setVoice(...READY);
  syncSidebar();
  state.memories = loadMemories();
  if (localStorage.getItem(MEMORY_KEY) === null) persist(state.memories);
  render();
})();
