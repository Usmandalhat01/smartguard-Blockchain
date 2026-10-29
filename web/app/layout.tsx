import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'SmartGuard — Blockchain-Enhanced AI-Powered Escrow',
    template: '%s · SmartGuard',
  },
  description:
    'A prototype escrow transaction system in which a machine-learning risk score gates blockchain-enforced fund custody through an oracle-mediated four-layer architecture.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8FC' },
    { media: '(prefers-color-scheme: dark)', color: '#080B14' },
  ],
};

/**
 * Applies the stored theme before first paint. Without this the page renders
 * light and then flips, which reads as a defect during a live demonstration.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('smartguard.theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The font variables must sit on the root element: globals.css composes
    // --font-sans and --font-head on :root, and a custom property whose value
    // references an undefined variable computes to nothing and is inherited
    // that way. Declaring them on <body> would leave every :root token empty.
    <html
      lang="en-GB"
      className={`${inter.variable} ${jakarta.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/*
        Browser extensions write to <body> before React hydrates — Grammarly
        adds data-new-gr-c-s-check-loaded and data-gr-ext-installed, password
        managers add their own — and React reports the difference as a
        hydration mismatch in a tree it did not render.

        suppressHydrationWarning applies to this element only, not to its
        descendants, so it silences the attributes an extension injects here
        without hiding a genuine mismatch anywhere inside the application.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
