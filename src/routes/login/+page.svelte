<script lang="ts">
  import { onMount } from 'svelte';
  import { getConfig, login } from '$lib/api';
  import { bootSkinFromStorage, initTheme, toggleTheme, type ThemeState } from '$lib/theme';

  let theme: ThemeState = { skin: 'futuristic', mode: 'dark' };
  let username = '';
  let password = '';
  let error = '';
  let submitting = false;

  onMount(async () => {
    const bootSkin = bootSkinFromStorage();
    theme = await initTheme(bootSkin);

    const cfg = await getConfig();
    theme = await initTheme(cfg.skin);
  });

  function onToggleTheme() {
    theme = toggleTheme(theme);
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    submitting = true;

    try {
      const result = await login(username, password);
      window.location.href = result.returnTo || '/';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Login failed.';
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Login — ip-utils</title>
</svelte:head>

<div class="card">
  <div class="card-head">
    <span class="brand-mark">ip-utils</span>
    <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode" onclick={onToggleTheme}>
      <img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" />
    </button>
    <h1>Sign in</h1>
    <div class="subtitle">IP Planner access is restricted</div>
  </div>

  {#if error}
    <div class="error show">{error}</div>
  {/if}

  <form id="login-form" autocomplete="on" onsubmit={onSubmit}>
    <div class="field">
      <span class="lbl">Username</span>
      <input type="text" bind:value={username} autocomplete="username" placeholder="username" required />
    </div>
    <div class="field">
      <span class="lbl">Password</span>
      <input type="password" bind:value={password} autocomplete="current-password" placeholder="password" required />
    </div>
    <button type="submit" id="submit-btn" disabled={submitting}>
      {#if submitting}
        Signing in...
      {:else}
        Sign in
      {/if}
    </button>
  </form>

  <div class="card-foot">
    <a href="/">← back to home</a>
  </div>
</div>
