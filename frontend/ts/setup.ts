import { api, esc, toast } from './app.js';
import type { Agent, WorkItem } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface QuestionResponse {
  type: 'question';
  message: string;
}

interface ProposedAgent {
  name: string;
  role: string;
  goal: string;
  backstory: string;
  model: string;
  is_orchestrator: boolean;
}

interface ProposedWorkItem {
  description: string;
  repo: string;
}

interface ProposalResponse {
  type: 'proposal';
  summary: string;
  agents: ProposedAgent[];
  work_item: ProposedWorkItem;
}

interface ConfirmResponse {
  agents: Agent[];
  work_item: WorkItem;
  orchestrator_id: string;
}

type SetupResponse = QuestionResponse | ProposalResponse;

// ── State ─────────────────────────────────────────────────────────────────────

let conversationHistory: ChatMessage[] = [];
let currentProposal: ProposalResponse | null = null;
let editingAgentIdx: number | null = null;

// ── Entry point ───────────────────────────────────────────────────────────────

export function initSetup(): void {
  conversationHistory = [];
  currentProposal = null;
  showScreen('goal');
}

export async function startSetup(): Promise<void> {
  const input = document.getElementById('setupGoalInput') as HTMLTextAreaElement;
  const repoInput = document.getElementById('setupRepoInput') as HTMLInputElement | null;
  const goal = input.value.trim();
  if (!goal) return toast('Please describe what you want to accomplish');

  const repo = repoInput?.value.trim() ?? '';
  const fullMessage = repo
    ? `${goal}

GitHub repository: ${repo}`
    : goal;

  showScreen('chat');
  appendUserBubble(goal + (repo ? `

Repo: ${repo}` : ''));
  conversationHistory = [{ role: 'user', content: fullMessage }];
  await callClaude();
}

export function resetSetup(): void {
  conversationHistory = [];
  currentProposal = null;
  const thread = document.getElementById('setupChatThread')!;
  thread.innerHTML = '';
  (document.getElementById('setupGoalInput') as HTMLTextAreaElement).value = '';
  const repoInput = document.getElementById('setupRepoInput') as HTMLInputElement | null;
  if (repoInput) repoInput.value = '';
  showScreen('goal');
}

export async function sendReply(): Promise<void> {
  const input = document.getElementById('setupReplyInput') as HTMLTextAreaElement;
  const reply = input.value.trim();
  if (!reply) return;
  input.value = '';

  appendUserBubble(reply);
  conversationHistory.push({ role: 'user', content: reply });
  hideReplyBox();
  await callClaude();
}

export function handleReplyKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude(): Promise<void> {
  showTypingIndicator();
  try {
    const response = await api<SetupResponse>('/setup/chat', 'POST', {
      messages: conversationHistory,
    });

    removeTypingIndicator();
    conversationHistory.push({ role: 'assistant', content: JSON.stringify(response) });

    if (response.type === 'question') {
      appendAssistantBubble(response.message);
      showReplyBox();
    } else {
      handleProposal(response);
    }
  } catch (e) {
    removeTypingIndicator();
    appendAssistantBubble('Sorry, something went wrong. Please try again.');
    showReplyBox();
    toast('Error: ' + (e as Error).message);
  }
}

// ── Proposal rendering ────────────────────────────────────────────────────────

function handleProposal(proposal: ProposalResponse): void {
  currentProposal = proposal;
  appendAssistantBubble(proposal.summary);

  const box = document.getElementById('setupProposalBox')!;
  box.style.display = 'flex';
  box.innerHTML = renderProposal(proposal);
}

