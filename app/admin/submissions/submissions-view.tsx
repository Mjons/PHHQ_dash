import { submissionPieceId, type SubmissionT } from "@/lib/submissions";
import DeleteSubmissionButton from "./delete-submission-button";
import AddToPiecesButton from "./add-to-pieces-button";
import PlaceOnWallButton from "./place-on-wall-button";
import AutoModeToggle from "./automode-toggle";

// Presentational, server-rendered. The gallery is PUBLIC (allowlisted in
// proxy.ts); `isCurator` is true only when a curator is signed in, gating the
// per-row actions (add-to-pieces, delete). `existingPieceIds` lets each row
// show whether its submission is already promoted into the pieces collection.
// Lists Creator Quest Q5 comic submissions.

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatWhen(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso || "—";
}

export default function SubmissionsView({
  submissions,
  isCurator,
  existingPieceIds,
  placedPieceIds,
  autoPlace,
}: {
  submissions: SubmissionT[];
  isCurator: boolean;
  existingPieceIds: string[];
  placedPieceIds: string[];
  autoPlace: boolean;
}) {
  const pieceIdSet = new Set(existingPieceIds);
  const placedSet = new Set(placedPieceIds);
  return (
    <div className="px-7 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-black text-2xl uppercase tracking-widest">
          Submissions
        </h1>
        <span className="text-sm text-muted">
          {submissions.length} comic{submissions.length === 1 ? "" : "s"} ·
          Creator Quest Q5
        </span>
        {isCurator && (
          <div className="ml-auto">
            <AutoModeToggle initial={autoPlace} />
          </div>
        )}
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
              {isCurator && <th className="py-2 pr-4">Actions</th>}
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
                {isCurator && (
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.comicUrl && (
                        <PlaceOnWallButton
                          wallet={s.wallet}
                          placed={placedSet.has(submissionPieceId(s.wallet))}
                        />
                      )}
                      {s.comicUrl && (
                        <AddToPiecesButton
                          pieceId={submissionPieceId(s.wallet)}
                          wallet={s.wallet}
                          dclName={s.dclName}
                          comicUrl={s.comicUrl}
                          added={pieceIdSet.has(submissionPieceId(s.wallet))}
                        />
                      )}
                      <DeleteSubmissionButton
                        wallet={s.wallet}
                        dclName={s.dclName}
                      />
                    </div>
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
