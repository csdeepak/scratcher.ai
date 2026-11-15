import { describe, expect, it } from 'vitest';
import { preserveFormatting } from '../src/shared/preserveFormatting';

// What an agent typically writes, and what a visual editor gives back after a one-word edit:
// "*" bullets, "_" emphasis, re-wrapped lines, "***" rules, escapes.
const agent = `Intro paragraph that an agent
wrapped over two lines with *emphasis* and snake_case.

- first point
- second point with \`code\`

| a | b |
|---|---|
| 1 | 2 |

---

\`\`\`python
# a comment
print("hi")
\`\`\`

> A quote.`;

const editorOutput = (changedParagraph: string) => `${changedParagraph}

* first point
* second point with \`code\`

| a | b |
| - | - |
| 1 | 2 |

***

\`\`\`python
# a comment
print("hi")
\`\`\`

> A quote.`;

describe('preserveFormatting', () => {
  it('keeps the exact original text of every block the user did not change', () => {
    const out = preserveFormatting(agent, editorOutput('Intro paragraph that an agent wrapped over two lines with _emphasis_ and snake\\_case. Added by me.'));
    expect(out).toContain('- first point\n- second point');
    expect(out).toContain('|---|---|');
    expect(out).toContain('\n---\n');
    // the edited paragraph takes the editor's text
    expect(out.startsWith('Intro paragraph that an agent wrapped over two lines with _emphasis_')).toBe(true);
    expect(out).toContain('Added by me.');
  });

  it('returns the original byte-for-byte when only formatting differs', () => {
    const out = preserveFormatting(agent, editorOutput('Intro paragraph that an agent wrapped over two lines with _emphasis_ and snake\\_case.'));
    expect(out).toBe(agent);
  });

  it('keeps real changes: new formatting, removed and reordered blocks', () => {
    const boldNow = preserveFormatting('A word here.\n\nSecond.', 'A **word** here.\n\nSecond.');
    expect(boldNow).toBe('A **word** here.\n\nSecond.');
    const removed = preserveFormatting('One.\n\nTwo.\n\nThree.', 'One.\n\nThree.');
    expect(removed).toBe('One.\n\nThree.');
    const ticked = preserveFormatting('- [ ] task', '* [x] task');
    expect(ticked).toBe('* [x] task');
    const reordered = preserveFormatting('- a\n\nPara B.', 'Para B.\n\n* a');
    expect(reordered).toBe('Para B.\n\n- a');
  });

  it('leaves code exactly as typed', () => {
    const out = preserveFormatting('```js\nconst  a = 1;\n```', '```js\nconst a = 1;\n```');
    expect(out).toBe('```js\nconst a = 1;\n```');
  });
});
