import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, COOKIE_NAME } from "../lib/auth";
import Board from "./board";

export const dynamic = "force-dynamic";

/**
 * THE PAGE ENFORCES THE SESSION ITSELF. It used to read the session only to
 * put a name in the corner, and fall back to "Office" when there wasn't one —
 * the actual gate lived in middleware. Middleware now checks only that a
 * cookie is present, because it runs on the Edge runtime where it cannot do
 * the arithmetic to tell a real cookie from a forged one (see the note there).
 * So the verification happens here, where it can: an unsigned or expired or
 * tampered-with token lands on the login screen rather than on the board.
 */
export default async function Page() {
  const session = readSession((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  return <Board who={session.name} />;
}
