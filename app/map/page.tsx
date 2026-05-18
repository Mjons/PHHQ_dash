export const metadata = { title: "Map — Panel Haus / Curator" };

export default function MapPage() {
  return (
    <div className="max-w-6xl mx-auto px-7 py-8">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-7">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">Map</h1>
          <p className="text-muted text-sm mt-1">
            Top-down floor map with anchor placement.
          </p>
        </div>
      </div>

      <div className="border-[3px] border-ink bg-cream p-12 shadow-[4px_4px_0_var(--color-ink)] text-center">
        <p className="font-black uppercase tracking-widest text-xl mb-3">
          Coming next
        </p>
        <p className="text-muted text-sm max-w-xl mx-auto">
          The full map view (180°-rotated, floor selector, click-to-place anchor
          flow) is the next thing to port over from the HTML mockup in the scene
          repo. The Anchors list and Import flow above are usable today — the
          Map view is purely a visual editor for things you can already do on
          Anchors.
        </p>
        <p className="text-muted text-xs mt-4">
          See{" "}
          <code className="font-mono bg-cream-dark px-1.5 py-0.5 border border-muted">
            dashboard-mockup.html
          </code>{" "}
          in the scene repo for the target design.
        </p>
      </div>
    </div>
  );
}
