import type { SubmissionT } from "@/lib/submissions";
import DeleteSubmissionButton from "./delete-submission-button";

// Presentational, server-rendered. The gallery is PUBLIC (allowlisted in
// proxy.ts); `canDelete` is true only when a curator is signed in, gating the
// per-row delete action. Lists Creator Quest Q5 comic submissions.

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatWhen(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso || "—";
}

export default function SubmissionsView({
  submissions,
  canDelete,
}: {
  submissions: SubmissionT[];
  canDelete: boolean;
}) {
  return (
    <div className="px-7 py-6">
      <div className="flex items-baseline gap-3">
        <h1 className="font-black text-2xl uppercase tracking-widest">
          Submissions
        </h1>
        <span className="text-sm text-muted">
          {submissions.length} comic{submissions.length === 1 ? "" : "s"} ·
          Creator Quest Q5
        </span>
      </div>

      {submissions.length === 0 ? (
        <p className="mt-6 text-muted">No submissions yet.</p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
              <th className="py-2 pr-4">Comic</th>
              <th className="py-2 pr-4">DCL name</th>
              <th className="py-2 pr-4">Wallet</th>
              <th className="py-2 pr-4">Submitted</th>
              {canDelete && <th className="py-2 pr-4">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.wallet} className="border-t-2 border-ink/15 align-top">
                <td className="py-3 pr-4">
                  {s.comicUrl ? (
                    <a
                      href={s.comicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.comicUrl}
                        alt={`comic by ${s.dclName || s.wallet}`}
                        className="h-20 w-20 border-[3px] border-ink object-cover"
                      />
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="py-3 pr-4 font-bold">{s.dclName || "—"}</td>
                <td className="py-3 pr-4 font-mono text-xs">
                  <a
                    href={`https://polygonscan.com/address/${s.wallet}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                    title={s.wallet}
                  >
                    {shortenAddress(s.wallet)}
                  </a>
                </td>
                <td className="py-3 pr-4 text-muted">{formatWhen(s.at)}</td>
                {canDelete && (
                  <td className="py-3 pr-4">
                    <DeleteSubmissionButton
                      wallet={s.wallet}
                      dclName={s.dclName}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
