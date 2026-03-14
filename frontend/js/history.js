import { api, esc } from './app.js';
function formatTs(ts) {
    if (!ts)
        return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export async function loadHistory() {
    const el = document.getElementById('historyList');
    try {
        const runs = await api('/runs');
        if (!runs.length) {
            el.innerHTML = `<div class="empty"><div class="empty-icon">◇</div>No runs yet.</div>`;
            return;
        }
        el.innerHTML = [...runs].reverse().map(run => `
      <div class="card">
        <div class="card-header" onclick="toggleExpand('run-${run.id}')" style="cursor:pointer; user-select:none">
          <div class="card-icon icon-blue">◆</div>
          <div style="flex:1; font-size:13px">${esc((run.work_item_description ?? run.id).slice(0, 70))}${(run.work_item_description ?? '').length > 70 ? '&hellip;' : ''}</div>
          <span style="font-size:11px; color:var(--text2); margin-right:8px">${esc(run.orchestrator_name ?? '')}</span>
          <span class="status status-${run.status}" style="margin-right:8px">${run.status}</span>
          <span class="expand-arrow" style="font-size:10px; color:var(--text3)">&#9660;</span>
        </div>
        <div id="run-${run.id}" style="display:none">
          ${run.work_item_description ? `
          <div class="card-body" style="border-bottom:1px solid var(--border)">
            <div class="field-row">
              <div class="field-label">Work Item</div>
              <div class="field-value" style="white-space:pre-wrap; line-height:1.6">${esc(run.work_item_description)}</div>
            </div>
            ${run.result ? `
            <div class="field-row" style="margin-top:10px">
              <div class="field-label">Summary</div>
              <div class="field-value">${esc(run.result)}</div>
            </div>` : ''}
          </div>` : ''}
          ${run.logs?.length ? `
          <div class="run-card-logs">
            ${run.logs.map((e, i) => {
            const msg = e.message ?? '';
            const TRUNC = 100;
            const lid = `hl-${run.id}-${i}`;
            const msgHtml = msg.length > TRUNC
                ? `<span id="${lid}-short">${esc(msg.slice(0, TRUNC))}&hellip;
                     <span class="log-data-toggle" onclick="toggleLogData('${lid}')">[expand]</span>
                   </span>
                   <span id="${lid}-full" class="log-data-full">${esc(msg)}
                     <span class="log-data-toggle" onclick="toggleLogData('${lid}')">[collapse]</span>
                   </span>`
                : esc(msg);
            return `
              <div style="display:flex; gap:10px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.02)">
                <span style="color:var(--text3); flex-shrink:0; font-size:10px; width:70px">${formatTs(e.ts ?? '')}</span>
                <span class="kind-${e.kind}" style="font-size:10px; width:110px; flex-shrink:0">${e.kind}</span>
                <span style="color:var(--text2); font-size:11px; word-break:break-word; flex:1; min-width:0">${msgHtml}</span>
              </div>`;
        }).join('')}
          </div>` : ''}
        </div>
      </div>
    `).join('');
    }
    catch {
        el.innerHTML = `<div class="empty" style="color:var(--red)">
      Could not reach backend — is uvicorn running on port 8000?
    </div>`;
    }
}
window.loadHistory = loadHistory;
//# sourceMappingURL=history.js.map