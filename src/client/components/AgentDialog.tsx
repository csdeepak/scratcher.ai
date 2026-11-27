// "Work with an agent": ready-made prompts for the session workflows in AGENTS.md, how to connect
// each agent app (Connect.tsx), and the copy/paste route for chats that can't reach your files.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Bot, Copy, GraduationCap, Lightbulb, ListChecks, NotebookPen, Sparkles, Split } from 'lucide-react';
import { http } from '../api';
import { setState, useStore } from '../store';
import { ConnectAgents } from './Connect';
import { TargetPicker, useAgentTarget } from './TargetPicker';
import { Button, Chip, Modal, cx } from './ui';

type Flow = 'start' | 'wrapup' | 'brainstorm' | 'quiz' | 'expand' | 'draft';

const FLOWS: { key: Flow; name: string; label: string; icon: ReactNode; needsCp: boolean; hint: string }[] = [
  { key: 'start', name: 'Start a study or work session', label: 'Start a session', icon: <GraduationCap size={15} />, needsCp: true, hint: 'The agent reads the checkpoint and your notes, then teaches from where you are.' },
  { key: 'wrapup', name: 'Wrap up a session', label: 'Wrap up: record what we covered', icon: <NotebookPen size={15} />, needsCp: true, hint: 'Use it at the end of a chat. Session notes go into My notes, plus takeaways and open questions.' },
  { key: 'brainstorm', name: 'Brainstorm into the roadmap', label: 'Brainstorm', icon: <Lightbulb size={15} />, needsCp: true, hint: 'Ideas are captured as notes and new checkpoints when you say "wrap up".' },
  { key: 'quiz', name: 'Check understanding', label: 'Quiz me', icon: <ListChecks size={15} />, needsCp: true, hint: 'Questions in the chat; the result is recorded as a session note.' },
  { key: 'expand', name: 'Expand one checkpoint', label: 'Expand into sub-checkpoints', icon: <Split size={15} />, needsCp: true, hint: 'Adds 3–6 sub-checkpoints with explanations and resources.' },
  { key: 'draft', name: 'Draft a new roadmap', label: 'Draft the main checkpoints', icon: <Sparkles size={15} />, needsCp: false, hint: 'For a new or empty roadmap.' },
];

const FORMAT_KEY = 'waymark.sessionFormat';

