"use client";

import { useEffect, useRef, useState } from "react";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  customRole: string | null;
  customRoleLabel: string | null;
  isJunior: boolean;
  generation: number | null;
}

// Shape returned by /api/admin/users (fields this component reads; the
// snake_case variants are kept as fallbacks for older payload shapes).
type AdminUserRecord = {
  id: string;
  email?: string | null;
  fullName?: string | null;
  full_name?: string | null;
  role?: string | null;
  customRole?: string | null;
  custom_role?: string | null;
  isJunior?: boolean | null;
  is_junior?: boolean | null;
  generation?: string | number | null;
};

const roleOrder: { [key: string]: number } = {
  founder: 0,
  CEO: 1,
  COO: 1.5,
  "Chief Executive": 2,
  Executive: 3,
  executive: 3,
  "Junior Executive": 4,
};

const normalizeStandardRole = (role: string | null | undefined) => {
  const value = String(role ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "founder") return "founder";
  if (value === "ceo") return "CEO";
  if (value === "coo") return "COO";
  if (value === "chief executive") return "Chief Executive";
  if (value === "executive" || value === "exec" || value === "tutor") return "Executive";
  if (value === "junior executive" || value === "junior exec") return "Junior Executive";
  return null;
};

const formatCustomRoleLabel = (role: string | null | undefined) => {
  const value = String(role ?? "").trim();
  return value.length > 0 ? value : null;
};

const isCustomOnlyRole = (role: string | null | undefined) => {
  const label = formatCustomRoleLabel(role);
  return Boolean(label && !normalizeStandardRole(label));
};

const standardRoleLabels = new Set([
  "founder",
  "CEO",
  "COO",
  "Chief Executive",
  "Executive",
  "Junior Executive",
]);

