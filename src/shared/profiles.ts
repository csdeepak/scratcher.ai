// Profiles are reusable field templates. A roadmap picks one profile; the
// profile decides which notebook sections and which statuses are offered.
// Nothing here is subject-specific.

import type { ProfileKey, SectionKey, Understanding } from './model';

export type StatusCategory = 'todo' | 'active' | 'review' | 'done';
export type Owner = 'human' | 'shared';

export interface StatusDef {
  key: string;
  label: string;
  category: StatusCategory;
}

export interface SectionDef {
  key: SectionKey;
  label: string;
  owner: Owner;
  hint: string;
}

export interface Profile {
  key: ProfileKey;
  label: string;
  description: string;
  sections: SectionKey[];
  statuses: StatusDef[];
  understanding: boolean;
}

export const SECTION_DEFS: Record<SectionKey, SectionDef> = {
  objectives: {
    key: 'objectives',
    label: 'Objectives',
    owner: 'shared',
    hint: 'What you should be able to do once this checkpoint is done.',
  },
  content: {
    key: 'content',
    label: 'Content',
    owner: 'shared',
    hint: 'The explanation or main material. Usually drafted by an agent and edited by you.',
  },
  known: {
    key: 'known',
    label: 'What I already know',
    owner: 'human',
    hint: 'Your starting point, in your words.',
  },
  toLearn: {
    key: 'toLearn',
    label: 'What I need to learn',
    owner: 'shared',
    hint: 'Gaps to close. You or an agent can list them.',
  },
  practice: {
    key: 'practice',
    label: 'Practice',
    owner: 'shared',
    hint: 'Exercises, activities or small builds.',
  },
  notes: {
    key: 'notes',
    label: 'My notes',
    owner: 'human',
    hint: 'Your working notes. Agents can read them but cannot change them without your approval.',
  },
  takeaways: {
    key: 'takeaways',
    label: 'Key takeaways',
    owner: 'human',
    hint: 'What you want to remember.',
  },
  ownWords: {
    key: 'ownWords',
    label: 'In my own words',
    owner: 'human',
    hint: 'Explain it as if teaching someone. A good test of understanding.',
  },
  evidence: {
    key: 'evidence',
    label: 'Evidence',
    owner: 'human',
    hint: 'What you built or did that shows it: links, results, commits.',
  },
  questions: {
    key: 'questions',
    label: 'Open questions',
    owner: 'shared',
    hint: 'Gaps, doubts and things to look up.',
  },
};

const GENERAL_STATUSES: StatusDef[] = [
  { key: 'not-started', label: 'Not started', category: 'todo' },
  { key: 'in-progress', label: 'In progress', category: 'active' },
  { key: 'needs-review', label: 'Needs review', category: 'review' },
  { key: 'complete', label: 'Complete', category: 'done' },
];

const LEARNING_STATUSES: StatusDef[] = [
  { key: 'not-started', label: 'Not started', category: 'todo' },
  { key: 'learning', label: 'Learning', category: 'active' },
  { key: 'practising', label: 'Practising', category: 'active' },
  { key: 'needs-review', label: 'Needs review', category: 'review' },
  { key: 'complete', label: 'Complete', category: 'done' },
];

export const PROFILES: Record<ProfileKey, Profile> = {
  general: {
    key: 'general',
    label: 'General',
    description: 'Projects and goals: content, notes, takeaways and questions.',
    sections: ['content', 'notes', 'takeaways', 'questions'],
    statuses: GENERAL_STATUSES,
    understanding: false,
  },
  learning: {
    key: 'learning',
    label: 'Learning',
    description:
      'Adds objectives, what you know and need to learn, practice, evidence, your own explanation and an understanding check.',
    sections: [
      'objectives',
      'content',
      'known',
      'toLearn',
      'practice',
      'notes',
      'takeaways',
      'ownWords',
      'evidence',
      'questions',
    ],
    statuses: LEARNING_STATUSES,
    understanding: true,
  },
};

export const UNDERSTANDING_LEVELS: { key: Understanding; label: string; short: string }[] = [
  { key: 'not-yet', label: 'Not yet', short: 'Not yet' },
  { key: 'can-explain', label: 'I can explain it', short: 'Can explain' },
  { key: 'can-apply', label: 'I can explain and apply it independently', short: 'Can apply' },
];

const STATUS_ALIASES: Record<string, string> = {
  todo: 'not-started',
  'to-do': 'not-started',
  new: 'not-started',
  'not started': 'not-started',
  notstarted: 'not-started',
  doing: 'in-progress',
  wip: 'in-progress',
  started: 'in-progress',
  'in progress': 'in-progress',
  active: 'in-progress',
  review: 'needs-review',
  'needs review': 'needs-review',
  done: 'complete',
  completed: 'complete',
  finished: 'complete',
  practicing: 'practising',
};

export function getProfile(key: string | undefined): Profile {
  return PROFILES[(key as ProfileKey) ?? 'general'] ?? PROFILES.general;
}

export function defaultStatus(_profile: Profile): string {
  return 'not-started';
}

/** Normalise a status string written by a human or agent to a known key when possible. */
export function normaliseStatus(raw: unknown, profile: Profile): string {
  if (typeof raw !== 'string' || !raw.trim()) return defaultStatus(profile);
  const s = raw.trim().toLowerCase();
  if (profile.statuses.some((d) => d.key === s)) return s;
  const alias = STATUS_ALIASES[s] ?? STATUS_ALIASES[s.replace(/_/g, '-')];
  if (alias) {
    if (profile.statuses.some((d) => d.key === alias)) return alias;
    // learning profile has no "in-progress"; map to "learning"
    if (alias === 'in-progress' && profile.key === 'learning') return 'learning';
    if (alias === 'learning' || alias === 'practising') return 'in-progress';
  }
  if (s === 'in-progress' && profile.key === 'learning') return 'learning';
  if ((s === 'learning' || s === 'practising') && profile.key === 'general') return 'in-progress';
  return s;
}

export function statusDef(profile: Profile, key: string): StatusDef {
  return (
    profile.statuses.find((d) => d.key === key) ?? {
      key,
      label: key,
      category: 'todo',
    }
  );
}

export function sectionsFor(profile: Profile): SectionKey[] {
  return profile.sections;
}

export function sectionOwner(key: SectionKey): Owner {
  return SECTION_DEFS[key].owner;
}

/** Heading text -> section key (case-insensitive; accepts label or key). */
export function sectionFromHeading(text: string): SectionKey | null {
  const t = text.trim().toLowerCase();
  for (const def of Object.values(SECTION_DEFS)) {
    if (def.label.toLowerCase() === t || def.key.toLowerCase() === t) return def.key;
  }
  const aliases: Record<string, SectionKey> = {
    notes: 'notes',
    explanation: 'content',
    overview: 'content',
    'learning objectives': 'objectives',
    takeaways: 'takeaways',
    questions: 'questions',
    'questions or gaps': 'questions',
    'already know': 'known',
    'need to learn': 'toLearn',
    'practice activities': 'practice',
    'my explanation': 'ownWords',
    'own words': 'ownWords',
  };
  return aliases[t] ?? null;
}
