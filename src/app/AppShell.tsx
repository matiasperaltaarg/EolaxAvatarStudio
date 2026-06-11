import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { getBalanceSeconds, getAvatarCreditBalance } from "@/lib/credits";
import { isAdmin } from "@/lib/admin";
import Sidebar from "./Sidebar";

// Shared authenticated app shell: fixed left sidebar + main content area.
// Page content renders unchanged as {children}. The credits balance shown in
// the sidebar reuses the SAME source as the credits page (getBalanceSeconds).
export default async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let balanceSeconds = 0;
  let avatarCredits = 0;
  let admin = false;
  if (user) {
    try {
      const accountId = await getAccountId();
      [balanceSeconds, avatarCredits, admin] = await Promise.all([
        getBalanceSeconds(supabase, accountId),
        getAvatarCreditBalance(supabase, accountId),
        isAdmin(),
      ]);
    } catch {
      balanceSeconds = 0;
      avatarCredits = 0;
    }
  }

  return (
    <div className="layout">
      <Sidebar balanceSeconds={balanceSeconds} avatarCredits={avatarCredits} isAdmin={admin} email={user?.email ?? ""} />
      <div className="shell-main">{children}</div>
    </div>
  );
}
