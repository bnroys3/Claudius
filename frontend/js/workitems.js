import { api, workItems, loadWorkItems, esc, toast, closeModal } from './app.js';
export function toggleExpand(id) {
    const el = document.getElementById(id);
    if (!el)
        return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : 'block';
    // Flip the arrow
    const arrow = el.previousElementSibling?.querySelector('.expand-arrow');
    if (arrow)
        arrow.innerHTML = isOpen ? '&#9660;' : '&#9650;';
}
export function renderWorkItems() {
    const el = document.getElementById('workItemsList');
    if (!workItems.length) {
        el.innerHTML = `<div class="empty"><div class="empty-icon">◎</div>No work items yet. Describe something you want done.</div>`;
        return;
    }
    el.innerHTML = workItems.map((w) => `
    <div class="card">
      <div class="card-header" onclick="toggleExpand('wi-${w.id}')" style="cursor:pointer; user-select:none">
        <div class="card-icon icon-amber">◎</div>
        <div class="card-name" style="font-size:13px; font-weight:400; flex:1">
          ${esc(w.description.slice(0, 90))}${w.description.length > 90 ? '&hellip;' : ''}
        </div>
        <span class="status status-${w.status}" style="margin-right:6px">${w.status}</span>
        ${w.repo ? `<span style="font-family:var(--mono); font-size:10px; color:var(--blue); margin-right:8px">${esc(w.repo)}</span>` : ''}
        <span class="expand-arrow" style="font-size:10px; color:var(--text3)">&#9660;</span>
      </div>
      <div id="wi-${w.id}" style="display:none">
        <div class="card-body">
          <div class="field-row">
            <div class="field-label">Full Description</div>
            <div class="field-value" style="white-space:pre-wrap; line-height:1.6">${esc(w.description)}</div>
          </div>
          ${w.repo ? `
          <div class="field-row">
            <div class="field-label">Repository</div>
            <div class="field-value" style="font-family:var(--mono)">${esc(w.repo)}</div>
          </div>` : ''}
          ${w.result ? `
          <div class="field-row">
            <div class="field-label">Last Result</div>
            <div class="field-value">${esc(w.result)}</div>
          </div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn btn-danger" onclick="event.stopPropagation(); deleteWorkItem('${w.id}')">&#10005; Remove</button>
        </div>
      </div>
    </div>
  `).join('');
}
export function openWorkItemModal() {
    document.getElementById('workItemDesc').value = '';
    document.getElementById('workItemRepo').value = '';
    document.getElementById('workItemModal').classList.add('open');
}
export async function saveWorkItem() {
    const desc = document.getElementById('workItemDesc').value.trim();
    const repo = document.getElementById('workItemRepo').value.trim();
    if (!desc)
        return toast('Description is required');
    try {
        await api('/work-items', 'POST', { description: desc, repo });
        await loadWorkItems();
        renderWorkItems();
        closeModal('workItemModal');
        toast('Work item added');
    }
    catch (e) {
        toast('Error: ' + e.message);
    }
}
export async function deleteWorkItem(id) {
    await api('/work-items/' + id, 'DELETE');
    await loadWorkItems();
    renderWorkItems();
    toast('Work item removed');
}
window.toggleExpand = toggleExpand;
window.openWorkItemModal = openWorkItemModal;
window.saveWorkItem = saveWorkItem;
window.deleteWorkItem = deleteWorkItem;
window.renderWorkItems = renderWorkItems;
//# sourceMappingURL=workitems.js.map