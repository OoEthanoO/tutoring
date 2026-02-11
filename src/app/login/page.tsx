import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginPageClient from "@/components/LoginPageClient";
import { getSessionUser } from "@/lib/authServer";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const user = await getSessionUser(token);

  if (user) {
    redirect("/");
  }

  return <LoginPageClient />;
}
