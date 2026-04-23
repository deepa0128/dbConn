import type { QueryEvent } from '../config.js';

type OnQueryOption = ((event: QueryEvent) => void) | Array<(event: QueryEvent) => void> | undefined;

export function notifyQuery(onQuery: OnQueryOption, event: QueryEvent): void {
  if (!onQuery) return;
  if (Array.isArray(onQuery)) {
    for (const fn of onQuery) fn(event);
  } else {
    onQuery(event);
  }
}
