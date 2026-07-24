// FOLLOW-625 NEGATIVE CONTROL — log-only catch body `.catch((e) => console.error(e))`
// (Rule AE covered shape: a console.* log is not an observable error state). MUST FAIL.
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
      .catch((e) => {
        console.error('load failed', e);
      });
  }, []);

  return config.name === '' ? null : null;
}
