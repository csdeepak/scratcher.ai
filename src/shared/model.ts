// Core data model shared by the server, the UI and the tests.
// The Markdown files in the workspace are the source of truth; these types are
// their parsed form. See docs/DATA-FORMAT.md for the on-disk format.

export const SCHEMA = 'waymark/1';
export const SCHEMA_VERSION = 1;

export type SectionKey =
  | 'content'
  | 'objectives'
  | 'known'
  | 'toLearn'
  | 'practice'
  | 'notes'
  | 'takeaways'
  | 'ownWords'
  | 'evidence'
  | 'questions';

export const ALL_SECTIONS: SectionKey[] = [
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
];

export type Understanding = 'not-yet' | 'can-explain' | 'can-apply';
export type AgentAccess = 'review' | 'direct' | 'locked';
export type ProfileKey = 'general' | 'learning';
export type ResourceKind = 'article' | 'video' | 'book' | 'course' | 'docs' | 'tool' | 'other';

export interface Resource {
  title: string;
  url: string;
  kind?: ResourceKind;
  /** Optional video timestamp such as "12:30" or "1:02:03". */
  start?: string;
  note?: string;
}

export interface Checkpoint {
  id: string;
  title: string;
  /** Parent checkpoint id; null for a main checkpoint. */
  parent: string | null;
  /** Position among siblings; decimals allowed. */
  order: number;
  summary: string;
  status: string;
  understanding: Understanding | null;
  /** Content approved by the human. Approved content is protected from agent edits. */
  approved: boolean;
  optional: boolean;
  archived: boolean;
  /** Override for agent edits in this checkpoint and everything below it. */
  agentAccess: AgentAccess | null;
  /** Ids of checkpoints this one requires. */
  prerequisites: string[];
  completion: string;
  resources: Resource[];
  sections: Partial<Record<SectionKey, string>>;
  /** Version counter. The app increments it; agents keep the value they read. */
  rev: number;
  updated?: string;
  /** Unknown front-matter keys are preserved round-trip. */
  extra?: Record<string, unknown>;
}

export interface RoadmapMeta {
  id: string;
  title: string;
  profile: ProfileKey;
  description: string;
  agentAccess: 'review' | 'direct';
  created: string;
  updated?: string;
  rev: number;
  /** Overview / goal written for both you and the agent (Markdown). */
  overview: string;
  extra?: Record<string, unknown>;
}

export interface LayoutOffsets {
  [checkpointId: string]: { dx: number; dy: number };
}

export interface RoadmapLayout {
  schema: 'waymark-layout/1';
  offsets: LayoutOffsets;
}

/** A complete roadmap as held in memory and sent to the UI. */
export interface Roadmap {
  meta: RoadmapMeta;
  slug: string;
  checkpoints: Record<string, Checkpoint>;
  layout: RoadmapLayout;
  /** checkpoint id -> file path relative to the roadmap folder */
  files: Record<string, string>;
  problems: Problem[];
}

export interface Problem {
  file: string;
  message: string;
  at: string;
}

export interface RoadmapSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  profile: ProfileKey;
  updated?: string;
  total: number;
  done: number;
  understood: number;
  drafts: number;
  problems: number;
}

/** Field paths used for diffs, guards and review. Sections use "sections.<key>". */
export type FieldPath =
  | 'title'
  | 'parent'
  | 'order'
  | 'summary'
  | 'status'
  | 'understanding'
  | 'approved'
  | 'optional'
  | 'archived'
  | 'agentAccess'
  | 'prerequisites'
  | 'completion'
  | 'resources'
  | `sections.${SectionKey}`;

export const SCALAR_FIELDS: FieldPath[] = [
  'title',
  'parent',
  'order',
  'summary',
  'status',
  'understanding',
  'approved',
  'optional',
  'archived',
  'agentAccess',
  'prerequisites',
  'completion',
  'resources',
];

export const ALL_FIELDS: FieldPath[] = [
  ...SCALAR_FIELDS,
  ...ALL_SECTIONS.map((k) => `sections.${k}` as FieldPath),
];

export interface FieldChange {
  field: FieldPath;
  before: unknown;
  after: unknown;
}
