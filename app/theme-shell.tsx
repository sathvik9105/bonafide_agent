'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

/** Nav, footer and the light/dark theme. The theme lives in React state only (no localStorage here). */
export function ThemeShell({
  children,
  githubUrl,
  anakinUrl,
}: {
  children: ReactNode;
  githubUrl: string;
  anakinUrl: string;
}) {
  const [theme, setTheme] = useState<Theme>('light');
  const next: Theme = theme === 'light' ? 'dark' : 'light';

  useEffect(() => {
    // Mirror onto <html> so the page background and native controls follow the theme too.
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div data-theme={theme} className="flex min-h-screen flex-1 flex-col bg-canvas text-ink">
      <header className="border-b border-line">
        <nav className="mx-auto flex w-full max-w-[1080px] items-center justify-between px-4 py-4">
          <Link href="/" className="font-serif text-xl tracking-tight text-ink">
            BonaFide
          </Link>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setTheme(next)}
              aria-label={`Switch to ${next} theme`}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              {theme === 'light' ? '☾ Dark' : '☀ Light'}
            </button>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:text-accent-hover"
            >
              GitHub
            </a>
          </div>
        </nav>
      </header>
      {children}
      <footer className="px-4 py-10 text-center text-xs text-ink-subtle">
        Built for the Anakin Forge hackathon ·{' '}
        <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          GitHub
        </a>{' '}
        ·{' '}
        <a href={anakinUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          Anakin
        </a>
      </footer>
    </div>
  );
}
