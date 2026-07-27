<script lang="ts">
  import { onMount } from 'svelte';
  import { getConfig } from '$lib/api';

  onMount(async () => {
    const config = await getConfig();
    if (!config.hasPlanner) {
      window.location.href = '/tool-not-installed?tool=ip-planner';
      return;
    }
    await import('$lib/planner/runtime');
  });
</script>

<svelte:head>
  <title>subnet/plan — IP address planner</title>
  <meta name="description" content="Add subnets, enumerate their addresses, annotate each one, and search across everything." />
</svelte:head>

<div class="shell">
  <header>
    <div class="brand">
      <span class="brand-mark">subnet/plan</span>
      <h1><i>an</i> <b>IP address planner</b></h1>
    </div>
    <div class="meta">
      <a href="https://asjhosting.com" target="_blank" rel="noopener" class="byline">Andreas Skarmark-Jakobsen</a> &nbsp;&middot;&nbsp; <span>IPv4 + IPv6</span> &nbsp;&middot;&nbsp; per-address notes
    </div>
    <div class="user-nav" id="user-nav"></div>
    <div class="admin-banner" id="admin-banner" style="display:none"></div>
  </header>

  <div class="searchbar">
    <div class="search-wrap">
      <span class="search-glyph"><img class="search-icon-svg" src="/icons/search-icon.svg" alt="" /></span>
      <input id="search" type="text" autocomplete="off" spellcheck="false"
              placeholder="search any address, note, or login description across all subnets…  (e.g. 10.0.1.5, gateway, printer, vpn account)" />
      <span class="search-stat" id="search-stat"></span>
      <div id="results" class="results"></div>
    </div>
  </div>

  <main>
    <section class="col-left">
      <div class="section">
        <div class="section-head">
          <span class="section-num">§ 01</span>
          <h2 class="section-title">Subnets</h2>
          <span class="section-desc">add as many as you need</span>
        </div>

        <div class="left-tabs">
          <button id="tab-subnets" class="left-tab active">Subnets</button>
          <button id="tab-organized" class="left-tab">Organised view</button>
        </div>

        <div id="add-form-section" class="add-form">
          <div class="add-grid">
            <div>
              <span class="lbl">CIDR <span style="color:var(--accent)">*</span></span>
              <input id="in-cidr" type="text" placeholder="192.168.1.0/24  ·  10.0.0.0/16  ·  2001:db8::/64" />
            </div>
            <div>
              <span class="lbl">Label</span>
              <input id="in-label" type="text" placeholder="e.g. Office LAN" />
            </div>
          </div>
          <p class="add-err" id="add-err"></p>
          <button id="btn-add" class="primary">+ add subnet</button>
          <span class="hint" style="display:inline-block;margin-left:12px;margin-top:0">enter accepts · network address is auto-normalised</span>
        </div>

        <div id="subnet-list" class="subnet-list"></div>
        <div id="subnet-empty" class="empty">no subnets yet — add one above to begin</div>
        <div id="organized-panel" style="display:none"></div>
      </div>

      <div id="other-plans-section" class="other-plans-section" style="display:none">
        <div class="other-plans-hd" id="other-plans-head">
          <span class="section-num">§ 02</span>
          <h2 class="section-title">Other IP plans</h2>
          <span class="other-plans-toggle" id="other-plans-toggle">&#9660;</span>
        </div>
        <div id="other-plans-body"></div>
      </div>
    </section>

    <section class="col-right">
      <div class="plan-head">
        <h2 class="plan-title" id="plan-title">IP plan <small id="plan-cidr"></small></h2>
        <div class="plan-actions">
          <button id="btn-export">↓ Export</button>
          <button id="btn-import">↑ Import</button>
          <button id="btn-reset" class="ghost">↻ Reset</button>
          <input id="file-import" type="file" accept="application/json,.json" style="display:none" />
        </div>
      </div>

      <div id="plan-facts" class="plan-facts"></div>
      <div id="plan-region"></div>
    </section>
  </main>

  <footer>
    <div>plan it · annotate it · <span style="color:var(--ink-mute)">export the JSON to keep it</span></div>
    <div><span style="color:var(--ink-mute)">plans saved to server · per-user storage</span></div>
  </footer>
</div>

<div id="toast" class="toast"></div>

<div id="modal-back" class="modal-back">
  <div class="modal">
    <h3 id="modal-title">Confirm</h3>
    <p id="modal-msg"></p>
    <div class="modal-actions">
      <button id="modal-cancel" class="ghost" style="padding:8px 14px">Cancel</button>
      <button id="modal-ok">Delete</button>
    </div>
  </div>
</div>
