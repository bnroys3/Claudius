import type { Agent, WorkItem, HealthStatus } from './types.js';

const API = 'http://localhost:8000';

// ── Shared state ──────────────────────────────────────────────────────────────

export let agents: Agent[] = [];
export let workItems: WorkItem[] = [];

// ── API helper ────────────────────────────────────────────────────────────────

export async function api<T>(path: string, method = 'GET', body: unknown = null): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

// ── Data loaders ──────────────────────────────────────────────────────────────

export async function loadAgents(): Promise<void> {
  try { agents = await api<Agent[]>('/agents'); } catch { agents = []; }
}

export async function loadWorkItems(): Promise<void> {
  try { workItems = await api<WorkItem[]>('/work-items'); } catch { workItems = []; }
}

// ── Page routing ──────────────────────────────────────────────────────────────

type PageCallback = () => void;

const PAGE_CALLBACKS: Record<string, PageCallback> = {
  setup:     () => (window as PageWindow).initSetup(),
  agents:    () => (window as PageWindow).renderAgents(),
  workitems: () => (window as PageWindow).renderWorkItems(),
  run:       () => (window as PageWindow).renderRunPanel(),
  history:   () => (window as PageWindow).loadHistory(),
};

// PageWindow lets us call page-specific functions from app.ts
interface PageWindow extends Window {
  initSetup: () => void;
  renderAgents: () => void;
  renderWorkItems: () => void;
  renderRunPanel: () => void;
  loadHistory: () => Promise<void>;
  _healthBannerShown?: boolean;
}

export async function switchTab(page: string, btn: HTMLElement): Promise<void> {
  document.querySelectorAll<HTMLButtonElement>('nav button')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const main = document.getElementById('main')!;
  const html = await fetch(`pages/${page}.html`).then(r => r.text());
  main.innerHTML = html;

  PAGE_CALLBACKS[page]?.();
}

// ── Utils ─────────────────────────────────────────────────────────────────────

export function closeModal(id: string): void {
  document.getElementById(id)?.classList.remove('open');
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let toastTimer: ReturnType<typeof setTimeout>;

export function toast(msg: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth(): Promise<void> {
  const dot   = document.getElementById('statusDot')!;
  const label = document.getElementById('statusLabel')!;
  try {
    const data = await api<HealthStatus>('/health');
    if (data.ok) {
      dot.className    = 'status-dot';
      dot.title        = 'All systems operational';
      label.textContent = 'connected';
      label.style.color = '';
    } else {
      dot.className    = 'status-dot warn';
      dot.title        = data.issues.join(' · ');
      label.textContent = 'config issues';
      label.style.color = 'var(--amber)';
      if (!(window as PageWindow)._healthBannerShown) {
        (window as PageWindow)._healthBannerShown = true;
        showHealthBanner(data.issues);
      }
    }
  } catch {
    dot.className    = 'status-dot error';
    dot.title        = 'Cannot reach backend on port 8000';
    label.textContent = 'offline';
    label.style.color = 'var(--red)';
  }
}

function showHealthBanner(issues: string[]): void {
  const banner = document.getElementById('healthBanner')!;
  banner.innerHTML =
    '&#9888;&nbsp;&nbsp;' +
    issues.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;') +
    '<button onclick="document.getElementById(\'healthBanner\').classList.add(\'hidden\')"' +
    ' style="margin-left:auto;background:none;border:none;color:var(--amber);cursor:pointer;font-size:15px;padding:0 4px;">&#215;</button>';
  banner.classList.remove('hidden');
}

// ── Wire nav ──────────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('nav button').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset['page']!, btn));
});

document.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('modal-overlay')) {
    target.classList.remove('open');
  }
});

// ── Log expand/collapse (shared across run and history pages) ────────────────

export function toggleLogData(id: string): void {
  const short = document.getElementById(`${id}-short`);
  const full  = document.getElementById(`${id}-full`);
  if (!short || !full) return;
  const isExpanded = full.classList.contains('open');
  short.style.display = isExpanded ? '' : 'none';
  full.classList.toggle('open', !isExpanded);
}

// Expose globally for inline onclick handlers
(window as unknown as Record<string, unknown>)['toggleLogData'] = toggleLogData;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  await Promise.all([loadAgents(), loadWorkItems()]);
  const firstBtn = document.querySelector<HTMLButtonElement>('nav button[data-page="setup"]')!;
  await switchTab('setup', firstBtn);
  await checkHealth();
  setInterval(checkHealth, 30000);
}

// Wait for all modules to finish registering their window exports before init
window.addEventListener('load', () => init());