function renderProposal(proposal: ProposalResponse): string {
  const modelShort = (m: string) => {
    if (m.includes('opus'))   return 'opus-4';
    if (m.includes('sonnet')) return 'sonnet-4';
    if (m.includes('haiku'))  return 'haiku-4.5';
    return m;
  };

  const agentCards = proposal.agents.map((a, i) => `
    <div style="background:var(--bg); border:1px solid var(--border); border-radius:5px; padding:12px 14px; display:flex; align-items:flex-start; gap:12px;">
      <div style="flex:1; min-width:0">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap">
          <span style="font-weight:500">${esc(a.name)}</span>
          <span class="badge ${a.is_orchestrator ? 'badge-orch' : 'badge-worker'}">${a.is_orchestrator ? 'orchestrator' : 'worker'}</span>
          <span class="badge badge-model">${esc(modelShort(a.model))}</span>
        </div>
        <div style="font-size:12px; color:var(--text2); margin-bottom:3px">${esc(a.role)}</div>
        <div style="font-size:12px; color:var(--text3)">${esc(a.goal)}</div>
      </div>
      <button class="btn btn-ghost" style="font-size:11px; padding:4px 8px; flex-shrink:0"
        onclick="editProposedAgent(${i})">&#9998; Edit</button>
    </div>
  `).join('');

  return `
    <div style="background:var(--bg2); border:1px solid var(--border2); border-radius:6px; overflow:hidden;">
      <div style="padding:12px 16px; border-bottom:1px solid var(--border); background:var(--bg3)">
        <div class="section-title">Proposed Team</div>
      </div>
      <div style="padding:14px 16px; display:flex; flex-direction:column; gap:8px;">
        ${agentCards}
      </div>

      <div style="padding:12px 16px; border-top:1px solid var(--border); border-bottom:1px solid var(--border); background:var(--bg3)">
        <div class="section-title">Work Item</div>
      </div>
      <div style="padding:14px 16px;">
        <div class="field-row">
          <div class="field-label">Description</div>
          <div class="field-value" style="white-space:pre-wrap">${esc(proposal.work_item.description)}</div>
        </div>
        ${proposal.work_item.repo ? `
        <div class="field-row" style="margin-top:10px">
          <div class="field-label">Repository</div>
          <div class="field-value" style="font-family:var(--mono)">${esc(proposal.work_item.repo)}</div>
        </div>` : ''}
      </div>

      <div style="padding:12px 16px; border-top:1px solid var(--border); display:flex; gap:10px; background:var(--bg);">
        <button class="btn btn-run" onclick="confirmProposal()">&#10003; Confirm &amp; Run</button>
        <button class="btn btn-ghost" onclick="rejectProposal()">Ask for changes</button>
      </div>
    </div>

    <!-- Edit agent modal inline -->
    <div id="agentEditInline" style="display:none; background:var(--bg2); border:1px solid var(--border2); border-radius:6px; padding:16px; flex-direction:column; gap:12px;"></div>
  `;
}

