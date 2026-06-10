import { redirect } from "next/navigation";

// Home redirects to the avatars list (the app's main surface in Phase 1).
export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/avatars");
}
