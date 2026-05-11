'use client';

import { useState } from 'react';

interface FormState {
  agency_name: string;
  website_url: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string;
  listings_volume: '' | '<100' | '100-1000' | '1000+';
  referral_source: string;
}

const INITIAL: FormState = {
  agency_name: '',
  website_url: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  country: '',
  listings_volume: '',
  referral_source: '',
};

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');

    const payload: Record<string, string> = {
      agency_name: form.agency_name,
      website_url: form.website_url,
      contact_name: form.contact_name,
      contact_email: form.contact_email,
      country: form.country,
    };
    if (form.contact_phone) payload.contact_phone = form.contact_phone;
    if (form.listings_volume) payload.listings_volume = form.listings_volume;
    if (form.referral_source) payload.referral_source = form.referral_source;

    try {
      const res = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { registration_id?: string; error?: string };

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Registration failed. Please try again.');
        setStatus('error');
        return;
      }

      setRegistrationId(data.registration_id ?? null);
      setStatus('success');
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <span className="text-2xl">✓</span>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Registration received!</h1>
          <p className="mb-4 text-gray-600">
            We will review your application within 2 business days and reach out to{' '}
            <strong>{form.contact_email}</strong>.
          </p>
          {registrationId && (
            <p className="text-xs text-gray-400">Reference ID: {registrationId}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Join Estalara Adaptive Listings</h1>
          <p className="mt-2 text-sm text-gray-500">
            Request access to the AI-powered personalization platform for real estate agencies.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
            {/* Agency Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Agency Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="agency_name"
                value={form.agency_name}
                onChange={handleChange}
                required
                minLength={2}
                maxLength={100}
                placeholder="Acme Real Estate"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Website URL */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Website URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                name="website_url"
                value={form.website_url}
                onChange={handleChange}
                required
                placeholder="https://acmerealestate.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Contact Name + Email */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Contact Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="contact_name"
                  value={form.contact_name}
                  onChange={handleChange}
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  name="contact_phone"
                  value={form.contact_phone}
                  onChange={handleChange}
                  placeholder="+1 555 000 0000"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                name="contact_email"
                value={form.contact_email}
                onChange={handleChange}
                required
                placeholder="jane@acmerealestate.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Country */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Country <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="country"
                value={form.country}
                onChange={handleChange}
                required
                minLength={2}
                maxLength={100}
                placeholder="Spain"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Listings Volume */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                How many listings do you have?
              </label>
              <select
                name="listings_volume"
                value={form.listings_volume}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select range (optional)</option>
                <option value="<100">Under 100</option>
                <option value="100-1000">100 – 1,000</option>
                <option value="1000+">Over 1,000</option>
              </select>
            </div>

            {/* Referral source */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                How did you hear about us?
              </label>
              <input
                type="text"
                name="referral_source"
                value={form.referral_source}
                onChange={handleChange}
                placeholder="Conference, colleague, search engine…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Error message */}
            {status === 'error' && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'loading' ? 'Submitting…' : 'Request Access'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
