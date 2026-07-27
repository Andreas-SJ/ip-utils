<script lang="ts">
  import { onMount } from 'svelte';
  import { getConfig } from '$lib/api';

  onMount(async () => {
    const config = await getConfig();
    if (!config.hasNetplan) {
      window.location.href = '/tool-not-installed?tool=netplan-gen';
      return;
    }
    await import('$lib/netplan/runtime');
  });
</script>

<svelte:head>
  <title>netplan.yaml — generator</title>
  <meta name="description" content="A generator for Ubuntu netplan YAML configuration files." />
</svelte:head>

<div class="shell">

<header>
  <div class="brand">
    <span class="brand-mark">netplan/gen</span>
    <h1><i>a generator for</i> <b>netplan.yaml</b></h1>
  </div>
  <div class="meta">
    <a href="https://asjhosting.com" target="_blank" rel="noopener" class="byline">Andreas Skarmark-Jakobsen</a> &nbsp;·&nbsp; <span>v2 schema</span> &nbsp;·&nbsp; ubuntu / debian &nbsp;·&nbsp; <span>networkd · NetworkManager</span>
  </div>
  <div class="user-nav" id="user-nav"></div>
</header>

<main>

  <section class="col-form">

    <div class="section">
      <div class="section-head">
        <span class="section-num">§ 01</span>
        <h2 class="section-title">Globals</h2>
        <span class="section-desc">renderer &amp; schema version</span>
      </div>

      <div class="row">
        <label class="field">
          <span class="lbl">Renderer</span>
          <select id="renderer">
            <option value="networkd">networkd — server default</option>
            <option value="NetworkManager">NetworkManager — desktop</option>
          </select>
          <span class="hint">Backend that applies the configuration.</span>
        </label>
        <label class="field">
          <span class="lbl">Schema version</span>
          <select id="version">
            <option value="2">2 — current</option>
          </select>
          <span class="hint">Netplan v2 is the only supported version.</span>
        </label>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <span class="section-num">§ 02</span>
        <h2 class="section-title">Interfaces</h2>
        <span class="section-desc">add as many as you need</span>
      </div>

      <div id="ifaces" class="iface-list"></div>

      <div id="empty-state" class="empty">
        no interfaces yet — add one below to begin
      </div>

      <div class="add-iface">
        <span class="lead">add interface</span>
        <button data-add="ethernets"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> ethernet</button>
        <button data-add="wifis"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> wifi</button>
        <button data-add="bridges"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> bridge</button>
        <button data-add="bonds"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> bond</button>
        <button data-add="vlans"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> vlan</button>
      </div>
    </div>

  </section>

  <section class="col-output">
    <div class="output-head">
      <h2 class="output-title">Output <small>/etc/netplan/01-config.yaml</small></h2>
      <div class="output-actions">
        <button id="btn-copy" class="primary"><img class="action-icon" src="/icons/copy-icon.svg" alt="" /> Copy</button>
        <button id="btn-download"><img class="action-icon" src="/icons/round-line-bottom-arrow-icon.svg" alt="" /> Download</button>
        <button id="btn-reset" class="ghost"><img class="action-icon" src="/icons/undo-arrow-icon.svg" alt="" /> Reset</button>
      </div>
    </div>

    <div id="errors" class="errors">
      <strong>Configuration issues</strong>
      <ul id="errors-list"></ul>
    </div>

    <div class="yaml-wrap">
      <pre id="yaml" class="yaml"></pre>
    </div>
  </section>
</main>

<footer>
  <div>netplan.yaml · place at <code style="color:var(--ink-mute)">/etc/netplan/</code> · apply with <code style="color:var(--accent)">sudo netplan apply</code></div>
</footer>

</div>

<div id="toast" class="toast">copied</div>