import { NextResponse } from "next/server";
import { COOKIE_NAME } from "../../../lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/office", maxAge: 0 });
  return res;
}
