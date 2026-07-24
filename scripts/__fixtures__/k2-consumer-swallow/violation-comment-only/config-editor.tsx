// FOLLOW-625 NEGATIVE CONTROL — comment-only catch body (the FOLLOW-630
// dashboard/quiz shape: `.catch(() => { /* load silently */ })`). Guard MUST FAIL.
'use client';

import { useEffect, useState } from 'react';

const DEFAULTS = { name: '' };

export function ConfigEditor() {
  const [config, setConfig] = useState(DEFAULTS);

  useEffect(() => {
    void fetch('/api/quiz/config')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP');
        return r.json();
      })
      .then((d) => {
        setConfig({ ...DEFAULTS, ...(d as object) });
      })
      .catch(() => {
        // load silently — defaults already set
      });
  }, []);

  return config.name === '' ? null : null;
}
