import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { guideFile } from "@/lib/sources";

const GUIDE_DIR = path.join(process.cwd(), "guides");

/** Letters and digits only: the guide names carry an en dash and "+" that can
 *  be re-encoded between Windows, the upload, and the Linux image. */
const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Resolve the guide on disk. The image stores them as ASCII "<code>.pdf" (see
 * Dockerfile); local dev has the original names, matched exactly or by an
 * encoding-proof key.
 */
async function resolveGuide(code: string, file: string): Promise<string | null> {
  const names = await fs.readdir(GUIDE_DIR).catch(() => [] as string[]);
  const hit =
    names.find((n) => n === `${code}.pdf`) ??
    names.find((n) => n === file) ??
    names.find((n) => key(n) === key(file));
  return hit ? path.join(GUIDE_DIR, hit) : null;
}

/**
 * Serves an exam guide PDF to signed-in users only. The guides are distributed
 * through the Anthropic Partner Academy, so they never go in public/. proxy.ts
 * already redirects anonymous requests; this check is the second lock.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/guide/[code]">) {
  const { code } = await ctx.params;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const file = guideFile(code);
  if (!file) return new Response("Not found", { status: 404 });

  const onDisk = await resolveGuide(code, file);
  if (!onDisk) {
    console.error(`[guide] ${code}: "${file}" not found in ${GUIDE_DIR}`);
    return new Response("Guide unavailable", { status: 404 });
  }

  const pdf = await fs.readFile(onDisk);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${code}-exam-guide.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
