import type { Metadata } from 'next';
import type React from 'react';

export const metadata: Metadata = {
  title: 'Estalara Control Plane',
  description: 'Estalara adaptive listings management dashboard',
};

/**
 * Root layout for the Estalara control plane.
 * Full implementation in TICKET-009 (backend-engineer).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
