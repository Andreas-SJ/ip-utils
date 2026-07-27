<script lang="ts">
  import { onMount } from 'svelte';
  import { logout } from '$lib/api';
  import {
    applyTheme,
    bootSkinFromStorage,
    initTheme,
    modeStorageKey,
    preferredModeForSkin,
    sanitizeSkin,
    toggleTheme,
    type Skin,
    type ThemeState
  } from '$lib/theme';

  type AdminUser = {
    username: string;
    isAdmin: boolean;
    hasPlan: boolean;
  };

  type AdminOptions = {
    passwordManagerEnabled: boolean;
    skin: Skin;
  };

  type UpdateEntry = {
    version: string;
    type: string;
    message: string;
    date: string;
  };

  type UpdateJob = {
    id: string | null;
    status: 'idle' | 'running' | 'succeeded' | 'failed';
    startedAt: string | null;
    endedAt: string | null;
    exitCode: number | null;
    branch: string | null;
    error: string | null;
    output: string;
  };

  let currentUser: { username: string; isAdmin: boolean } | null = null;
  let users: AdminUser[] = [];
  let options: AdminOptions = { passwordManagerEnabled: false, skin: 'futuristic' };
  let theme: ThemeState = { skin: 'futuristic', mode: 'dark' };

  let installedVersion = 'loading...';
  let updates: UpdateEntry[] = [];
  let latestUpdateVersion: string | null = null;
  let updateJobStatusText = '';
  let updateJobStatusClass = '';

  let newUsername = '';
  let newPassword = '';
  let newIsAdmin = false;
  let createError = '';

  let toastMessage = '';
  let toastVisible = false;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let confirmOpen = false;
  let confirmTitle = '';
  let confirmMessage = '';
  let confirmLabel = 'Confirm';
  let confirmAction: (() => Promise<void>) | null = null;

  let pwModalOpen = false;
  let pwModalUser = '';
  let pwNew = '';
  let pwConfirm = '';
  let pwError = '';
  let pwSaving = false;

  let updModalOpen = false;
  let updBranch = 'main';
  let updProxyMode: 'keep' | 'remove' | 'set' = 'keep';
  let updProxyIp = '';
  let updAdminPass = '';
  let updError = '';
  let updSubmitting = false;

  let updateStatusPoll: ReturnType<typeof setInterval> | null = null;

  function showToast(msg: string) {
    toastMessage = msg;
    toastVisible = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible = false;
    }, 2000);
  }

  function parseSemver(v: string): [number, number, number] | null {
    const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }

  function compareSemver(a: string, b: string): number {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) return 0;
    for (let i = 0; i < 3; i += 1) {
      if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
    }
    return 0;
  }

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const r = await fetch(url, {
      credentials: 'include',
      ...init
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({} as Record<string, unknown>));
      const msg = typeof body.error === 'string' ? body.error : `Request failed: ${r.status}`;
      throw new Error(msg);
    }
    return r.json() as Promise<T>;
  }

  async function loadMe() {
    try {
      const me = await fetchJson<{ username: string; isAdmin: boolean }>('/api/me');
      currentUser = me;
    } catch {
      window.location.href = '/login';
    }
  }

  async function loadInstalledVersion() {
    try {
      const d = await fetchJson<{ version?: string }>('/api/admin/version');
      installedVersion = d.version || 'unknown';
    } catch {
      installedVersion = 'unknown';
    }
  }

  async function loadGlobalOptions() {
    try {
      const d = await fetchJson<{ passwordManagerEnabled: boolean; skin: string }>('/api/admin/options');
      options = {
        passwordManagerEnabled: !!d.passwordManagerEnabled,
        skin: sanitizeSkin(d.skin)
      };
      theme = applyTheme(options.skin, preferredModeForSkin(options.skin));
    } catch {
      // keep defaults
    }
  }

  async function loadUsers() {
    try {
      users = await fetchJson<AdminUser[]>('/api/admin/users');
    } catch {
      users = [];
    }
  }

  async function refreshUpdateJobStatus() {
    try {
      const job = await fetchJson<UpdateJob>('/api/admin/update/status');
      if (!job || !job.status || job.status === 'idle') {
        updateJobStatusText = '';
        updateJobStatusClass = '';
        return;
      }

      if (job.status === 'running') {
        updateJobStatusText = `Update running on branch ${job.branch || 'main'}...`;
        updateJobStatusClass = 'running';
      } else if (job.status === 'succeeded') {
        updateJobStatusText = `Last update succeeded (${job.branch || 'main'})`;
        updateJobStatusClass = 'succeeded';
        await Promise.all([loadUpdates(), loadInstalledVersion()]);
      } else {
        updateJobStatusText = `Last update failed (${job.branch || 'main'})`;
        updateJobStatusClass = 'failed';
      }
    } catch {
      // ignore polling errors
    }
  }

  function ensureUpdateStatusPolling() {
    if (updateStatusPoll) return;
    updateStatusPoll = setInterval(() => {
      refreshUpdateJobStatus();
    }, 3000);
  }

  async function loadUpdates() {
    try {
      const list = await fetchJson<UpdateEntry[]>('/api/admin/updates');
      updates = [...list].sort((a, b) => compareSemver(b.version, a.version));
      latestUpdateVersion = updates[0]?.version || null;
    } catch {
      updates = [];
      latestUpdateVersion = null;
    }
  }

  function openConfirm(title: string, message: string, label: string, action: () => Promise<void>) {
    confirmTitle = title;
    confirmMessage = message;
    confirmLabel = label;
    confirmAction = action;
    confirmOpen = true;
  }

  async function runConfirm() {
    if (!confirmAction) return;
    const action = confirmAction;
    confirmOpen = false;
    confirmAction = null;
    await action();
  }

  function cancelConfirm() {
    confirmOpen = false;
    confirmAction = null;
  }

  function openPasswordModal(username: string) {
    pwModalUser = username;
    pwNew = '';
    pwConfirm = '';
    pwError = '';
    pwSaving = false;
    pwModalOpen = true;
  }

  async function savePassword() {
    pwError = '';
    if (pwNew.length < 8) {
      pwError = 'Password must be at least 8 characters.';
      return;
    }
    if (pwNew !== pwConfirm) {
      pwError = 'Passwords do not match.';
      return;
    }

    pwSaving = true;
    try {
      await fetchJson(`/api/admin/users/${encodeURIComponent(pwModalUser)}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwNew })
      });
      pwModalOpen = false;
      showToast('Password updated');
    } catch (err) {
      pwError = err instanceof Error ? err.message : 'Failed to change password.';
    } finally {
      pwSaving = false;
    }
  }

  function openUpdateModal() {
    updBranch = latestUpdateVersion ? 'main' : 'main';
    updProxyMode = 'keep';
    updProxyIp = '';
    updAdminPass = '';
    updError = '';
    updSubmitting = false;
    updModalOpen = true;
  }

  async function submitUpdate() {
    updError = '';
    if (!updAdminPass) {
      updError = 'Please re-enter your admin password.';
      return;
    }
    if (updProxyMode === 'set' && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(updProxyIp)) {
      updError = 'Please enter a valid proxy IPv4 address.';
      return;
    }

    updSubmitting = true;
    try {
      await fetchJson('/api/admin/update/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: updBranch.trim() || 'main',
          proxyMode: updProxyMode,
          proxyIp: updProxyIp.trim(),
          adminPassword: updAdminPass
        })
      });
      updModalOpen = false;
      showToast('update started');
      updateJobStatusText = `Update running on branch ${updBranch.trim() || 'main'}...`;
      updateJobStatusClass = 'running';
      ensureUpdateStatusPolling();
      await refreshUpdateJobStatus();
    } catch (err) {
      updError = err instanceof Error ? err.message : 'Failed to start update.';
    } finally {
      updSubmitting = false;
    }
  }

  async function onDeletePlan(username: string) {
    openConfirm(
      'Delete IP plan',
      `Delete the IP plan for "${username}"? This cannot be undone. The user account will remain.`,
      'Delete plan',
      async () => {
        try {
          await fetchJson(`/api/admin/plans/${encodeURIComponent(username)}`, { method: 'DELETE' });
          showToast('Plan deleted');
          await loadUsers();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Error');
        }
      }
    );
  }

  async function onDeleteUser(username: string) {
    openConfirm(
      'Delete user',
      `Delete user "${username}" and their IP plan? This cannot be undone.`,
      'Delete user',
      async () => {
        try {
          await fetchJson(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
          showToast('User deleted');
          await loadUsers();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Error');
        }
      }
    );
  }

  async function onCreateUser() {
    createError = '';
    if (!newUsername.trim() || !newPassword) {
      createError = 'Username and password are required.';
      return;
    }

    try {
      await fetchJson('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          isAdmin: newIsAdmin
        })
      });

      newUsername = '';
      newPassword = '';
      newIsAdmin = false;
      showToast('User created');
      await loadUsers();
    } catch (err) {
      createError = err instanceof Error ? err.message : 'Failed to create user.';
    }
  }

  async function onSaveGlobalOptions() {
    try {
      options.skin = sanitizeSkin(options.skin);
      await fetchJson('/api/admin/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passwordManagerEnabled: options.passwordManagerEnabled,
          skin: options.skin
        })
      });
      theme = applyTheme(options.skin, preferredModeForSkin(options.skin));
      showToast('Global options saved');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save options');
    }
  }

  function onSkinChange() {
    options.skin = sanitizeSkin(options.skin);
    theme = applyTheme(options.skin, preferredModeForSkin(options.skin));
  }

  function onToggleTheme() {
    theme = toggleTheme(theme);
  }

  async function onLogout(event: MouseEvent) {
    event.preventDefault();
    await logout();
    window.location.href = '/login';
  }

  async function onCheckUpdates() {
    try {
      await fetchJson('/api/admin/updates/check', { method: 'POST' });
      await loadUpdates();
      showToast('update check complete');
    } catch {
      showToast('update check failed');
    }
  }

  async function onDismissUpdates() {
    await fetchJson('/api/admin/updates/dismiss', { method: 'POST' });
    await loadUpdates();
    showToast('updates dismissed');
  }

  function updateDateLabel(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return '';
    }
  }

  onMount(async () => {
    const bootSkin = bootSkinFromStorage();
    theme = await initTheme(bootSkin);

    await loadMe();
    await Promise.all([loadUsers(), loadGlobalOptions(), loadUpdates(), loadInstalledVersion()]);
    ensureUpdateStatusPolling();
    await refreshUpdateJobStatus();

    return () => {
      if (updateStatusPoll) clearInterval(updateStatusPoll);
      if (toastTimer) clearTimeout(toastTimer);
    };
  });
</script>

<svelte:head>
  <title>Admin — ip-utils</title>
</svelte:head>

<div class="shell">
  <header>
    <div class="brand">
      <span class="brand-mark">admin</span>
      <h1><i>user</i> <b>management</b></h1>
    </div>
    <div class="header-nav">
      <a href="/">home</a>
      <span>&nbsp;&middot;&nbsp;</span>
      <span>{currentUser?.username || ''}</span>
      <span>&nbsp;&middot;&nbsp;</span>
      <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode" onclick={onToggleTheme}>
        <img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" />
      </button>
      <span>&nbsp;&middot;&nbsp;</span>
      <a href="#" onclick={onLogout}>logout</a>
    </div>
  </header>

  <div id="update-banner" class="update-banner">
    <div class="update-banner-header">
      <div class="update-banner-head-left">
        <span>version updates</span>
        <button class="ghost check-updates-btn" id="check-updates" title="Check for updates now" onclick={onCheckUpdates}>check now</button>
      </div>
      <button class="ghost" id="dismiss-updates" style="padding:3px 8px;font-size:10px;visibility: {updates.length ? 'visible' : 'hidden'}" onclick={onDismissUpdates}>dismiss all</button>
    </div>
    <div id="update-job-status" class={`update-job-status ${updateJobStatusClass}`}>{updateJobStatusText}</div>
    <div id="update-list">
      {#if !updates.length}
        <div class="update-current">You are on the most recent version.</div>
      {:else}
        {#each updates as u, idx}
          <div class={`update-entry type-${u.type.replace(/ /g, '-')}`}>
            <span class={`update-tag type-${u.type.replace(/ /g, '-')}`}>{u.version || u.type}</span>
            <span class="update-msg" title={u.message}>{u.message}</span>
            <span class="update-date">{updateDateLabel(u.date)}</span>
            {#if idx === 0}
              <button class="update-now-btn" id="update-now-btn" title="Update to latest version" onclick={openUpdateModal}>update now</button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <main>
    <div class="section">
      <div class="section-head">
        <span class="section-num">§ 01</span>
        <h2 class="section-title">Users</h2>
      </div>

      <table class="user-table" id="user-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>IP Plan</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="user-tbody">
          {#if !users.length}
            <tr class="empty-row"><td colspan="4">No users found.</td></tr>
          {:else}
            {#each users as u}
              <tr data-username={u.username}>
                <td><span class="u-name">{u.username}</span></td>
                <td>
                  {#if u.isAdmin}
                    <span class="badge badge-admin">admin</span>
                  {:else}
                    <span style="color:var(--ink-faint);font-size:12px">user</span>
                  {/if}
                </td>
                <td>
                  {#if u.hasPlan}
                    <span class="badge badge-plan">has plan</span>
                  {:else}
                    <span class="badge badge-no-plan">no plan</span>
                  {/if}
                </td>
                <td>
                  <div class="action-cell">
                    <button class="ghost" onclick={() => openPasswordModal(u.username)}>change pw</button>
                    {#if u.hasPlan}
                      <button class="ghost" onclick={() => onDeletePlan(u.username)}>delete plan</button>
                    {/if}
                    {#if u.username !== currentUser?.username}
                      <button class="danger" onclick={() => onDeleteUser(u.username)}>delete user</button>
                    {:else}
                      <span style="color:var(--ink-faint);font-size:11px;font-family:var(--mono)">(you)</span>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-head">
        <span class="section-num">§ 02</span>
        <h2 class="section-title">Create User</h2>
      </div>

      <div class="form-grid">
        <div>
          <span class="lbl">Username</span>
          <input type="text" bind:value={newUsername} placeholder="username" autocomplete="off" />
        </div>
        <div>
          <span class="lbl">Password</span>
          <input type="password" bind:value={newPassword} placeholder="min. 8 characters" autocomplete="new-password" />
        </div>
        <div>
          <span class="lbl">Role</span>
          <label class="check">
            <input type="checkbox" bind:checked={newIsAdmin} />
            <span class="box"></span>
            <span class="lbl-text">Admin</span>
          </label>
        </div>
        <div>
          <span class="lbl">&nbsp;</span>
          <button class="primary" id="btn-create" onclick={onCreateUser}>+ create</button>
        </div>
      </div>

      <div class="additional-options">
        <div class="additional-options-title">Additional Options</div>
        <label class="check">
          <input type="checkbox" bind:checked={options.passwordManagerEnabled} />
          <span class="box"></span>
          <span class="lbl-text">Enable password manager (global)</span>
        </label>
        <div style="margin-top:10px;max-width:260px">
          <span class="lbl">Skin</span>
          <select bind:value={options.skin} onchange={onSkinChange}>
            <option value="futuristic">futuristic</option>
            <option value="enterprise">enterprise</option>
          </select>
        </div>
        <div style="margin-top:8px">
          <button id="btn-save-global-options" class="primary" style="font-size:11px;padding:6px 10px" onclick={onSaveGlobalOptions}>save global options</button>
        </div>
        <div class="option-help">Applies to all users. Skin controls dark/light style family for user theme toggle and overall visuals.</div>
      </div>

      <div class="form-err" id="create-err">{createError}</div>
    </div>
  </main>

  <footer>
    <span>ip-utils admin panel</span>
    <span class="footer-version" id="installed-version">version: {installedVersion}</span>
  </footer>
</div>

<div id="toast" class={`toast ${toastVisible ? 'show' : ''}`}>{toastMessage}</div>

<div id="modal-back" class={`modal-back ${confirmOpen ? 'show' : ''}`} onclick={(e) => e.currentTarget === e.target && cancelConfirm()}>
  <div class="modal">
    <h3 id="modal-title">{confirmTitle || 'Confirm'}</h3>
    <p id="modal-msg">{confirmMessage}</p>
    <div class="modal-actions">
      <button class="ghost" id="modal-cancel" style="padding:8px 14px" onclick={cancelConfirm}>Cancel</button>
      <button class="modal-ok" id="modal-ok" onclick={runConfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

<div id="pw-modal-back" class={`modal-back ${pwModalOpen ? 'show' : ''}`} onclick={(e) => e.currentTarget === e.target && (pwModalOpen = false)}>
  <div class="modal pw-modal">
    <h3 id="pw-modal-title">Change password</h3>
    <p class="pw-sub" id="pw-modal-sub">User: {pwModalUser}</p>
    <div class="field">
      <span class="lbl">New password</span>
      <input type="password" id="pw-new" bind:value={pwNew} placeholder="min. 8 characters" autocomplete="new-password" />
    </div>
    <div class="field">
      <span class="lbl">Confirm password</span>
      <input type="password" id="pw-confirm" bind:value={pwConfirm} placeholder="repeat password" autocomplete="new-password" />
    </div>
    <div class="pw-err" id="pw-err">{pwError}</div>
    <div class="modal-actions" style="margin-top:18px">
      <button class="ghost" id="pw-cancel" style="padding:8px 14px" onclick={() => (pwModalOpen = false)}>Cancel</button>
      <button class="pw-ok" id="pw-ok" onclick={savePassword} disabled={pwSaving}>{pwSaving ? 'Saving...' : 'Save password'}</button>
    </div>
  </div>
</div>

<div id="upd-modal-back" class={`modal-back ${updModalOpen ? 'show' : ''}`} onclick={(e) => e.currentTarget === e.target && (updModalOpen = false)}>
  <div class="modal pw-modal">
    <h3 id="upd-modal-title">Run update</h3>
    <p class="pw-sub">Choose update options and confirm with your admin password.</p>
    <div class="field">
      <span class="lbl">Branch</span>
      <input type="text" id="upd-branch" bind:value={updBranch} placeholder="main" autocomplete="off" />
    </div>
    <div class="field">
      <span class="lbl">Reverse proxy setting</span>
      <select id="upd-proxy-mode" bind:value={updProxyMode} style="width:100%;background:var(--bg-sunk);color:var(--ink);border:1px solid var(--line-strong);border-radius:2px;padding:9px 11px;font-family:var(--mono);font-size:13px;">
        <option value="keep">Keep current proxy config</option>
        <option value="remove">Remove proxy trust</option>
        <option value="set">Set proxy IP</option>
      </select>
    </div>
    {#if updProxyMode === 'set'}
      <div class="field" id="upd-proxy-ip-wrap">
        <span class="lbl">Proxy IP</span>
        <input type="text" id="upd-proxy-ip" bind:value={updProxyIp} placeholder="127.0.0.1" autocomplete="off" />
      </div>
    {/if}
    <div class="field">
      <span class="lbl">Confirm admin password</span>
      <input type="password" id="upd-admin-pass" bind:value={updAdminPass} placeholder="current admin password" autocomplete="current-password" />
    </div>
    <div class="pw-err" id="upd-err">{updError}</div>
    <div class="modal-actions" style="margin-top:18px">
      <button class="ghost" id="upd-cancel" style="padding:8px 14px" onclick={() => (updModalOpen = false)}>Cancel</button>
      <button class="pw-ok" id="upd-submit" onclick={submitUpdate} disabled={updSubmitting}>{updSubmitting ? 'Submitting...' : 'Submit update'}</button>
    </div>
  </div>
</div>
