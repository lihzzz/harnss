export type UsageRange = 7 | 30 | 90;

export type UsageInterval = [start: number, end: number];

export interface UsageTimings {
  version: 1;
  trackingStartedAt: number;
  active: UsageInterval[];
  agent: UsageInterval[];
}

export interface UsageDay {
  date: string;
  userMessages: number;
  assistantMessages: number;
  /** Null means this date predates timing collection. */
  activeMs: number | null;
  agentMs: number | null;
}

export interface UsageRank {
  name: string;
  count: number;
}

export interface UsageReport {
  days: UsageDay[];
  tools: UsageRank[];
  commands: UsageRank[];
  slashCommands: UsageRank[];
  trackingStartedAt: number;
  timeZone: string;
  incompleteHistory: boolean;
}
