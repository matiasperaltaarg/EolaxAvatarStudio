"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Props = { ok?: string; error?: string };

export default function AdminToast({ ok, error }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const message = error ?? ok ?? null;
  const kind = error ? "error" : "ok";
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    if (!message) return;
    setVisible(true);
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
