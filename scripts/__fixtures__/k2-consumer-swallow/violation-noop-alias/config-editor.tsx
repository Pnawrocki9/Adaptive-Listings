// FOLLOW-625 NEGATIVE CONTROL — named no-op alias `.catch(noop)` (Rule AE covered
// shape). Guard MUST FAIL.
'use client';

import { useEffect, useState } from 'react';

const DEFAULTS = { name: '' };

function noop(): void {}

export function ConfigEditor() {
  const [config, setConfig] = useState(DEFAULTS);

  useEffect(() => {
    void fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        setConfig({ ...DEFAULTS, ...(d as object) });
      })
      .catch(noop);
  }, []);

  return config.name === '' ? null : null;
}
