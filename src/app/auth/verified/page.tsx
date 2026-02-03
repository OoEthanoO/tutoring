import Link from "next/link";

type VerifiedPageProps = {
  searchParams?: { status?: string };
};

export default function VerifiedPage({ searchParams }: VerifiedPageProps) {
  const status = searchParams?.status ?? "verified";
  const isVerified = status === "verified";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {isVerified ? "Email verified" : "Email verification"}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {isVerified
            ? "Thanks! Your email address is confirmed and your account is ready."
            : "Your email verification is complete."}
        </p>
        <div className="flex justify-center">
          <Link
            href="/login"
            className="rounded-full border border-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--foreground)] hover:text-white"
          >
            Continue to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
