import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAutoPlace, setAutoPlace } from "@/lib/submissions";

// Curator-only read/write of the submission auto-placement toggle. The submit
// route reads the same flag via lib/submissions directly (not over HTTP); this
// route backs the dashboard switch on /admin/submissions.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ auto: await getAutoPlace() });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const auto = (body as { auto?: unknown } | null)?.auto === true;
  await setAutoPlace(auto);
  return NextResponse.json({ auto });
}
