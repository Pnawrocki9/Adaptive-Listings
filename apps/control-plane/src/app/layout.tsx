import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import type React from 'react';

import { Toaster } from '@/components/ui/toaster';

import './globals.css';

/**
 * Root metadata for the Estalara control plane dashboard.
 * OG tags support social sharing and unfurl previews.
 */
export const metadata: Metadata = {
  title: 'Estalara — Adaptive Listings',
  description:
    'AI-powered personalization for real estate websites. Boost conversion. Embed in 60 seconds.',
  openGraph: {
    type: 'website',
    title: 'Estalara — Adaptive Listings',
    description:
      'AI-powered personalization for real estate websites. Boost conversion. Embed in 60 seconds.',
    siteName: 'Estalara',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Estalara — Adaptive Listings',
    description: 'AI-powered personalization for real estate websites.',
  },
};

/**
 * Root layout for the Estalara control plane.
 *
 * Wraps all pages with:
 * - System font stack via Tailwind font-sans (no external font download)
 * - next-themes ThemeProvider for dark/light/system theme support
 * - Global Toaster for notifications
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
