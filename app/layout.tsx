import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Serif display face for headings only. Body text and tables keep the sans stack.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const GITHUB_URL = "https://github.com/sathvik9105/bonafide_agent";
const ANAKIN_URL = "https://anakin.io";

export const metadata: Metadata = {
  title: "BonaFide",
  description: "Verifies academic conference and journal invitations against free registries.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-zinc-200">
          <nav className="mx-auto flex w-full max-w-[680px] items-center justify-between px-4 py-4">
            <Link href="/" className="font-serif text-xl tracking-tight text-zinc-900">
              BonaFide
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              GitHub
            </a>
          </nav>
        </header>
        {children}
        <footer className="px-4 py-10 text-center text-xs text-zinc-500">
          Built for the Anakin Forge hackathon ·{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
            GitHub
          </a>{" "}
          ·{" "}
          <a href={ANAKIN_URL} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
            Anakin
          </a>
        </footer>
      </body>
    </html>
  );
}
