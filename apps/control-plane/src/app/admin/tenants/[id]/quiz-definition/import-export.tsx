'use client';

/**
 * ImportExport — export the current draft as JSON, import a file into the DRAFT (FOLLOW-1362 C3).
 *
 * Import never publishes: the file is parsed, validated with `QuizDefinitionAuthoringSchema` (the
 * same schema the server's PUT enforces), shown with its lint warnings and the keys the schema
 * dropped, and only then loaded into the editor's draft. The parent remembers the draft came from
 * an import and sends `source: 'import'` when it is published. Export is available read-only;
 * import is hidden without `can_write`.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/import-export
 */

import { useRef, useState } from 'react';

import type { QuizLintIssue } from '@estalara/shared';
import { QuizDefinitionAuthoringSchema, lintQuizDefinition } from '@estalara/shared';

/** Paths present in `raw` but absent from `parsed` (what Zod silently stripped). */
export function findDroppedKeys(raw: unknown, parsed: unknown, path = ''): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item, i) => findDroppedKeys(item, parsed[i], `${path}[${String(i)}]`));
  }
  if (
    raw !== null &&
    parsed !== null &&
    typeof raw === 'object' &&
    typeof parsed === 'object' &&
    !Array.isArray(raw) &&
    !Array.isArray(parsed)
  ) {
    const p = parsed as Record<string, unknown>;
    return Object.entries(raw as Record<string, unknown>).flatMap(([k, v]) => {
      const here = path === '' ? k : `${path}.${k}`;
      return k in p ? findDroppedKeys(v, p[k], here) : [here];
    });
  }
  return [];
}

type ImportResult =
  | { ok: false; errors: string[] }
  | { ok: true; warnings: QuizLintIssue[]; dropped: string[] };

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('Could not read the file'));
    };
    reader.readAsText(file);
  });
}

export function ImportExport({
  tenantId,
  version,
  draftText,
  canWrite,
  onImport,
}: {
  tenantId: string;
  version: number | null;
  draftText: string;
  canWrite: boolean;
  /** Load the validated, pretty-printed definition into the draft (never publishes). */
  onImport: (text: string) => void;
}): React.JSX.Element {
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleExport(): void {
    const blob = new Blob([draftText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz-definition-${tenantId}-v${version === null ? 'default' : String(version)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file));
    } catch (err) {
      setResult({
        ok: false,
        errors: [`Not valid JSON: ${err instanceof Error ? err.message : 'unreadable file'}`],
      });
      return;
    }
    const parsed = QuizDefinitionAuthoringSchema.safeParse(raw);
    if (!parsed.success) {
      setResult({
        ok: false,
        errors: parsed.error.issues.map((i) => {
          const code: unknown = i.code === 'custom' ? i.params?.lint_code : undefined;
          return `${typeof code === 'string' ? `${code} ` : ''}${i.path.length ? `[${i.path.join('.')}] ` : ''}${i.message}`;
        }),
      });
      return;
    }
    setResult({
      ok: true,
      warnings: lintQuizDefinition(parsed.data).warnings,
      dropped: findDroppedKeys(raw, parsed.data),
    });
    onImport(JSON.stringify(parsed.data, null, 2));
  }

  return (
    <div data-testid="import-export" className="mb-3">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          data-testid="export-draft"
          onClick={handleExport}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          Export JSON
        </button>
        {canWrite && (
          <>
            <button
              type="button"
              data-testid="import-draft"
              onClick={() => fileInput.current?.click()}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              Import JSON…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              data-testid="import-file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleFile(file);
              }}
            />
          </>
        )}
      </div>

      {result?.ok === false && (
        <div
          role="alert"
          data-testid="import-errors"
          className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <p className="font-medium">Import rejected — the draft was not changed:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {result?.ok === true && (
        <div
          role="status"
          data-testid="import-ok"
          className="mt-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          Imported into the draft. It is <strong>not published</strong> — review it, then Publish…
          {result.dropped.length > 0 && (
            <p data-testid="import-dropped" className="mt-1 text-amber-800">
              Unknown keys dropped ({String(result.dropped.length)}):{' '}
              <span className="font-mono text-xs">{result.dropped.join(', ')}</span>
            </p>
          )}
          {result.warnings.length > 0 && (
            <ul data-testid="import-warnings" className="mt-1 list-disc pl-5 text-amber-800">
              {result.warnings.map((w, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{w.code}</span> {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
