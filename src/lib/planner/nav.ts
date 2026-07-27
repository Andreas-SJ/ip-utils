export type PlannerConfig = {
  hasNetplan?: boolean;
  skin?: string;
};

export type PlannerMe = {
  username: string;
  isAdmin: boolean;
  passwordManagerEnabled?: boolean;
};

export function buildPlannerNavHtml(
  cfg: PlannerConfig,
  me: PlannerMe,
  esc: (value: unknown) => string
): string {
  let html = '<span class="u-name">' + esc(me.username) + '</span>' +
    ' &nbsp;&middot;&nbsp; <a href="/">home</a>' +
    (me.isAdmin ? ' &nbsp;&middot;&nbsp; <a href="/admin">admin</a>' : '');

  if (cfg.hasNetplan) {
    html += ' &nbsp;&middot;&nbsp; <a href="/netplan-gen">netplan-gen</a>';
  } else {
    html += ' &nbsp;&middot;&nbsp; <a href="#" id="btn-netplan-missing" class="nav-disabled" aria-disabled="true">netplan-gen</a>';
  }

  html += ' &nbsp;&middot;&nbsp; <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode"><img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" /></button>';
  html += ' &nbsp;&middot;&nbsp; <a href="#" id="btn-logout">logout</a>';
  return html;
}