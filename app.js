/* English Pet Quest — zero dependencies, no student accounts or timers. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const STUDENT = Boolean(window.STUDENT_MODE);
  const KEY = 'stage3chat.petquest.v1';
  const CONFIG_KEY = 'stage3chat.curriculum.v1';
  const PET = window.PET_ASSET || 'assets/pet.webp';
  const TYPES = ['listen', 'order', 'context'];
  let storageFailed = false;
  let notice = '';
  let modal = null;
  let tutorialStep = 0;
  let selectedWords = [];
  let wrongChoice = '';
  let audio = null;
  let speechToken = 0;
  let audioPlaying = false;
  let petAction = '';
  let animationTimer;
  const safeRead = key => { let raw; try { raw = localStorage.getItem(key); } catch (_) { storageFailed = true; return null; } try { return JSON.parse(raw || 'null'); } catch (_) { notice = '儲存資料格式異常，已安全使用可用教材與進度啟動。'; return null; } };
  const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { storageFailed = true; return false; } };
  const storedConfig = STUDENT ? null : safeRead(CONFIG_KEY);
  let lessons = Array.isArray(window.DEFAULT_LESSONS) ? window.DEFAULT_LESSONS.map(row => ({ ...row })) : [];
  let settings = { count: 12, rate: 0.85, ...(window.DEFAULT_SETTINGS || {}) };
  if (storedConfig && Array.isArray(storedConfig.lessons)) {
    const result = validateLessons(storedConfig.lessons);
    if (!result.errors.length) { lessons = result.rows; settings.count = Number(storedConfig.count) || 12; }
  }
  settings.count = Math.max(6, Math.min(21, lessons.length, Number(settings.count) || 12));
  const fingerprint = () => {
    // Compact dual hashes avoid storing a second copy of embedded teacher recordings.
    const serialized = JSON.stringify(lessons.map(l => [l.id, l.english, l.chinese, l.emoji, l.item, l.context, l.audio || '']));
    let left = 2166136261, right = 5381;
    for (let i = 0; i < serialized.length; i++) { const code = serialized.charCodeAt(i); left = Math.imul(left ^ code, 16777619); right = Math.imul(right, 33) ^ code; }
    return `v1:${serialized.length}:${left >>> 0}:${right >>> 0}`;
  };
  const baseState = () => ({ version: 1, fingerprint: fingerprint(), tutorial: false, energy: 0, xp: 0, feeds: 0, decoration: false, outfit: false, muted: false, rate: settings.rate, session: null });
  let state = baseState();
  const restored = safeRead(KEY);
  if (validState(restored)) state = restored;
  else if (restored) notice = '舊進度與教材不相符，已安全開始新的冒險。';
  let screen = state.session ? (state.session.done ? 'completed' : 'home') : 'home';
  if (!state.tutorial) modal = 'tutorial';
  let paused = false;

  function validState(s) {
    if (!s || s.version !== 1 || s.fingerprint !== fingerprint()) return false;
    if (![s.energy, s.xp, s.feeds].every(n => Number.isInteger(n) && n >= 0 && n < 1000000)) return false;
    if (![s.tutorial, s.decoration, s.outfit, s.muted].every(n => typeof n === 'boolean')) return false;
    if (![0.7, 0.85, 1].includes(s.rate)) return false;
    if (!s.session) return true;
    const t = s.session;
    if (!Array.isArray(t.queue) || !t.queue.length || t.queue.length > 42 || !Number.isInteger(t.index) || t.index < 0 || t.index >= t.queue.length || typeof t.done !== 'boolean') return false;
    if (!Number.isInteger(t.originalCount) || t.originalCount < 6 || t.originalCount > 21 || !Array.isArray(t.missed) || t.missed.some(id => !lessons.some(l => l.id === id))) return false;
    if (t.queue.some(q => !q || typeof q !== 'object')) return false;
    if (t.queue.filter(q => !q.review).length !== t.originalCount || t.queue.slice(0, t.index).some(q => !q.correct) || (t.done && (t.index !== t.queue.length - 1 || t.queue.some(q => !q.correct)))) return false;
    return t.queue.every(q => {
      if (!q || !lessons.some(l => l.id === q.lessonId) || !TYPES.includes(q.type)) return false;
      if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4 || !q.options.includes(q.lessonId) || q.options.some(id => !lessons.some(l => l.id === id))) return false;
      if (new Set(q.options.map(id => normalizeMeaning(lessonFor(id).chinese))).size !== 4) return false;
      const expected = tokenize(lessonFor(q.lessonId).english).sort();
      if (!Array.isArray(q.words) || q.words.length !== expected.length || q.words.some(w => !w || typeof w.text !== 'string' || typeof w.key !== 'string') || new Set(q.words.map(w => w.key)).size !== q.words.length || JSON.stringify(q.words.map(w => w.text).sort()) !== JSON.stringify(expected)) return false;
      return Number.isInteger(q.attempts) && q.attempts >= 0 && q.attempts < 10000 && typeof q.correct === 'boolean' && typeof q.review === 'boolean' && typeof q.hint === 'boolean' && (q.firstCorrect === null || typeof q.firstCorrect === 'boolean') && (!q.correct || q.attempts > 0);
    });
  }
  function persist() { state.fingerprint = fingerprint(); safeWrite(KEY, state); }
  function lessonFor(id) { return lessons.find(l => l.id === id); }
  function current() { return state.session && state.session.queue[state.session.index]; }
  function currentLesson() { const q = current(); return q && lessonFor(q.lessonId); }
  function shuffle(values) {
    const a = [...values];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function tokenize(sentence) { return sentence.trim().split(/\s+/); }
  function normalizeMeaning(text) { return text.replace(/[\s。.!！?？]/g, ''); }
  function optionsFor(l) {
    const seen = new Set([normalizeMeaning(l.chinese)]);
    const alternatives = shuffle(lessons).filter(row => {
      const meaning = normalizeMeaning(row.chinese);
      if (row.id === l.id || seen.has(meaning)) return false;
      seen.add(meaning); return true;
    });
    return shuffle([l.id, ...alternatives.slice(0, 3).map(row => row.id)]);
  }
  function makeQuestion(l, type, review = false) {
    return { lessonId: l.id, type, review, options: optionsFor(l), words: shuffle(tokenize(l.english).map((text, i) => ({ text, key: `${l.id}-${i}` }))), attempts: 0, correct: false, firstCorrect: null, hint: false };
  }
  function startNew() {
    stopAudio(); notice = '';
    const chosen = shuffle(lessons).slice(0, settings.count);
    state.session = { queue: chosen.map((l, i) => makeQuestion(l, TYPES[i % 3])), originalCount: chosen.length, index: 0, missed: [], done: false, started: Date.now() };
    selectedWords = []; wrongChoice = ''; paused = false; screen = 'playing'; persist(); render();
  }
  function resume() { stopAudio(); notice = ''; selectedWords = []; wrongChoice = ''; paused = false; screen = state.session && state.session.done ? 'completed' : 'playing'; render(); }
  function stopAudio() {
    speechToken++; audioPlaying = false;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    updateAudioButtons();
  }
  function updateAudioButtons() { document.querySelectorAll('[data-action="play"]').forEach(b => { b.textContent = audioPlaying ? '◼ 停止播放' : '🔊 播放英文'; b.setAttribute('aria-label', audioPlaying ? '停止播放英文' : '播放英文'); }); }
  function speak(l) {
    if (!l) return;
    if (audioPlaying) { stopAudio(); return; }
    stopAudio();
    if (state.muted) { notice = '音訊目前關閉。點右上方音訊按鈕即可開啟。'; render(); return; }
    const token = speechToken;
    const fail = () => { if (token !== speechToken) return; audioPlaying = false; if (screen === 'playing' && currentLesson()?.id === l.id) { current().hint = true; persist(); } notice = '這次沒有播放成功。已顯示英文提示，你可以繼續練習；也能再點一次「播放英文」。'; render(); };
    if (l.audio) {
      audio = new Audio(l.audio); audio.playbackRate = state.rate; audioPlaying = true; updateAudioButtons();
      audio.onended = () => { if (token === speechToken) { audioPlaying = false; updateAudioButtons(); } };
      audio.onerror = fail;
      const result = audio.play(); if (result && result.catch) result.catch(fail);
      return;
    }
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { fail(); return; }
    const u = new SpeechSynthesisUtterance(l.english);
    u.lang = 'en-US'; u.rate = state.rate; u.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find(v => /^en[-_]US/i.test(v.lang)) || voices.find(v => /^en[-_]/i.test(v.lang)) || null;
    u.onend = () => { if (token === speechToken) { audioPlaying = false; updateAudioButtons(); } };
    u.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) fail(); };
    audioPlaying = true; updateAudioButtons(); window.speechSynthesis.speak(u);
  }
  function el(tag, className, text, attrs = {}) {
    const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = text;
    Object.entries(attrs).forEach(([key, value]) => { if (value !== undefined) n.setAttribute(key, String(value)); }); return n;
  }
  function append(parent, ...nodes) { nodes.filter(Boolean).forEach(n => parent.appendChild(n)); return parent; }
  function button(text, action, extra = '', attrs = {}) { return el('button', `button ${extra}`, text, { type: 'button', 'data-action': action, ...attrs }); }
  function progress() { const s = state.session; return s ? s.queue.filter(q => !q.review && q.correct).length : 0; }
  function level() { return Math.min(3, 1 + Math.floor(state.xp / 6)); }
  function header() {
    const h = el('header', 'topbar');
    const brand = el('div', 'brand'); append(brand, el('span', 'brand-icon', '✦'), el('div', 'brand-copy', '英語寵物冒險'));
    const mp = el('div', 'mission-progress');
    append(mp, el('span', 'progress-label', state.session ? `今日任務 ${progress()} / ${state.session.originalCount}` : '第三關・照顧你的身體'), el('div', 'progress-track'));
    mp.lastChild.appendChild(el('div', 'progress-fill', null, { style: `width:${state.session ? progress() / state.session.originalCount * 100 : 0}%` }));
    const actions = el('div', 'top-actions');
    append(actions, el('span', 'energy-chip', `⚡ ${state.energy}`), button(state.muted ? '🔇' : '🔊', 'mute', 'button-icon', { 'aria-label': state.muted ? '開啟音訊' : '關閉音訊', title: '音訊開關' }), button('⛶', 'fullscreen', 'button-icon', { 'aria-label': '切換全螢幕', title: '全螢幕' }), !STUDENT && button('⚙ 教師', 'teacher', 'button-secondary teacher-button'));
    return append(h, brand, mp, actions);
  }
  function petScene(compact = false) {
    const p = el('section', `pet-scene ${compact ? 'hero-scene' : ''} ${petAction ? `is-${petAction}` : ''}`, null, { 'data-growth': level(), 'data-outfit': state.outfit ? 'purple' : 'mint', 'aria-label': `寵物米米，成長階段${level()}，已餵食${state.feeds}次` });
    append(p, el('div', 'scene-label', '✦ 米米的療癒小島'), el('div', 'scene-orbit scene-orbit-one'), el('div', 'scene-orbit scene-orbit-two'));
    const stage = el('div', 'pet-stage'); append(stage, el('div', 'pet-shadow'), el('img', 'pet-image', null, { src: PET, alt: '原創薄荷綠寵物米米，穿著帽T與球鞋' }));
    if (level() >= 2) append(stage, el('span', 'growth-accessory', level() === 3 ? '👑' : '⭐', { 'aria-label': level() === 3 ? '成長王冠' : '成長星星' }));
    if (state.outfit) append(stage, el('span', 'outfit-accessory', '🧢', { 'aria-label': '已解鎖紫色街頭帽' }));
    if (petAction === 'eating') append(stage, el('span', 'pet-action-icon', '🍎', { 'aria-label': '寵物正在吃點心' }));
    if (petAction === 'drinking') append(stage, el('span', 'pet-action-icon', '🥤', { 'aria-label': '寵物正在喝水' }));
    if (state.decoration) append(p, el('div', 'scene-decoration', '🪴  🌈', { 'aria-label': '小屋已布置彩虹與盆栽' }));
    append(p, stage, el('div', 'scene-caption', petAction === 'drinking' ? '米米喝到水了，好開心！' : petAction === 'eating' ? '米米正在享用點心！' : level() === 3 ? '米米長大了！一起繼續冒險。' : level() === 2 ? '米米解鎖成長星星！' : '小小米米，等你一起出發！'));
    const stats = el('div', 'pet-stats'); append(stats, el('span', 'level-pill', `成長階段 ${level()}`), el('span', '', `✦ 已完成 ${state.xp} 個任務`));
    append(stats, el('div', 'growth-meter')); stats.lastChild.appendChild(el('div', 'growth-meter-fill', null, { style: `width:${level() === 3 ? 100 : (state.xp % 6) / 6 * 100}%` }));
    append(p, stats); return p;
  }
  function rewards() {
    const r = el('section', 'rewards-strip', null, { 'aria-label': '照顧與獎勵' });
    append(r, button('🍎 餵點心 · 10⚡', 'feed', 'reward-card', { disabled: state.energy < 10 ? 'disabled' : undefined }), button(state.decoration ? '🪴 小屋已布置' : '🪴 布置小屋 · 20⚡', 'decorate', 'reward-card', { disabled: state.decoration || state.energy < 20 ? 'disabled' : undefined }), button(state.outfit ? '🧢 新造型已穿上' : '🧢 街頭新造型 · 30⚡', 'outfit', 'reward-card', { disabled: state.outfit || state.energy < 30 ? 'disabled' : undefined }));
    return r;
  }
  function home() {
    const main = el('main', 'screen home-screen'); const layout = el('div', 'home-layout'); const hero = el('section', 'hero-content');
    append(hero, el('div', 'eyebrow', '第三關 · 身體與健康'), el('h1', '', '學一句英文，\n陪米米長大。'), el('p', 'hero-description', '聽英文、拼句子、完成對話。把學會的能量，變成米米的點心、造型和小屋！'));
    const cards = el('div', 'home-grid');
    ['🎧 聽一聽\n找出正確圖像', '🧩 排一排\n拼出完整句子', '💬 說一說\n完成情境對話'].forEach(text => cards.appendChild(el('div', 'feature-card', text)));
    append(hero, cards);
    const start = el('div', 'start-card');
    append(start, el('div', 'session-summary', `${settings.count} 個任務 · 約 5～8 分鐘 · 不限答題時間`));
    if (state.session && !state.session.done) append(start, button(`▶ 繼續冒險（${progress()} / ${state.session.originalCount}）`, 'resume', 'button-primary'), button('開始新的一輪', 'new', 'button-secondary'));
    else append(start, button('▶ 開始冒險', 'start', 'button-primary'), state.session && button('查看完成卡', 'completion', 'button-secondary'));
    append(start, button('❔ 操作教學', 'tutorial', 'button-link')); append(hero, start); append(layout, hero, petScene(true)); append(main, layout, rewards()); return main;
  }
  function audioRow(l) {
    const row = el('div', 'audio-row'); const label = el('label', 'rate-control', '語速 '); const select = el('select', '', null, { id: 'speech-rate', 'aria-label': '英文語速' });
    [[0.7, '慢速'], [0.85, '標準'], [1, '自然']].forEach(([v, text]) => { const option = el('option', '', text, { value: v }); option.selected = state.rate === v; select.appendChild(option); });
    append(label, select); append(row, button(audioPlaying ? '◼ 停止播放' : '🔊 播放英文', 'play', 'button-secondary', { disabled: paused ? 'disabled' : undefined }), label, button('💡 提示', 'hint', 'button-link', { disabled: paused ? 'disabled' : undefined })); return row;
  }
  function playing() {
    const q = current(), l = currentLesson(); if (!q || !l) { screen = 'home'; return home(); }
    const main = el('main', 'screen game-screen'); const grid = el('div', 'game-layout'); const panel = el('section', 'question-panel', null, { 'aria-label': '英文任務', 'data-type': q.type });
    append(panel, el('div', 'mission-meta', `${q.review ? '↻ 加強練習' : `任務 ${progress() + (q.correct ? 0 : 1)}`} · ${q.type === 'listen' ? '🎧 聽英文，選圖像' : q.type === 'order' ? '🧩 點選單字，排句子' : '💬 完成情境對話'}`));
    append(panel, el('h2', 'question-title', q.type === 'listen' ? '米米說了什麼？' : q.type === 'order' ? '幫米米把句子排好！' : '米米會怎麼說？'));
    append(panel, el('p', 'question-copy', q.type === 'listen' ? '先點「播放英文」，再選出符合意思的圖像。' : q.type === 'order' ? l.chinese : l.context));
    append(panel, audioRow(l));
    if (q.hint && !q.correct) append(panel, el('p', 'hint-box', q.type === 'listen' ? `提示：${l.english}` : q.type === 'order' ? `提示：第一個單字是 ${tokenize(l.english)[0]}。` : `提示：${l.chinese}`));
    if (q.type === 'order') {
      const slots = el('div', 'sentence-slots', null, { 'aria-label': '已排列的句子' });
      if (!selectedWords.length && !q.correct) slots.appendChild(el('span', 'slot-placeholder', '點下方單字，依順序放進來'));
      (q.correct ? tokenize(l.english).map((text, i) => ({ text, key: String(i) })) : selectedWords).forEach(word => slots.appendChild(button(word.text, 'remove-word', 'word-chip selected', { 'data-key': word.key, disabled: paused || q.correct ? 'disabled' : undefined })));
      append(panel, slots); const bank = el('div', 'word-bank', null, { 'aria-label': '可用的單字' });
      q.words.forEach(word => { const used = q.correct || selectedWords.some(w => w.key === word.key); bank.appendChild(button(word.text, 'word', `word-chip ${used ? 'used' : ''}`, { 'data-key': word.key, disabled: paused || used ? 'disabled' : undefined })); }); append(panel, bank);
      if (!q.correct) { const controls = el('div', 'sentence-controls'); append(controls, button('✓ 確認句子', 'check-order', 'button-primary check-order', { disabled: paused || selectedWords.length !== q.words.length ? 'disabled' : undefined }), button('↶ 重新排列', 'clear-words', 'button-link', { disabled: paused || !selectedWords.length ? 'disabled' : undefined })); append(panel, controls); }
    } else {
      const choices = el('div', 'choices answers-grid');
      q.options.forEach(id => { const option = lessonFor(id); const correct = q.correct && id === q.lessonId; const b = button('', 'answer', `choice-button answer-card ${correct ? 'is-correct' : ''} ${wrongChoice === id && !q.correct ? 'is-incorrect' : ''}`, { 'data-id': id, disabled: paused || q.correct ? 'disabled' : undefined });
        if (q.type === 'listen') append(b, el('span', 'choice-emoji', option.emoji, { 'aria-hidden': true }), el('span', 'choice-label', option.item), el('span', 'choice-meaning', option.chinese));
        else append(b, el('span', 'choice-english', option.english, { lang: 'en' }));
        choices.appendChild(b);
      }); append(panel, choices);
    }
    const fb = el('div', 'feedback', null, { 'aria-live': 'polite', role: 'status', 'data-tone': q.correct ? 'correct' : q.attempts ? 'incorrect' : 'neutral' });
    if (q.correct) append(fb, el('strong', '', '✨ 太棒了！米米獲得能量！'), el('span', 'feedback-english', l.english, { lang: 'en' }), el('span', '', l.chinese));
    else if (q.attempts) append(fb, el('strong', '', '再試一次，你可以的！'), el('span', '', q.type === 'order' ? '聽聽英文，想想每個單字的順序。' : '再聽一次，或點提示找線索。'));
    else append(fb, el('span', '', '不限時間，慢慢想。答錯也可以再試一次。'));
    append(panel, fb); const actions = el('div', 'mission-actions');
    append(actions, button('⏸ 暫停', 'pause', 'button-secondary'), q.correct && button(state.session.index === state.session.queue.length - 1 ? '查看完成卡 →' : '下一個任務 →', 'next', 'button-primary'));
    append(panel, actions); append(grid, petScene(), panel); append(main, grid, rewards()); return main;
  }
  function completion() {
    const s = state.session; if (!s) return home();
    const original = s.queue.filter(q => !q.review); const first = original.filter(q => q.firstCorrect).length;
    const main = el('main', 'screen completion-screen'); const card = el('section', 'completion-card', null, { id: 'completion-card' });
    append(card, el('div', 'eyebrow', '✦ 第三關 · 冒險紀念卡'), el('h1', '', '今日任務完成！'), el('p', 'hero-description', '你照顧了米米，也學會更清楚地說出身體的感覺。'));
    const stats = el('div', 'completion-stats'); append(stats, el('div', '', `🎯 首次答對\n${first} / ${s.originalCount}`), el('div', '', `📚 完成任務\n${s.originalCount} 題`), el('div', '', `↻ 加強練習\n${s.queue.filter(q => q.review).length} 題`)); append(card, stats);
    append(card, el('p', 'screenshot-note', '📷 可以用 iPad 截圖，保存這張完成卡！'));
    const review = el('div', 'review-list'); append(review, el('h2', '', s.missed.length ? '下次再複習這些句子' : '首次全答對！今天學會的句子'));
    (s.missed.length ? s.missed : original.map(q => q.lessonId)).forEach(id => { const l = lessonFor(id); const row = el('div', 'review-row'); append(row, el('span', 'review-emoji', l.emoji), el('div', 'review-copy')); append(row.lastChild, el('strong', '', l.english, { lang: 'en' }), el('span', '', l.chinese)); append(row, button('🔊', 'review-audio', 'button-icon', { 'data-id': id, 'aria-label': `播放 ${l.english}` })); review.appendChild(row); });
    const actions = el('div', 'mission-actions'); append(actions, button('再來一輪 →', 'new', 'button-primary'), button('回到小島', 'home', 'button-secondary')); append(card, actions); const hero = el('div', 'completion-hero'); append(hero, card, petScene(true)); const reviewPanel = el('section', 'completion-review-panel'); append(reviewPanel, review); append(main, hero, reviewPanel, rewards()); return main;
  }
  function render() {
    app.replaceChildren(); document.body.dataset.stage = screen;
    append(app, el('div', 'app-shell')); const shell = app.firstChild;
    append(shell, header(), screen === 'playing' ? playing() : screen === 'completed' ? completion() : home());
    const portrait = el('div', 'portrait-hint', null, { role: 'status' }); append(portrait, el('span', 'rotation-icon', '↻'), el('span', '', '把 iPad 橫過來，冒險畫面更好玩！')); append(shell, portrait);
    if (storageFailed) append(shell, el('div', 'storage-warning', '⚠ 這個瀏覽器暫時無法儲存進度。你仍可繼續玩；關閉網頁後，進度可能不會保留。', { role: 'status' }));
    if (notice) append(shell, el('div', 'toast', notice, { role: 'status' }), button('×', 'dismiss', 'toast-close', { 'aria-label': '關閉提示' }));
    if (modal) renderModal(shell);
    updateAudioButtons();
  }
  function modalBase(title, className = '') {
    const back = el('div', 'modal-backdrop'); const box = el('section', `modal ${className}`, null, { role: 'dialog', 'aria-modal': true, 'aria-label': title }); append(box, el('h2', '', title)); append(back, box); return { back, box };
  }
  function renderModal(shell) {
    if (modal === 'teacher') { renderTeacher(shell); return; }
    const tutorial = modal === 'tutorial'; const { back, box } = modalBase(tutorial ? '一起認識米米！' : '冒險暫停中');
    if (tutorial) {
      const steps = [ ['🎧', '先聽一聽', '點「播放英文」聽米米說話。可以重播，也可以調慢語速。'], ['🧩', '動手完成任務', '點選符合意思的圖像、依順序點單字，或選出情境中的英文。答錯可以再試。'], ['✨', '讓米米長大', '答對得到能量！可以餵點心、布置小屋、換造型。關掉網頁後，下次也能繼續。'] ];
      const [icon, title, copy] = steps[tutorialStep]; append(box, el('div', 'tutorial-illustration', icon), el('div', 'eyebrow', `${tutorialStep + 1} / 3`), el('h3', '', title), el('p', '', copy));
      if (tutorialStep === 0) { const demo = lessons.find(l => l.english === 'I am thirsty.') || lessons[0]; append(box, button(`🔊 試聽：${demo.english}`, 'demo-audio', 'button-secondary')); }
      append(box, button(tutorialStep === 2 ? '我準備好了 →' : '下一步 →', 'tutorial-next', 'button-primary'));
      if (state.tutorial) append(box, button('關閉教學', 'close-modal', 'button-link'));
    } else append(box, el('div', 'tutorial-illustration', '☁️'), el('p', '', '慢慢來，米米會在這裡等你。題目和進度都保留了。'), button('▶ 繼續冒險', 'unpause', 'button-primary'), button('回到小島', 'pause-home', 'button-secondary'));
    append(shell, back);
  }
  function parseMaterial(text) {
    const trimmed = text.trim(); if (!trimmed) return { errors: ['教材空白：請貼上 JSON 或「英文 | 中文」表格。'], rows: [], warnings: [] };
    let raw;
    try {
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed); raw = Array.isArray(parsed) ? parsed : parsed.lessons;
        if (!Array.isArray(raw)) throw new Error('JSON 必須是陣列，或有 lessons 陣列的物件。');
      } else {
        raw = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean).filter(line => !/^\|?\s*[-:]+\s*\|/.test(line)).map(line => {
          const cells = line.replace(/^\|\s*/, '').replace(/\s*\|$/, '').split('|').map(cell => cell.trim());
          if (/^(英文|english|句型)$/i.test(cells[0])) return null;
          if (cells.length < 2) throw new Error('每列至少要有「英文 | 中文」，請檢查分隔符號 |。');
          return { english: cells[0], chinese: cells[1], emoji: cells[2] || undefined, item: cells[3] || undefined, context: cells[4] || undefined, audio: cells[5] || undefined };
        }).filter(Boolean);
      }
    } catch (error) { return { errors: [`格式錯誤：${error.message}`], rows: [], warnings: [] }; }
    return validateLessons(raw);
  }
  function validateLessons(raw) {
    const errors = [], warnings = [], rows = [], seen = new Set();
    if (!Array.isArray(raw)) return { rows, warnings, errors: ['教材必須是陣列。'] };
    if (raw.length < 6) errors.push('教材不足：至少需要 6 句，才能安排不同的任務與選項。');
    if (raw.length > 100) errors.push('教材最多 100 句；請拆成不同的練習單元。');
    raw.slice(0, 100).forEach((row, i) => {
      if (!row || typeof row !== 'object') { errors.push(`第 ${i + 1} 列必須包含英文與中文。`); return; }
      const english = typeof row.english === 'string' ? row.english.trim().replace(/\s+/g, ' ') : '';
      const chinese = typeof row.chinese === 'string' ? row.chinese.trim() : '';
      if (!english || !chinese) errors.push(`第 ${i + 1} 列缺少 ${!english ? 'english 英文' : 'chinese 中文'}。`);
      if (english.length > 120 || tokenize(english).length > 12 || chinese.length > 100) errors.push(`第 ${i + 1} 列太長：英文限 12 個單字、120 個字元；中文限 100 字，請使用適合孩子的短句。`);
      if (english && !/^[A-Za-z][A-Za-z0-9\s.,?!'’\-:;]*[.?!]$/.test(english)) errors.push(`第 ${i + 1} 列英文「${english}」：請使用英文句子，並補上句尾標點。`);
      if (seen.has(english.toLowerCase())) errors.push(`第 ${i + 1} 列重複英文「${english}」：請保留一列。`); seen.add(english.toLowerCase());
      const singular = /\b(My (?:nose|throat|foot|arm|back|leg|head|mouth|stomach|tooth)) are\b/i;
      const plural = /\b(My (?:hands|eyes|ears|feet|teeth)) is\b/i;
      if (singular.test(english)) errors.push(`第 ${i + 1} 列「${english}」有疑義：單數主詞建議使用 is，請修正後匯入。`);
      if (plural.test(english)) errors.push(`第 ${i + 1} 列「${english}」有疑義：複數主詞建議使用 are，請修正後匯入。`);
      if (/\bI (?:is|are)\b/i.test(english)) errors.push(`第 ${i + 1} 列「${english}」有疑義：I 後面建議使用 am，請先核對。`);
      const existing = (window.DEFAULT_LESSONS || []).find(l => l.english === english);
      if (!existing) warnings.push(`第 ${i + 1} 列新增句型「${english}」：請教師核對文法、中文意思與情境。`);
      else if (normalizeMeaning(chinese) !== normalizeMeaning(existing.chinese)) warnings.push(`第 ${i + 1} 列「${english}」原示範意思為「${existing.chinese}」；目前為「${chinese}」，請核對。`);
      const audioURL = typeof row.audio === 'string' ? row.audio.trim() : '';
      if (audioURL && !/^(https:\/\/[^\s]+|data:audio\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)$/.test(audioURL)) errors.push(`第 ${i + 1} 列 audio 請使用 HTTPS 音檔網址，或由下方錄音上傳功能加入。`);
      const emoji = typeof row.emoji === 'string' && row.emoji.trim() ? row.emoji.trim().slice(0, 12) : existing ? existing.emoji : '💬';
      const item = typeof row.item === 'string' && row.item.trim() ? row.item.trim().slice(0, 60) : existing ? existing.item : chinese;
      const context = typeof row.context === 'string' && row.context.trim() ? row.context.trim().slice(0, 180) : existing ? existing.context : `寵物想表達：「${chinese}」請選出教材中對應的英文。`;
      // IDs are regenerated from row order when importing, so duplicate or unsafe IDs cannot alter grading.
      rows.push({ id: existing ? existing.id : `custom-${i + 1}`, english, chinese, emoji, item, context, ...(audioURL ? { audio: audioURL } : {}) });
    });
    if (new Set(rows.map(l => normalizeMeaning(l.chinese))).size < 4) errors.push('中文意思至少需要 4 種不同內容，才能產生唯一正解的選項。');
    if (new Set(rows.map(l => l.id)).size !== rows.length) errors.push('教材有重複句型；請刪除重複列。');
    return { rows, errors, warnings };
  }
  function renderTeacher(shell) {
    const { back, box } = modalBase('教師工作室', 'teacher-modal');
    append(box, el('p', '', '所有學習內容都來自這份教材。貼上後先檢查，再套用；學生不需要登入。'));
    const grid = el('div', 'teacher-grid'); const editor = el('div', 'form-field'); append(editor, el('label', '', '教材（JSON 或表格）', { for: 'material-input' }));
    const textarea = el('textarea', 'material-input', JSON.stringify(lessons, null, 2), { id: 'material-input', spellcheck: 'false', rows: '10' });
    append(editor, textarea, el('p', 'input-help', '表格每列：英文 | 中文 | 圖示（可省略） | 物品名稱（可省略） | 中文情境（可省略） | HTTPS 錄音網址（可省略）。JSON 必填 english、chinese。'));
    const side = el('div', 'teacher-settings'); const countLabel = el('label', 'form-field', '每輪題數 ', { for: 'question-count' }); const count = el('input', '', null, { id: 'question-count', type: 'number', min: '6', max: Math.min(21, lessons.length), value: settings.count }); append(countLabel, count); append(side, countLabel);
    append(side, button('檢查教材', 'validate-material', 'button-secondary'), button('載入示範教材', 'default-material', 'button-secondary'));
    const confirmLabel = el('label', 'teacher-confirm'); const check = el('input', '', null, { id: 'teacher-reviewed', type: 'checkbox' }); append(confirmLabel, check, el('span', '', '我已核對新增或修改教材的英文、中文、圖像及情境對應。')); append(side, confirmLabel);
    append(grid, editor, side); append(box, grid);
    const results = el('div', 'material-results', '目前教材已核對：兩句「喉嚨痛」不會同時成為選項，情境題以 hurts / sore 提供明確線索。', { id: 'material-results', role: 'status', 'aria-live': 'polite' }); append(box, results);
    const recorder = el('div', 'recording-field'); append(recorder, el('label', '', '加入老師的真人錄音 ', { for: 'recording-lesson' }));
    const recordingLesson = el('select', '', null, { id: 'recording-lesson', 'aria-label': '真人錄音對應句子' }); lessons.forEach(l => recordingLesson.appendChild(el('option', '', l.english, { value: l.id })));
    const file = el('input', '', null, { type: 'file', accept: 'audio/*', id: 'recording-file', 'aria-label': '選擇英文錄音檔' }); append(recorder, recordingLesson, file, el('p', 'input-help', '每個錄音限 5 MB。匯入後會加入教材編輯區；請再點「套用教材」。真人錄音優先播放。')); append(box, recorder);
    const actions = el('div', 'mission-actions'); append(actions, button('套用教材與題數', 'apply-material', 'button-primary'), button('⬇ 輸出已套用教材的學生版', 'export-student', 'button-secondary'), button('重設所有進度', 'reset-progress', 'button-secondary'), button('關閉', 'close-modal', 'button-secondary')); append(box, actions); append(shell, back);
  }
  function showMaterialResult(result) {
    const target = document.getElementById('material-results'); target.replaceChildren();
    target.dataset.tone = result.errors.length ? 'incorrect' : 'correct';
    if (!result.errors.length) target.appendChild(el('p', '', `✓ 格式檢查通過，共 ${result.rows.length} 句。英文拼字、文法與教學適切性仍須由教師確認。`));
    [...result.errors, ...result.warnings].forEach(message => target.appendChild(el('p', '', message)));
  }
  function teacherApply() {
    const result = parseMaterial(document.getElementById('material-input').value); showMaterialResult(result); if (result.errors.length) return;
    const count = Number(document.getElementById('question-count').value);
    if (!Number.isInteger(count) || count < 6 || count > Math.min(21, result.rows.length)) { const n = document.getElementById('material-results'); n.appendChild(el('p', '', `題數請填 6～${Math.min(21, result.rows.length)} 之間的整數。`)); return; }
    if (result.warnings.length && !document.getElementById('teacher-reviewed').checked) { document.getElementById('material-results').appendChild(el('p', '', '請先核對上列教材疑義，再勾選「我已核對」；尚未套用。')); return; }
    const changed = JSON.stringify(result.rows) !== JSON.stringify(lessons);
    if (changed && state.session && !window.confirm('更換教材會開始新的學習進度，寵物能量與成長會保留。確定套用嗎？')) return;
    stopAudio(); lessons = result.rows; settings.count = count;
    safeWrite(CONFIG_KEY, { lessons, count });
    if (changed) state.session = null;
    state.fingerprint = fingerprint(); persist(); modal = null; screen = 'home'; notice = `教材已套用：${lessons.length} 句，每輪 ${count} 題。`; render();
  }
  function blobDataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); }
  async function attachRecording(file) {
    if (!file) return;
    const target = document.getElementById('material-results');
    const audioTypes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', webm: 'audio/webm' };
    const extension = file.name.split('.').pop().toLowerCase();
    const mime = file.type.startsWith('audio/') ? file.type : (!file.type ? audioTypes[extension] : null);
    if (!file.size || file.size > 5 * 1024 * 1024 || !mime) { target.textContent = '請選擇非空白、5 MB 以內的音檔（例如 MP3、M4A、WAV）。'; return; }
    const result = parseMaterial(document.getElementById('material-input').value);
    if (result.errors.length) { showMaterialResult(result); return; }
    const id = document.getElementById('recording-lesson').value;
    const original = lessonFor(id); const row = result.rows.find(l => l.english === original.english);
    if (!row) { target.textContent = '編輯區沒有這句英文。請先套用教材，再選擇對應句子。'; return; }
    try { row.audio = await blobDataURL(new Blob([file], { type: mime })); const input = document.getElementById('material-input'); if (!input || !target.isConnected) return; input.value = JSON.stringify(result.rows, null, 2); target.textContent = `已加入「${row.english}」的錄音，請點「套用教材」。`; } catch (_) { target.textContent = '音檔讀取失敗，請重新選擇。'; }
  }
  async function exportStudent() {
    const results = document.getElementById('material-results'); results.textContent = '正在準備可獨立開啟的學生版，請稍候…';
    try {
      const files = await Promise.all(['styles.css', 'app.js', PET].map(async path => { const response = await fetch(path); if (!response.ok) throw new Error('讀取失敗'); return path === PET ? blobDataURL(await response.blob()) : response.text(); }));
      const [css, js, petData] = files;
      const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
      const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>英語寵物冒險・學生版</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="app"></div><script>window.STUDENT_MODE=true;window.DEFAULT_LESSONS=${json(lessons)};window.DEFAULT_SETTINGS=${json({ count: settings.count })};window.PET_ASSET=${json(petData)};<\/script><script>${js.replace(/<\/script/gi, '<\\/script')}<\/script></body></html>`;
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = el('a', 'button button-primary', '⬇ 學生版已準備好，點此下載', { href: url, download: '英語寵物冒險-第三關.html' }); results.replaceChildren(link, el('p', '', '學生版內含目前已套用的教材、寵物素材和完整功能，不顯示教師選單；尚未套用的編輯不包含在內。iPad 可直接用遊戲網址；HTML 可交給家長下載保存。'));
      link.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 60000), { once: true });
    } catch (_) { results.textContent = '學生版輸出失敗，請確認網路並重試。也可以直接分享目前的遊戲網址。'; }
  }
  function animatePet(action) { clearTimeout(animationTimer); petAction = action; animationTimer = setTimeout(() => { petAction = ''; const scene = document.querySelector('.pet-scene'); if (scene) { scene.classList.remove('is-happy', 'is-eating', 'is-drinking', 'is-waving'); scene.querySelector('.pet-action-icon')?.remove(); const caption = scene.querySelector('.scene-caption'); if (caption) caption.textContent = level() === 3 ? '米米長大了！一起繼續冒險。' : level() === 2 ? '米米解鎖成長星星！' : '小小米米，等你一起出發！'; } }, 1800); }
  function grade(isCorrect, choice = '') {
    const q = current(); if (!q || q.correct || paused || modal || screen !== 'playing') return;
    q.attempts++;
    if (!isCorrect) { if (q.firstCorrect === null) q.firstCorrect = false; wrongChoice = choice; if (!state.session.missed.includes(q.lessonId)) state.session.missed.push(q.lessonId); persist(); render(); return; }
    if (q.firstCorrect === null) q.firstCorrect = true;
    q.correct = true; wrongChoice = ''; state.energy += q.review ? 5 : 10;
    if (!q.review) {
      state.xp++;
      // An initially missed sentence appears once later, without endlessly extending the session.
      if (!q.firstCorrect) state.session.queue.push(makeQuestion(currentLesson(), TYPES[(TYPES.indexOf(q.type) + 1) % 3], true));
    }
    animatePet(q.lessonId === 'thirsty' ? 'drinking' : q.lessonId === 'hungry' ? 'eating' : 'happy'); persist(); render();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) { const exit = document.exitFullscreen || document.webkitExitFullscreen; if (exit) await exit.call(document); return; }
      const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (!request) { notice = '這個瀏覽器不支援網頁全螢幕。把 iPad 橫過來即可完整遊玩；Safari 也可收合網址列。'; render(); return; }
      await request.call(document.documentElement);
      if (window.screen.orientation && typeof window.screen.orientation.lock === 'function') { try { await window.screen.orientation.lock('landscape'); } catch (_) { /* Rotation remains a manual operation on iPad. */ } }
    } catch (_) { notice = '目前無法切換全螢幕。把 iPad 橫過來即可完整遊玩。'; render(); }
  }
  app.addEventListener('click', event => {
    const b = event.target.closest('[data-action]'); if (!b || b.disabled) return; const action = b.dataset.action;
    if (modal && !b.closest('.modal') && !['dismiss'].includes(action)) return;
    if (['answer', 'word', 'remove-word', 'check-order', 'clear-words', 'hint', 'next'].includes(action) && (paused || modal)) return;
    if (action === 'start') startNew();
    else if (action === 'new') { if (state.session && !state.session.done && !window.confirm('要重新開始這輪任務嗎？這輪答題進度會重設；寵物能量與成長會保留。')) return; startNew(); }
    else if (action === 'resume') resume();
    else if (action === 'home') { stopAudio(); screen = 'home'; render(); }
    else if (action === 'completion') { screen = 'completed'; render(); }
    else if (action === 'play') speak(currentLesson());
    else if (action === 'review-audio') speak(lessonFor(b.dataset.id));
    else if (action === 'demo-audio') speak(lessons.find(l => l.english === 'I am thirsty.') || lessons[0]);
    else if (action === 'mute') { state.muted = !state.muted; stopAudio(); persist(); render(); }
    else if (action === 'fullscreen') fullscreen();
    else if (action === 'hint') { const q = current(); if (!q || q.correct) return; q.hint = true; persist(); render(); }
    else if (action === 'answer') grade(b.dataset.id === current().lessonId, b.dataset.id);
    else if (action === 'word') { const q = current(); if (!q || q.correct) return; const word = q.words.find(w => w.key === b.dataset.key); if (word && !selectedWords.some(w => w.key === word.key)) selectedWords.push(word); render(); }
    else if (action === 'remove-word') { if (current().correct) return; selectedWords = selectedWords.filter(w => w.key !== b.dataset.key); render(); }
    else if (action === 'clear-words') { selectedWords = []; render(); }
    else if (action === 'check-order') { if (selectedWords.length !== current().words.length) return; grade(selectedWords.map(w => w.text).join(' ') === currentLesson().english); }
    else if (action === 'next') {
      if (!current().correct) return; stopAudio(); notice = ''; selectedWords = []; wrongChoice = '';
      if (state.session.index === state.session.queue.length - 1) { state.session.done = true; screen = 'completed'; }
      else state.session.index++; persist(); render();
    }
    else if (action === 'pause') { stopAudio(); paused = true; modal = 'pause'; render(); }
    else if (action === 'unpause') { paused = false; modal = null; render(); }
    else if (action === 'pause-home') { paused = false; modal = null; screen = 'home'; render(); }
    else if (action === 'tutorial') { stopAudio(); tutorialStep = 0; modal = 'tutorial'; render(); }
    else if (action === 'tutorial-next') { stopAudio(); if (tutorialStep === 2) { state.tutorial = true; modal = null; persist(); } else tutorialStep++; render(); }
    else if (action === 'close-modal') { stopAudio(); modal = null; render(); }
    else if (action === 'teacher' && !STUDENT) { stopAudio(); modal = 'teacher'; render(); }
    else if (action === 'validate-material') showMaterialResult(parseMaterial(document.getElementById('material-input').value));
    else if (action === 'default-material') { document.getElementById('material-input').value = JSON.stringify(window.DEFAULT_LESSONS, null, 2); showMaterialResult(parseMaterial(document.getElementById('material-input').value)); }
    else if (action === 'apply-material') teacherApply();
    else if (action === 'export-student') exportStudent();
    else if (action === 'reset-progress') { if (!window.confirm('確定重設全部進度嗎？答題、能量、成長、造型與小屋將全部歸零，教材會保留。')) return; stopAudio(); state = baseState(); state.tutorial = true; screen = 'home'; modal = null; persist(); notice = '進度已重設，米米準備重新出發。'; render(); }
    else if (action === 'feed' && state.energy >= 10) { state.energy -= 10; state.feeds++; animatePet('eating'); persist(); render(); }
    else if (action === 'decorate' && state.energy >= 20 && !state.decoration) { state.energy -= 20; state.decoration = true; notice = '🌈 彩虹與盆栽加入小島！'; persist(); render(); }
    else if (action === 'outfit' && state.energy >= 30 && !state.outfit) { state.energy -= 30; state.outfit = true; animatePet('waving'); notice = '🧢 米米戴上了新的街頭帽！'; persist(); render(); }
    else if (action === 'dismiss') { notice = ''; render(); }
  });
  app.addEventListener('change', event => {
    if (event.target.id === 'speech-rate') { const rate = Number(event.target.value); if ([0.7, 0.85, 1].includes(rate)) { stopAudio(); state.rate = rate; persist(); render(); } }
    if (event.target.id === 'recording-file') attachRecording(event.target.files[0]);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
  window.addEventListener('pagehide', () => { stopAudio(); persist(); });
  render();
})();
