// FOLLOW-625 fixture — mirrors the shape the six FOLLOW-624/630 fixes landed
// (app scope). A failed GET sets a visible error state; the guard must ACCEPT it.
'use client';

import { useEffect, useState } from 'react';

const DEFAULTS = { name: '' };

export function ConfigEditor() {
  const [config, setConfig] = useState(DEFAULTS);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [, setLoadErrorMsg] = useState('');

  useEffect(() => {
    void fetch('/api/config')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((d) => {
        setConfig({ ...DEFAULTS, ...(d as object) });
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load.');
        setLoadStatus('error');
      });
  }, []);

  return config.name === '' && loadStatus === 'error' ? null : null;
}
