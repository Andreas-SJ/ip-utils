<script lang="ts">
  import { onMount } from 'svelte';
  import { getConfig, type AppConfig } from '$lib/api';
  import { bootSkinFromStorage, initTheme, type ThemeState } from '$lib/theme';

  let theme: ThemeState = { skin: 'futuristic', mode: 'dark' };
  let config: AppConfig = { hasPlanner: false, hasNetplan: false, skin: 'futuristic' };
  let missingTool = 'unknown';
  let requestedPath = '/tool-not-installed';

  onMount(async () => {
    const bootSkin = bootSkinFromStorage();
    theme = await initTheme(bootSkin);
    config = await getConfig();
    theme = await initTheme(config.skin);

    const params = new URLSearchParams(window.location.search);
    missingTool = params.get('tool') || 'unknown';
    requestedPath = window.location.pathname || '/tool-not-installed';
  });
</script>

<svelte:head>
  <title>Tool Not Installed — ip-utils</title>
</svelte:head>

<div class="card">
  <div class="tag">ip-utils</div>
  <h1>Tool not installed</h1>
  <p>This endpoint is not available in the current installation mode.</p>
  <div class="req">missing tool: {missingTool}</div>
  <div class="req">requested path: {requestedPath}</div>
  <div class="links">
    <a class="btn primary" href="/">go to home</a>
    {#if config.hasPlanner}
      <a class="btn" href="/ip-planner">open ip-planner</a>
      <a class="btn" href="/login">log in</a>
    {/if}
    {#if config.hasNetplan}
      <a class="btn" href="/netplan-gen">open netplan-gen</a>
    {/if}
  </div>
  <div class="hint">Use the installer to switch to both tools if you want access to all features.</div>
</div>

<style>
  :global(html), :global(body) {
    min-height: 100%;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .card {
    width: 100%;
    max-width: 760px;
    background: var(--bg-elev);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--danger);
    border-radius: 3px;
    padding: 30px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.45);
  }

  .tag {
    display: inline-block;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    border: 1px solid var(--accent-dim);
    padding: 4px 8px;
    border-radius: 2px;
    margin-bottom: 12px;
  }

  h1 {
    margin: 0 0 10px;
    font-family: var(--serif);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  p {
    margin: 0 0 14px;
    color: var(--ink-mute);
    line-height: 1.6;
  }

  .req {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--ink);
    padding: 8px 10px;
    border: 1px dashed var(--line-strong);
    display: inline-block;
    margin: 0 0 18px;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    font-family: var(--mono);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 8px 12px;
    transition: all .15s ease;
  }

  .btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .btn.primary {
    color: var(--accent);
    border-color: var(--accent-dim);
  }

  .hint {
    margin-top: 14px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-faint);
  }
</style>
