'use strict';

/* ============================================================
   MoE AI — frontend application
   Single-page shell with hash routing. All data comes from the
   secure backend; no API keys ever live in the browser.
   ============================================================ */

const state = {
  settings: null,
  providers: null,
  defaults: null,
  apiKeyConfigured: false,
  stats: null,
  lastRecord: null,
  metricsView: 'last',
  pending: false,
  manualExpert: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtTok = (n) => (n == null ? '—' : Number(n).toLocaleString());
const fmtPct = (n) => (n == null ? '—' : Number(n).toFixed(1) + '%');

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.001) return '$' + n.toFixed(5);
  if (n > 0) return '$' + n.toFixed(7);
  return '$0.00';
}

function fmtWh(wh) {
  if (wh == null || isNaN(wh)) return '—';
  if (wh >= 1000) return (wh / 1000).toFixed(2) + ' kWh';
  if (wh >= 100) return wh.toFixed(0) + ' Wh';
  return wh.toFixed(2) + ' Wh';
}

function fmtL(l) {
  if (l == null || isNaN(l)) return '—';
  if (l >= 1000) return (l / 1000).toFixed(2) + ' m³';
  if (l >= 1) return l.toFixed(2) + ' L';
  return l.toFixed(3) + ' L';
}

function fmtKg(kg) {
  if (kg == null || isNaN(kg)) return '—';
  if (kg >= 1000) return (kg / 1000).toFixed(2) + ' t';
  if (kg >= 1) return kg.toFixed(2) + ' kg';
  return (kg * 1000).toFixed(1) + ' g';
}

function fmtMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function toast(message, type) {
  const root = document.getElementById('toastRoot');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = message;
  root.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function openModal(html, large) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal${large ? ' modal-lg' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2 id="modalTitle"></h2>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">${html}</div>
      </div>
    </div>`;
  const overlay = root.querySelector('.modal-overlay');
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', closeOnEsc);
}

function closeOnEsc(e) {
  if (e.key === 'Escape') closeModal();
}

function closeModal() {
  document.removeEventListener('keydown', closeOnEsc);
  document.getElementById('modalRoot').innerHTML = '';
}

function spinner() {
  return '<span class="spin"></span>';
}

// Minimal markdown-lite renderer for answers (bold, code, code blocks, bullets, headings).
function md(text) {
  if (!text) return '';
  const escTxt = (t) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = String(text).split(/```/);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      html += '<pre class="code-block">' + escTxt(parts[i].replace(/^\n/, '')) + '</pre>';
      continue;
    }
    const inline = (t) =>
      escTxt(t)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    const lines = parts[i].split('\n');
    let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        if (inList) { html += '</ul>'; inList = false; }
        continue;
      }
      if (/^#{1,3}\s/.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        const lvl = line.match(/^#+/)[0].length;
        html += `<h${lvl}>${inline(line.replace(/^#+\s*/, ''))}</h${lvl}>`;
        continue;
      }
      if (line.startsWith('- ')) {
        if (!inList) html += '<ul>';
        inList = true;
        html += '<li>' + inline(line.slice(2)) + '</li>';
        continue;
      }
      if (inList) { html += '</ul>'; inList = false; }
      html += '<div class="md-line">' + inline(line) + '</div>';
    }
    if (inList) html += '</ul>';
  }
  return html;
}

// ---------------------------------------------------------------------------
// Boot / theme / navigation
// ---------------------------------------------------------------------------
async function loadSettings() {
  const data = await api('/api/settings');
  state.settings = data.settings;
  state.providers = data.providers;
  state.defaults = data.defaults;
  state.apiKeyConfigured = data.apiKeyConfigured;
}

let systemThemeListener = null;

function resolveTheme() {
  const t = state.settings && state.settings.theme ? state.settings.theme : 'light';
  if (t === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
}

function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme();
  if (systemThemeListener) {
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', systemThemeListener);
    systemThemeListener = null;
  }
  if (state.settings && state.settings.theme === 'system') {
    systemThemeListener = () => applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', systemThemeListener);
  }
}

function updateSidebarBadge() {
  const demo = !state.settings || state.settings.provider === 'demo' ||
    state.settings.routerMode === 'demo' || !state.apiKeyConfigured;
  document.getElementById('modeBadgeSidebar').classList.toggle('hidden', !demo);
}

const NAV_ITEMS = ['chat', 'environmental', 'dashboard', 'experts', 'analytics', 'history', 'settings', 'about'];

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return NAV_ITEMS.includes(hash) ? hash : 'chat';
}

function wireNav() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = '#/' + btn.dataset.route;
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarScrim').classList.add('hidden');
    });
  });
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    const s = document.getElementById('sidebar');
    s.classList.toggle('open');
    document.getElementById('sidebarScrim').classList.toggle('hidden', !s.classList.contains('open'));
  });
  document.getElementById('sidebarScrim').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarScrim').classList.add('hidden');
  });
}

function highlightNav(route) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
}

const VIEWS = {
  chat: viewChat,
  environmental: viewEnvironmental,
  dashboard: viewDashboard,
  experts: viewExperts,
  analytics: viewAnalytics,
  history: viewHistory,
  settings: viewSettings,
  about: viewAbout,
};

