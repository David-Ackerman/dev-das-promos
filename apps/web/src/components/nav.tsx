import Link from "next/link";

export function Nav() {
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold">
          das promos
        </Link>
        <nav className="flex gap-4 text-sm text-neutral-600">
          <Link href="/deals" className="hover:text-neutral-950">
            Todas as ofertas
          </Link>
        </nav>
      </div>
    </header>
  );
}
