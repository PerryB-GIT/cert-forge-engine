import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  // Only same-origin paths: `new URL("https://evil.com", origin)` or "//evil.com"
  // would otherwise turn this into an open redirect after a valid sign-in.
  const rawNext = url.searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/";

  const supabase = await supabaseServer();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(safe(next, url.origin));
  }
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(safe(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}

/** Resolve `next` and refuse anything that lands on another origin. */
function safe(next: string, origin: string): URL {
  const target = new URL(next, origin);
  return target.origin === origin ? target : new URL("/", origin);
}
