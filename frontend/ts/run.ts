import { api, agents, workItems, loadWorkItems, esc, toast } from './app.js';
import type { LogEntry, Run, RunStarted } from './types.js';

const POLL_INTERVAL_MS = 2000;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let currentRunId: string | null = null;
let seenLogCount = 0;

export function renderRunPanel(): void {
  // If a run is in progress, restore the live view
  if (currentRunId) {
    restoreLiveView();
    return;
  }

  showRunForm();
}

function showRunForm(): void {
  // Only re-render the form if we're not mid-run
  const wiSel   = document.getElementById('runWorkItem')    as HTMLSelectElement | null;
  const orchSel = document.getElementById('runOrchestrator') as HTMLSelectElement | null;
  if (!wiSel || !orchSel) return;

  wiSel.innerHTML = workItems.length
    ? workItems.map(w =>
        `<option value="${w.id}">${esc(w.description.slice(0, 60))}${w.description.length > 60 ? '...' : ''}</option>`
      ).join('')
    : '<option value="">-- No work items --</option>';

  const orchs = agents.filter(a => a.is_orchestrator);
  orchSel.innerHTML = orchs.length
    ? orchs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')
    : '<option value="">-- No orchestrators defined --</option>';
}

function restoreLiveView(): void {
  // Kick off a poll to redraw current state
  pollRun();
}

export async function executeRun(): Promise<void> {
  const work_item_id    = (document.getElementById('runWorkItem')      as HTMLSelectElement).value;
  const orchestrator_id = (document.getElementById('runOrchestrator')  as HTMLSelectElement).value;
  if (!work_item_id || !orchestrator_id) return toast('Select a work item and an orchestrator');

  setRunningState(true);
  seenLogCount  = 0;
  currentRunId  = null;

  const logEl = getLogEl();
  if (logEl) logEl.innerHTML = '';
  showLog(true);
  setLogStatus('<span class="spinner"></span> starting...');

  try {
    const started = await api<RunStarted>('/runs', 'POST', { work_item_id, orchestrator_id });
    currentRunId = started.run_id;
    schedulePoll();
  } catch (e) {
    appendLogEntry({ kind: 'error', message: (e as Error).message, ts: new Date().toISOString() });
    setLogStatus('<span style="color:var(--red)">&#10007; error</span>');
    setRunningState(false);
    toast('Failed to start run: ' + (e as Error).message);
  }
}

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollRun, POLL_INTERVAL_MS);
}

async function pollRun(): Promise<void> {
  if (!currentRunId) return;

  try {
    const run = await api<Run>(`/runs/${currentRunId}`);

    // Append only new log entries
    const newEntries = (run.logs ?? []).slice(seenLogCount);
    newEntries.forEach(entry => appendLogEntry(entry));
    seenLogCount = run.logs?.length ?? 0;

    if (run.status === 'running') {
      setLogStatus('<span class="spinner"></span> running');
      schedulePoll();
    } else {
      // Done
      const ok = run.status === 'complete';
      setLogStatus(ok
        ? '<span style="color:var(--accent)">&#10003; complete</span>'
        : '<span style="color:var(--red)">&#10007; ' + run.status + '</span>');

      if (run.result) {
        const logEl = getLogEl();
        if (logEl) {
          const summaryDiv = document.createElement('div');
          summaryDiv.style.cssText = 'margin-top:12px; padding:10px 12px; background:var(--bg2); border:1px solid var(--border2); border-radius:4px; font-size:12px; color:var(--text);';
          summaryDiv.innerHTML = `<span style="font-family:var(--mono); font-size:10px; color:var(--text3); display:block; margin-bottom:4px;">SUMMARY</span>${esc(run.result)}`;
          logEl.appendChild(summaryDiv);
          logEl.scrollTop = logEl.scrollHeight;
        }
      }

      await loadWorkItems();
      currentRunId = null;
      setRunningState(false);
      toast(ok ? 'Run complete' : 'Run failed');

      // Update run button to show "New Run" state
      const btn = document.getElementById('runBtn') as HTMLButtonElement | null;
      if (btn) {
        btn.textContent  = '&#9654; New Run';
        btn.disabled     = false;
        btn.onclick      = resetRunPanel;
      }
    }
  } catch (e) {
    // Transient network error — keep polling
    schedulePoll();
  }
}

function resetRunPanel(): void {
  currentRunId  = null;
  seenLogCount  = 0;
  showLog(false);
  setRunningState(false);

  const btn = document.getElementById('runBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.innerHTML = '&#9654; Run';
    btn.onclick   = executeRun;
  }

  // Refresh selects
  showRunForm();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function getLogEl(): HTMLElement | null {
  return document.getElementById('liveLogBody');
}

function showLog(visible: boolean): void {
  const el = document.getElementById('liveLog');
  if (el) el.style.display = visible ? 'block' : 'none';
}

function setLogStatus(html: string): void {
  const el = document.getElementById('liveLogStatus');
  if (el) el.innerHTML = html;
}

function setRunningState(running: boolean): void {
  const btn = document.getElementById('runBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled    = running;
    if (running) btn.textContent = 'Running...';
  }
}

const LOG_TRUNCATE = 120;
let logExpandCounter = 0;

export function appendLogEntry(entry: LogEntry): void {
  const container = getLogEl();
  if (!container) return;

  const ts   = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const kind = entry.kind ?? 'info';
  const div  = document.createElement('div');
  div.className = 'log-entry';

  const SKIP_KEYS = new Set(['work_item_id', 'result_preview', 'context_length']);
  let dataHtml = '';
  if (entry.data) {
    const interesting = (Object.entries(entry.data as Record<string, unknown>))
      .filter(([k]) => !SKIP_KEYS.has(k))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v as Record<string, unknown>) : String(v)}`)
      .join(' · ');
    if (interesting) {
      const id = `ld-${logExpandCounter++}`;
      if (interesting.length > LOG_TRUNCATE) {
        dataHtml = `
          <div class="log-data">
            <span id="${id}-short">${esc(interesting.slice(0, LOG_TRUNCATE))}&hellip;
              <span class="log-data-toggle" onclick="toggleLogData('${id}')">[expand]</span>
            </span>
            <span id="${id}-full" class="log-data-full">${esc(interesting)}
              <span class="log-data-toggle" onclick="toggleLogData('${id}')">[collapse]</span>
            </span>
          </div>`;
      } else {
        dataHtml = `<div class="log-data">${esc(interesting)}</div>`;
      }
    }
  }

  div.innerHTML = `
    <div class="log-ts">${ts}</div>
    <div class="log-kind kind-${kind}">${kind}</div>
    <div class="log-msg">
      <div>${esc(entry.message)}</div>
      ${dataHtml}
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

export function toggleLogData(id: string): void {
  const short = document.getElementById(`${id}-short`);
  const full  = document.getElementById(`${id}-full`);
  if (!short || !full) return;
  const isExpanded = full.classList.contains('open');
  short.style.display = isExpanded ? '' : 'none';
  full.classList.toggle('open', !isExpanded);
}

declare global {
  interface Window {
    executeRun: typeof executeRun;
    renderRunPanel: typeof renderRunPanel;
    resetRunPanel: typeof resetRunPanel;
  }
}
window.executeRun    = executeRun;
window.renderRunPanel = renderRunPanel;
window.resetRunPanel  = resetRunPanel;