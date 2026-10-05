/**
 * /dashboard/pilot — retired by FOLLOW-1289 (WP-2.4). The pilot view is now the "Pilot" tab of
 * /dashboard/analytics; this route only forwards bookmarks and links there.
 *
 * @module apps/control-plane/src/app/dashboard/pilot/page
 */

import { redirect } from 'next/navigation';

export default function PilotRedirectPage(): never {
  redirect('/dashboard/analytics?tab=pilot');
}
