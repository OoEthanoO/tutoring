import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginPageClient from "@/components/LoginPageClient";
import { getSessionUser } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getMaintenanceMode } from "@/lib/siteSettings";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const user = await getSessionUser(token);
  const maintenanceEnabled = await getMaintenanceMode();

  if (user) {
    const role = resolveUserRole(user.email, user.role ?? null);
    
    if (maintenanceEnabled && !isFounder(role)) {
      // Do not redirect to "/", they are stuck in maintenance mode.
      // Let them see the login page so they can sign in as a founder.
    } else {
      redirect("/");
    }
  }

  return <LoginPageClient maintenanceEnabled={maintenanceEnabled} />;
}
