/**
 * Root route — permanently redirects to /sign-in.
 *
 * The marketing landing page has been replaced by the admin sign-in page.
 * GET / returns HTTP 308 Permanent Redirect to /sign-in.
 *
 * AC4: GET / → 308 → /sign-in.
 *
 * @module apps/control-plane/src/app/page
 */

import { permanentRedirect } from 'next/navigation';

export default function RootPage() {
  permanentRedirect('/sign-in');
}
