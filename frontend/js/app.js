const API = 'http://localhost:8000';
// ── Shared state ──────────────────────────────────────────────────────────────
export let agents = [];
export let workItems = [];
// ── API helper ────────────────────────────────────────────────────────────────
export async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body)
        opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    if (!r.ok)
        throw new Error(await r.text());
    return r.json();
}
// ── Data loaders ──────────────────────────────────────────────────────────────
export async function loadAgents() {
    try {
        agents = await api('/agents');
    }
    catch {
        agents = [];
    }
}
export async function loadWorkItems() {
    try {
        workItems = await api('/work-items');
    }
    catch {
        workItems = [];
    }
}
const PAGE_CALLBACKS = {
    setup: () => window.initSetup(),
    agents: () => window.renderAgents(),
    workitems: () => window.renderWorkItems(),
    run: () => window.renderRunPanel(),
    history: () => window.loadHistory(),
};
export async function switchTab(page, btn) {
    document.querySelectorAll('nav button')
        .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const main = document.getElementById('main');
    const html = await fetch(`pages/${page}.html`).then(r => r.text());
    main.innerHTML = html;
    PAGE_CALLBACKS[page]?.();
}
// ── Utils ─────────────────────────────────────────────────────────────────────
export function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
}
export function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
let toastTimer;
export function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
// ── Health check ──────────────────────────────────────────────────────────────
async function checkHealth() {
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    try {
        const data = await api('/health');
        if (data.ok) {
            dot.className = 'status-dot';
            dot.title = 'All systems operational';
            label.textContent = 'connected';
            label.style.color = '';
        }
        else {
            dot.className = 'status-dot warn';
            dot.title = data.issues.join(' · ');
            label.textContent = 'config issues';
            label.style.color = 'var(--amber)';
            if (!window._healthBannerShown) {
                window._healthBannerShown = true;
                showHealthBanner(data.issues);
            }
        }
    }
    catch {
        dot.className = 'status-dot error';
        dot.title = 'Cannot reach backend on port 8000';
        label.textContent = 'offline';
        label.style.color = 'var(--red)';
    }
}
function showHealthBanner(issues) {
    const banner = document.getElementById('healthBanner');
    banner.innerHTML =
        '&#9888;&nbsp;&nbsp;' +
            issues.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;') +
            '<button onclick="document.getElementById(\'healthBanner\').classList.add(\'hidden\')"' +
            ' style="margin-left:auto;background:none;border:none;color:var(--amber);cursor:pointer;font-size:15px;padding:0 4px;">&#215;</button>';
    banner.classList.remove('hidden');
}
// ── Wire nav ──────────────────────────────────────────────────────────────────
document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset['page'], btn));
});
document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('modal-overlay')) {
        target.classList.remove('open');
    }
});
// ── Log expand/collapse (shared across run and history pages) ────────────────
export function toggleLogData(id) {
    const short = document.getElementById(`${id}-short`);
    const full = document.getElementById(`${id}-full`);
    if (!short || !full)
        return;
    const isExpanded = full.classList.contains('open');
    short.style.display = isExpanded ? '' : 'none';
    full.classList.toggle('open', !isExpanded);
}
// Expose globally for inline onclick handlers
window['toggleLogData'] = toggleLogData;
// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    await Promise.all([loadAgents(), loadWorkItems()]);
    const firstBtn = document.querySelector('nav button[data-page="setup"]');
    await switchTab('setup', firstBtn);
    await checkHealth();
    setInterval(checkHealth, 30000);
}
// Wait for all modules to finish registering their window exports before init
window.addEventListener('load', () => init());
//# sourceMappingURL=app.js.map