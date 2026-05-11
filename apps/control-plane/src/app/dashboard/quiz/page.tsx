'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface QuizConfig {
  enabled: boolean;
  trigger_after_n_listings: number;
  sticky_widget: boolean;
  language: 'en' | 'pl';
  accent_color: string;
}

const DEFAULTS: QuizConfig = {
  enabled: false,
  trigger_after_n_listings: 3,
  sticky_widget: false,
  language: 'en',
  accent_color: '#2563EB',
};

export default function QuizSettingsPage() {
  const [config, setConfig] = useState<QuizConfig>(DEFAULTS);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    void fetch('/api/quiz/config')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          setConfig({ ...DEFAULTS, ...(data as Partial<QuizConfig>) });
        }
      })
      .catch(() => {
        // load silently — defaults already set
      });
  }, []);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/quiz/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setErrorMsg(body.error ?? 'Failed to save settings.');
        setStatus('error');
        return;
      }
      setStatus('saved');
      setTimeout(() => {
        setStatus('idle');
      }, 2500);
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Investor Quiz Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure the 2-question intent quiz widget embedded on your listings page.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-900">Enable Quiz Widget</label>
              <p className="text-xs text-gray-500">
                Show the investor intent quiz on your listings page
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setConfig((c) => ({ ...c, enabled: !c.enabled }));
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.enabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Trigger threshold */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Show quiz after N listing views
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.trigger_after_n_listings}
              onChange={(e) => {
                setConfig((c) => ({ ...c, trigger_after_n_listings: Number(e.target.value) }));
              }}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400">Range: 1–10 listing views</p>
          </div>

          {/* Sticky widget */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-900">Sticky Widget</label>
              <p className="text-xs text-gray-500">
                Keep the quiz button always visible (not just after N views)
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setConfig((c) => ({ ...c, sticky_widget: !c.sticky_widget }));
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.sticky_widget ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  config.sticky_widget ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Language */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Language</label>
            <select
              value={config.language}
              onChange={(e) => {
                setConfig((c) => ({ ...c, language: e.target.value as 'en' | 'pl' }));
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="en">English</option>
              <option value="pl">Polish</option>
            </select>
          </div>

          {/* Accent color */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Accent Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={config.accent_color}
                onChange={(e) => {
                  setConfig((c) => ({ ...c, accent_color: e.target.value }));
                }}
                className="h-9 w-16 cursor-pointer rounded border border-gray-300"
              />
              <span className="text-sm text-gray-500">{config.accent_color}</span>
            </div>
          </div>

          {/* Error */}
          {status === 'error' && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {status === 'loading' ? 'Saving…' : 'Save Settings'}
            </button>
            {status === 'saved' && (
              <span className="text-sm font-medium text-green-600">Settings saved!</span>
            )}
          </div>
        </form>
      </div>

      {/* Link to analytics */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Quiz Analytics</p>
            <p className="text-xs text-gray-500">
              View completion rates and archetype distribution
            </p>
          </div>
          <Link
            href="/dashboard/quiz/analytics"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            View Analytics →
          </Link>
        </div>
      </div>
    </div>
  );
}
