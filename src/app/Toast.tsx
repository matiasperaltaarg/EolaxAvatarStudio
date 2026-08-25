"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Props = {
  ok?: string;
  error?: string;
};

// Fixed, auto-dismissing toast so feedback is visible regardless of scroll
// position (the edit form sits well below the top of the page). Clears the
// ok/error query params so the toast doesn't reappear on refresh.
export default function Toast({ ok, error }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const message = error ?? ok ?? null;
  const kind = error ? "error" : "ok";
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    // Strip the query param so a manual refresh won't replay the toast.
    router.replace(pathname);
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [message, pathname, router]);

  if (!message || !visible) return null;

  return (
    <div className={`toast toast-${kind}`} role="status" onClick={() => setVisible(false)}>
      {message}
    </div>
  );
}
