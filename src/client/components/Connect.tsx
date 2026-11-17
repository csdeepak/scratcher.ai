// "Connect your AI": how Claude, ChatGPT and other agents get at the workspace folder. Step 2 of
// the desktop app's first start, and later from Help, the ⋯ menu, Ctrl+K and "Work with an agent".
// Waymark never changes other apps' settings: each card says where to click in that app.

import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Copy, FolderOpen, Sparkles } from 'lucide-react';
import { setState, useStore } from '../store';
import { desktopBridge } from '../desktop';
import { Button, Chip, Modal } from './ui';

const copy = (text: string, msg: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast.success(msg),
    () => toast.error("Couldn't copy: clipboard access was blocked."),
  );

/** A path inside the workspace, written the way this computer writes paths. */
export function workspacePath(workspace: string, ...parts: string[]) {
  const sep = workspace.includes('\\') ? '\\' : '/';
  return [workspace.replace(/[\\/]+$/, ''), ...parts.flatMap((p) => p.split('/'))].filter(Boolean).join(sep);
}

const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px]">{children}</code>;

function Way({ name, best, children }: { name: string; best?: boolean; children: ReactNode }) {
  return (
    <li className="grid gap-0.5">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        {name} {best && <Chip tone="accent">Recommended</Chip>}
      </div>
      <div className="text-[12.5px] leading-relaxed text-muted">{children}</div>
    </li>
  );
}

function Card({ title, who, children }: { title: string; who: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line p-3.5">
      <h3 className="mb-2.5 text-[14px] font-semibold">
        {title} <span className="text-[12px] font-normal text-faint">{who}</span>
      </h3>
      <ul className="grid gap-3">{children}</ul>
    </section>
  );
}

/** The cards. `onChatRoute` opens the copy/paste route for chats that can't reach files. */
export function ConnectAgents({ workspace, onChatRoute }: { workspace: string; onChatRoute: () => void }) {
  const desktop = desktopBridge();
  const agents = workspacePath(workspace, 'AGENTS.md');
  const firstPrompt = `Read ${agents} and follow it: it explains how my roadmaps are stored and what you may change.
Then create a new roadmap in that workspace for my goal: <describe your goal>.
Draft 5–8 main checkpoints with a one-line summary each, and tell me what to check in Waymark's Review.`;
  const chatLink = (
    <button className="text-accent hover:underline" onClick={onChatRoute}>
      Chat without file access
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="mb-1.5 text-[12.5px] font-semibold">Your workspace folder: give this folder to your AI</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px]" title={workspace}>
            {workspace}
          </code>
          <Button size="sm" onClick={() => copy(workspace, 'Folder path copied')}>
            <Copy size={13} /> Copy path
          </Button>
          {desktop && (
            <Button size="sm" onClick={() => void desktop.showWorkspace()}>
              <FolderOpen size={13} /> Show folder
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
        <Card title="Claude" who="Anthropic">
          <Way name="Claude app → Code tab" best>
            Start a session and choose this folder. Claude reads <Code>CLAUDE.md</Code>, which loads the rules in <Code>AGENTS.md</Code>, then edits your files
            directly. Claude Code in a terminal works the same: run <Code>claude</Code> in this folder.
          </Way>
          <Way name="Claude app → Cowork">Give Claude this folder when you start a task.</Way>
          <Way name="Claude chat">
            A chat can't see your files on its own. Add a desktop extension that reads and writes files (Settings → Desktop app → Extensions) and allow only this
            folder, or use {chatLink}.
          </Way>
        </Card>
        <Card title="ChatGPT" who="OpenAI">
          <Way name="ChatGPT desktop app → Codex" best>
            Choose <i>open a folder</i> and pick this one. Codex reads <Code>AGENTS.md</Code> before it starts work. The Codex CLI and editor extension work the same way.
          </Way>
          <Way name="ChatGPT in a browser">It can't reach files on your computer. Use {chatLink}: copy a brief, then paste the reply into Review.</Way>
        </Card>
      </div>
      <Card title="Other agents" who="all read AGENTS.md">
        <Way name="Cursor, VS Code (GitHub Copilot), Windsurf">Open this folder in the editor and ask its agent.</Way>
        <Way name="Gemini CLI">
          Run <Code>gemini</Code> in this folder. <Code>GEMINI.md</Code> loads the rules in <Code>AGENTS.md</Code>.
        </Way>
      </Card>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px] font-semibold">
          <span className="flex items-center gap-1.5">
            <Sparkles size={14} /> Try it: a first prompt
          </span>
          <Button size="sm" variant="primary" onClick={() => copy(firstPrompt, 'Prompt copied: paste it into your agent')}>
            <Copy size={13} /> Copy prompt
          </Button>
        </div>
        <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">{firstPrompt}</pre>
        <p className="mt-1.5 text-[12px] text-muted">
          The new roadmap appears here as soon as the agent writes it. Agents may add to your notes but never rewrite them, and anything they change waits for you in Review.
        </p>
      </div>
    </div>
  );
}

export function ConnectDialog() {
  const open = useStore((s) => s.dialog === 'connect');
  const firstRun = useStore((s) => s.connectFirstRun);
  const workspace = useStore((s) => s.workspace);
  const close = () => setState({ dialog: null, connectFirstRun: false });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? setState({ dialog: 'connect' }) : close())}
      title={firstRun ? 'Step 2 of 2: Connect your AI' : 'Connect your AI'}
      description="Waymark has no AI of its own. Point the agent you already use at your workspace folder: it reads and writes the same files, and Waymark shows its changes live."
      wide
      footer={
        <Button variant="primary" onClick={close}>
          {firstRun ? 'Start using Waymark' : 'Done'}
        </Button>
      }
    >
      <ConnectAgents workspace={workspace} onChatRoute={() => setState({ dialog: 'agent', agentTab: 'chat', connectFirstRun: false })} />
    </Modal>
  );
}
