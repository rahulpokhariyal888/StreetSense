/* StreetSense UX upgrades: command palette, keyboard navigation and local city operations persistence. */
(() => {
  'use strict';

  const STORAGE_KEY = 'streetsense-city operations-state-v2';
  const $id = (id) => document.getElementById(id);
  const safeCopy = (value) => JSON.parse(JSON.stringify(value));
  const seedIncidents = safeCopy(incidents);
  const seedWorkOrders = safeCopy(workOrders);

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        incidents,
        workOrders
      }));
      const pill = document.querySelector('.local-save-pill');
      if (pill) {
        pill.textContent = window.streetSenseBackend?.online ? 'Synced to StreetSense server' : 'Saved on this device';
        pill.classList.remove('save-flash');
        requestAnimationFrame(() => pill.classList.add('save-flash'));
      }
      if (window.streetSenseBackend?.online) {
        window.streetSenseBackend.saveSnapshot(incidents, workOrders).catch(error => {
          console.error('StreetSense server sync failed:', error);
          if (pill) pill.textContent = 'Server sync failed · local copy saved';
        });
      }
    } catch (error) {
      console.warn('StreetSense could not save city operations state locally:', error);
      if (typeof toast === 'function') toast('Local save is unavailable in this browser session.', '!');
    }
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.version !== 2 || !Array.isArray(saved.incidents) || !Array.isArray(saved.workOrders)) return;
      if (saved.incidents.every(item => item && typeof item.id === 'string' && typeof item.type === 'string')) {
        incidents.splice(0, incidents.length, ...saved.incidents);
      }
      if (saved.workOrders.every(item => item && typeof item.id === 'string' && typeof item.status === 'string')) {
        workOrders.splice(0, workOrders.length, ...saved.workOrders);
      }
    } catch (error) {
      console.warn('StreetSense saved city operations data could not be restored:', error);
    }
  }

  // Restore local fallback before the app's DOMContentLoaded initializer.
  restoreState();

  // Persist state changes from both manual reports and upload-analysis previews.
  if (typeof window.makeReport === 'function') {
    const originalMakeReport = window.makeReport;
    window.makeReport = function (...args) {
      const result = originalMakeReport.apply(this, args);
      persistState();
      return result;
    };
  }
  if (typeof window.addWorkOrder === 'function') {
    const originalAddWorkOrder = window.addWorkOrder;
    window.addWorkOrder = function (...args) {
      const before = workOrders.length;
      const result = originalAddWorkOrder.apply(this, args);
      if (workOrders.length !== before) persistState();
      return result;
    };
  }

  const commands = [
    { id: 'overview', title: 'Go to overview', detail: 'Dashboard and city summary', icon: '▦', keys: 'dashboard' },
    { id: 'live-map', title: 'Open live map', detail: 'Explore geolocated incidents', icon: '⌖', keys: 'map locations' },
    { id: 'reports', title: 'Open incident reports', detail: 'Search and filter the report register', icon: '▤', keys: 'incidents search' },
    { id: 'work-orders', title: 'Open work orders', detail: 'Manage the municipal repair queue', icon: '◫', keys: 'tasks kanban repairs' },
    { id: 'analytics', title: 'Open analytics', detail: 'Review trends and hotspot areas', icon: '⌁', keys: 'charts insights' },
    { id: 'new-report', title: 'Create a new report', detail: 'Log a field observation', icon: '＋', keys: 'submit defect form' },
    { id: 'upload', title: 'Upload street evidence', detail: 'Choose a photo or dashcam clip', icon: '↑', keys: 'image video evidence ai' },
    { id: 'export', title: 'Export incident register', detail: 'Download a CSV file', icon: '↧', keys: 'download csv data' },
    { id: 'reset', title: 'Reset sample workspace', detail: 'Restore the original illustrative city operations data', icon: '↺', keys: 'clear reset city operations', danger: true }
  ];

  function buildPalette() {
    if ($id('command-backdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'command-backdrop';
    backdrop.id = 'command-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <section class="command-panel" role="dialog" aria-modal="true" aria-label="Quick actions">
        <div class="command-search-row"><span class="command-search-icon" aria-hidden="true">⌕</span><input id="command-search" type="search" autocomplete="off" placeholder="Search pages and actions…" aria-label="Search pages and actions"><kbd>ESC</kbd></div>
        <div class="command-section-label">QUICK ACTIONS</div>
        <div class="command-results" id="command-results" role="listbox" aria-label="Quick actions"></div>
        <div class="command-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> Open palette</span></div>
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closePalette(); });
    $id('command-search').addEventListener('input', renderCommands);
    $id('command-results').addEventListener('click', event => {
      const button = event.target.closest('[data-command]');
      if (button) runCommand(button.dataset.command);
    });
  }

  let activeCommandIndex = 0;
  let filteredCommands = [...commands];

  function renderCommands() {
    const query = ($id('command-search').value || '').trim().toLowerCase();
    filteredCommands = commands.filter(command => `${command.title} ${command.detail} ${command.keys}`.toLowerCase().includes(query));
    activeCommandIndex = 0;
    const list = $id('command-results');
    if (!filteredCommands.length) {
      list.innerHTML = '<div class="command-empty">No matching pages or actions. Try “map”, “report”, or “export”.</div>';
      return;
    }
    list.innerHTML = filteredCommands.map((command, index) => `
      <button type="button" class="command-result ${index === 0 ? 'selected' : ''}" data-command="${command.id}" role="option" aria-selected="${index === 0}">
        <span class="command-result-icon">${command.icon}</span>
        <span class="command-result-copy"><strong>${command.title}</strong><small>${command.detail}</small></span>
        ${command.danger ? '<kbd>RESET</kbd>' : index === 0 ? '<kbd>↵</kbd>' : ''}
      </button>`).join('');
  }

  function openPalette() {
    buildPalette();
    const backdrop = $id('command-backdrop');
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    $id('command-search').value = '';
    renderCommands();
    document.body.classList.add('command-open');
    setTimeout(() => $id('command-search').focus(), 25);
  }

  function closePalette() {
    const backdrop = $id('command-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('command-open');
  }

  function runCommand(id) {
    closePalette();
    switch (id) {
      case 'overview': case 'live-map': case 'reports': case 'work-orders': case 'analytics':
        navigate(id);
        break;
      case 'new-report':
        openModal('report-modal');
        break;
      case 'upload':
        navigate('overview');
        setTimeout(() => $id('evidence-input')?.click(), 180);
        break;
      case 'export':
        exportCSV();
        break;
      case 'reset':
        if (window.confirm('Reset StreetSense to the original sample data? This removes reports and work-order changes saved in this browser.')) {
          incidents.splice(0, incidents.length, ...safeCopy(seedIncidents));
          workOrders.splice(0, workOrders.length, ...safeCopy(seedWorkOrders));
          try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore storage restrictions */ }
          updateCounts(); renderPriorityTable(); renderReports(); renderWorkOrders();
          renderMapMarkers('mini', 'all'); renderMapMarkers('full', 'all');
          setMapFilter('all');
          toast('Sample workspace restored.');
        }
        break;
    }
  }

  function selectCommand(direction) {
    if (!filteredCommands.length) return;
    activeCommandIndex = (activeCommandIndex + direction + filteredCommands.length) % filteredCommands.length;
    document.querySelectorAll('.command-result').forEach((button, index) => {
      const selected = index === activeCommandIndex;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
      if (selected) button.scrollIntoView({ block: 'nearest' });
    });
  }

  function addHeaderEnhancements() {
    const actions = document.querySelector('.topbar-actions');
    const searchButton = $id('top-search-button');
    if (!actions || !searchButton) return;

    const clock = document.createElement('span');
    clock.className = 'local-clock';
    clock.id = 'local-clock';
    clock.setAttribute('aria-label', 'India local time');
    searchButton.insertAdjacentElement('afterend', clock);

    const savePill = document.createElement('span');
    savePill.className = 'local-save-pill';
    savePill.textContent = 'Saved on this device';
    savePill.title = 'Reports and work-order changes are stored in this browser only.';
    clock.insertAdjacentElement('afterend', savePill);

    const quickButton = document.createElement('button');
    quickButton.type = 'button';
    quickButton.className = 'icon-button command-trigger';
    quickButton.id = 'command-open-button';
    quickButton.title = 'Quick actions (Ctrl+K)';
    quickButton.setAttribute('aria-label', 'Open quick actions');
    quickButton.textContent = '⌘';
    savePill.insertAdjacentElement('afterend', quickButton);
    quickButton.addEventListener('click', openPalette);

    // Intercept the old search button so it opens the richer command palette.
    searchButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPalette();
    }, true);

    const updateClock = () => {
      try {
        clock.textContent = new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
        }).format(new Date()) + ' IST';
      } catch (_) { clock.textContent = new Date().toLocaleTimeString(); }
    };
    updateClock();
    setInterval(updateClock, 30000);
  }

  function addMobileScrim() {
    const sidebar = $id('sidebar');
    const menu = $id('mobile-menu');
    if (!sidebar || !menu) return;
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'mobile-scrim';
    scrim.setAttribute('aria-label', 'Close navigation');
    document.body.appendChild(scrim);
    const sync = () => scrim.classList.toggle('active', sidebar.classList.contains('mobile-open'));
    menu.addEventListener('click', () => setTimeout(sync, 0));
    scrim.addEventListener('click', () => { sidebar.classList.remove('mobile-open'); sync(); });
    sidebar.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => setTimeout(sync, 0)));
  }

  function bindPersistenceEvents() {
    const kanban = $id('kanban-board');
    kanban?.addEventListener('change', event => {
      if (event.target.matches('[data-work-status]')) setTimeout(persistState, 0);
    });
    window.addEventListener('beforeunload', persistState);
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', event => {
      const paletteOpen = $id('command-backdrop')?.classList.contains('open');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        paletteOpen ? closePalette() : openPalette();
        return;
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target;
        const typing = target && (target.matches('input, textarea, select, [contenteditable="true"]'));
        if (!typing) { event.preventDefault(); openPalette(); }
      }
      if (paletteOpen && event.key === 'Escape') closePalette();
      if (paletteOpen && event.key === 'ArrowDown') { event.preventDefault(); selectCommand(1); }
      if (paletteOpen && event.key === 'ArrowUp') { event.preventDefault(); selectCommand(-1); }
      if (paletteOpen && event.key === 'Enter' && filteredCommands[activeCommandIndex]) {
        event.preventDefault(); runCommand(filteredCommands[activeCommandIndex].id);
      }
    });
  }

  function enhanceMotion() {
    const cards = document.querySelectorAll('.stat-card, .panel');
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    cards.forEach(card => observer.observe(card));
  }

  function initEnhancements() {
    buildPalette();
    addHeaderEnhancements();
    addMobileScrim();
    bindPersistenceEvents();
    setupKeyboardShortcuts();
    enhanceMotion();
    // Re-render once with restored data; app.js has already initialized first.
    updateCounts();
    renderPriorityTable();
    renderReports();
    renderWorkOrders();
    renderMapMarkers('mini', 'all');
    renderMapMarkers('full', 'all');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEnhancements, { once: true });
  else initEnhancements();
})();
