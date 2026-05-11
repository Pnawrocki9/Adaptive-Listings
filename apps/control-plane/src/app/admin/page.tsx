import { permanentRedirect } from 'next/navigation';

export default function AdminIndexPage() {
  permanentRedirect('/admin/registrations');
}
