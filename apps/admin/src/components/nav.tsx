import Link from "next/link";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/deals", label: "Deals" },
  { href: "/products", label: "Products" },
  { href: "/analytics", label: "Analytics" },
  { href: "/publications", label: "Publications" },
];

export function Nav() {
  return (
    <nav className="border-b border-neutral-800 bg-[#0e131a]">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <span className="font-semibold">das-promos admin</span>
        <div className="flex gap-4 text-sm text-neutral-400">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-neutral-100">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
