"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import BrandMark from "./BrandMark";
import { signOut } from "./login/actions";

type Props = { balanceSeconds: number; avatarCredits: number; isAdmin: boolean; email: string };

const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/studio", label: "Estudio", icon: <IconStudio /> },
  { href: "/gallery", label: "Galería", icon: <IconGallery /> },
  { href: "/credits", label: "Créditos", icon: <IconCredits /> },
  { href: "/avatars", label: "Avatares", icon: <IconAvatars /> },
];

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
}

export default function Sidebar({ balanceSeconds, avatarCredits, isAdmin: admin, email }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // Decorative fill: balance against the largest pack (Scale = 3600s).
  const fill = Math.min(100, Math.round((balanceSeconds / 3600) * 100));
  const initial = (email[0] ?? "E").toUpperCase();

  return (
    <>
      <div className="mobile-topbar">
        <BrandMark size="sm" />
        <button className="hamburger secondary" type="button" onClick={() => setOpen(true)}>
          ☰ Menú
        </button>
      </div>

      {open ? <button className="sidebar-overlay" type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)} /> : null}

      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-brand">
          <BrandMark />
        </div>

        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`nav-item${isActive(n.href) ? " active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {n.icon}
              <span>{n.label}</span>
            </Link>
          ))}
          {admin ? (
            <Link
              href="/admin"
              className={`nav-item${isActive("/admin") ? " active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <IconAdmin />
              <span>Admin</span>
            </Link>
          ) : null}
        </nav>

        <div className="sidebar-foot">
          <Link href="/credits" className="credits-card" onClick={() => setOpen(false)}>
            <div className="lbl">Tiempo de video</div>
            <div className="big">
              {mmss(balanceSeconds)} <span>({balanceSeconds}s)</span>
            </div>
            <div className="cbar">
              <i style={{ width: `${fill}%` }} />
            </div>
            <div className="lbl" style={{ marginTop: 8 }}>Créditos de avatar</div>
            <div className="big">
              {avatarCredits} <span>{avatarCredits === 1 ? "avatar" : "avatares"}</span>
            </div>
          </Link>

          {email ? (
            <div className="user-chip">
              <span className="user-av">{initial}</span>
              <span className="user-nm">{email}</span>
            </div>
          ) : null}

          <form action={signOut}>
            <button className="nav-item nav-signout" type="submit">
              <IconSignOut />
              <span>Salir</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

/* ---- minimal line icons (match the mockup's style) ---- */
function IconStudio() {
  return (
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" /></svg>
  );
}
function IconGallery() {
  return (
    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
  );
}
function IconCredits() {
  return (
    <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /></svg>
  );
}
function IconAvatars() {
  return (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
  );
}
function IconAdmin() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /><path d="M8 11V7a4 4 0 118 0v4" /></svg>
  );
}
function IconSignOut() {
  return (
    <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
  );
}
