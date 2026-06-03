import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panel Haus / Curator",
  description: "Curator dashboard for the Panel Haus venue.",
};

async function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="text-gold-light text-xs uppercase tracking-widest font-bold hover:underline"
      >
        sign out
      </button>
    </form>
  );
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-cream text-ink">
        {session?.user && (
          <>
            <header className="bg-ink text-cream px-7 py-3 flex items-center justify-between border-b-[3px] border-gold">
              <div className="font-black text-lg tracking-widest uppercase">
                PANEL HAUS <span className="text-gold mx-1">/</span>CURATOR
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-cream-dark/70">{session.user.email}</span>
                <SignOutButton />
              </div>
            </header>
            <nav className="bg-cream-dark px-7 flex gap-1 border-b-[3px] border-ink">
              <NavLink href="/">Anchors</NavLink>
              <NavLink href="/map">Map</NavLink>
              <NavLink href="/pieces">Pieces</NavLink>
              <NavLink href="/books">Books</NavLink>
              <NavLink href="/music">Music</NavLink>
              <NavLink href="/vault">Vault</NavLink>
              <NavLink href="/import">Import</NavLink>
              <NavLink href="/admin/submissions">Submissions</NavLink>
              <NavLink href="/admin/blob-orphans">Orphans</NavLink>
            </nav>
          </>
        )}
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-5 py-3 text-sm font-bold uppercase tracking-widest border-b-4 border-transparent hover:bg-black/5 -mb-[3px]"
    >
      {children}
    </Link>
  );
}
