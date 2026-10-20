'use client';

/**
 * useLocalDraft — browser-local autosave of the quiz draft (FOLLOW-1362 C3, decision Q-I: no
 * server drafts). The draft is kept in `localStorage` under `<tenant>:<base version>`, so a draft
 * made against version 7 is never offered on top of version 8. On load, a stored draft that
 * differs from the loaded version raises a restore prompt (`pending`); while it is unanswered
 * nothing is written. While the draft differs from the loaded version a `beforeunload` guard is
 * armed. Every storage access is wrapped in try/catch (private mode, quota, disabled storage).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/use-local-draft
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface StoredDraft {
  text: string;
  /** ISO-8601 of the last autosave. */
  saved_at: string;
}

/** The localStorage key of a tenant's draft against a base version. */
export function draftKey(tenantId: string, baseVersion: number | null): string {
  return `estalara:quiz-draft:${tenantId}:${baseVersion === null ? 'default' : String(baseVersion)}`;
}

function readDraft(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<StoredDraft>;
    return typeof v.text === 'string' ? { text: v.text, saved_at: v.saved_at ?? '' } : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, text: string): void {
  try {
    const value: StoredDraft = { text, saved_at: new Date().toISOString() };
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable or full — autosave is best-effort, the in-memory draft is unaffected
  }
}

function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface LocalDraft {
  /** A stored draft that differs from the loaded version, awaiting restore / discard. */
  pending: StoredDraft | null;
  /** True while the draft differs from the loaded version (the unsaved-changes guard). */
  dirty: boolean;
  /** Take the stored draft: returns its text (the caller loads it) and closes the prompt. */
  restore: () => string | null;
  /** Drop the stored draft and close the prompt. */
  discard: () => void;
  /** Forget the stored draft (after a successful publish). */
  clear: () => void;
}

export function useLocalDraft({
  tenantId,
  baseVersion,
  text,
  baseline,
  ready,
}: {
  tenantId: string;
  baseVersion: number | null;
  /** The current draft text. */
  text: string;
  /** The text of the loaded version (what "unchanged" means). */
  baseline: string;
  /** Loaded, writable and valid: only then is anything stored or guarded. */
  ready: boolean;
}): LocalDraft {
  const key = draftKey(tenantId, baseVersion);
  const [pending, setPending] = useState<StoredDraft | null>(null);
  const checkedKey = useRef<string | null>(null);
  const armed = useRef(false);
  const dirty = ready && text !== baseline;

  // 1. On load (per key): look for a stored draft that differs from the loaded version.
  useEffect(() => {
    if (!ready) {
      checkedKey.current = null;
      armed.current = false;
      setPending(null);
      return;
    }
    if (checkedKey.current === key) return;
    checkedKey.current = key;
    const stored = readDraft(key);
    setPending(stored !== null && stored.text !== baseline ? stored : null);
  }, [ready, key, baseline]);

  // 2. Autosave (the first pass after load only arms it, so the loaded text cannot erase the
  //    stored draft before the prompt was shown).
  useEffect(() => {
    if (!ready || pending !== null) return;
    if (!armed.current) {
      armed.current = true;
      return;
    }
    if (text === baseline) removeDraft(key);
    else writeDraft(key, text);
  }, [ready, pending, text, baseline, key]);

  // 3. Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const restore = useCallback((): string | null => {
    const taken = pending?.text ?? null;
    setPending(null);
    return taken;
  }, [pending]);

  const discard = useCallback((): void => {
    removeDraft(key);
    setPending(null);
  }, [key]);

  const clear = useCallback((): void => {
    removeDraft(key);
    setPending(null);
  }, [key]);

  return { pending, dirty, restore, discard, clear };
}
