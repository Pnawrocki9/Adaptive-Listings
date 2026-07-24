// FOLLOW-625 NEGATIVE CONTROL — `.catch(() => undefined)` (Rule AE covered shape).
// Guard MUST FAIL.
'use client';

import { useEffect, useState } from 'react';

const DEFAULTS = { name: '' };

export function ConfigEditor() {
  const [config, setConfig] = useState(DEFAULTS);

  useEffect(() => {
    void fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        setConfig({ ...DEFAULTS, ...(d as object) });
      })
      .catch(() => undefined);
  }, []);

  return config.name === '' ? null : null;
}
