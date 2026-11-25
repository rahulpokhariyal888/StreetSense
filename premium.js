/* StreetSense 3.0 — contextual dashboard features and accessible controls. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const THEME_KEY = 'streetsense-theme-v1';
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function applySavedTheme() {
    let theme = 'light';
    try { theme = localStorage.getItem(THEME_KEY) || 'light'; } catch (_) { /* private browsing */ }
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  function addThemeControl() {
    const search = $('top-search-button');
    if (!search || $('theme-toggle')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button theme-toggle';
    button.id = 'theme-toggle';
    button.title = 'Switch color theme';
    button.setAttribute('aria-label', 'Switch to dark mode');
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      button.textContent = next === 'dark' ? '☀' : '◐';
      button.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* theme still works for this session */ }
      if (typeof toast === 'function') toast(`${next === 'dark' ? 'Dark' : 'Light'} appearance enabled.`);
    });
    search.insertAdjacentElement('afterend', button);
    button.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '◐';
    button.setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function updateDateAndClock() {
    const dateLine = document.querySelector('#view-overview .overline');
    if (dateLine) {
      const pill = dateLine.querySelector('.overline-pill');
      const formatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata', weekday: 'long', month: 'long', day: '2-digit', year: 'numeric'
      }).format(new Date()).toUpperCase();
      const line = dateLine.querySelector('.overline-line');
      dateLine.textContent = '';
      if (line) dateLine.appendChild(line);
      dateLine.append(` ${formatted} `);
      if (pill) dateLine.appendChild(pill);
    }
    const clock = $('local-clock');
    if (clock) {
      clock.textContent = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
      }).format(new Date()) + ' IST';
    }
  }

  function addOverviewHero() {
    const heading = document.querySelector('#view-overview .page-heading');
    if (!heading || $('hero-command')) return;
    const hero = document.createElement('section');
    hero.id = 'hero-command';
    hero.className = 'hero-command';
    hero.setAttribute('aria-label', 'City operations summary');
    hero.innerHTML = `
      <div class="hero-copy">
        <div class="hero-eyebrow"><i></i> CITY OPERATIONS CENTER <span>·</span> PILOT OVERVIEW</div>
        <h2>See the problem. Prioritize the risk. Move the city forward.</h2>
        <p>StreetSense turns street-level evidence into a clear, reviewable maintenance workflow — from the first report to the repair queue.</p>
        <div class="hero-actions">
          <button class="hero-primary" type="button" data-hero-action="report">＋ Create field report</button>
          <button type="button" data-hero-action="map">Explore incident map ↗</button>
        </div>
      </div>
      <div class="hero-visual" aria-label="Illustrative incident summary">
        <div class="hero-visual-head"><span>LIVE PILOT SNAPSHOT</span><strong>● ILLUSTRATIVE DATA</strong></div>
        <div class="hero-metrics">
          <div class="hero-metric"><strong id="hero-open-count">—</strong><span>Open issues</span></div>
          <div class="hero-metric"><strong id="hero-critical-count">—</strong><span>Critical</span></div>
          <div class="hero-metric"><strong id="hero-order-count">—</strong><span>Work orders</span></div>
        </div>
        <div class="hero-sparkline" aria-hidden="true"><i style="height:35%"></i><i style="height:56%"></i><i style="height:42%"></i><i style="height:72%"></i><i style="height:52%"></i><i style="height:85%"></i><i style="height:64%"></i><i style="height:100%"></i><i style="height:77%"></i><i style="height:91%"></i><i style="height:70%"></i><i style="height:96%"></i></div>
      </div>`;
    heading.insertAdjacentElement('afterend', hero);
    hero.addEventListener('click', (event) => {
      const action = event.target.closest('[data-hero-action]')?.dataset.heroAction;
      if (action === 'report') $('new-report-button')?.click();
      if (action === 'map' && typeof navigate === 'function') navigate('live-map');
    });
  }

  function refreshHeroMetrics() {
    const open = typeof incidents !== 'undefined' && Array.isArray(incidents) ? incidents.filter((item) => item.status !== 'Resolved').length : 0;
    const critical = typeof incidents !== 'undefined' && Array.isArray(incidents) ? incidents.filter((item) => item.severity === 'Critical' && item.status !== 'Resolved').length : 0;
    const orders = typeof workOrders !== 'undefined' && Array.isArray(workOrders) ? workOrders.filter((item) => item.status !== 'Resolved').length : 0;
    if ($('hero-open-count')) $('hero-open-count').textContent = String(open).padStart(2, '0');
    if ($('hero-critical-count')) $('hero-critical-count').textContent = String(critical).padStart(2, '0');
    if ($('hero-order-count')) $('hero-order-count').textContent = String(orders).padStart(2, '0');
  }

  function buildNotificationCenter() {
    const button = $('notification-button');
    if (!button || button.closest('.notification-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'notification-wrap';
    button.parentNode.insertBefore(wrap, button);
    wrap.appendChild(button);
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('section');
    panel.className = 'notification-panel';
    panel.id = 'notification-panel';
    panel.setAttribute('aria-label', 'Recent notifications');
    panel.innerHTML = '<div class="notification-head"><strong>Needs your attention</strong><span>ACTIVITY FEED</span></div><div class="notification-list" id="notification-list"></div><div class="notification-foot"><button type="button" id="notification-view-all">View incident register →</button></div>';
    wrap.appendChild(panel);

    function render() {
      const rows = (typeof incidents !== 'undefined' && Array.isArray(incidents) ? incidents : [])
        .filter((item) => item.status !== 'Resolved')
        .sort((a, b) => ({ Critical: 0, High: 1, Medium: 2, Low: 3 }[a.severity] ?? 4) - ({ Critical: 0, High: 1, Medium: 2, Low: 3 }[b.severity] ?? 4))
        .slice(0, 4);
      const list = $('notification-list');
      if (!rows.length) {
        list.innerHTML = '<div class="notification-empty">No open incidents in this workspace.</div>';
        return;
      }
      list.innerHTML = rows.map((item) => `
        <button class="notification-item" type="button" data-notification-incident="${safe(item.id)}">
          <span class="notification-icon ${safe(String(item.severity).toLowerCase())}">${item.severity === 'Critical' ? '!' : '•'}</span>
          <span class="notification-copy"><strong>${safe(item.type)} · ${safe(item.severity)}</strong><small>${safe(item.location)}<br>${safe(item.id)} · ${safe(item.status)}</small></span>
        </button>`).join('');
    }
    render();

    const close = () => {
      panel.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = panel.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
      if (open) render();
    });
    document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    panel.addEventListener('click', (event) => {
      const incident = event.target.closest('[data-notification-incident]');
      if (incident) {
        close();
        if (typeof navigate === 'function') navigate('reports');
        const search = $('report-search');
        if (search) { search.value = incident.dataset.notificationIncident; search.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    });
    $('notification-view-all')?.addEventListener('click', () => { close(); if (typeof navigate === 'function') navigate('reports'); });
    window.refreshStreetSenseNotifications = render;
  }

  function syncAnalytics() {
    const list = typeof incidents !== 'undefined' && Array.isArray(incidents) ? incidents : [];
    const total = list.length;
    const center = document.querySelector('.donut-center strong');
    if (center) center.textContent = String(total);
    const categoryMap = [
      { label: 'Potholes', types: ['Pothole'], color: '#36b78d' },
      { label: 'Damaged signs', types: ['Damaged sign'], color: '#6299e8' },
      { label: 'Streetlights', types: ['Broken streetlight'], color: '#a48be8' },
      { label: 'Road cracks', types: ['Road crack'], color: '#e5ae5c' }
    ];
    const values = categoryMap.map((entry) => entry.types.reduce((sum, type) => sum + list.filter((item) => item.type === type).length, 0));
    const known = values.reduce((a, b) => a + b, 0);
    const rest = Math.max(0, total - known);
    const percentages = values.map((value) => total ? Math.round(value / total * 100) : 0);
    const legend = document.querySelector('.donut-legend');
    if (legend) {
      legend.innerHTML = categoryMap.map((entry, index) => `<span><i style="background:${entry.color}"></i>${entry.label} <b>${percentages[index]}%</b></span>`).join('') + (rest ? `<span><i style="background:#a9b8b0"></i>Other <b>${Math.round(rest / Math.max(total,1) * 100)}%</b></span>` : '');
    }
    const valuesWithRest = [...values, rest];
    const colors = [...categoryMap.map((entry) => entry.color), '#a9b8b0'];
    let cursor = 0;
    const stops = valuesWithRest.map((value, index) => {
      const start = cursor;
      cursor += total ? value / total * 100 : 0;
      return `${colors[index]} ${start}% ${cursor}%`;
    });
    const donut = document.querySelector('.donut-chart');
    if (donut) donut.style.background = total ? `conic-gradient(${stops.join(',')})` : '#e9efeb';
    const reportTotal = $('reports-total');
    if (reportTotal) reportTotal.textContent = String(total);
  }

  function addKeyboardSupport() {
    document.addEventListener('keydown', (event) => {
      const typing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (event.key === 'Escape') {
        document.querySelectorAll('.notification-panel.open').forEach((panel) => panel.classList.remove('open'));
      }
      if (event.altKey && event.key.toLowerCase() === '1' && !typing && typeof navigate === 'function') {
        event.preventDefault(); navigate('overview');
      }
      if (event.altKey && event.key.toLowerCase() === '2' && !typing && typeof navigate === 'function') {
        event.preventDefault(); navigate('live-map');
      }
    });
  }

  function init() {
    applySavedTheme();
    addThemeControl();
    addOverviewHero();
    buildNotificationCenter();
    updateDateAndClock();
    refreshHeroMetrics();
    syncAnalytics();
    addKeyboardSupport();
    window.setInterval(updateDateAndClock, 30000);

    // Recalculate the small hero/analytics snapshots after existing app actions.
    const refresh = () => {
      refreshHeroMetrics();
      syncAnalytics();
      window.refreshStreetSenseNotifications?.();
    };
    document.addEventListener('click', (event) => {
      if (event.target.closest('#new-report-button, #reports-new-button, #map-report-button, #create-work-order, #detail-create-order, [data-work-status]')) {
        window.setTimeout(refresh, 80);
      }
    });
    const observer = new MutationObserver(() => refreshHeroMetrics());
    const priority = $('priority-table-body');
    if (priority) observer.observe(priority, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
