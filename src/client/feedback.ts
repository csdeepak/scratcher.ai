// "Send feedback": opens the GitHub feedback form (.github/ISSUE_TEMPLATE/1-feedback.yml) with the
// version and computer filled in. Issue forms take field values from the address (?<field id>=…).

import pkg from '../../package.json';

const ISSUES = 'https://github.com/csdeepak/scratcher.ai/issues/new';

function computer(): string {
  const ua = navigator.userAgent;
  return /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'unknown';
}

export function feedbackUrl(kind: 'feedback' | 'bug' | 'idea' = 'feedback'): string {
  const template = { feedback: '1-feedback.yml', bug: '2-bug.yml', idea: '3-idea.yml' }[kind];
  const q = new URLSearchParams({ template });
  if (kind !== 'idea') q.set('version', `${pkg.version}, ${computer()}${(window as { waymarkDesktop?: unknown }).waymarkDesktop ? ' (desktop app)' : ' (browser)'}`);
  return `${ISSUES}?${q}`;
}

export function openFeedback(kind: 'feedback' | 'bug' | 'idea' = 'feedback') {
  window.open(feedbackUrl(kind), '_blank', 'noopener,noreferrer');
}
