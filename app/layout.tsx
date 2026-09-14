import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeShell } from "./theme-shell";

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
      <body className="min-h-full flex flex-col">
        <ThemeShell githubUrl={GITHUB_URL} anakinUrl={ANAKIN_URL}>
          {children}
        </ThemeShell>
      </body>
    </html>
  );
}
