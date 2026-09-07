import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";

interface PublicationRow {
  id: string;
  channel: string;
  status: string;
  publishedAt: string | null;
  externalPublicationId: string | null;
  errorMessage: string | null;
  dealCandidateId: string;
  productName: string;
  marketplace: string;
  dealScore: number;
}

export default async function PublicationsPage() {
  await requireAdmin();
  const { publications } = await apiFetchServer<{ publications: PublicationRow[] }>(
    "/admin/publications",
  );

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Publications ({publications.length})</h1>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-800 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Published at</th>
                <th className="px-4 py-3">External id</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((pub) => (
                <tr key={pub.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                  <td className="px-4 py-3">
                    <a
                      href={`/deals/${pub.dealCandidateId}`}
                      className="text-blue-400 hover:underline"
                    >
                      {pub.productName}
                    </a>
                    <span className="ml-2 text-xs text-neutral-500">{pub.marketplace}</span>
                  </td>
                  <td className="px-4 py-3">{pub.channel}</td>
                  <td className="px-4 py-3">{pub.dealScore.toFixed(0)}</td>
                  <td className="px-4 py-3">
                    <Badge status={pub.status}>{pub.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {pub.publishedAt ? new Date(pub.publishedAt).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{pub.externalPublicationId ?? "—"}</td>
                </tr>
              ))}
              {publications.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    Nothing published yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