export function editProposedAgent(idx: number): void {
  if (!currentProposal) return;
  editingAgentIdx = idx;
  const a = currentProposal.agents[idx];
  const box = document.getElementById('agentEditInline')!;

  box.style.display = 'flex';
  box.innerHTML = `
    <div style="font-family:var(--mono); font-size:11px; color:var(--accent); margin-bottom:4px">// EDIT AGENT</div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="editAgentName" value="${esc(a.name)}"/>
    </div>
    <div class="form-group">
      <label class="form-label">Role</label>
      <input class="form-input" id="editAgentRole" value="${esc(a.role)}"/>
    </div>
    <div class="form-group">
      <label class="form-label">Goal</label>
      <textarea class="form-textarea" id="editAgentGoal">${esc(a.goal)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Model</label>
      <select class="form-select" id="editAgentModel">
        <option value="claude-sonnet-4-20250514" ${a.model.includes('sonnet') ? 'selected' : ''}>claude-sonnet-4 -- Recommended</option>
        <option value="claude-opus-4-20250514"   ${a.model.includes('opus')   ? 'selected' : ''}>claude-opus-4 -- most capable</option>
        <option value="claude-haiku-4-5-20251001" ${a.model.includes('haiku') ? 'selected' : ''}>claude-haiku-4.5 -- Cheapest</option>
      </select>
    </div>
    <div style="display:flex; gap:8px">
      <button class="btn btn-primary" onclick="saveAgentEdit()">Save</button>
      <button class="btn btn-ghost" onclick="cancelAgentEdit()">Cancel</button>
    </div>
  `;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function saveAgentEdit(): void {
  if (!currentProposal || editingAgentIdx === null) return;
  const a = currentProposal.agents[editingAgentIdx];
  a.name  = (document.getElementById('editAgentName')  as HTMLInputElement).value.trim();
  a.role  = (document.getElementById('editAgentRole')  as HTMLInputElement).value.trim();
  a.goal  = (document.getElementById('editAgentGoal')  as HTMLTextAreaElement).value.trim();
  a.model = (document.getElementById('editAgentModel') as HTMLSelectElement).value;
  editingAgentIdx = null;

  // Re-render proposal with updated agent
  const box = document.getElementById('setupProposalBox')!;
  box.innerHTML = renderProposal(currentProposal);
}

export function cancelAgentEdit(): void {
  editingAgentIdx = null;
  const box = document.getElementById('agentEditInline');
  if (box) box.style.display = 'none';
}

export async function confirmProposal(): Promise<void> {
  if (!currentProposal) return;
  const btn = document.querySelector('#setupProposalBox .btn-run') as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up...'; }

  try {
    const result = await api<ConfirmResponse>('/setup/confirm', 'POST', {
      agents: currentProposal.agents,
      work_item: currentProposal.work_item,
    });

    // Auto-start the run
    if (result.orchestrator_id && result.work_item?.id) {
      appendAssistantBubble('Team created! Starting the run now...');
      await api('/runs', 'POST', {
        work_item_id: result.work_item.id,
        orchestrator_id: result.orchestrator_id,
      });
      toast('Run started! Check the Run tab for live output.');

      // Navigate to run tab
      const runBtn = document.querySelector<HTMLButtonElement>('nav button[data-page="run"]');
      runBtn?.click();
    }
  } catch (e) {
    toast('Error: ' + (e as Error).message);
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm & Run'; }
  }
}

export function rejectProposal(): void {
  currentProposal = null;
  const box = document.getElementById('setupProposalBox')!;
  box.style.display = 'none';
  box.innerHTML = '';
  appendAssistantBubble('No problem. What would you like changed?');
  showReplyBox();
}

// ── Chat bubble helpers ───────────────────────────────────────────────────────

function appendUserBubble(text: string): void {
  const thread = document.getElementById('setupChatThread')!;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex; justify-content:flex-end;';
  div.innerHTML = `
    <div style="background:rgba(0,212,160,0.1); border:1px solid var(--accent2); border-radius:12px 12px 2px 12px; padding:10px 14px; max-width:80%; font-size:13px; color:var(--text); white-space:pre-wrap; word-break:break-word">
      ${esc(text)}
    </div>`;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

function appendAssistantBubble(text: string): void {
  const thread = document.getElementById('setupChatThread')!;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex; justify-content:flex-start; gap:10px; align-items:flex-start;';
  div.innerHTML = `
    <div style="width:28px; height:28px; border-radius:50%; background:rgba(74,158,255,0.1); border:1px solid rgba(74,158,255,0.2); display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:11px; color:var(--blue); flex-shrink:0; margin-top:2px">C</div>
    <div style="background:var(--bg2); border:1px solid var(--border); border-radius:2px 12px 12px 12px; padding:10px 14px; max-width:80%; font-size:13px; color:var(--text); line-height:1.6; white-space:pre-wrap; word-break:break-word">
      ${esc(text)}
    </div>`;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

function showTypingIndicator(): void {
  const thread = document.getElementById('setupChatThread')!;
  const div = document.createElement('div');
  div.id = 'setupTyping';
  div.style.cssText = 'display:flex; justify-content:flex-start; gap:10px; align-items:flex-start;';
  div.innerHTML = `
    <div style="width:28px; height:28px; border-radius:50%; background:rgba(74,158,255,0.1); border:1px solid rgba(74,158,255,0.2); display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:11px; color:var(--blue); flex-shrink:0">C</div>
    <div style="background:var(--bg2); border:1px solid var(--border); border-radius:2px 12px 12px 12px; padding:10px 14px; font-size:13px;">
      <span class="spinner"></span>
    </div>`;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

function removeTypingIndicator(): void {
  document.getElementById('setupTyping')?.remove();
}

function showReplyBox(): void {
  const box = document.getElementById('setupReplyBox')!;
  box.style.display = 'flex';
  const input = document.getElementById('setupReplyInput') as HTMLTextAreaElement;
  input.value = '';
  setTimeout(() => input.focus(), 50);
}

function hideReplyBox(): void {
  const box = document.getElementById('setupReplyBox')!;
  box.style.display = 'none';
}

function showScreen(screen: 'goal' | 'chat'): void {
  const goalScreen = document.getElementById('setupGoalScreen')!;
  const chatScreen = document.getElementById('setupChatScreen')!;
  goalScreen.style.display = screen === 'goal' ? 'block' : 'none';
  chatScreen.style.display = screen === 'chat' ? 'flex' : 'none';
}

// ── Window exports ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    initSetup: typeof initSetup;
    startSetup: typeof startSetup;
    resetSetup: typeof resetSetup;
    sendReply: typeof sendReply;
    handleReplyKey: typeof handleReplyKey;
    editProposedAgent: typeof editProposedAgent;
    saveAgentEdit: typeof saveAgentEdit;
    cancelAgentEdit: typeof cancelAgentEdit;
    confirmProposal: typeof confirmProposal;
    rejectProposal: typeof rejectProposal;
  }
}
window.initSetup         = initSetup;
window.startSetup        = startSetup;
window.resetSetup        = resetSetup;
window.sendReply         = sendReply;
window.handleReplyKey    = handleReplyKey;
window.editProposedAgent = editProposedAgent;
window.saveAgentEdit     = saveAgentEdit;
window.cancelAgentEdit   = cancelAgentEdit;
window.confirmProposal   = confirmProposal;
window.rejectProposal    = rejectProposal;
