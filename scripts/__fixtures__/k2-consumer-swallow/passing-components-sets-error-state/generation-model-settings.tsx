// FOLLOW-625 fixture — src/components scope, FIXED shape (mirrors the FOLLOW-630
// generation-model-settings fix). A failed GET sets an error state → guard ACCEPTs.
'use client';

import { useEffect, useState } from 'react';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function GenerationModelSettings() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    void fetch('/api/admin/generation-model')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((d) => {
        const parsed = d as { generation_model?: string };
        setModel(parsed.generation_model ?? DEFAULT_MODEL);
        setLoadStatus('loaded');
      })
      .catch(() => {
        setLoadStatus('error');
      });
  }, []);

  return model === '' && loadStatus === 'error' ? null : null;
}
