/* ==========================================================================
   ShieldAuth — Interactive Developer Console Logic
   ========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEY = 'shieldauth_console_v8';
  const SESSION_KEY = 'shieldauth_session_v1';
  const INVITES_INBOX_KEY = 'shieldauth_invites_inbox_v1';
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  let licenseGridView = false;
  const selectedLicenseKeys = new Set();

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  function randomHex(len = 24) {
    const chars = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function randomSeg(len = 4) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function expandMask(mask, useLower, useUpper) {
    let pool = '0123456789';
    if (useLower) pool += 'abcdefghijklmnopqrstuvwxyz';
    if (useUpper) pool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (!useLower && !useUpper) pool = '0123456789';

    return mask.replace(/\*/g, () => pool[Math.floor(Math.random() * pool.length)]);
  }

  function formatExpiry(unit, duration) {
    if (unit === 'Lifetime') return 'Lifetime';
    const d = Number(duration) || 1;
    const label = d === 1 ? unit.replace(/s$/, '') : unit;
    return `${d} ${label}`;
  }

  function getDefaultState() {
    return {
      selectedAppId: null,
      appName: 'No Application Selected',
      appSecret: 'shld_sec_72a91e4f0b8c3d11a09e2f44c18b',
      apps: [],
      licenses: [],
      users: [],
      variables: [],
      blacklist: [],
      teams: [],
      resellers: [],
      pendingInviteCards: [],
      security: {
        hwidLock: true,
        ephemeral: true,
        attestation: true,
        offlineLease: false
      },
      logs: []
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultState();
      return { ...getDefaultState(), ...JSON.parse(raw) };
    } catch {
      return getDefaultState();
    }
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function logEvent(event, actor, status = 'OK') {
    const pops = ['iad-01', 'fra-02', 'sin-01', 'nrt-03', 'lhr-01'];
    const pop = pops[Math.floor(Math.random() * pops.length)];
    state.logs.unshift({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      event,
      actor,
      pop,
      status
    });
    if (state.logs.length > 25) state.logs.pop();
  }

  /* ------------------------------------------------------------------------
     Navigation
     ------------------------------------------------------------------------ */
  const navBtns = document.querySelectorAll('.dash-nav-btn');
  const panels = document.querySelectorAll('.dash-panel');
  const panelTitle = document.getElementById('panelTitle');

  const panelNames = {
    overview: 'Overview',
    apps: 'My Applications',
    licenses: 'Licenses',
    users: 'Users & HWIDs',
    teams: 'Teams',
    resellers: 'Resellers',
    variables: 'Cloud Vars & Files',
    security: 'Security & Blacklist',
    webhooks: 'Webhooks',
    settings: 'App Settings'
  };

  document.getElementById('sidebarAppPill')?.addEventListener('click', () => switchPanel('apps'));

  // Display signed-in session if available
  (function renderSession() {
    const el = document.getElementById('signedInAccount');
    if (!el) return;
    try {
      const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (sess && sess.email) {
        const via = sess.provider === 'google' ? ' (Google)' : '';
        el.textContent = `${sess.email}${via}`;
      }
    } catch {}
    document.getElementById('signOutBtn')?.addEventListener('click', () => {
      localStorage.removeItem(SESSION_KEY);
    });
  })();

  const APP_REQUIRED_PANELS = new Set(['licenses', 'users', 'variables', 'security', 'webhooks', 'settings']);
  let currentPanel = 'overview';

  function hasActiveApp() {
    const app = getSelectedApp();
    return Boolean(app && app.status === 'ACTIVE');
  }

  function requireActiveApp() {
    if (hasActiveApp()) return true;
    const app = getSelectedApp();
    if (!app) {
      showToast('Create an application first in My Applications');
    } else {
      showToast(`"${app.name}" is paused — resume or select an active app`);
    }
    return false;
  }

  function syncAppLockState() {
    const active = hasActiveApp();
    const app = getSelectedApp();
    const banner = document.getElementById('noAppBanner');
    const titleEl = document.getElementById('noAppBannerTitle');
    const descEl = document.getElementById('noAppBannerDesc');
    const btnEl = document.getElementById('noAppBannerBtn');

    APP_REQUIRED_PANELS.forEach((p) => {
      document.getElementById(`panel-${p}`)?.classList.toggle('panel-app-locked', !active);
    });

    if (!banner) return;
    const shouldShow = !active && APP_REQUIRED_PANELS.has(currentPanel);
    banner.classList.toggle('show', shouldShow);

    if (shouldShow && titleEl && descEl && btnEl) {
      if (!app) {
        titleEl.textContent = 'No active application';
        descEl.textContent = 'Create an application first before creating licenses, managing users, variables, or security.';
        btnEl.textContent = '+ Create Application';
        btnEl.dataset.action = 'create';
      } else {
        titleEl.textContent = `"${app.name}" is paused`;
        descEl.textContent = 'Resume this application or select another active application in My Applications to make changes.';
        btnEl.textContent = 'Go to My Applications';
        btnEl.dataset.action = 'apps';
      }
    }
  }

  document.getElementById('noAppBannerBtn')?.addEventListener('click', (e) => {
    switchPanel('apps');
    if (e.target.dataset.action === 'create') {
      openModal(createAppModal);
      document.getElementById('newAppName')?.focus();
    }
  });

  function switchPanel(name) {
    currentPanel = name;
    navBtns.forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
    if (panelTitle) panelTitle.textContent = panelNames[name] || 'Console';
    syncAppLockState();
  }

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  /* ------------------------------------------------------------------------
     Modal Helpers
     ------------------------------------------------------------------------ */
  const createLicModal = document.getElementById('createLicenseModal');
  const addTimeModal = document.getElementById('addTimeModal');
  const editLicModal = document.getElementById('editLicenseModal');
  const editUserModal = document.getElementById('editUserModal');
  const createAppModal = document.getElementById('createAppModal');
  const renameAppModal = document.getElementById('renameAppModal');
  const editDescModal = document.getElementById('editDescModal');

  function openModal(el) {
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function closeModal(el) {
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  [createLicModal, addTimeModal, editLicModal, editUserModal, createAppModal, renameAppModal, editDescModal].forEach((m) => {
    m?.addEventListener('click', (e) => {
      if (e.target === m) closeModal(m);
    });
  });

  document.getElementById('closeCreateLicModal')?.addEventListener('click', () => closeModal(createLicModal));
  document.getElementById('cancelCreateLicBtn')?.addEventListener('click', () => closeModal(createLicModal));
  document.getElementById('closeAddTimeModal')?.addEventListener('click', () => closeModal(addTimeModal));
  document.getElementById('cancelAddTimeBtn')?.addEventListener('click', () => closeModal(addTimeModal));
  document.getElementById('closeEditLicModal')?.addEventListener('click', () => closeModal(editLicModal));
  document.getElementById('cancelEditLicBtn')?.addEventListener('click', () => closeModal(editLicModal));
  document.getElementById('closeEditUserModal')?.addEventListener('click', () => closeModal(editUserModal));
  document.getElementById('cancelEditUserBtn')?.addEventListener('click', () => closeModal(editUserModal));
  document.getElementById('closeCreateAppModal')?.addEventListener('click', () => closeModal(createAppModal));
  document.getElementById('cancelCreateAppBtn')?.addEventListener('click', () => closeModal(createAppModal));
  document.getElementById('closeRenameAppModal')?.addEventListener('click', () => closeModal(renameAppModal));
  document.getElementById('cancelRenameAppBtn')?.addEventListener('click', () => closeModal(renameAppModal));
  document.getElementById('closeEditDescModal')?.addEventListener('click', () => closeModal(editDescModal));
  document.getElementById('cancelEditDescBtn')?.addEventListener('click', () => closeModal(editDescModal));

  // Sync Lifetime disable on Create License & Add Time modals
  function bindLifetimeToggle(selectId, inputId) {
    const sel = document.getElementById(selectId);
    const inp = document.getElementById(inputId);
    if (!sel || !inp) return;
    const sync = () => {
      const isLifetime = sel.value === 'Lifetime';
      inp.disabled = isLifetime;
      inp.style.opacity = isLifetime ? '0.45' : '1';
    };
    sel.addEventListener('change', sync);
    sync();
  }

  bindLifetimeToggle('licExpiryUnit', 'licExpiryDuration');
  bindLifetimeToggle('addTimeUnit', 'addTimeAmount');

  /* ------------------------------------------------------------------------
     Render Functions
     ------------------------------------------------------------------------ */
  function renderChart() {
    const chart = document.getElementById('authChart');
    if (!chart) return;
    chart.innerHTML = Array.from({ length: 14 }, (_, i) =>
      `<div class="chart-bar" style="height:4%;opacity:0.25;" title="Day ${i + 1}: 0 verifications"></div>`
    ).join('');
  }

  function getFilteredLicenses() {
    const query = (document.getElementById('licenseSearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('licenseStatusFilter')?.value || 'all';
    const levelFilter = document.getElementById('licenseLevelFilter')?.value || 'all';

    return state.licenses.filter((l) => {
      const matchQuery =
        !query ||
        l.key.toLowerCase().includes(query) ||
        (l.note || '').toLowerCase().includes(query) ||
        (l.hwid || '').toLowerCase().includes(query) ||
        (l.expiry || '').toLowerCase().includes(query);
      const matchStatus = statusFilter === 'all' || l.status === statusFilter;
      const matchLevel = levelFilter === 'all' || String(l.level) === levelFilter;
      return matchQuery && matchStatus && matchLevel;
    });
  }

  function getSelectedApp() {
    if (!Array.isArray(state.apps) || !state.apps.length) return null;
    return state.apps.find((a) => a.id === state.selectedAppId) || state.apps[0];
  }

  function renderApps() {
    const listEl = document.getElementById('appsList');
    if (!listEl) return;
    const query = (document.getElementById('appsSearchInput')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('appsStatusFilter')?.value || 'all';

    const filtered = (state.apps || []).filter((a) => {
      const matchQ =
        !query ||
        a.name.toLowerCase().includes(query) ||
        (a.description || '').toLowerCase().includes(query) ||
        a.id.toLowerCase().includes(query);
      const matchS = statusFilter === 'all' || a.status === statusFilter;
      return matchQ && matchS;
    });

    listEl.innerHTML = filtered.length
      ? filtered
          .map((a) => {
            const isSel = a.id === state.selectedAppId;
            const isPaused = a.status === 'PAUSED';
            return `<article class="app-card ${isSel ? 'selected' : ''}">
              <div class="app-card-head">
                <div>
                  <div class="app-card-title">${a.name}</div>
                  ${a.description ? `<div class="app-card-desc">${a.description}</div>` : ''}
                </div>
                <span class="app-status-pill ${isPaused ? 'paused' : ''}">${a.status}</span>
              </div>

              <div class="app-stats-row">
                <div class="app-stat">
                  <span>App Version</span>
                  <strong>${a.version || '1.0'}</strong>
                </div>
                <div class="app-stat">
                  <span>Users</span>
                  <strong>${a.users ?? 0}</strong>
                </div>
                <div class="app-stat">
                  <span>Application Standing</span>
                  <strong>${isPaused ? 'Paused' : a.standing || 'Good'}</strong>
                </div>
              </div>

              <div class="app-actions-row">
                <button type="button" class="app-btn ${isSel ? 'is-selected' : ''}" data-select-app="${a.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  ${isSel ? 'Selected' : 'Select'}
                </button>
                <button type="button" class="app-btn" data-rename-app="${a.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  Rename
                </button>
                <button type="button" class="app-btn" data-desc-app="${a.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Description
                </button>
                <button type="button" class="app-btn" data-pause-app="${a.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
                  ${isPaused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" class="app-btn is-danger" data-delete-app="${a.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete
                </button>
              </div>
            </article>`;
          })
          .join('')
      : `<div class="surface-card" style="text-align:center;color:var(--text-muted);padding:36px 20px;">${
          (state.apps || []).length === 0
            ? 'No applications yet. Click <strong>+ Create Application</strong> above to create your first app.'
            : 'No matching applications found.'
        }</div>`;
  }

  function renderAll() {
    const activeApp = getSelectedApp();
    const topId = document.getElementById('topAppId');
    const setId = document.getElementById('setAppId');

    if (activeApp) {
      state.selectedAppId = activeApp.id;
      state.appName = activeApp.name;
      if (topId) topId.textContent = activeApp.id;
      if (setId) setId.value = activeApp.id;
    } else {
      state.selectedAppId = null;
      state.appName = 'No Application Selected';
      if (topId) topId.textContent = 'No App';
      if (setId) setId.value = '';
    }

    document.getElementById('sidebarAppName').textContent = state.appName;
    document.getElementById('setAppName').value = state.appName;
    document.getElementById('setAppSecret').value = state.appSecret;
    renderApps();
    renderInviteTray();
    renderDashSdkCode();
    syncAppLockState();

    document.getElementById('kpiLicenses').textContent = state.licenses.length;
    document.getElementById('kpiUsers').textContent = state.users.length;
    document.getElementById('kpiVars').textContent = state.variables.length;
    document.getElementById('kpiBlocked').textContent = state.blacklist.length;

    // Populate license key datalist for Add Time modal
    const keyList = document.getElementById('licenseKeyList');
    if (keyList) {
      keyList.innerHTML = state.licenses.map((l) => `<option value="${l.key}"></option>`).join('');
    }

    // Audit Logs
    const auditBody = document.getElementById('auditBody');
    auditBody.innerHTML = state.logs.length
      ? state.logs
          .map(
            (l) => `<tr>
              <td class="mono" style="color:var(--text-muted);">${l.time}</td>
              <td class="mono">${l.event}</td>
              <td class="mono">${l.actor}</td>
              <td class="mono" style="color:var(--text-muted);">${l.pop}</td>
              <td><span class="tag-status ${l.status === 'OK' ? '' : 'dim'}">${l.status}</span></td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;">No recent events.</td></tr>`;

    // Licenses (Table & Grid)
    const filtered = getFilteredLicenses();
    const tableWrap = document.getElementById('licensesTableWrap');
    const gridWrap = document.getElementById('licensesGridWrap');

    tableWrap.style.display = licenseGridView ? 'none' : 'block';
    gridWrap.style.display = licenseGridView ? 'grid' : 'none';

    // Prune stale selected keys & sync Select All
    for (const k of Array.from(selectedLicenseKeys)) {
      if (!state.licenses.some((l) => l.key === k)) selectedLicenseKeys.delete(k);
    }
    const selectAllEl = document.getElementById('selectAllLicenses');
    const selectedCountEl = document.getElementById('selectedLicCount');
    if (selectAllEl) {
      selectAllEl.checked = filtered.length > 0 && filtered.every((l) => selectedLicenseKeys.has(l.key));
    }
    if (selectedCountEl) {
      selectedCountEl.textContent = selectedLicenseKeys.size ? `(${selectedLicenseKeys.size} selected)` : '';
    }

    document.getElementById('licensesBody').innerHTML = filtered.length
      ? filtered
          .map(
            (l) => `<tr>
              <td><input type="checkbox" class="custom-check" data-select-lic="${l.key}" ${selectedLicenseKeys.has(l.key) ? 'checked' : ''} /></td>
              <td class="mono">${l.key}</td>
              <td class="mono">L${l.level}</td>
              <td>${l.expiry}</td>
              <td style="color:var(--text-secondary);">${l.note || '&mdash;'}</td>
              <td><span class="tag-status ${l.status === 'Banned' ? 'dim' : ''}">${l.status}</span></td>
              <td style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" data-copy-key="${l.key}">Copy</button>
                <button class="btn btn-secondary btn-sm" data-edit-key="${l.key}">Edit</button>
                <button class="btn btn-secondary btn-sm" data-ban-key="${l.key}">${l.status === 'Banned' ? 'Unban' : 'Ban'}</button>
                <button class="btn btn-ghost btn-sm" data-del-key="${l.key}">Delete</button>
              </td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="7" style="color:var(--text-muted);text-align:center;padding:24px;">No matching licenses. Click the key icon above to create one.</td></tr>`;

    gridWrap.innerHTML = filtered.length
      ? filtered
          .map(
            (l) => `<div class="lic-card">
              <div class="lic-card-top">
                <label class="check-label" style="gap:8px;">
                  <input type="checkbox" class="custom-check" data-select-lic="${l.key}" ${selectedLicenseKeys.has(l.key) ? 'checked' : ''} />
                  <span class="tag-status ${l.status === 'Banned' ? 'dim' : ''}">${l.status}</span>
                </label>
                <span class="mono" style="font-size:0.74rem;color:var(--text-muted);">Level ${l.level} &middot; ${l.expiry}</span>
              </div>
              <div class="lic-card-key">${l.key}</div>
              <div class="lic-card-meta">
                <span>Note: ${l.note || 'None'}</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" data-copy-key="${l.key}">Copy</button>
                <button class="btn btn-secondary btn-sm" data-edit-key="${l.key}">Edit</button>
                <button class="btn btn-secondary btn-sm" data-ban-key="${l.key}">${l.status === 'Banned' ? 'Unban' : 'Ban'}</button>
                <button class="btn btn-ghost btn-sm" data-del-key="${l.key}">Delete</button>
              </div>
            </div>`
          )
          .join('')
      : `<div style="color:var(--text-muted);padding:20px;">No matching licenses.</div>`;

    // Users
    document.getElementById('usersBody').innerHTML = state.users.length
      ? state.users
          .map(
            (u) => `<tr>
              <td class="mono">${u.username}</td>
              <td>${u.tier}</td>
              <td class="mono" style="color:var(--text-secondary);">${u.hwid || 'Unbound'}</td>
              <td class="mono" style="color:var(--text-muted);">${u.ip || '127.0.0.1'}</td>
              <td style="color:var(--text-muted);">${u.lastLogin || 'Just now'}</td>
              <td><span class="tag-status ${u.status === 'Banned' ? 'dim' : ''}">${u.status}</span></td>
              <td style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" data-reset-hwid="${u.username}">Reset HWID</button>
                <button class="btn btn-secondary btn-sm" data-edit-user="${u.username}">Edit</button>
                <button class="btn btn-ghost btn-sm" data-ban-user="${u.username}">${u.status === 'Banned' ? 'Unban' : 'Ban'}</button>
              </td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="7" style="color:var(--text-muted);text-align:center;padding:20px;">No users registered yet.</td></tr>`;

    // Variables
    document.getElementById('varsBody').innerHTML = state.variables.length
      ? state.variables
          .map(
            (v) => `<tr>
              <td class="mono">${v.name}</td>
              <td class="mono" style="color:var(--text-secondary);">${v.value}</td>
              <td><span class="tag-status">${v.access}</span></td>
              <td><button class="btn btn-ghost btn-sm" data-del-var="${v.name}">Delete</button></td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="4" style="color:var(--text-muted);text-align:center;padding:20px;">No cloud variables created yet.</td></tr>`;

    // Security Toggles
    document.querySelectorAll('[data-sec-toggle]').forEach((el) => {
      el.checked = Boolean(state.security[el.dataset.secToggle]);
    });

    // Blacklist
    document.getElementById('blacklistBody').innerHTML = state.blacklist.length
      ? state.blacklist
          .map(
            (b, idx) => `<tr>
              <td><span class="tag-status">${b.type}</span></td>
              <td class="mono">${b.value}</td>
              <td style="color:var(--text-secondary);">${b.reason || 'Policy violation'}</td>
              <td><button class="btn btn-ghost btn-sm" data-del-bl="${idx}">Remove</button></td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="4" style="color:var(--text-muted);text-align:center;padding:20px;">No blacklist rules yet.</td></tr>`;

    // Teams
    const teamsBody = document.getElementById('teamsBody');
    if (teamsBody) {
      teamsBody.innerHTML = state.teams.length
        ? state.teams
            .map(
              (t, idx) => `<tr>
                <td class="mono">${t.email}</td>
                <td><span class="tag-status">${t.role}</span></td>
                <td><span class="tag-status ${t.status === 'Pending Invite' ? 'dim' : ''}">${t.status}</span></td>
                <td style="color:var(--text-muted);">${t.added}</td>
                <td style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${t.status === 'Pending Invite' ? `<button class="btn btn-secondary btn-sm" data-resend-team="${t.email}">Resend</button>` : ''}
                  ${t.added !== 'Owner' ? `<button class="btn btn-ghost btn-sm" data-del-team="${idx}">Remove</button>` : '<span style="font-size:0.75rem;color:var(--text-muted);">Owner</span>'}
                </td>
              </tr>`
            )
            .join('')
        : `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;">No team members yet.</td></tr>`;
    }

    // Resellers
    const resellersBody = document.getElementById('resellersBody');
    if (resellersBody) {
      resellersBody.innerHTML = state.resellers.length
        ? state.resellers
            .map(
              (r, idx) => `<tr>
                <td class="mono">${r.email}</td>
                <td><span class="tag-status">${r.scope || 'All Levels'}</span></td>
                <td class="mono">$${Number(r.balance || 0).toFixed(2)}</td>
                <td class="mono">${r.minted || 0}</td>
                <td><span class="tag-status ${r.status !== 'Active' ? 'dim' : ''}">${r.status}</span></td>
                <td style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="btn btn-secondary btn-sm" data-credit-reseller="${idx}">+$50</button>
                  <button class="btn btn-secondary btn-sm" data-toggle-reseller="${idx}">${r.status === 'Suspended' ? 'Activate' : 'Suspend'}</button>
                  <button class="btn btn-ghost btn-sm" data-del-reseller="${idx}">Remove</button>
                </td>
              </tr>`
            )
            .join('')
        : `<tr><td colspan="6" style="color:var(--text-muted);text-align:center;">No resellers invited yet.</td></tr>`;
    }
  }

  /* ------------------------------------------------------------------------
     6-Button License Toolbar Handlers
     ------------------------------------------------------------------------ */
  const filterDrawer = document.getElementById('licenseFilterDrawer');
  const btnToggleFilter = document.getElementById('btnToggleFilter');
  const btnToggleView = document.getElementById('btnToggleView');

  btnToggleFilter?.addEventListener('click', () => {
    const isOpen = filterDrawer.classList.toggle('open');
    btnToggleFilter.classList.toggle('active', isOpen);
  });

  btnToggleView?.addEventListener('click', () => {
    licenseGridView = !licenseGridView;
    btnToggleView.classList.toggle('active', licenseGridView);
    renderAll();
  });

  document.getElementById('btnOpenCreateLic')?.addEventListener('click', () => {
    if (!requireActiveApp()) return;
    openModal(createLicModal);
  });

  document.getElementById('btnOpenAddTime')?.addEventListener('click', () => {
    if (!requireActiveApp()) return;
    const keyInput = document.getElementById('addTimeKey');
    if (keyInput && !keyInput.value && state.licenses[0]) {
      keyInput.value = '';
    }
    openModal(addTimeModal);
    keyInput?.focus();
  });

  document.getElementById('selectAllLicenses')?.addEventListener('change', (e) => {
    const filtered = getFilteredLicenses();
    if (e.target.checked) {
      filtered.forEach((l) => selectedLicenseKeys.add(l.key));
    } else {
      filtered.forEach((l) => selectedLicenseKeys.delete(l.key));
    }
    renderAll();
  });

  function handleLicenseCheckboxChange(e) {
    const key = e.target.dataset.selectLic;
    if (!key) return;
    if (e.target.checked) selectedLicenseKeys.add(key);
    else selectedLicenseKeys.delete(key);
    renderAll();
  }

  document.getElementById('licensesBody')?.addEventListener('change', handleLicenseCheckboxChange);
  document.getElementById('licensesGridWrap')?.addEventListener('change', handleLicenseCheckboxChange);

  document.getElementById('exportLicensesBtn')?.addEventListener('click', () => {
    const list = selectedLicenseKeys.size
      ? state.licenses.filter((l) => selectedLicenseKeys.has(l.key))
      : state.licenses;
    const text = list.map((l) => l.key).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shieldauth-licenses.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${list.length} license${list.length === 1 ? '' : 's'} (.txt)`);
  });

  document.getElementById('btnDeleteUnused')?.addEventListener('click', () => {
    if (selectedLicenseKeys.size > 0) {
      const count = selectedLicenseKeys.size;
      state.licenses = state.licenses.filter((l) => !selectedLicenseKeys.has(l.key));
      selectedLicenseKeys.clear();
      logEvent('license.delete_selected', `${count} keys removed`);
      saveState();
      renderAll();
      showToast(`Deleted ${count} selected license${count > 1 ? 's' : ''}`);
      return;
    }

    const before = state.licenses.length;
    state.licenses = state.licenses.filter((l) => l.status !== 'Unused');
    const removed = before - state.licenses.length;
    if (removed === 0) {
      showToast('No unused licenses to delete');
      return;
    }
    logEvent('license.purge_unused', `${removed} keys removed`);
    saveState();
    renderAll();
    showToast(`Deleted ${removed} unused license${removed > 1 ? 's' : ''}`);
  });

  /* ------------------------------------------------------------------------
     Create License Form Submit
     ------------------------------------------------------------------------ */
  document.getElementById('createLicenseForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireActiveApp()) return;
    const amount = Math.min(100, Math.max(1, Number(document.getElementById('licAmount').value) || 1));
    const mask = document.getElementById('licMask').value.trim() || 'SHLD-******-******-******';
    const useLower = document.getElementById('licLowercase').checked;
    const useUpper = document.getElementById('licUppercase').checked;
    const level = Number(document.getElementById('licSubLevel').value) || 1;
    const note = document.getElementById('licNote').value.trim();
    const unit = document.getElementById('licExpiryUnit').value;
    const duration = document.getElementById('licExpiryDuration').value;
    const expiry = formatExpiry(unit, duration);

    for (let i = 0; i < amount; i++) {
      const key = expandMask(mask, useLower, useUpper);
      state.licenses.unshift({
        key,
        level,
        expiry,
        hwid: 'Unbound',
        note,
        status: 'Unused'
      });
    }

    logEvent('license.created', `${amount}x L${level} (${expiry})`);
    saveState();
    renderAll();
    closeModal(createLicModal);
    document.getElementById('licNote').value = '';
    showToast(`Created ${amount} new license${amount > 1 ? 's' : ''}`);
  });

  /* ------------------------------------------------------------------------
     Add Time Form Submit (Key-Specific)
     ------------------------------------------------------------------------ */
  document.getElementById('addTimeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireActiveApp()) return;
    const keyVal = document.getElementById('addTimeKey').value.trim();
    const unit = document.getElementById('addTimeUnit').value;
    const amt = Number(document.getElementById('addTimeAmount').value) || 1;
    const noteVal = document.getElementById('addTimeNote').value.trim();

    const target = state.licenses.find((l) => l.key.toLowerCase() === keyVal.toLowerCase());
    if (!target) {
      showToast('License key not found — pick an existing key');
      return;
    }

    if (unit === 'Lifetime') {
      target.expiry = 'Lifetime';
    } else if (target.expiry === 'Lifetime') {
      target.expiry = 'Lifetime';
    } else {
      target.expiry = `${target.expiry} + ${formatExpiry(unit, amt)}`;
    }

    if (noteVal) target.note = noteVal;

    logEvent('license.add_time', `${target.key} (+${formatExpiry(unit, amt)})`);
    saveState();
    renderAll();
    closeModal(addTimeModal);
    e.target.reset();
    showToast(`Added ${formatExpiry(unit, amt)} to ${target.key}`);
  });

  /* ------------------------------------------------------------------------
     Edit License Modal
     ------------------------------------------------------------------------ */
  document.getElementById('editLicenseForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = document.getElementById('editLicKey').value;
    const target = state.licenses.find((l) => l.key === key);
    if (!target) return;

    target.level = Number(document.getElementById('editLicLevel').value) || 1;
    target.expiry = document.getElementById('editLicExpiry').value.trim() || target.expiry;
    target.note = document.getElementById('editLicNote').value.trim();
    target.status = document.getElementById('editLicStatus').value;

    logEvent('license.edited', `${target.key} (L${target.level}, ${target.status})`);
    saveState();
    renderAll();
    closeModal(editLicModal);
    showToast(`Updated ${target.key}`);
  });

  /* ------------------------------------------------------------------------
     Edit User Modal
     ------------------------------------------------------------------------ */
  document.getElementById('editUserResetHwidBtn')?.addEventListener('click', () => {
    document.getElementById('editUserHwid').value = 'Unbound';
    showToast('User HWID cleared — click Save User');
  });

  document.getElementById('editUserForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const orig = document.getElementById('editUserOrigName').value;
    const target = state.users.find((u) => u.username === orig);
    if (!target) return;

    target.username = document.getElementById('editUserName').value.trim() || orig;
    target.tier = document.getElementById('editUserTier').value.trim() || target.tier;
    target.hwid = document.getElementById('editUserHwid').value.trim() || 'Unbound';
    target.status = document.getElementById('editUserStatus').value;

    logEvent('user.edited', `${target.username} (${target.status})`);
    saveState();
    renderAll();
    closeModal(editUserModal);
    showToast(`Saved changes for ${target.username}`);
  });

  /* ------------------------------------------------------------------------
     Filter & Row Actions (Licenses + Users)
     ------------------------------------------------------------------------ */
  ['licenseSearch', 'licenseStatusFilter', 'licenseLevelFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderAll);
    document.getElementById(id)?.addEventListener('change', renderAll);
  });

  async function handleLicenseRowAction(e) {
    const copyKey = e.target.dataset.copyKey;
    const resetHwidKey = e.target.dataset.resetLicHwid;
    const editKey = e.target.dataset.editKey;
    const banKey = e.target.dataset.banKey;
    const delKey = e.target.dataset.delKey;

    if (copyKey) {
      try { await navigator.clipboard.writeText(copyKey); } catch {}
      showToast(`Copied ${copyKey}`);
    } else if (resetHwidKey) {
      const item = state.licenses.find((l) => l.key === resetHwidKey);
      if (item) {
        item.hwid = 'Unbound';
        logEvent('hwid.reset', item.key);
        saveState();
        renderAll();
        showToast(`HWID reset for ${item.key}`);
      }
    } else if (editKey) {
      const item = state.licenses.find((l) => l.key === editKey);
      if (item) {
        document.getElementById('editLicKey').value = item.key;
        document.getElementById('editLicLevel').value = String(item.level);
        document.getElementById('editLicExpiry').value = item.expiry;
        document.getElementById('editLicNote').value = item.note || '';
        document.getElementById('editLicStatus').value = item.status;
        openModal(editLicModal);
      }
    } else if (banKey) {
      const item = state.licenses.find((l) => l.key === banKey);
      if (item) {
        item.status = item.status === 'Banned' ? 'Active' : 'Banned';
        logEvent('license.moderation', `${item.key} -> ${item.status}`, item.status === 'Banned' ? 'BLOCKED' : 'OK');
        saveState();
        renderAll();
        showToast(`${item.status === 'Banned' ? 'Banned' : 'Unbanned'} ${item.key}`);
      }
    } else if (delKey) {
      state.licenses = state.licenses.filter((l) => l.key !== delKey);
      logEvent('license.deleted', delKey);
      saveState();
      renderAll();
      showToast('License deleted');
    }
  }

  document.getElementById('licensesBody')?.addEventListener('click', handleLicenseRowAction);
  document.getElementById('licensesGridWrap')?.addEventListener('click', handleLicenseRowAction);

  document.getElementById('usersBody')?.addEventListener('click', (e) => {
    const resetU = e.target.dataset.resetHwid;
    const editU = e.target.dataset.editUser;
    const banU = e.target.dataset.banUser;

    if (resetU) {
      const user = state.users.find((u) => u.username === resetU);
      if (user) {
        user.hwid = 'Unbound';
        logEvent('hwid.reset', user.username);
        saveState();
        renderAll();
        showToast(`HWID reset for ${user.username}`);
      }
    } else if (editU) {
      const user = state.users.find((u) => u.username === editU);
      if (user) {
        document.getElementById('editUserOrigName').value = user.username;
        document.getElementById('editUserName').value = user.username;
        document.getElementById('editUserTier').value = user.tier;
        document.getElementById('editUserHwid').value = user.hwid || 'Unbound';
        document.getElementById('editUserStatus').value = user.status;
        openModal(editUserModal);
      }
    } else if (banU) {
      const user = state.users.find((u) => u.username === banU);
      if (user) {
        user.status = user.status === 'Banned' ? 'Active' : 'Banned';
        logEvent('user.moderation', `${user.username} -> ${user.status}`, user.status === 'Banned' ? 'BLOCKED' : 'OK');
        saveState();
        renderAll();
        showToast(`${user.status === 'Banned' ? 'Banned' : 'Unbanned'} ${user.username}`);
      }
    }
  });

  /* ------------------------------------------------------------------------
     Variables, Security, Webhooks & Settings Handlers
     ------------------------------------------------------------------------ */
  document.getElementById('varForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireActiveApp()) return;
    const name = document.getElementById('varName').value.trim();
    const value = document.getElementById('varValue').value.trim();
    if (!name || !value) return;
    state.variables = state.variables.filter((v) => v.name !== name);
    state.variables.unshift({ name, value, access: 'Authenticated' });
    logEvent('var.updated', name);
    saveState();
    renderAll();
    e.target.reset();
    showToast(`Saved cloud variable "${name}"`);
  });

  document.getElementById('varsBody')?.addEventListener('click', (e) => {
    const name = e.target.dataset.delVar;
    if (!name) return;
    state.variables = state.variables.filter((v) => v.name !== name);
    logEvent('var.deleted', name);
    saveState();
    renderAll();
    showToast(`Deleted "${name}"`);
  });

  document.querySelectorAll('[data-sec-toggle]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.secToggle;
      state.security[key] = el.checked;
      logEvent('security.policy', `${key}=${el.checked}`);
      saveState();
      renderAll();
      showToast(`Updated ${key} policy`);
    });
  });

  document.getElementById('blacklistForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireActiveApp()) return;
    const type = document.getElementById('blType').value;
    const value = document.getElementById('blValue').value.trim();
    const reason = document.getElementById('blReason').value.trim();
    if (!value) return;
    state.blacklist.unshift({ type, value, reason });
    logEvent('blacklist.added', `${type}:${value}`, 'BLOCKED');
    saveState();
    renderAll();
    e.target.reset();
    showToast(`Blacklisted ${value}`);
  });

  document.getElementById('blacklistBody')?.addEventListener('click', (e) => {
    const idx = e.target.dataset.delBl;
    if (idx === undefined) return;
    const removed = state.blacklist.splice(Number(idx), 1)[0];
    if (removed) logEvent('blacklist.removed', removed.value);
    saveState();
    renderAll();
    showToast('Removed blacklist rule');
  });

  document.getElementById('testWebhookBtn')?.addEventListener('click', () => {
    if (!requireActiveApp()) return;
    logEvent('webhook.dispatched', 'HTTP 204 · HMAC verified');
    saveState();
    renderAll();
    showToast('Signed webhook test payload delivered (204)');
  });

  /* ------------------------------------------------------------------------
     Shared Invite Inbox, Email Delivery (/api/send-invite), Incoming Tabs & Bottom-Left Tray
     ------------------------------------------------------------------------ */
  function getSignedInEmail() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && s.email ? String(s.email).trim().toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function loadInviteInbox() {
    try {
      const arr = JSON.parse(localStorage.getItem(INVITES_INBOX_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveInviteInbox(arr) {
    localStorage.setItem(INVITES_INBOX_KEY, JSON.stringify(arr));
  }

  function encodeInviteToken(payload) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch {
      return '';
    }
  }

  function decodeInviteToken(token) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(token))));
    } catch {
      return null;
    }
  }

  // Ingest ?invite= token from email link into the recipient's inbox & open matching tab
  (function ingestInviteLink() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite') || sessionStorage.getItem('shieldauth_pending_invite_token');
    if (!token) return;
    sessionStorage.removeItem('shieldauth_pending_invite_token');

    const inv = decodeInviteToken(token);
    if (!inv || !inv.id || !inv.toEmail || !inv.kind) return;

    const inbox = loadInviteInbox();
    if (!inbox.some((x) => x.id === inv.id)) {
      inbox.unshift({
        id: inv.id,
        kind: inv.kind,
        toEmail: String(inv.toEmail).toLowerCase(),
        fromEmail: inv.fromEmail || 'ShieldAuth Owner',
        appName: inv.appName || 'ShieldAuth',
        detail: inv.detail || '',
        balance: Number(inv.balance || 0),
        status: 'Pending Invite',
        dismissedTray: false,
        createdAt: inv.createdAt || new Date().toISOString()
      });
      saveInviteInbox(inbox);
    }

    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    setTimeout(() => {
      switchPanel(inv.kind === 'reseller' ? 'resellers' : 'teams');
      showToast(`Opened ${inv.kind === 'reseller' ? 'reseller' : 'team'} invite for ${inv.toEmail}`);
    }, 80);
  })();

  function getIncomingInvitesForCurrentUser() {
    const me = getSignedInEmail();
    const inbox = loadInviteInbox();
    if (!me) return [];
    return inbox.filter((i) => i.toEmail === me);
  }

  function renderIncomingInviteSections() {
    const mine = getIncomingInvitesForCurrentUser();
    const teamInvs = mine.filter((i) => i.kind === 'team');
    const resellerInvs = mine.filter((i) => i.kind === 'reseller');

    const teamCard = document.getElementById('incomingTeamInvitesCard');
    const teamBody = document.getElementById('incomingTeamsBody');
    if (teamCard && teamBody) {
      teamCard.style.display = teamInvs.length ? 'block' : 'none';
      teamBody.innerHTML = teamInvs
        .map(
          (i) => `<tr>
            <td><strong>${i.appName}</strong></td>
            <td class="mono" style="color:var(--text-secondary);">${i.fromEmail}</td>
            <td><span class="tag-status">${i.detail}</span></td>
            <td><span class="tag-status ${i.status !== 'Active' ? 'dim' : ''}">${i.status}</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              ${
                i.status === 'Pending Invite'
                  ? `<button class="btn btn-primary btn-sm" data-accept-invite="${i.id}">Accept</button>
                     <button class="btn btn-secondary btn-sm" data-decline-invite="${i.id}">Decline</button>`
                  : `<span style="font-size:0.76rem;color:var(--text-muted);">${i.status}</span>`
              }
            </td>
          </tr>`
        )
        .join('');
    }

    const resCard = document.getElementById('incomingResellerInvitesCard');
    const resBody = document.getElementById('incomingResellersBody');
    if (resCard && resBody) {
      resCard.style.display = resellerInvs.length ? 'block' : 'none';
      resBody.innerHTML = resellerInvs
        .map(
          (i) => `<tr>
            <td><strong>${i.appName}</strong></td>
            <td class="mono" style="color:var(--text-secondary);">${i.fromEmail}</td>
            <td><span class="tag-status">${i.detail}</span></td>
            <td class="mono">$${Number(i.balance || 0).toFixed(2)}</td>
            <td><span class="tag-status ${i.status !== 'Active' ? 'dim' : ''}">${i.status}</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              ${
                i.status === 'Pending Invite'
                  ? `<button class="btn btn-primary btn-sm" data-accept-invite="${i.id}">Accept</button>
                     <button class="btn btn-secondary btn-sm" data-decline-invite="${i.id}">Decline</button>`
                  : `<span style="font-size:0.76rem;color:var(--text-muted);">${i.status}</span>`
              }
            </td>
          </tr>`
        )
        .join('');
    }
  }

  function renderInviteTray() {
    renderIncomingInviteSections();
    const tray = document.getElementById('inviteTray');
    if (!tray) return;

    const pendingForMe = getIncomingInvitesForCurrentUser().filter(
      (c) => c.status === 'Pending Invite' && !c.dismissedTray
    );

    tray.innerHTML = pendingForMe
      .map(
        (c) => `<div class="invite-card" data-invite-id="${c.id}">
          <div class="invite-card-head">
            <span class="invite-pill">${c.kind === 'team' ? 'TEAM INVITE' : 'RESELLER INVITE'}</span>
            <button type="button" class="invite-close" data-dismiss-invite="${c.id}" aria-label="Dismiss">&times;</button>
          </div>
          <div class="invite-card-title">You've been invited to ${c.appName}</div>
          <div class="invite-card-meta">
            From: <code>${c.fromEmail}</code><br/>
            ${c.kind === 'team' ? `Role: <strong>${c.detail}</strong>` : `Scope: <strong>${c.detail}</strong> &middot; Credit: <strong>$${Number(c.balance || 0).toFixed(2)}</strong>`}
          </div>
          <div class="invite-card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-accept-invite="${c.id}">Accept Invite</button>
            <button type="button" class="btn btn-secondary btn-sm" data-decline-invite="${c.id}">Decline</button>
          </div>
        </div>`
      )
      .join('');
  }

  function handleInviteDecision(e) {
    const acceptId = e.target.dataset.acceptInvite;
    const declineId = e.target.dataset.declineInvite;
    const dismissId = e.target.dataset.dismissInvite;
    if (!acceptId && !declineId && !dismissId) return;

    const inbox = loadInviteInbox();

    if (acceptId) {
      const inv = inbox.find((c) => c.id === acceptId);
      if (!inv) return;
      inv.status = 'Active';
      inv.dismissedTray = true;
      saveInviteInbox(inbox);

      if (inv.kind === 'team') {
        const member = state.teams.find((t) => t.email === inv.toEmail);
        if (member) member.status = 'Active';
        logEvent('team.invite_accepted', inv.toEmail);
      } else {
        const reseller = state.resellers.find((r) => r.email === inv.toEmail);
        if (reseller) reseller.status = 'Active';
        logEvent('reseller.invite_accepted', inv.toEmail);
      }
      saveState();
      renderAll();
      showToast(`Accepted ${inv.kind} invite for ${inv.appName}`);
    } else if (declineId) {
      const inv = inbox.find((c) => c.id === declineId);
      if (!inv) return;
      const nextInbox = inbox.filter((c) => c.id !== declineId);
      saveInviteInbox(nextInbox);

      if (inv.kind === 'team') {
        state.teams = state.teams.filter((t) => t.email !== inv.toEmail);
        logEvent('team.invite_declined', inv.toEmail, 'BLOCKED');
      } else {
        state.resellers = state.resellers.filter((r) => r.email !== inv.toEmail);
        logEvent('reseller.invite_declined', inv.toEmail, 'BLOCKED');
      }
      saveState();
      renderAll();
      showToast(`Declined invite for ${inv.appName}`);
    } else if (dismissId) {
      const inv = inbox.find((c) => c.id === dismissId);
      if (inv) {
        inv.dismissedTray = true;
        saveInviteInbox(inbox);
        renderInviteTray();
      }
    }
  }

  document.getElementById('inviteTray')?.addEventListener('click', handleInviteDecision);
  document.getElementById('incomingTeamsBody')?.addEventListener('click', handleInviteDecision);
  document.getElementById('incomingResellersBody')?.addEventListener('click', handleInviteDecision);

  async function dispatchInvite({ kind, toEmail, detail, balance }) {
    const id = `inv_${randomHex(8)}`;
    const fromEmail = getSignedInEmail() || 'ShieldAuth Admin';
    const appName = state.selectedAppId ? state.appName : 'ShieldAuth';

    const record = {
      id,
      kind,
      toEmail: toEmail.toLowerCase(),
      fromEmail,
      appName,
      detail,
      balance: Number(balance || 0),
      status: 'Pending Invite',
      dismissedTray: false,
      createdAt: new Date().toISOString()
    };

    // 1. Deliver directly into the recipient's Teams / Resellers inbox
    const inbox = loadInviteInbox();
    inbox.unshift(record);
    saveInviteInbox(inbox);

    // 2. Build email invite link & send real email via Vercel /api/send-invite
    const token = encodeInviteToken(record);
    const acceptUrl = `${window.location.origin}/dashboard.html?invite=${encodeURIComponent(token)}`;

    try {
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          toEmail: record.toEmail,
          fromEmail,
          appName,
          detail,
          balance: record.balance,
          acceptUrl
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.sent) {
        showToast(`Email sent to ${record.toEmail} & delivered to their ${kind === 'team' ? 'Teams' : 'Resellers'} tab`);
        return acceptUrl;
      }
    } catch {}

    showToast(`Delivered to ${record.toEmail}'s ${kind === 'team' ? 'Teams' : 'Resellers'} tab (add RESEND_API_KEY in Vercel for live email)`);
    return acceptUrl;
  }

  /* ------------------------------------------------------------------------
     Teams & Resellers Email Invite Handlers
     ------------------------------------------------------------------------ */
  document.getElementById('inviteTeamForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('teamInviteEmail').value.trim().toLowerCase();
    const role = document.getElementById('teamInviteRole').value;
    if (!email) return;
    if (state.teams.some((t) => t.email.toLowerCase() === email)) {
      showToast(`${email} is already on this team`);
      return;
    }
    state.teams.unshift({
      email,
      role,
      status: 'Pending Invite',
      added: 'Just now'
    });
    logEvent('team.invite_sent', `${email} (${role})`);
    saveState();
    e.target.reset();
    await dispatchInvite({ kind: 'team', toEmail: email, detail: role });
    renderAll();
  });

  document.getElementById('teamsBody')?.addEventListener('click', async (e) => {
    const resendEmail = e.target.dataset.resendTeam;
    const delIdx = e.target.dataset.delTeam;
    if (resendEmail) {
      const member = state.teams.find((t) => t.email === resendEmail);
      logEvent('team.invite_resent', resendEmail);
      saveState();
      if (member) await dispatchInvite({ kind: 'team', toEmail: member.email, detail: member.role });
      renderAll();
    } else if (delIdx !== undefined) {
      const removed = state.teams.splice(Number(delIdx), 1)[0];
      if (removed) {
        saveInviteInbox(loadInviteInbox().filter((c) => !(c.kind === 'team' && c.toEmail === removed.email)));
        logEvent('team.member_removed', removed.email);
      }
      saveState();
      renderAll();
      showToast('Removed team member');
    }
  });

  document.getElementById('inviteResellerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('resellerInviteEmail').value.trim().toLowerCase();
    const balance = Math.max(0, Number(document.getElementById('resellerInviteBalance').value) || 0);
    const scope = document.getElementById('resellerInviteLevel').value;
    if (!email) return;
    if (state.resellers.some((r) => r.email.toLowerCase() === email)) {
      showToast(`${email} is already invited as a reseller`);
      return;
    }
    state.resellers.unshift({
      email,
      scope,
      balance,
      minted: 0,
      status: 'Pending Invite'
    });
    logEvent('reseller.invite_sent', `${email} ($${balance.toFixed(2)})`);
    saveState();
    e.target.reset();
    document.getElementById('resellerInviteBalance').value = '100';
    await dispatchInvite({ kind: 'reseller', toEmail: email, detail: scope, balance });
    renderAll();
  });

  document.getElementById('resellersBody')?.addEventListener('click', (e) => {
    const creditIdx = e.target.dataset.creditReseller;
    const toggleIdx = e.target.dataset.toggleReseller;
    const delIdx = e.target.dataset.delReseller;

    if (creditIdx !== undefined) {
      const r = state.resellers[Number(creditIdx)];
      if (r) {
        r.balance = Number(r.balance || 0) + 50;
        logEvent('reseller.credits_added', `${r.email} (+$50.00)`);
        saveState();
        renderAll();
        showToast(`Added $50.00 credit to ${r.email}`);
      }
    } else if (toggleIdx !== undefined) {
      const r = state.resellers[Number(toggleIdx)];
      if (r) {
        r.status = r.status === 'Suspended' ? 'Active' : 'Suspended';
        logEvent('reseller.status', `${r.email} -> ${r.status}`, r.status === 'Suspended' ? 'BLOCKED' : 'OK');
        saveState();
        renderAll();
        showToast(`${r.email} is now ${r.status}`);
      }
    } else if (delIdx !== undefined) {
      const removed = state.resellers.splice(Number(delIdx), 1)[0];
      if (removed) {
        saveInviteInbox(loadInviteInbox().filter((c) => !(c.kind === 'reseller' && c.toEmail === removed.email)));
        logEvent('reseller.removed', removed.email);
      }
      saveState();
      renderAll();
      showToast('Removed reseller');
    }
  });

  document.getElementById('clearLogsBtn')?.addEventListener('click', () => {
    state.logs = [];
    saveState();
    renderAll();
  });

  document.getElementById('rotateSecretBtn')?.addEventListener('click', () => {
    if (!requireActiveApp()) return;
    state.appSecret = `shld_sec_${randomHex(28)}`;
    logEvent('credentials.rotated', 'app_secret');
    saveState();
    renderAll();
    showToast('Application secret rotated');
  });

  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    if (!requireActiveApp()) return;
    const app = getSelectedApp();
    const newName = document.getElementById('setAppName').value.trim();
    if (app && newName) {
      app.name = newName;
      state.appName = newName;
    }
    logEvent('settings.updated', state.appName);
    saveState();
    renderAll();
    showToast('Application settings saved');
  });

  /* ------------------------------------------------------------------------
     My Applications Handlers
     ------------------------------------------------------------------------ */
  document.getElementById('appsSearchInput')?.addEventListener('input', renderApps);
  document.getElementById('appsStatusFilter')?.addEventListener('change', renderApps);

  document.getElementById('openCreateAppBtn')?.addEventListener('click', () => {
    openModal(createAppModal);
    document.getElementById('newAppName')?.focus();
  });

  document.getElementById('createAppForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newAppName').value.trim();
    const version = document.getElementById('newAppVersion').value.trim() || '1.0';
    const description = document.getElementById('newAppDesc').value.trim();
    if (!name) return;

    const id = `app_${randomHex(8)}`;
    state.apps.unshift({
      id,
      name,
      version,
      users: 0,
      standing: 'Good',
      status: 'ACTIVE',
      description
    });
    state.selectedAppId = id;
    logEvent('app.created', `${name} (${id})`);
    saveState();
    renderAll();
    closeModal(createAppModal);
    e.target.reset();
    document.getElementById('newAppVersion').value = '1.0';
    showToast(`Created application "${name}"`);
  });

  document.getElementById('appsList')?.addEventListener('click', (e) => {
    const selBtn = e.target.closest('[data-select-app]');
    const renBtn = e.target.closest('[data-rename-app]');
    const descBtn = e.target.closest('[data-desc-app]');
    const pauseBtn = e.target.closest('[data-pause-app]');
    const delBtn = e.target.closest('[data-delete-app]');

    if (selBtn) {
      const id = selBtn.dataset.selectApp;
      const app = state.apps.find((a) => a.id === id);
      if (app) {
        state.selectedAppId = app.id;
        logEvent('app.selected', app.name);
        saveState();
        renderAll();
        showToast(`Selected "${app.name}"`);
      }
    } else if (renBtn) {
      const id = renBtn.dataset.renameApp;
      const app = state.apps.find((a) => a.id === id);
      if (app) {
        document.getElementById('renameAppId').value = app.id;
        document.getElementById('renameAppInput').value = app.name;
        openModal(renameAppModal);
        document.getElementById('renameAppInput')?.focus();
      }
    } else if (descBtn) {
      const id = descBtn.dataset.descApp;
      const app = state.apps.find((a) => a.id === id);
      if (app) {
        document.getElementById('editDescAppId').value = app.id;
        document.getElementById('editDescInput').value = app.description || '';
        openModal(editDescModal);
        document.getElementById('editDescInput')?.focus();
      }
    } else if (pauseBtn) {
      const id = pauseBtn.dataset.pauseApp;
      const app = state.apps.find((a) => a.id === id);
      if (app) {
        app.status = app.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
        logEvent('app.status', `${app.name} -> ${app.status}`);
        saveState();
        renderAll();
        showToast(`${app.name} is now ${app.status}`);
      }
    } else if (delBtn) {
      const id = delBtn.dataset.deleteApp;
      const target = state.apps.find((a) => a.id === id);
      state.apps = state.apps.filter((a) => a.id !== id);
      if (state.selectedAppId === id) {
        state.selectedAppId = state.apps[0] ? state.apps[0].id : null;
      }
      if (target) logEvent('app.deleted', target.name, 'BLOCKED');
      saveState();
      renderAll();
      showToast(`Deleted "${target ? target.name : id}"`);
    }
  });

  document.getElementById('renameAppForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('renameAppId').value;
    const newName = document.getElementById('renameAppInput').value.trim();
    const app = state.apps.find((a) => a.id === id);
    if (!app || !newName) return;
    app.name = newName;
    logEvent('app.renamed', newName);
    saveState();
    renderAll();
    closeModal(renameAppModal);
    showToast(`Renamed application to "${newName}"`);
  });

  document.getElementById('editDescForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('editDescAppId').value;
    const newDesc = document.getElementById('editDescInput').value.trim();
    const app = state.apps.find((a) => a.id === id);
    if (!app) return;
    app.description = newDesc;
    logEvent('app.description_updated', app.name);
    saveState();
    renderAll();
    closeModal(editDescModal);
    showToast(`Updated description for "${app.name}"`);
  });

  /* ------------------------------------------------------------------------
     Premade App Credentials SDK Integration Code (13 Languages)
     ------------------------------------------------------------------------ */
  let activeDashLang = 'cpp';

  function getDashSdkSnippet(lang) {
    const app = getSelectedApp();
    const name = app ? app.name : 'YourAppName';
    const appId = app ? app.id : 'app_xxxxxxxx';
    const ownerId = 'own_44b19e2d';
    const version = app ? app.version || '1.0' : '1.0';
    const publicKey = 'ed25519:pk_live_8a91c4f0d2b17e33a90c41f7';
    const secret = state.appSecret;

    const map = {
      cpp: {
        file: 'shieldauth_setup.cpp',
        code: `#include <shieldauth/api.hpp>
#include <iostream>

// Auto-filled ShieldAuth credentials for "${name}"
shieldauth::App app(
    "${name}",
    "${appId}",
    "${ownerId}",
    "${secret}",
    "${version}"
);

int main() {
    app.set_public_key("${publicKey}");
    app.init();
    if (!app.response.success) {
        std::cerr << "Init failed: " << app.response.message << "\\n";
        return 1;
    }

    std::string key;
    std::cout << "Enter License Key: ";
    std::cin >> key;

    app.license(key);
    if (!app.response.success) {
        std::cerr << "Access denied: " << app.response.message << "\\n";
        return 1;
    }

    std::cout << "Authenticated! Welcome " << app.user.username << "\\n";
    return 0;
}`
      },
      csharp: {
        file: 'ShieldAuthSetup.cs',
        code: `using System;
using ShieldAuth;

// Auto-filled ShieldAuth credentials for "${name}"
var app = new ShieldAuthApp(
    name: "${name}",
    appId: "${appId}",
    ownerId: "${ownerId}",
    secret: "${secret}",
    publicKey: "${publicKey}",
    version: "${version}"
);

app.Init();
Console.Write("Enter License Key: ");
var licenseKey = Console.ReadLine();

app.License(licenseKey);
if (!app.Response.Success) {
    Console.WriteLine($"Denied: {app.Response.Message}");
    Environment.Exit(1);
}

Console.WriteLine($"Authenticated as {app.User.Username} (Level {app.User.Level})");`
      },
      python: {
        file: 'shieldauth_setup.py',
        code: `from shieldauth import ShieldAuthApp

# Auto-filled ShieldAuth credentials for "${name}"
app = ShieldAuthApp(
    name="${name}",
    app_id="${appId}",
    owner_id="${ownerId}",
    secret="${secret}",
    public_key="${publicKey}",
    version="${version}",
)

app.init()
license_key = input("Enter License Key: ").strip()
app.license(license_key)

print(f"Authenticated: {app.user.username} | HWID: {app.user.hwid}")`
      },
      rust: {
        file: 'src/main.rs',
        code: `use shieldauth::{Config, ShieldAuthApp};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Auto-filled ShieldAuth credentials for "${name}"
    let mut app = ShieldAuthApp::new(Config {
        name: "${name}".into(),
        app_id: "${appId}".into(),
        owner_id: "${ownerId}".into(),
        secret: "${secret}".into(),
        public_key: "${publicKey}".into(),
        version: "${version}".into(),
    })?;

    app.init().await?;
    app.license("ENTER-LICENSE-KEY").await?;
    println!("Authenticated user: {}", app.user().username);
    Ok(())
}`
      },
      js: {
        file: 'shieldauth.js',
        code: `import { ShieldAuthApp } from '@shieldauth/sdk';

// Auto-filled ShieldAuth credentials for "${name}"
const app = new ShieldAuthApp({
  name: '${name}',
  appId: '${appId}',
  ownerId: '${ownerId}',
  secret: '${secret}',
  publicKey: '${publicKey}',
  version: '${version}',
});

await app.init();
await app.license('ENTER-LICENSE-KEY');
console.log('Authenticated:', app.user.username);`
      },
      ts: {
        file: 'shieldauth.ts',
        code: `import { ShieldAuthApp, type Session } from '@shieldauth/sdk';

// Auto-filled ShieldAuth credentials for "${name}"
const app = new ShieldAuthApp({
  name: '${name}',
  appId: '${appId}',
  ownerId: '${ownerId}',
  secret: '${secret}',
  publicKey: '${publicKey}',
  version: '${version}',
});

export async function authenticate(licenseKey: string): Promise<Session> {
  await app.init();
  const session = await app.license(licenseKey);
  if (!session.verified) throw new Error(session.message);
  return session;
}`
      },
      go: {
        file: 'main.go',
        code: `package main

import (
    "fmt"
    "log"
    "github.com/shieldauth/shieldauth-go"
)

func main() {
    // Auto-filled ShieldAuth credentials for "${name}"
    app := shieldauth.New(shieldauth.Config{
        Name:      "${name}",
        AppID:     "${appId}",
        OwnerID:   "${ownerId}",
        Secret:    "${secret}",
        PublicKey: "${publicKey}",
        Version:   "${version}",
    })

    if err := app.Init(); err != nil {
        log.Fatalf("init failed: %v", err)
    }

    session, err := app.License("ENTER-LICENSE-KEY")
    if err != nil {
        log.Fatalf("access denied: %v", err)
    }

    fmt.Printf("Authenticated %s (level=%d)\\n", session.Username, session.Level)
}`
      },
      php: {
        file: 'shieldauth.php',
        code: `<?php
require 'vendor/autoload.php';

// Auto-filled ShieldAuth credentials for "${name}"
$app = new ShieldAuth\\App([
    'name'       => '${name}',
    'app_id'     => '${appId}',
    'owner_id'   => '${ownerId}',
    'secret'     => '${secret}',
    'public_key' => '${publicKey}',
    'version'    => '${version}',
]);

$app->init();
if ($app->license($_POST['license_key'] ?? '')) {
    echo 'Authenticated: ' . $app->user['username'];
} else {
    http_response_code(401);
    echo 'Denied: ' . $app->response['message'];
}`
      },
      java: {
        file: 'ShieldAuthSetup.java',
        code: `import io.shieldauth.ShieldAuthApp;

public class ShieldAuthSetup {
    public static void main(String[] args) {
        // Auto-filled ShieldAuth credentials for "${name}"
        ShieldAuthApp app = new ShieldAuthApp.Builder()
            .name("${name}")
            .appId("${appId}")
            .ownerId("${ownerId}")
            .secret("${secret}")
            .publicKey("${publicKey}")
            .version("${version}")
            .build();

        app.init();
        if (!app.license("ENTER-LICENSE-KEY")) {
            System.err.println("Denied: " + app.getMessage());
            System.exit(1);
        }

        System.out.println("Authenticated: " + app.getUser().getUsername());
    }
}`
      },
      lua: {
        file: 'shieldauth.lua',
        code: `local ShieldAuth = require("shieldauth")

-- Auto-filled ShieldAuth credentials for "${name}"
local app = ShieldAuth.new({
    name       = "${name}",
    app_id     = "${appId}",
    owner_id   = "${ownerId}",
    secret     = "${secret}",
    public_key = "${publicKey}",
    version    = "${version}"
})

assert(app:init(), "Failed to initialize ShieldAuth")
local ok, err = app:license("ENTER-LICENSE-KEY")
if not ok then error("Denied: " .. err) end

print("Authenticated: " .. app.user.username)`
      },
      ruby: {
        file: 'shieldauth.rb',
        code: `require 'shieldauth'

# Auto-filled ShieldAuth credentials for "${name}"
app = ShieldAuth::App.new(
  name: '${name}',
  app_id: '${appId}',
  owner_id: '${ownerId}',
  secret: '${secret}',
  public_key: '${publicKey}',
  version: '${version}'
)

app.init
session = app.license('ENTER-LICENSE-KEY')
abort("Denied: #{session.message}") unless session.verified?

puts "Authenticated: #{session.username}"`
      },
      swift: {
        file: 'ShieldAuthSetup.swift',
        code: `import ShieldAuth

// Auto-filled ShieldAuth credentials for "${name}"
let app = ShieldAuthApp(
    name: "${name}",
    appId: "${appId}",
    ownerId: "${ownerId}",
    secret: "${secret}",
    publicKey: "${publicKey}",
    version: "${version}"
)

Task {
    try await app.initialize()
    let session = try await app.verifyLicense("ENTER-LICENSE-KEY")
    print("Authenticated: \\(session.username)")
}`
      },
      kotlin: {
        file: 'ShieldAuthSetup.kt',
        code: `import io.shieldauth.ShieldAuthApp

// Auto-filled ShieldAuth credentials for "${name}"
fun main() {
    val app = ShieldAuthApp(
        name = "${name}",
        appId = "${appId}",
        ownerId = "${ownerId}",
        secret = "${secret}",
        publicKey = "${publicKey}",
        version = "${version}"
    )

    app.init()
    val session = app.license("ENTER-LICENSE-KEY")
    require(session.verified) { "Denied: \${session.message}" }
    println("Authenticated: \${session.username}")
}`
      }
    };

    return map[lang] || map.cpp;
  }

  function renderDashSdkCode() {
    const codeEl = document.getElementById('dashSdkCode');
    const fileEl = document.getElementById('dashSdkFilename');
    if (!codeEl || !fileEl) return;
    const snippet = getDashSdkSnippet(activeDashLang);
    fileEl.textContent = snippet.file;
    codeEl.textContent = snippet.code;
    document.querySelectorAll('[data-dash-lang]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.dashLang === activeDashLang);
    });
  }

  document.getElementById('dashSdkTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dash-lang]');
    if (!btn) return;
    activeDashLang = btn.dataset.dashLang;
    renderDashSdkCode();
  });

  document.getElementById('copyDashCodeBtn')?.addEventListener('click', async () => {
    const snippet = getDashSdkSnippet(activeDashLang);
    try {
      await navigator.clipboard.writeText(snippet.code);
      showToast(`Copied ${snippet.file} to clipboard`);
    } catch {
      showToast('Clipboard permission unavailable');
    }
  });

  renderChart();
  renderAll();
})();