export default function OurTeamMenu() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const backdropClickedRef = useRef(false);

  useEffect(() => {
    const fetchTeam = async () => {
      try {
        setIsLoading(true);
        const [usersResponse, coursesResponse] = await Promise.all([
          fetch("/api/admin/users?all=true"),
          fetch("/api/courses"),
        ]);

        if (!usersResponse.ok || !coursesResponse.ok) {
          throw new Error("Failed to fetch team members");
        }
        const data = (await usersResponse.json()) as { users?: AdminUserRecord[] };
        const coursesData = (await coursesResponse.json()) as { courses?: Array<{ created_by?: string | null }> };
        const activeCreatorIds = new Set(
          (coursesData.courses ?? [])
            .map((course) => course.created_by)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        );

        const users = (data.users ?? [])
          .map((u) => {
            const rawCustomRoleLabel = formatCustomRoleLabel(u.customRole ?? u.custom_role ?? null);
            const customRoleLabel = isCustomOnlyRole(rawCustomRoleLabel) ? rawCustomRoleLabel : null;
            const customRole = normalizeStandardRole(rawCustomRoleLabel);
            const role = normalizeStandardRole(u.role) ?? null;
            return {
              id: u.id,
              name: String(u.fullName ?? u.full_name ?? u.email ?? "").trim() || "Team member",
              email: String(u.email ?? ""),
              role: role ?? "student",
              customRole,
              customRoleLabel,
              isJunior: Boolean(u.isJunior ?? u.is_junior),
              generation: typeof u.generation === "string" && u.generation.trim()
                ? Number.parseInt(u.generation, 10)
                : typeof u.generation === "number"
                  ? u.generation
                  : null,
            };
          })
          .filter((u: TeamMember & { id: string }) => {
            const effectiveRole = u.customRole ?? u.role;
            if (u.isJunior) {
              return activeCreatorIds.has(u.id);
            }
            return Boolean(effectiveRole && effectiveRole !== "student");
          })
          .sort((a: TeamMember, b: TeamMember) => {
            const aRoleOrder = roleOrder[a.customRole ?? a.role] ?? 999;
            const bRoleOrder = roleOrder[b.customRole ?? b.role] ?? 999;
            if (aRoleOrder !== bRoleOrder) {
              return aRoleOrder - bRoleOrder;
            }
            if ((a.generation ?? 999) !== (b.generation ?? 999)) {
              return (a.generation ?? 999) - (b.generation ?? 999);
            }
            return a.name.localeCompare(b.name);
          });

        setTeamMembers(users);
      } catch (error) {
        console.error("Failed to fetch team members:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTeam();
  }, []);

  useEffect(() => {
    if (!selectedImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedImage(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedImage]);

  const groupedMembers = {
    founder: teamMembers.filter((m) => !m.customRoleLabel && (m.customRole ?? m.role) === "founder"),
    ceo: teamMembers.filter((m) => !m.customRoleLabel && (m.customRole ?? m.role) === "CEO"),
    coo: teamMembers.filter((m) => !m.customRoleLabel && (m.customRole ?? m.role) === "COO"),
    chief_executive: teamMembers.filter((m) => !m.customRoleLabel && (m.customRole ?? m.role) === "Chief Executive"),
    executive: teamMembers.filter((m) => !m.customRoleLabel && (m.customRole ?? m.role) === "Executive"),
    junior_executive: teamMembers.filter((m) => !m.customRoleLabel && (m.customRole ?? m.role) === "Junior Executive"),
  };

  const customRoleGroups = Array.from(
    new Map(
      teamMembers
        .filter((member) => member.customRoleLabel && !standardRoleLabels.has(member.customRoleLabel))
        .map((member) => [member.customRoleLabel as string, teamMembers.filter((candidate) => candidate.customRoleLabel === member.customRoleLabel)])
    )
  ).sort(([a], [b]) => a.localeCompare(b));

  const roleLabels: { [key: string]: string } = {
    founder: "Founders",
    ceo: "CEO",
    coo: "COO",
    chief_executive: "Chief Executives",
    executive: "Executives",
    junior_executive: "Junior Executives",
  };

  const images = [
    "IMG_0009.jpeg",
    "IMG_0018.jpeg",
    "IMG_0040.JPG",
    "IMG_0047.JPG",
  ];

  if (isLoading) {
    return <div className="py-8 text-center text-[var(--muted)]">Loading team...</div>;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      {/* Mission Section */}
      <section className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Our Mission</h2>
        <div className="space-y-2 text-sm text-[var(--foreground)]">
          <p>
            YanLearn is a platform built by high school students, for students. We bring together talented high schoolers across the Toronto area and give them a stage to share their academic strengths — providing high-quality extracurricular tutoring and mentorship to younger students in grades 6-12.
          </p>
          <p className="font-semibold">Students Helping Students</p>
          <p>
            We believe every student who needs academic support should be able to access it without financial pressure. On our platform, students help students — and together, they give back to the community. All proceeds are donated to SickKids Hospital through our &quot;Coding for SickKids&quot; fundraising campaign, turning academic value into tangible support for sick kids&apos; healthcare in our community.
          </p>
        </div>
      </section>

      {/* Team Section */}
      <section className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Our Team</h2>
        <div className="space-y-2">
          <div className="flex items-start gap-6 flex-wrap lg:flex-nowrap">
            {groupedMembers.founder.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">{roleLabels.founder}</h3>
                <div className="flex flex-wrap gap-2">
                  {groupedMembers.founder.map((member) => (
                    <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                      <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-8 flex-wrap lg:flex-nowrap">
            {groupedMembers.ceo.length > 0 && (
              <div className="flex-shrink-0">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)] mb-0">{roleLabels.ceo}</h3>
                <div className="flex gap-2 flex-wrap items-center">
                  {groupedMembers.ceo.map((member) => (
                    <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                      <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {groupedMembers.coo.length > 0 && (
              <div className="flex-shrink-0">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)] mb-0">{roleLabels.coo}</h3>
                <div className="flex gap-2 flex-wrap items-center">
                  {groupedMembers.coo.map((member) => (
                    <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                      <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {customRoleGroups.length > 0 && (
            <div className="flex-shrink-0 space-y-3">
              {customRoleGroups.map(([roleName, members]) => (
                <div key={roleName} className="space-y-1">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)] mb-0">{roleName}</h3>
                  <div className="flex gap-2 flex-wrap items-center">
                    {members.map((member) => (
                      <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                        <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {groupedMembers.chief_executive.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">{roleLabels.chief_executive}</h3>
              <div className="flex flex-wrap gap-2">
                {groupedMembers.chief_executive.map((member) => (
                  <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                    <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.executive.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">{roleLabels.executive}</h3>
              <div className="flex flex-wrap gap-2">
                {groupedMembers.executive.map((member) => (
                  <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                    <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.junior_executive.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">{roleLabels.junior_executive}</h3>
              <div className="flex flex-wrap gap-2">
                {groupedMembers.junior_executive.map((member) => (
                  <div key={member.id} className="group inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--background-tertiary)] hover:shadow-md">
                    <p className="whitespace-nowrap text-sm font-medium text-[var(--foreground)]">{member.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Images Gallery: grouped by event/date */}
      <section className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">May 4th, 2026: SickKids Foundation Hospital</h2>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 md:grid-cols-4">
          {images.map((image, idx) => (
            <div
              key={idx}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedImage(image)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedImage(image);
              }}
              className="group cursor-zoom-in overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="relative">
                <img
                  src={`/images/thumbs/${image}`}
                  alt={`SickKids moment ${idx + 1}`}
                  loading="lazy"
                  decoding="async"
                  className="h-40 w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] group-hover:brightness-95"
                />
                <div className="pointer-events-none absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <span className="m-2 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-black shadow-sm">
                    Click to enlarge
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {selectedImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                backdropClickedRef.current = true;
              } else {
                backdropClickedRef.current = false;
              }
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && backdropClickedRef.current) {
                setSelectedImage(null);
              }
              backdropClickedRef.current = false;
            }}
          >
            <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
              <button
                aria-label="Close"
                onClick={() => setSelectedImage(null)}
                className="absolute -right-2 -top-2 z-60 rounded-full bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black"
              >
                ✕
              </button>
              <img
                src={`/images/${selectedImage}`}
                alt="Enlarged team moment"
                className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
              />
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
