// FOLLOW-625 NEGATIVE CONTROL — src/components SCOPE (amended AC / RETRO-206 §4a
// LG-2). Reinstates the pre-FOLLOW-630 `components/generation-model-settings.tsx`
// swallow: no `!r.ok` guard, `.catch(() => {})`; a Save resets the GLOBAL model.
// Proves the guard covers src/components/**, not only src/app/**. Guard MUST FAIL.
'use client';

import { useEffect, useState } from 'react';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function GenerationModelSettings() {
  const [model, setModel] = useState(DEFAULT_MODEL);

  useEffect(() => {
    void fetch('/api/admin/generation-model')
      .then((r) => r.json())
      .then((d) => {
        const parsed = d as { generation_model?: string };
        setModel(parsed.generation_model ?? DEFAULT_MODEL);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    await fetch('/api/admin/generation-model', {
      method: 'PUT',
      body: JSON.stringify({ generation_model: model }),
    });
  }

  return model === '' ? null : null;
}
