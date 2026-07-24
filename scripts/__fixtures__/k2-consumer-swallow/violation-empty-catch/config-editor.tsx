// FOLLOW-625 NEGATIVE CONTROL — reinstates the exact `catch(() => {})` shape that
// shipped in FOLLOW-595→596→600. A failed GET is swallowed; a later Save would
// clobber real config with DEFAULTS. The guard MUST FAIL on this file.
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
      .catch(() => {});
  }, []);

  async function handleSave() {
    await fetch('/api/config', { method: 'PATCH', body: JSON.stringify(config) });
  }

  return config.name === '' ? null : null;
}