async function renderRoute() {
  const route = currentRoute();
  highlightNav(route);
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty-state"><div class="big">⬡</div>Loading…</div>';
  try {
    const view = VIEWS[route] || viewChat;
    await view(content);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="big">⚠</div>${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------
async function viewChat(content) {
  const s = state.settings;
  const manual = s.routerMode === 'manual';
  let expertOptions = '';
  if (manual) {
    const data = await api('/api/experts');
    expertOptions = data.experts
      .map((e) => `<option value="${e.id}" ${state.manualExpert === e.id ? 'selected' : ''}>${esc(e.name)}</option>`)
      .join('');
  }

  content.innerHTML = `
    <div class="chat-layout">
      <section class="chat-main card">
        <header class="chat-header">
          <div>
            <h1>Chat</h1>
            <div class="sub">
              Question → Router → Expert → Answer
              <span id="chatModeBadge"></span>
            </div>
          </div>
          <div class="chat-tools">
            <div id="manualPicker" class="${manual ? '' : 'hidden'}" style="min-width:180px">
              <select id="manualExpert" class="${manual ? '' : 'hidden'}">${expertOptions}</select>
            </div>
          </div>
        </header>
        <div class="chat-scroll" id="chatMessages"></div>
        <div id="stages" class="stages hidden"></div>
        <form id="chatForm" class="chat-form">
          <textarea id="chatInput" rows="1" placeholder="Ask a question… (e.g. “Explain how photosynthesis works”)"></textarea>
          <button id="sendBtn" class="btn btn-primary" type="submit">Send</button>
        </form>
      </section>

      <aside class="metrics-panel">
        <div class="card metrics-card">
          <div class="metrics-head">
            <span class="title">MoE Metrics</span>
            <div class="seg">
              <button data-m="last" class="${state.metricsView === 'last' ? 'on' : ''}">Last query</button>
              <button data-m="totals" class="${state.metricsView === 'totals' ? 'on' : ''}">Totals</button>
            </div>
          </div>
          <div id="metricsBody"><div class="empty-state">Ask a question to see metrics.</div></div>
        </div>
        <div class="card metrics-card">
          <div class="metrics-head"><span class="title">Router pipeline</span></div>
          <div id="pipelineState" class="kv-list" style="display:flex;flex-direction:column;gap:6px">
            <div class="empty-state" style="padding:8px 0">Idle — waiting for a question.</div>
          </div>
        </div>
      </aside>
    </div>`;

  updateChatModeBadge();

  const form = content.querySelector('#chatForm');
  const input = content.querySelector('#chatInput');
  const sendBtn = content.querySelector('#sendBtn');
  const messages = content.querySelector('#chatMessages');
  const stages = content.querySelector('#stages');
  const manualSelect = content.querySelector('#manualExpert');

  if (manualSelect) {
    manualSelect.addEventListener('change', () => { state.manualExpert = manualSelect.value; });
  }

  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  };
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });

  content.querySelectorAll('.seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.metricsView = btn.dataset.m;
      content.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b === btn));
      renderMetrics();
    });
  });

  function send() {
    const text = input.value.trim();
    if (!text || state.pending) return;
    state.pending = true;
    sendBtn.disabled = true;
    appendUser(text);
    input.value = '';
    autoGrow();
    showStages();
    const expertOverride = state.settings.routerMode === 'manual' ? (manualSelect ? manualSelect.value : '') : undefined;
    api('/api/chat', {
      method: 'POST',
      body: JSON.stringify(expertOverride ? { question: text, expertId: expertOverride } : { question: text }),
    })
      .then((data) => {
        state.lastRecord = data.record;
        appendAssistant(data.record, true);
        finishStages();
        return api('/api/stats');
      })
      .then((stats) => { state.stats = stats; renderMetrics(); updateChatModeBadge(); })
      .catch((err) => {
        finishStages();
        appendError(err.message);
        toast(err.message, 'err');
      })
      .finally(() => {
        state.pending = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  function showStages() {
    const names = ['Analyzing', 'Detecting Subject', 'Routing', 'Expert Processing', 'Answer'];
    stages.innerHTML = names
      .map((n, i) =>
        i === 0
          ? `<span class="stage on"><span class="dot"></span>${n}</span>`
          : `<span class="stage"><span class="dot"></span>${n}</span>`
      )
      .join('<span class="stage-arrow">→</span>');
    stages.classList.remove('hidden');
    stages.__timer = setInterval(() => {
      const all = stages.querySelectorAll('.stage');
      const current = stages.querySelector('.stage.on');
      if (!current) { clearInterval(stages.__timer); return; }
      const idx = [...all].indexOf(current);
      current.classList.remove('on');
      current.classList.add('done');
      if (idx + 1 < all.length) all[idx + 1].classList.add('on');
    }, 480);
  }

  function finishStages() {
    if (stages.__timer) clearInterval(stages.__timer);
    stages.querySelectorAll('.stage').forEach((st) => { st.classList.remove('on'); st.classList.add('done'); });
    setTimeout(() => stages.classList.add('hidden'), 400);
  }

  function scrollBottom() { messages.scrollTop = messages.scrollHeight; }

  function appendUser(text) {
    const el = document.createElement('div');
    el.className = 'user-msg';
    el.textContent = text;
    messages.appendChild(el);
    scrollBottom();
  }

  function appendError(text) {
    const el = document.createElement('div');
    el.className = 'assistant-answer';
    el.style.borderColor = 'var(--red)';
    el.textContent = '⚠ ' + text;
    messages.appendChild(el);
    scrollBottom();
  }

  function appendAssistant(record, animate) {
    const wrap = document.createElement('div');
    wrap.innerHTML = assistantBlock(record);
    const node = wrap.firstElementChild;
    bindStepToggles(node);
    messages.appendChild(node);
    scrollBottom();
  }

  // Rebuild prior conversation (newest-first from the backend).
  try {
    const hist = await api('/api/history?limit=40&full=1');
    const records = hist.records.slice().reverse();
    for (const rec of records) {
      appendUser(rec.question);
      appendAssistant(rec, false);
    }
    if (records.length) {
      state.lastRecord = records[records.length - 1];
      const st = await api('/api/stats');
      state.stats = st;
      renderMetrics();
    } else {
      renderMetrics();
    }
  } catch (err) {
    renderMetrics();
  }
}

function expertColor(id) {
  const colors = {
    mathematics: '#6366f1', physics: '#8b5cf6', chemistry: '#ec4899', biology: '#10b981',
    history: '#f59e0b', coding: '#3b82f6', language: '#14b8a6', general: '#64748b',
  };
  return colors[id] || '#64748b';
}

function expertIcon(id) {
  const icons = { mathematics: '∑', physics: 'ƒ', chemistry: '⚗', biology: '✿', history: '§', coding: '</>', language: '文', general: '✦' };
  return icons[id] || '✦';
}

function stepRow(index, label, value, color, detailHtml, open) {
  return `
    <div class="step-row ${open ? 'open' : ''}" role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}">
      <span class="step-index">${index}</span>
      <span class="step-label">${label}</span>
      <span class="step-value">${color ? `<span class="expert-dot" style="background:${color}"></span>` : ''}${esc(value)}</span>
      <span class="step-chev">⌄</span>
    </div>
    <div class="step-detail ${open ? 'open' : ''}">${detailHtml}</div>`;
}

function assistantBlock(record) {
  const color = expertColor(record.expert);
  const demoNote = record.demo
    ? `<div class="demo-note">Demo Mode — ${esc(record.demoReason || 'simulated response, no API key configured.')}</div>`
    : '';
  const candidateHtml = (record.candidateExperts || [])
    .map(
      (c) =>
        `<div class="detail-item"><span class="k">${esc(c.expertId)}</span><span class="v">${fmtPct(c.confidence * 100)}</span></div>`
    )
    .join('');

  const detail1 = `
    <div class="detail-grid">
      <div class="detail-item"><span class="k">Subject</span><span class="v">${esc(record.subject)}</span></div>
      <div class="detail-item"><span class="k">Confidence</span><span class="v">${fmtPct(record.confidence * 100)}</span></div>
      <div class="detail-item"><span class="k">Routed to General</span><span class="v">${record.routedToGeneral ? 'Yes' : 'No'}</span></div>
    </div>
    <div class="detail-item"><span class="k">All candidates (top 4)</span>
      <div class="detail-grid" style="margin-top:6px">${candidateHtml}</div>
    </div>`;

  const detail2 = `
    <div class="detail-grid">
      <div class="detail-item"><span class="k">Router decision</span><span class="v">${esc(record.expertName)}</span></div>
      <div class="detail-item"><span class="k">Confidence</span><span class="v">${fmtPct(record.confidence * 100)}</span></div>
      <div class="detail-item"><span class="k">Mode</span><span class="v">${esc(record.routerMode)}</span></div>
    </div>
    <div class="detail-item"><span class="k">Routing reasoning</span>
      <div class="v" style="font-weight:400;color:var(--text-2);margin-top:4px">${esc(record.routingReason)}</div>
    </div>`;

  const detail3 = `
    <div class="detail-grid">
      <div class="detail-item"><span class="k">Prompt sent to</span><span class="v">${esc(record.expertName)}</span></div>
      <div class="detail-item"><span class="k">Input tokens</span><span class="v">${fmtTok(record.inputTokens)}</span></div>
    </div>
    <div class="detail-item"><span class="k">Prompt (system prompt + question)</span>
      <div class="prompt-box">${esc(record.promptSent || '')}</div>
    </div>`;

  const detail4 = `
    <div class="detail-grid">
      <div class="detail-item"><span class="k">Model</span><span class="v">${esc(record.model)}</span></div>
      <div class="detail-item"><span class="k">Provider</span><span class="v">${esc(record.provider)}</span></div>
      <div class="detail-item"><span class="k">Output tokens</span><span class="v">${fmtTok(record.outputTokens)}</span></div>
      <div class="detail-item"><span class="k">Response time</span><span class="v">${fmtMs(record.responseTimeMs)}</span></div>
      <div class="detail-item"><span class="k">Source</span><span class="v">${esc(record.source)}</span></div>
    </div>`;

  const steps = [
    stepRow(1, 'Subject Detected', record.subject, null, detail1, false),
    stepRow(2, 'Router Decision', record.expertName + ' Expert', color, detail2, false),
    stepRow(3, 'Question given to', record.expertName + ' Expert', color, detail3, false),
    stepRow(4, 'Answer from', record.expertName + ' Expert', color, detail4, false),
  ].join('');

  return `
    <div class="assistant-msg" data-id="${esc(record.id)}">
      <div class="assistant-head">
        <span class="expert-dot" style="background:${color}"></span>
        ${esc(record.expertName)} Expert
        <span class="badge ${record.demo ? 'badge-amber' : 'badge-green'}">${record.demo ? 'Demo' : 'Live API'}</span>
      </div>
      <div class="assistant-answer">${demoNote}${md(record.answer)}</div>
      <div class="steps">${steps}</div>
      <div class="msg-meta">
        <span>${fmtTok(record.totalTokens)} tokens</span>
        <span>${fmtMoney(record.cost)} cost</span>
        <span>${fmtWh(record.energyEstimate)} energy (est.)</span>
        <span>${fmtMs(record.responseTimeMs)}</span>
      </div>
    </div>`;
}

function bindStepToggles(root) {
  root.querySelectorAll('.step-row').forEach((row) => {
    const toggle = () => {
      row.classList.toggle('open');
      row.setAttribute('aria-expanded', row.classList.contains('open'));
      const detail = row.nextElementSibling;
      if (detail && detail.classList.contains('step-detail')) detail.classList.toggle('open');
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

function updateChatModeBadge() {
  const el = document.getElementById('chatModeBadge');
  if (!el) return;
  const s = state.settings;
  if (!s) return;
  const demo = s.provider === 'demo' || s.routerMode === 'demo' || !state.apiKeyConfigured;
  el.innerHTML = demo
    ? ' <span class="badge badge-amber">Demo Mode</span>'
    : ' <span class="badge badge-green">' + esc(s.provider) + ' · ' + esc(s.model) + '</span>';
}

// ---------------------------------------------------------------------------
// Metrics panel
// ---------------------------------------------------------------------------
function metricRow(label, value, tag, tagClass, extraClass) {
  const tagHtml = tag ? `<span class="m-tag ${tagClass}">${tag}</span>` : '';
  return `<div class="metric-row ${extraClass || ''}">
    <span class="m-label">${label}${tagHtml}</span>
    <span class="m-value">${value}</span>
  </div>`;
}

function renderMetrics() {
  const body = document.getElementById('metricsBody');
  if (!body) return;
  const last = state.lastRecord;
  const stats = state.stats;

  if (state.metricsView === 'last' && last) {
    body.innerHTML = [
      metricRow('Experts Available', '8', '', ''),
      metricRow('Experts Activated', '1', '', ''),
      metricRow('Tokens Used', fmtTok(last.totalTokens) + `<span class="sub">${fmtTok(last.inputTokens)} in · ${fmtTok(last.outputTokens)} out</span>`, 'EST.', 'est'),
      metricRow('Dense Eq. Tokens', fmtTok(last.denseEquivalentTokens), 'HYP.', 'hyp'),
      metricRow('Tokens Saved', fmtTok(last.tokensSaved), 'HYP.', 'hyp'),
      metricRow('Token Reduction', fmtPct(last.tokenReductionPct), 'HYP.', 'hyp', 'green'),
      metricRow('Estimated Cost', fmtMoney(last.cost), 'EST.', 'est'),
      metricRow('Cost Saved', fmtMoney(last.costSaved), 'HYP.', 'hyp', 'green'),
      metricRow('Energy Used', fmtWh(last.energyEstimate), 'EST.', 'est'),
      metricRow('Response Time', fmtMs(last.responseTimeMs), 'ACT.', 'act'),
    ].join('');
  } else if (state.metricsView === 'totals' && stats) {
    body.innerHTML = [
      metricRow('Total Queries', fmtTok(stats.totalQueries), '', ''),
      metricRow('Experts Activated', stats.expertsActivated + ' / ' + stats.expertsAvailable, '', ''),
      metricRow('Total Tokens', fmtTok(stats.totalTokens), 'EST.', 'est'),
      metricRow('Dense Eq. Tokens', fmtTok(stats.denseEquivalentTokens), 'HYP.', 'hyp'),
      metricRow('Tokens Saved', fmtTok(stats.tokensSaved), 'HYP.', 'hyp'),
      metricRow('Token Reduction', fmtPct(stats.tokenReductionPct), 'HYP.', 'hyp', 'green'),
      metricRow('Estimated Cost', fmtMoney(stats.cost), 'EST.', 'est'),
      metricRow('Cost Saved', fmtMoney(stats.costSaved), 'HYP.', 'hyp', 'green'),
      metricRow('Energy Used', fmtWh(stats.energyEstimate), 'EST.', 'est'),
      metricRow('Avg Response', fmtMs(stats.avgResponseTime), 'ACT.', 'act'),
    ].join('');
  } else {
    body.innerHTML = '<div class="empty-state">Ask a question to see metrics.</div>';
  }

  const pipeline = document.getElementById('pipelineState');
  if (pipeline) {
    if (last) {
      pipeline.innerHTML = `
        <div class="detail-item"><span class="k">Last subject</span><span class="v">${esc(last.subject)}</span></div>
        <div class="detail-item"><span class="k">Last expert</span><span class="v">${esc(last.expertName)}</span></div>
        <div class="detail-item"><span class="k">Confidence</span><span class="v">${fmtPct(last.confidence * 100)}</span></div>
        <div class="detail-item"><span class="k">Router</span><span class="v">${esc(last.routerMode)}</span></div>
        <div class="detail-item"><span class="k">Source</span><span class="v">${esc(last.source)}</span></div>`;
    } else {
      pipeline.innerHTML = '<div class="empty-state" style="padding:8px 0">Idle — waiting for a question.</div>';
    }
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function viewDashboard(content) {
  const stats = await api('/api/stats');
  state.stats = stats;
  const s = state.settings;

  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-sub">Overview of all routing activity. Environmental values are estimates.</p>
      </div>
      <span class="badge ${s.provider === 'demo' || !state.apiKeyConfigured ? 'badge-amber' : 'badge-green'}">
        ${s.provider === 'demo' || !state.apiKeyConfigured ? 'Demo Mode' : esc(s.provider) + ' · ' + esc(s.model)}
      </span>
    </div>

    <div class="grid cards-3">
      <div class="stat"><div class="stat-label">Total Queries</div><div class="stat-value">${fmtTok(stats.totalQueries)}</div></div>
      <div class="stat"><div class="stat-label">Total Tokens</div><div class="stat-value">${fmtTok(stats.totalTokens)}</div><div class="stat-note">${fmtTok(stats.inputTokens)} in · ${fmtTok(stats.outputTokens)} out</div></div>
      <div class="stat green"><div class="stat-label">Tokens Saved <span class="m-tag hyp">HYPOTHETICAL</span></div><div class="stat-value">${fmtTok(stats.tokensSaved)}</div><div class="stat-note">${fmtPct(stats.tokenReductionPct)} reduction vs. dense model</div></div>
      <div class="stat green"><div class="stat-label">Estimated Energy Saved <span class="m-tag est">ESTIMATE</span></div><div class="stat-value">${fmtWh(stats.energySaved)}</div></div>
      <div class="stat green"><div class="stat-label">Estimated Water Saved <span class="m-tag est">ESTIMATE</span></div><div class="stat-value">${fmtL(stats.waterSaved)}</div></div>
      <div class="stat green"><div class="stat-label">Estimated CO₂e Avoided <span class="m-tag est">ESTIMATE</span></div><div class="stat-value">${fmtKg(stats.co2Saved)}</div></div>
      <div class="stat accent"><div class="stat-label">Most Used Expert</div><div class="stat-value">${esc(stats.mostUsedExpertName || '—')}</div></div>
      <div class="stat"><div class="stat-label">Average Routing Confidence</div><div class="stat-value">${fmtPct(stats.avgConfidence * 100)}</div></div>
      <div class="stat"><div class="stat-label">Average Response Time</div><div class="stat-value">${fmtMs(stats.avgResponseTime)}</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2 class="card-title">Pipeline</h2>
      <p class="card-desc">How a question flows through the system, every time.</p>
      <div class="pipeline">
        <div class="pipe-node">Question</div>
        <span class="pipe-arrow">→</span>
        <div class="pipe-node router">Router</div>
        <span class="pipe-arrow">→</span>
        <div class="pipe-node expert">Expert</div>
        <span class="pipe-arrow">→</span>
        <div class="pipe-node">Answer</div>
        <span class="pipe-arrow">→</span>
        <div class="pipe-node">Metrics</div>
      </div>
      <div class="metrics-note">
        ACTUAL values are measured by this app · ESTIMATED values use configurable assumptions ·
        HYPOTHETICAL values compare against a simulated dense architecture where all 8 experts process every question.
        Savings do not automatically correspond to real electricity or water savings.
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Environmental
// ---------------------------------------------------------------------------
async function viewEnvironmental(content) {
  const stats = await api('/api/stats');
  state.stats = stats;
  const env = state.settings.environmentalAssumptions;

  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Environmental</h1>
        <p class="page-sub">Estimated resource impact of queries. <span class="badge badge-amber">ESTIMATES</span></p>
      </div>
      <button class="btn" id="envInfoBtn">ⓘ Methodology</button>
    </div>

    <div class="grid cards-3">
      <div class="stat"><div class="stat-label">Electricity Used <span class="m-tag est">EST.</span></div><div class="stat-value">${fmtWh(stats.energyEstimate)}</div></div>
      <div class="stat green"><div class="stat-label">Electricity Saved <span class="m-tag est">EST.</span></div><div class="stat-value">${fmtWh(stats.energySaved)}</div></div>
      <div class="stat"><div class="stat-label">Water Used <span class="m-tag est">EST.</span></div><div class="stat-value">${fmtL(stats.waterEstimate)}</div></div>
      <div class="stat green"><div class="stat-label">Water Saved <span class="m-tag est">EST.</span></div><div class="stat-value">${fmtL(stats.waterSaved)}</div></div>
      <div class="stat"><div class="stat-label">CO₂e Emissions <span class="m-tag est">EST.</span></div><div class="stat-value">${fmtKg(stats.co2Estimate)}</div></div>
      <div class="stat green"><div class="stat-label">CO₂e Avoided <span class="m-tag est">EST.</span></div><div class="stat-value">${fmtKg(stats.co2Saved)}</div></div>
      <div class="stat"><div class="stat-label">Total Queries</div><div class="stat-value">${fmtTok(stats.totalQueries)}</div></div>
      <div class="stat"><div class="stat-label">Energy per Query</div><div class="stat-value">${stats.totalQueries ? fmtWh(stats.energyEstimate / stats.totalQueries) : '—'}</div></div>
      <div class="stat"><div class="stat-label">Assumed MoE Reduction</div><div class="stat-value">${fmtPct((env.moeEnergyReduction || 0) * 100)}</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2 class="card-title">Current assumptions</h2>
      <p class="card-desc">Editable in Settings → Environmental Assumptions.</p>
      <div class="grid cards-2">
        <div class="detail-item"><span class="k">Baseline energy per query (dense)</span><span class="v">${esc(env.baselineEnergyWhPerQuery)} Wh</span></div>
        <div class="detail-item"><span class="k">Water intensity</span><span class="v">${esc(env.waterIntensityLPerKwh)} L/kWh</span></div>
        <div class="detail-item"><span class="k">Carbon intensity</span><span class="v">${esc(env.carbonIntensityKgPerKwh)} kg CO₂e/kWh</span></div>
        <div class="detail-item"><span class="k">Energy per query (MoE scenario)</span><span class="v">${fmtWh((env.baselineEnergyWhPerQuery || 0) * (1 - (env.moeEnergyReduction || 0)))}</span></div>
      </div>
      <div class="metrics-note" style="margin-top:14px">
        <strong>Estimated —</strong> actual resource usage varies by model, hardware, data center, cooling system,
        location and workload. This application cannot measure the AI provider's data-centre resources.
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">Sources & Methodology</h2>
      <p class="card-desc">These assumptions are not universally agreed — that is why they are editable.</p>
      <ul class="source-list">
        <li><div class="src-title">International Energy Agency — “Energy and AI” / Electricity 2024</div>
          <div class="src-ref">IEA analysis of electricity demand from data centres and AI, a key reference for AI's share of global electricity.</div></li>
        <li><div class="src-title">de Vries, A. (2023) — “The Growing Energy Footprint of Artificial Intelligence”</div>
          <div class="src-ref">Peer-reviewed estimate in Joule (Cell Press) of AI inference and training energy demand.</div></li>
        <li><div class="src-title">Luccioni, Jernite & Strubell (2023) — “Power Hungry Processing: Watts Driving the Cost of AI Deployment?”</div>
          <div class="src-ref">ACM FAccT paper measuring real inference energy use of large models; basis for the "energy per query" scale used here.</div></li>
        <li><div class="src-title">Li, Yang, Islam & Ren (2023) — “Making AI Less 'Thirsty'”</div>
          <div class="src-ref">arXiv:2304.03271 — academic estimate of the water footprint of AI models; supports the ~2 L/kWh data-centre water intensity assumption.</div></li>
        <li><div class="src-title">IEA / Our World in Data — average CO₂ intensity of electricity generation</div>
          <div class="src-ref">Global average ~0.4 kg CO₂e per kWh used as the default carbon intensity. Local grids vary widely.</div></li>
      </ul>
      <div class="metrics-note" style="margin-top:12px">
        Methodology: <code>energy = queries × energyPerQuery</code> · <code>water = energy[kWh] × water intensity</code> ·
        <code>CO₂e = energy[kWh] × carbon intensity</code>. Savings are the difference between the configured dense baseline
        and the modelled sparse-MoE scenario.
      </div>
    </div>`;

  content.querySelector('#envInfoBtn').addEventListener('click', () => {
    openModal(`
      <h3 style="margin:0 0 8px">Methodology</h3>
      <p style="color:var(--text-2);margin:0 0 12px">
        MoE AI does <strong>not</strong> measure real data-centre resources. All environmental figures are
        <strong>estimates</strong> derived from configurable assumptions.
      </p>
      <div class="kv-list" style="display:grid;grid-template-columns:1fr">
        <div class="detail-item"><span class="k">Energy</span><span class="v">energyWh = queries × energyPerQuery</span></div>
        <div class="detail-item"><span class="k">Water</span><span class="v">waterL = energyKWh × waterIntensityLPerKwh</span></div>
        <div class="detail-item"><span class="k">CO₂e</span><span class="v">co2kg = energyKWh × carbonIntensityKgPerKwh</span></div>
        <div class="detail-item"><span class="k">Savings</span><span class="v">difference between the dense baseline and the modelled MoE scenario</span></div>
      </div>
      <hr class="divider" />
      <h3 style="margin:0 0 8px">Why “saved” is a model, not a measurement</h3>
      <p style="color:var(--text-2);margin:0">
        A sparse MoE processes a question through the router plus the selected expert, not all 8 experts at once —
        this is why the hypothetical dense baseline is larger. Real energy use still depends on model size, hardware,
        data-centre efficiency (PUE), cooling, location, grid mix and workload. Activating 1 of 8 experts does
        <strong>not</strong> automatically mean 87.5% electricity savings; the default assumption used here is
        ${fmtPct((state.settings.environmentalAssumptions.moeEnergyReduction || 0) * 100)}.
      </p>`, false);
  });
}

// ---------------------------------------------------------------------------
// Experts
// ---------------------------------------------------------------------------
async function viewExperts(content) {
  const data = await api('/api/experts');
  const stats = await api('/api/stats');
  state.stats = stats;

  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Experts</h1>
        <p class="page-sub">The ${data.experts.length} specialists in the MoE. One is activated per query.</p>
      </div>
      <span class="badge badge-accent">Active: ${esc(data.activeExpert || 'none')}</span>
    </div>
    <div class="grid cards-2">
      ${data.experts
        .map(
          (e) => `
        <div class="card expert-card ${e.status === 'active' ? 'active' : ''}">
          <div class="expert-head">
            <div class="expert-icon" style="background:${e.color}">${esc(e.icon)}</div>
            <div>
              <div class="name">${esc(e.name)} ${e.status === 'active' ? '<span class="badge badge-accent">Active now</span>' : ''}</div>
              <div class="sub">${esc(e.subject)}</div>
            </div>
            <span class="badge ${e.status === 'active' ? 'badge-green' : 'badge-gray'}" style="margin-left:auto">${e.status}</span>
          </div>
          <p class="expert-desc">${esc(e.description)}</p>
          <div class="expert-stats">
            <div class="expert-stat"><span class="k">Queries handled</span><span class="v">${fmtTok(e.queries)}</span></div>
            <div class="expert-stat"><span class="k">Tokens processed</span><span class="v">${fmtTok(e.totalTokens)}</span></div>
            <div class="expert-stat"><span class="k">Avg response time</span><span class="v">${fmtMs(e.avgResponseMs)}</span></div>
            <div class="expert-stat"><span class="k">Estimated energy</span><span class="v">${fmtWh(e.energyEstimateWh)}</span></div>
          </div>
        </div>`
        )
        .join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
async function viewAnalytics(content) {
  const stats = await api('/api/stats');
  state.stats = stats;
  const hist = await api('/api/history?limit=100&full=1');
  const records = hist.records.slice().reverse(); // chronological

  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Analytics</h1>
        <p class="page-sub">Charts of routing, token and impact metrics. Values are labelled ACTUAL / ESTIMATED / HYPOTHETICAL.</p>
      </div>
    </div>
    ${records.length === 0
      ? '<div class="empty-state"><div class="big">◔</div>No data yet — ask a question in <b>Chat</b> to populate analytics.</div>'
      : `
    <div class="chart-row">
      <div class="card chart-box"><h2 class="card-title">Queries by Expert</h2><canvas id="chQueries"></canvas></div>
      <div class="card chart-box"><h2 class="card-title">Expert Activation</h2><canvas id="chActivation"></canvas>
        <div class="chart-legend" id="activationLegend"></div></div>
    </div>
    <div class="chart-row">
      <div class="card chart-box"><h2 class="card-title">Token Usage — last ${records.length} queries <span class="m-tag est">EST.</span></h2><canvas id="chTokens"></canvas>
        <div class="chart-legend"><span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Input</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--accent-2)"></span>Output</span></div></div>
      <div class="card chart-box"><h2 class="card-title">Tokens Saved vs Dense <span class="m-tag hyp">HYP.</span></h2><canvas id="chSavings"></canvas></div>
    </div>
    <div class="chart-row">
      <div class="card chart-box"><h2 class="card-title">Estimated Energy per Query (Wh) <span class="m-tag est">EST.</span></h2><canvas id="chEnergy"></canvas></div>
      <div class="card chart-box"><h2 class="card-title">Response Time (ms) <span class="m-tag act">ACT.</span></h2><canvas id="chTime"></canvas></div>
    </div>
    <div class="card chart-box"><h2 class="card-title">Environmental Impact (cumulative) <span class="m-tag est">EST.</span></h2>
      <div class="chart-row">
        <div class="card" style="border:none;box-shadow:none;padding:0"><h2 class="card-title" style="font-size:12px">Electricity (Wh)</h2><canvas id="chEnvEnergy"></canvas></div>
        <div class="card" style="border:none;box-shadow:none;padding:0"><h2 class="card-title" style="font-size:12px">Water (L)</h2><canvas id="chEnvWater"></canvas></div>
        <div class="card" style="border:none;box-shadow:none;padding:0"><h2 class="card-title" style="font-size:12px">CO₂e (kg)</h2><canvas id="chEnvCo2"></canvas></div>
      </div>
      <div class="chart-legend"><span class="legend-item"><span class="legend-swatch" style="background:var(--green)"></span>Used (MoE scenario)</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Saved (vs. dense baseline)</span></div>
    </div>`
    }`;

  if (records.length === 0) return;

  const byExpert = stats.perExpert;
  const labels = records.map((r, i) => '#' + (hist.total - i));
  const qLabels = Object.keys(byExpert);

  const expertPalette = qLabels.map((id) => expertColor(id));

  Charts.drawBars(content.querySelector('#chQueries'), {
    labels: qLabels,
    data: qLabels.map((id) => byExpert[id].queries),
    color: '#6366f1',
    format: (v) => fmtTok(v),
  });

  const legend = content.querySelector('#activationLegend');
  legend.innerHTML = qLabels.map((id, i) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${expertColor(id)}"></span>${esc(byExpert[id].name)}</span>`
  ).join('');
  Charts.drawDonut(content.querySelector('#chActivation'), {
    data: qLabels.map((id) => byExpert[id].queries),
    colors: expertPalette,
    size: 150,
  });

  Charts.drawBars(content.querySelector('#chTokens'), {
    labels,
    series: [
      { name: 'Input', data: records.map((r) => r.inputTokens), color: '#6366f1' },
      { name: 'Output', data: records.map((r) => r.outputTokens), color: '#8b5cf6' },
    ],
    stacked: true,
    format: (v) => fmtTok(v),
    leftPad: 46,
  });

  Charts.drawBars(content.querySelector('#chSavings'), {
    labels,
    series: [
      { name: 'Saved', data: records.map((r) => r.tokensSaved), color: '#16a34a' },
    ],
    format: (v) => fmtTok(v),
    leftPad: 46,
  });

  Charts.drawBars(content.querySelector('#chEnergy'), {
    labels,
    data: records.map((r) => r.energyEstimate),
    color: '#f59e0b',
    format: (v) => fmtWh(v),
    leftPad: 52,
  });

  Charts.drawLine(content.querySelector('#chTime'), {
    labels,
    data: records.map((r) => r.responseTimeMs),
    color: '#8b5cf6',
    format: (v) => Math.round(v) + 'ms',
    leftPad: 52,
  });

  Charts.drawBars(content.querySelector('#chEnvEnergy'), {
    labels: ['Used', 'Saved'],
    series: [
      { name: 'Used', data: [stats.energyEstimate, 0], color: '#10b981' },
      { name: 'Saved', data: [0, stats.energySaved], color: '#6366f1' },
    ],
    format: (v) => fmtWh(v),
    leftPad: 56,
  });
  Charts.drawBars(content.querySelector('#chEnvWater'), {
    labels: ['Used', 'Saved'],
    series: [
      { name: 'Used', data: [stats.waterEstimate, 0], color: '#10b981' },
      { name: 'Saved', data: [0, stats.waterSaved], color: '#6366f1' },
    ],
    format: (v) => fmtL(v),
    leftPad: 56,
  });
  Charts.drawBars(content.querySelector('#chEnvCo2'), {
    labels: ['Used', 'Saved'],
    series: [
      { name: 'Used', data: [stats.co2Estimate, 0], color: '#10b981' },
      { name: 'Saved', data: [0, stats.co2Saved], color: '#6366f1' },
    ],
    format: (v) => fmtKg(v),
    leftPad: 56,
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
async function viewHistory(content) {
  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">History</h1>
        <p class="page-sub">Every query record: routing, tokens, cost and environmental estimates.</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="search" id="historySearch" placeholder="Search question, subject or expert…" style="width:240px" />
        <button class="btn btn-danger" id="clearHistoryBtn">Clear all</button>
      </div>
    </div>
    <div class="card" id="historyBody" style="padding:0">${spinner()} <div style="padding:16px">Loading…</div></div>`;

  const body = content.querySelector('#historyBody');
  const search = content.querySelector('#historySearch');

  let timer = null;
  const load = async () => {
    const q = search.value.trim();
    const data = await api('/api/history?limit=200' + (q ? '&q=' + encodeURIComponent(q) : ''));
    state.historyTotal = data.total;
    if (data.total === 0) {
      body.innerHTML = '<div class="empty-state"><div class="big">◷</div>' +
        (q ? 'No records match your search.' : 'No queries yet — ask something in <b>Chat</b>.') + '</div>';
      return;
    }
    body.innerHTML = data.records
      .map(
        (r) => `
      <div class="history-row" data-id="${esc(r.id)}">
        <span class="badge" style="background:${expertColor(r.expert)};color:#fff">${esc(expertIcon(r.expert))}</span>
        <div style="flex:1;min-width:0">
          <div class="h-q">${esc(r.question)}</div>
          <div class="h-meta">
            <span class="badge badge-gray">${esc(r.subject)}</span>
            <span>${fmtTime(r.timestamp)}</span>
            <span>${fmtTok(r.totalTokens)} tok</span>
            <span>${fmtMoney(r.cost)}</span>
            <span>${fmtWh(r.energyEstimate)} (est.)</span>
          </div>
        </div>
        <button class="btn btn-sm" data-act="open">Open</button>
        <button class="icon-btn" data-act="del" title="Delete" style="color:var(--red)">✕</button>
      </div>`
      )
      .join('');
  };

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  });

  body.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-act="del"]')) {
      await api('/api/history/' + id, { method: 'DELETE' });
      toast('Record deleted', 'ok');
      load();
      return;
    }
    if (e.target.closest('[data-act="open"]')) {
      const { record } = await api('/api/history/' + id);
      openHistoryModal(record);
    }
  });

  content.querySelector('#clearHistoryBtn').addEventListener('click', async () => {
    if (!confirm('Delete all history? This cannot be undone.')) return;
    await api('/api/history', { method: 'DELETE' });
    toast('History cleared', 'ok');
    load();
  });

  await load();
}

function openHistoryModal(record) {
  const color = expertColor(record.expert);
  openModal(`
    <div class="assistant-head" style="margin-bottom:10px">
      <span class="expert-dot" style="background:${color}"></span>
      <b>${esc(record.expertName)} Expert</b>
      <span class="badge ${record.demo ? 'badge-amber' : 'badge-green'}">${record.demo ? 'Demo' : 'Live API'}</span>
      <span class="badge badge-gray" style="margin-left:auto">${fmtTime(record.timestamp)}</span>
    </div>
    <div class="assistant-answer" style="border:none;box-shadow:none;padding:0;background:transparent">
      <strong>Question</strong>
      <div class="v" style="font-weight:400;color:var(--text-2);margin:4px 0 12px">${esc(record.question)}</div>
      <strong>Answer</strong>
      <div style="margin-top:4px">${md(record.answer)}</div>
    </div>
    <hr class="divider" />
    <div class="kv-list">
      <span class="k">Subject</span><span class="v">${esc(record.subject)}</span>
      <span class="k">Expert</span><span class="v">${esc(record.expertName)}</span>
      <span class="k">Confidence</span><span class="v">${fmtPct(record.confidence * 100)}</span>
      <span class="k">Routing</span><span class="v">${esc(record.routerMode)}</span>
      <span class="k">Model / Provider</span><span class="v">${esc(record.model)} · ${esc(record.provider)}</span>
      <span class="k">Tokens</span><span class="v">${fmtTok(record.inputTokens)} in / ${fmtTok(record.outputTokens)} out / ${fmtTok(record.totalTokens)} total</span>
      <span class="k">Dense equivalent</span><span class="v">${fmtTok(record.denseEquivalentTokens)} (HYP.)</span>
      <span class="k">Tokens saved</span><span class="v">${fmtTok(record.tokensSaved)} (HYP.)</span>
      <span class="k">Cost</span><span class="v">${fmtMoney(record.cost)}</span>
      <span class="k">Cost saved</span><span class="v">${fmtMoney(record.costSaved)} (HYP.)</span>
      <span class="k">Energy (est.)</span><span class="v">${fmtWh(record.energyEstimate)}</span>
      <span class="k">Water (est.)</span><span class="v">${fmtL(record.waterEstimate)}</span>
      <span class="k">CO₂e (est.)</span><span class="v">${fmtKg(record.co2Estimate)}</span>
      <span class="k">Response time</span><span class="v">${fmtMs(record.responseTimeMs)}</span>
    </div>
    <hr class="divider" />
    <strong>Routing reason</strong>
    <div style="font-size:12.5px;color:var(--text-2);margin-top:4px">${esc(record.routingReason)}</div>
    <div style="margin-top:12px"><strong>Prompt sent to expert</strong></div>
    <div class="prompt-box" style="margin-top:6px">${esc(record.promptSent || '')}</div>
  `, true);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function viewSettings(content) {
  const s = state.settings;
  const providers = state.providers;
  const defaults = state.defaults;
  const theme = s.theme || 'light';
  const routerMode = s.routerMode || 'automatic';
  const provMeta = providers[s.provider] || { models: [] };
  const modelList = provMeta.models && provMeta.models.length ? provMeta.models : ['demo-simulator'];

  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-sub">API keys are stored securely on the backend and are never exposed to the browser.</p>
      </div>
      <button class="btn btn-primary" id="saveSettingsBtn">Save changes</button>
    </div>

    <div class="settings-sections">
      <div class="card">
        <h2 class="card-title">A. Appearance</h2>
        <p class="card-desc">Light is the default. Dark mode changes the entire UI.</p>
        <div class="radio-row">
          ${['light', 'dark', 'system'].map(
            (t) => `<label class="radio-pill ${theme === t ? 'selected' : ''}">
              <input type="radio" name="theme" value="${t}" ${theme === t ? 'checked' : ''} />${esc(t[0].toUpperCase() + t.slice(1))}</label>`
          ).join('')}
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">B. API Configuration</h2>
        <p class="card-desc">Choose a provider and model. The key is saved server-side; environment variables take precedence.</p>
        <div class="settings-grid">
          <div class="field">
            <label for="selProvider">Provider</label>
            <select id="selProvider">
              ${Object.entries(providers).map(([id, p]) => `<option value="${id}" ${id === s.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="inpModel">Model</label>
            <input type="text" id="inpModel" list="modelSuggestions" value="${esc(s.model)}" placeholder="e.g. gpt-4o-mini" />
            <datalist id="modelSuggestions"></datalist>
          </div>
          <div class="field">
            <label for="inpBaseUrl">API Base URL <span class="hint">(for OpenAI-compatible endpoints)</span></label>
            <input type="text" id="inpBaseUrl" value="${esc(s.baseUrl || '')}" placeholder="https://api.example.com/v1" />
          </div>
          <div class="field">
            <label for="inpApiKey">API Key <span class="hint" id="keyHint">${state.apiKeyConfigured ? 'Configured (' + '••••' + '). Leave blank to keep, or type a new key.' : 'Not configured — Demo Mode will be used.'}</span></label>
            <input type="password" id="inpApiKey" autocomplete="off" placeholder="${state.apiKeyConfigured ? '••••••••••••••••' : 'sk-…'}" />
            <label style="display:flex;gap:6px;align-items:center;font-weight:400;font-size:12px;color:var(--text-2);margin-top:4px">
              <input type="checkbox" id="chkRemoveKey" style="width:auto" /> Remove saved key
            </label>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn" id="testConnBtn">Test Connection</button>
          <span class="test-status" id="testStatus"></span>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">C. Router Settings</h2>
        <p class="card-desc">Automatic routes by subject classification. Manual lets you pick the expert in Chat. Demo simulates answers.</p>
        <div class="radio-row" style="margin-bottom:16px">
          ${['automatic', 'manual', 'demo'].map(
            (m) => `<label class="radio-pill ${routerMode === m ? 'selected' : ''}">
              <input type="radio" name="routerMode" value="${m}" ${routerMode === m ? 'checked' : ''} />${esc(m[0].toUpperCase() + m.slice(1))}</label>`
          ).join('')}
        </div>
        <div class="field" style="max-width:320px">
          <label for="thresholdRange">Confidence Threshold — <span id="thresholdValue">${(s.confidenceThreshold || 0.35).toFixed(2)}</span></label>
          <input type="range" id="thresholdRange" min="0.1" max="0.9" step="0.05" value="${s.confidenceThreshold || 0.35}" />
          <span class="hint">Below this confidence the question is routed to the General expert.</span>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">D. Environmental Assumptions</h2>
        <p class="card-desc">Educational estimates — there is no universal electricity/water use per AI query. Edit freely and reset to recommended defaults.</p>
        <div class="settings-grid">
          <div class="field">
            <label for="envBaseline">Baseline energy per query (Wh, dense)</label>
            <input type="number" id="envBaseline" min="0" step="0.1" value="${s.environmentalAssumptions.baselineEnergyWhPerQuery}" />
          </div>
          <div class="field">
            <label for="envReduction">MoE energy reduction assumption (0–0.95)</label>
            <input type="number" id="envReduction" min="0" max="0.95" step="0.05" value="${s.environmentalAssumptions.moeEnergyReduction}" />
          </div>
          <div class="field">
            <label for="envWater">Water intensity (L/kWh)</label>
            <input type="number" id="envWater" min="0" step="0.1" value="${s.environmentalAssumptions.waterIntensityLPerKwh}" />
          </div>
          <div class="field">
            <label for="envCarbon">Carbon intensity (kg CO₂e/kWh)</label>
            <input type="number" id="envCarbon" min="0" step="0.05" value="${s.environmentalAssumptions.carbonIntensityKgPerKwh}" />
          </div>
        </div>
        <button class="btn btn-sm" id="envResetBtn">Reset to recommended defaults</button>
      </div>

      <div class="card">
        <h2 class="card-title">Model Pricing <span class="hint" style="font-weight:400">USD per 1M tokens</span></h2>
        <p class="card-desc">Cost = input tokens × input price + output tokens × output price. These starting values are editable.</p>
        <div class="table-wrap">
          <table class="price-table">
            <thead><tr><th>Model</th><th style="width:160px">Input $/1M</th><th style="width:160px">Output $/1M</th></tr></thead>
            <tbody id="priceRows"></tbody>
          </table>
        </div>
        <button class="btn btn-sm" style="margin-top:12px" id="priceResetBtn">Reset to defaults</button>
      </div>
    </div>`;

  // populate model suggestions + pricing rows
  const fillModels = () => {
    const meta = providers[state.settings.provider] || providers[selProvider.value] || { models: [] };
    const dl = content.querySelector('#modelSuggestions');
    dl.innerHTML = (meta.models && meta.models.length ? meta.models : ['demo-simulator'])
      .map((m) => `<option value="${esc(m)}"></option>`)
      .join('');
  };

  const selProvider = content.querySelector('#selProvider');
  const inpBaseUrl = content.querySelector('#inpBaseUrl');
  const inpModel = content.querySelector('#inpModel');
  const inpApiKey = content.querySelector('#inpApiKey');
  const themeRadios = [...content.querySelectorAll('input[name="theme"]')];
  const modeRadios = [...content.querySelectorAll('input[name="routerMode"]')];
  const thresholdRange = content.querySelector('#thresholdRange');
  const thresholdValue = content.querySelector('#thresholdValue');

  fillModels();
  const setBasePlaceholder = () => {
    const meta = providers[selProvider.value];
    inpBaseUrl.placeholder = (meta && meta.baseUrl) || 'https://api.example.com/v1';
  };
  setBasePlaceholder();
  selProvider.addEventListener('change', () => {
    const meta = providers[selProvider.value];
    if (meta && meta.models && meta.models.length) inpModel.value = meta.models[0];
    else if (selProvider.value === 'demo') inpModel.value = 'demo-simulator';
    setBasePlaceholder();
    fillModels();
    if (!meta.baseUrl) inpBaseUrl.value = '';
  });
  themeRadios.forEach((r) => r.addEventListener('change', () => {
    themeRadios.forEach((x) => x.closest('.radio-pill').classList.toggle('selected', x.checked));
    state.settings.theme = themeRadios.find((x) => x.checked).value;
    applyTheme();
  }));
  modeRadios.forEach((r) => r.addEventListener('change', () => {
    modeRadios.forEach((x) => x.closest('.radio-pill').classList.toggle('selected', x.checked));
  }));
  thresholdRange.addEventListener('input', () => { thresholdValue.textContent = Number(thresholdRange.value).toFixed(2); });

  const priceRows = content.querySelector('#priceRows');
  const allModels = Object.keys(s.pricing).concat(Object.keys(defaults.pricing));
  [...new Set(allModels)].sort().forEach((model) => {
    const p = s.pricing[model] || defaults.pricing[model] || { input: 0, output: 0 };
    priceRows.insertAdjacentHTML('beforeend', `
      <tr>
        <td class="cell-strong">${esc(model)}</td>
        <td><input type="number" min="0" step="0.01" data-price="in" data-model="${esc(model)}" value="${p.input}" /></td>
        <td><input type="number" min="0" step="0.01" data-price="out" data-model="${esc(model)}" value="${p.output}" /></td>
      </tr>`);
  });

  const envResetBtn = content.querySelector('#envResetBtn');
  envResetBtn.addEventListener('click', () => {
    const d = defaults.environmentalAssumptions;
    content.querySelector('#envBaseline').value = d.baselineEnergyWhPerQuery;
    content.querySelector('#envReduction').value = d.moeEnergyReduction;
    content.querySelector('#envWater').value = d.waterIntensityLPerKwh;
    content.querySelector('#envCarbon').value = d.carbonIntensityKgPerKwh;
  });

  const priceResetBtn = content.querySelector('#priceResetBtn');
  priceResetBtn.addEventListener('click', () => {
    priceRows.querySelectorAll('input').forEach((inp) => {
      const d = defaults.pricing[inp.dataset.model] || { input: 0, output: 0 };
      inp.value = inp.dataset.price === 'in' ? d.input : d.output;
    });
  });

  const testBtn = content.querySelector('#testConnBtn');
  const testStatus = content.querySelector('#testStatus');
  testBtn.addEventListener('click', async () => {
    const provider = selProvider.value;
    const model = inpModel.value.trim() || (providers[provider].models && providers[provider].models[0]);
    const apiKey = inpApiKey.value.trim();
    if (provider === 'demo') {
      testStatus.className = 'test-status ok';
      testStatus.textContent = 'Demo mode — no external API required.';
      return;
    }
    if (!apiKey && !state.apiKeyConfigured) {
      testStatus.className = 'test-status err';
      testStatus.textContent = 'No API key. Add one or use Demo Mode.';
      return;
    }
    testBtn.disabled = true;
    testBtn.innerHTML = spinner() + ' Testing…';
    testStatus.textContent = '';
    try {
      const r = await api('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({ provider, model, baseUrl: inpBaseUrl.value.trim(), apiKey: apiKey || undefined }),
      });
      testStatus.className = 'test-status ok';
      testStatus.textContent = r.message + (r.latencyMs ? ` (${Math.round(r.latencyMs)} ms)` : '');
    } catch (err) {
      testStatus.className = 'test-status err';
      testStatus.textContent = err.message;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });

  content.querySelector('#saveSettingsBtn').addEventListener('click', async () => {
    const provider = selProvider.value;
    const apiKey = inpApiKey.value.trim();
    const removeKey = content.querySelector('#chkRemoveKey').checked;
    const pricing = {};
    priceRows.querySelectorAll('input').forEach((inp) => {
      pricing[inp.dataset.model] = pricing[inp.dataset.model] || {};
      pricing[inp.dataset.model][inp.dataset.price] = Number(inp.value) || 0;
    });
    const payload = {
      settings: {
        theme: themeRadios.find((x) => x.checked).value,
        provider,
        model: inpModel.value.trim() || 'demo-simulator',
        baseUrl: inpBaseUrl.value.trim(),
        routerMode: modeRadios.find((x) => x.checked).value,
        confidenceThreshold: Number(thresholdRange.value),
        environmentalAssumptions: {
          baselineEnergyWhPerQuery: Number(content.querySelector('#envBaseline').value) || 0,
          moeEnergyReduction: Math.min(0.95, Number(content.querySelector('#envReduction').value) || 0),
          waterIntensityLPerKwh: Number(content.querySelector('#envWater').value) || 0,
          carbonIntensityKgPerKwh: Number(content.querySelector('#envCarbon').value) || 0,
        },
        pricing,
      },
    };
    if (apiKey && !apiKey.startsWith('••')) {
      payload.apiKey = apiKey;
      payload.provider = provider;
    }
    if (removeKey) {
      payload.apiKey = '';
      payload.provider = provider;
    }
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      state.settings = res.settings;
      state.apiKeyConfigured = res.apiKeyConfigured;
      applyTheme();
      updateSidebarBadge();
      toast('Settings saved', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
async function viewAbout(content) {
  content.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">About MoE AI</h1>
        <p class="page-sub">A simplified, educational representation of Mixture-of-Experts systems.</p>
      </div>
    </div>

    <div class="card">
      <div class="pipeline">
        <div class="pipe-node">Question</div><span class="pipe-arrow">→</span>
        <div class="pipe-node router">Router</div><span class="pipe-arrow">→</span>
        <div class="pipe-node expert">Expert</div><span class="pipe-arrow">→</span>
        <div class="pipe-node">Answer</div>
      </div>

      <div class="about-section">
        <h3>What is MoE?</h3>
        <p>Mixture-of-Experts is a neural-network architecture that splits the model's capacity into specialised
        sub-networks called experts. Instead of activating the whole network for every token, a sparse router sends each
        input to only the most relevant experts. That is how large models can stay efficient while growing very big.</p>

        <h3>What is an Expert?</h3>
        <p>An expert is a specialised sub-network that becomes good at a particular kind of input — mathematics, code,
        biology and so on. In this educational demo, each "expert" is a specialised assistant with its own system prompt
        and routing profile, standing in for a real expert sub-network.</p>

        <h3>What does the Router do?</h3>
        <p>The router reads the question, scores each expert, and activates only the best match. It returns the subject,
        the selected expert, a confidence score and a reason — and, if confidence is too low, it falls back to the
        General expert. Here the router runs offline with weighted keyword matching so the demo works without an API.</p>

        <h3>Why does sparse expert activation help efficiency?</h3>
        <p>In a dense model, every token passes through the full network. In a sparse MoE, the router activates only a
        few experts per token, so the per-token compute is much smaller even though the total parameter count is huge.
        That is the basis of the <b>hypothetical</b> dense-vs-MoE savings shown in the metrics — they are a model of the
        architecture, not a measurement of real electricity or cost.</p>

        <h3>How this project differs from real MoE systems</h3>
        <p>Modern systems such as DeepSeek use sophisticated sparse MoE architectures with many experts, learned routing
        and careful load balancing. This project is a <b>simplified educational representation</b> of that idea: it does
        not reproduce DeepSeek's (or any vendor's) architecture, and it is not trained.</p>

        <h3>Accuracy labels</h3>
        <ul>
          <li><span class="m-tag act">ACTUAL</span> measured directly by this application (token counts, response time).</li>
          <li><span class="m-tag est">ESTIMATED</span> calculated from configurable assumptions (cost, energy, water, CO₂e).</li>
          <li><span class="m-tag hyp">HYPOTHETICAL</span> comparison against a simulated dense architecture (token & cost savings).</li>
        </ul>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    await loadSettings();
  } catch (err) {
    toast('Could not load settings: ' + err.message, 'err');
  }
  applyTheme();
  wireNav();
  updateSidebarBadge();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

document.addEventListener('DOMContentLoaded', boot);
