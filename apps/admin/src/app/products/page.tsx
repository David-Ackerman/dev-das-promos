import { Nav } from "@/components/nav";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  categoryName: string | null;
}

export default async function ProductsPage() {
  await requireAdmin();
  const { products } = await apiFetchServer<{ products: ProductRow[] }>("/admin/products");

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Products ({products.length})</h1>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-800 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Category</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-neutral-900 hover:bg-neutral-900/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/products/${product.id}`}
                      className="text-blue-400 hover:underline"
                    >
                      {product.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-400">{product.brand ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{product.categoryName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
