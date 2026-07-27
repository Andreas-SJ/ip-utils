<script lang="ts">
	import { onMount } from 'svelte';
	import { getConfig, getMe, logout, type AppConfig, type Me } from '$lib/api';
	import { bootSkinFromStorage, initTheme, toggleTheme, type ThemeState } from '$lib/theme';

	let config: AppConfig = { hasPlanner: true, hasNetplan: true, skin: 'futuristic' };
	let me: Me | null = null;
	let theme: ThemeState = { skin: 'futuristic', mode: 'dark' };

	onMount(async () => {
		const bootSkin = bootSkinFromStorage();
		theme = await initTheme(bootSkin);

		config = await getConfig();
		theme = await initTheme(config.skin);

		me = await getMe();
	});

	function onToggleTheme() {
		theme = toggleTheme(theme);
	}

	async function onLogout(event: MouseEvent) {
		event.preventDefault();
		await logout();
		window.location.reload();
	}
</script>

<svelte:head>
	<title>ip-utils</title>
</svelte:head>

<div class="shell">
	<header>
		<div class="brand">
			<span class="brand-mark">ip-utils</span>
			<h1><i>networking</i> <b>tools</b></h1>
		</div>
		<div class="header-nav" id="header-nav">
			{#if me}
				<span class="u-name">{me.username}</span>
				{#if me.isAdmin}
					<span>&nbsp;&middot;&nbsp;</span>
					<a href="/admin">admin</a>
				{/if}
				<span>&nbsp;&middot;&nbsp;</span>
				<button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode" onclick={onToggleTheme}>
					<img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" />
				</button>
				<span>&nbsp;&middot;&nbsp;</span>
				<button type="button" class="nav-button" onclick={onLogout}>logout</button>
			{:else}
				<button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode" onclick={onToggleTheme}>
					<img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" />
				</button>
				<span>&nbsp;&middot;&nbsp;</span>
				<a href="/login">log in</a>
			{/if}
		</div>
	</header>

	<main>
		<div class="tool-grid" id="tool-grid">
			{#if config.hasPlanner}
				<a class="tool-card" href="/ip-planner">
					<div class="tool-tag">subnet/plan</div>
					<div class="tool-title">IP Address Planner</div>
					<div class="tool-desc">
						Plan and annotate subnets, enumerate addresses, add per-host notes,
						and search across everything. Supports IPv4 and IPv6.
					</div>
					<div class="tool-go">open planner →</div>
					<div class="tool-locked">requires login</div>
				</a>
			{/if}

			{#if config.hasNetplan}
				<a class="tool-card" href="/netplan-gen">
					<div class="tool-tag">netplan/gen</div>
					<div class="tool-title">Netplan Generator</div>
					<div class="tool-desc">
						Generate Ubuntu/Debian <code style="color:var(--accent);font-family:var(--mono);font-size:12px">netplan.yaml</code>
						configurations with support for ethernet, Wi-Fi, bridges, bonds, and VLANs.
					</div>
					<div class="tool-go">open generator →</div>
				</a>
			{/if}
		</div>
	</main>

	<footer>
		<div>ip-utils &mdash; self-hosted networking tools</div>
	</footer>
</div>

<style>
	.nav-button {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
</style>