export function AgentDialog() {
  const open = useStore((s) => s.dialog === 'agent');
  const workspace = useStore((s) => s.workspace);
  // The roadmap and checkpoint the prompts are for: what's open and selected, or picked in the dialog.
  const target = useAgentTarget(open);
  const { rm, cp } = target;
  const tab = useStore((s) => s.agentTab);
  const setTab = (agentTab: typeof tab) => setState({ agentTab });
  const [flow, setFlow] = useState<Flow>('wrapup');
  const [format, setFormat] = useState(() => {
    try {
      return localStorage.getItem(FORMAT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [request, setRequest] = useState('');
  const [scope, setScope] = useState<'section' | 'roadmap'>('section');

  useEffect(() => {
    if (!open) return;
    setScope(cp ? 'section' : 'roadmap');
    if (!cp) setFlow('draft');
    else if (flow === 'draft') setFlow('wrapup');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rm?.meta.id, cp?.id]);

  // Paths in the style of this computer (backslashes on Windows).
  const sep = workspace.includes('\\') ? '\\' : '/';
  const abs = (...parts: string[]) => [workspace.replace(/[\\/]+$/, ''), ...parts.flatMap((p) => p.split('/'))].filter(Boolean).join(sep);
  const agentsPath = abs('AGENTS.md');

  const prompt = useMemo(() => {
    if (!rm) return `Read ${agentsPath} and follow it. Then create a new roadmap for my goal: …`;
    const f = FLOWS.find((x) => x.key === flow)!;
    const lines = [`Follow the "${f.name}" workflow in ${agentsPath} (read that file first if you haven't in this chat).`, `Roadmap: "${rm.meta.title}" (${abs('roadmaps', rm.slug)})`];
    if (cp && f.needsCp) lines.push(`Checkpoint: "${cp.title}" (id ${cp.id}), file ${abs('roadmaps', rm.slug, rm.files[cp.id] ?? `checkpoints/${cp.id}.md`)}`);
    const fmt = format.trim() ? `Format for my session notes: ${format.trim()}.` : 'Format for my session notes: choose the clearest representation for what we did.';
    switch (flow) {
      case 'start':
        lines.push('Read the checkpoint, its parent and my notes, then start teaching me from where I am. Don\'t change the files until I say "wrap up".', fmt);
        break;
      case 'wrapup':
        lines.push('Wrap up our session now: add notes from this chat to My notes (below what is there), new takeaways, open questions and resources we used, as the workflow describes. Then tell me what to check in Review.', fmt);
        break;
      case 'brainstorm':
        lines.push('Brainstorm with me about this checkpoint. When I say "wrap up", capture the outcome as the workflow describes.', fmt);
        break;
      case 'quiz':
        lines.push('Quiz me on this checkpoint, one question at a time, and tell me how I did. When I say "wrap up", record the result.', fmt);
        break;
      case 'expand':
        lines.push('Expand this checkpoint into 3–6 sub-checkpoints with short explanations and a few good resources. Don\'t change anything else.');
        break;
      case 'draft':
        lines.push('Draft the main checkpoints for this roadmap: 5–8, each with a one-line summary, no sub-checkpoints yet. Read roadmap.md for the goal first.');
        break;
    }
    return lines.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rm, cp, flow, format, workspace]);

  const projectInstructions = `My roadmaps (learning plans and projects) are Markdown files in this folder: ${workspace}
Before changing anything there, read ${agentsPath} and follow its rules and workflows. Find a roadmap in LIBRARY.md.
When I say "wrap up" or "record this", add notes from our session to that checkpoint's "My notes", in the format I ask for (otherwise the clearest format for what we did), plus new takeaways and open questions.
Never rewrite or delete my existing notes, and never mark progress or understanding unless I say so.`;

  const copy = (text: string, msg = 'Copied') =>
    void navigator.clipboard.writeText(text).then(
      () => toast.success(msg),
      () => toast.error('Your browser blocked clipboard access.'),
    );

  const copyBrief = async () => {
    if (!rm) return;
    try {
      const res = await http.post<{ text: string }>(`/api/roadmaps/${rm.meta.id}/brief`, { checkpointId: scope === 'section' && cp ? cp.id : null, request });
      copy(res.text, 'Brief copied. Paste it into your chat, then paste the reply in Review → Paste proposal.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const tabs: [typeof tab, string][] = [
    ['prompts', 'Session prompts'],
    ['setup', 'Connect your AI'],
    ['chat', 'Chat without file access'],
  ];

  return (
    <Modal open={open} onOpenChange={(o) => setState(o ? { dialog: 'agent' } : { dialog: null, agentTab: 'prompts' })} title="Work with an agent" description="Waymark has no built-in AI. Study or brainstorm with Claude, ChatGPT or another agent, then let it write the results into your files: the map updates live." wide>
      <div className="mb-4 flex rounded-lg bg-surface-2 p-0.5 text-[12.5px]">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('flex-1 rounded-md px-3 py-1.5', tab === k ? 'bg-surface font-medium shadow-sm' : 'text-muted')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'prompts' && (
        <div className="grid gap-4 text-[13px]">
          <TargetPicker target={target} />
          {!cp && (
            <p className="-mt-2 text-[12px] text-muted">
              {rm ? 'Pick a checkpoint above for the session prompts; Draft works on the whole roadmap.' : 'Pick a roadmap above, or copy the prompt below to have your agent create a new one.'}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Workflow">
            {FLOWS.map((f) => {
              const disabled = !rm || (f.needsCp && !cp);
              const why = !rm ? 'Pick a roadmap first' : 'Pick a checkpoint first';
              return (
                <button
                  key={f.key}
                  role="radio"
                  aria-checked={flow === f.key}
                  disabled={disabled}
                  title={disabled ? why : undefined}
                  onClick={() => setFlow(f.key)}
                  className={cx('flex gap-2.5 rounded-lg border p-2.5 text-left disabled:opacity-40', flow === f.key ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
                >
                  <span className="mt-0.5 text-muted">{f.icon}</span>
                  <span>
                    <span className="block text-[13px] font-semibold">{f.label}</span>
                    <span className="block text-[12px] leading-snug text-muted">{f.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {['start', 'wrapup', 'brainstorm', 'quiz'].includes(flow) && (
            <label className="text-[12.5px] font-medium">
              How should session notes look? <span className="font-normal text-faint">(optional; leave empty and the agent picks the clearest format)</span>
              <input
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value);
                  try {
                    localStorage.setItem(FORMAT_KEY, e.target.value);
                  } catch {
                    /* fine */
                  }
                }}
                placeholder="e.g. short bullets with one worked example; or Q&A; or Cornell notes"
                className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px] font-normal outline-none focus:border-accent"
              />
            </label>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between text-[12.5px] font-semibold">
              Prompt to paste into your agent
              <Button size="sm" variant="primary" onClick={() => copy(prompt, 'Prompt copied')}>
                <Copy size={13} /> Copy prompt
              </Button>
            </div>
            <pre tabIndex={0} aria-label="Prompt" className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">{prompt}</pre>
          </div>
          <p className="text-[12px] leading-relaxed text-muted">
            Works in any agent that can open your workspace folder: the Claude app's Code tab or Cowork, Codex in the ChatGPT desktop app, Cursor and others (see <i>Connect your AI</i>). Once the agent has read AGENTS.md in a chat, you can simply say <b>"wrap up"</b> at the end.
          </p>
        </div>
      )}

      {tab === 'setup' && (
        <div className="flex min-w-0 flex-col gap-4 text-[13px] leading-relaxed">
          <ConnectAgents workspace={workspace} onChatRoute={() => setTab('chat')} />
          <div className="border-t border-line pt-4">
            <div className="mb-1 flex items-center justify-between text-[12.5px] font-semibold">
              One-time instructions for a Claude Project or ChatGPT Project
              <Button size="sm" onClick={() => copy(projectInstructions, 'Instructions copied')}>
                <Copy size={13} /> Copy
              </Button>
            </div>
            <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">{projectInstructions}</pre>
            <p className="mt-1 text-[12px] text-muted">Paste this into the project's instructions so every chat in it knows the workflow; then "wrap up" is all you need to say.</p>
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div className="grid gap-3 text-[13px] leading-relaxed">
          <p className="text-muted">
            For ChatGPT or Claude on the web, or when you only upload a copy of a file: copy a brief, paste it into the chat, then paste the reply into <b>Review → Paste proposal</b>. Session notes arrive as additions to My notes, and you preview everything before it's applied.
          </p>
          <TargetPicker target={target} />
          {rm ? (
            <>
              {cp && (
                <div className="flex gap-2 text-[12.5px]">
                  {(['section', 'roadmap'] as const).map((s) => (
                    <label key={s} className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5', scope === s ? 'border-accent bg-accent-soft' : 'border-line')}>
                      <input type="radio" className="accent-[var(--accent)]" checked={scope === s} onChange={() => setScope(s)} />
                      {s === 'section' ? `“${cp.title}” and below` : 'Whole roadmap outline'}
                    </label>
                  ))}
                </div>
              )}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[12.5px] font-medium" htmlFor="ag-req">
                    What should the agent do?
                  </label>
                  {cp && (
                    <button
                      className="text-[12px] text-accent hover:underline"
                      onClick={() => setRequest(`Wrap up our session: record what we covered as session notes for "${cp.title}" (append to My notes${format.trim() ? `, format: ${format.trim()}` : ''}), plus new takeaways and open questions.`)}
                    >
                      Use the wrap-up request
                    </button>
                  )}
                </div>
                <textarea id="ag-req" rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent" value={request} onChange={(e) => setRequest(e.target.value)} placeholder={cp ? `Expand “${cp.title}” into sub-checkpoints with explanations and resources.` : 'Draft the main checkpoints.'} />
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void copyBrief()}>
                  <Copy size={14} /> Copy brief for AI
                </Button>
                <Button onClick={() => setState({ dialog: 'paste' })}>Paste the reply…</Button>
              </div>
            </>
          ) : (
            <p className="text-muted">Pick a roadmap above.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <Bot size={13} /> Agents may <b>add</b> to your notes and takeaways but never rewrite them, content stays a <Chip>draft</Chip> until you approve it, and progress changes wait for your OK in Review.
      </div>
    </Modal>
  );
}
