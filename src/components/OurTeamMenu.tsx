"use client";

import { useEffect, useState } from "react";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  customRole: string | null;
  isJunior: boolean;
  generation: number | null;
}

const roleOrder: { [key: string]: number } = {
  founder: 0,
  CEO: 1,
  COO: 2,
  "Chief Executive": 3,
  Executive: 4,
  executive: 4,
  "Junior Executive": 5,
};

const normalizeRole = (role: string | null | undefined) => {
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

export default function OurTeamMenu() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
        const data = (await usersResponse.json()) as { users?: any[] };
        const coursesData = (await coursesResponse.json()) as { courses?: Array<{ created_by?: string | null }> };
        const activeCreatorIds = new Set(
          (coursesData.courses ?? [])
            .map((course) => course.created_by)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        );

        const users = (data.users ?? [])
          .map((u: any) => {
            const customRole = normalizeRole(u.customRole ?? u.custom_role ?? null);
            const role = normalizeRole(u.role) ?? null;
            return {
              id: u.id,
              name: String(u.fullName ?? u.full_name ?? u.email ?? "").trim() || "Team member",
              email: String(u.email ?? ""),
              role: role ?? "student",
              customRole,
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

  const groupedMembers = {
    founder: teamMembers.filter((m) => (m.customRole ?? m.role) === "founder"),
    ceo: teamMembers.filter((m) => (m.customRole ?? m.role) === "CEO"),
    coo: teamMembers.filter((m) => (m.customRole ?? m.role) === "COO"),
    chief_executive: teamMembers.filter((m) => (m.customRole ?? m.role) === "Chief Executive"),
    executive: teamMembers.filter((m) => (m.customRole ?? m.role) === "Executive"),
    junior_executive: teamMembers.filter((m) => (m.customRole ?? m.role) === "Junior Executive"),
  };

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
    "IMG_0018.HEIC",
    "IMG_0040.JPG",
    "IMG_0044.JPG",
    "IMG_0047.JPG",
  ];

  if (isLoading) {
    return <div className="py-8 text-center text-[var(--muted)]">Loading team...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Mission Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">Our Mission</h2>
        <div className="space-y-3 text-sm text-[var(--foreground)]">
          <p>
            YanLearn is a platform built by high school students, for students. We bring together talented high schoolers across the Toronto area and give them a stage to share their academic strengths — providing high-quality extracurricular tutoring and mentorship to younger students in grades 6-12.
          </p>
          <p className="font-semibold">Students Helping Students</p>
          <p>
            We believe every student who needs academic support should be able to access it without financial pressure. On our platform, students help students — and together, they give back to the community. All proceeds are donated to SickKids Hospital through our "Coding for SickKids" fundraising campaign, turning academic value into real-world impact.
          </p>
        </div>
      </section>

      {/* Team Section */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">Our Team</h2>
        <div className="space-y-6">
          {groupedMembers.founder.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{roleLabels.founder}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedMembers.founder.map((member) => (
                  <div key={member.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{member.name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.ceo.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{roleLabels.ceo}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedMembers.ceo.map((member) => (
                  <div key={member.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{member.name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.coo.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{roleLabels.coo}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedMembers.coo.map((member) => (
                  <div key={member.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{member.name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.chief_executive.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{roleLabels.chief_executive}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedMembers.chief_executive.map((member) => (
                  <div key={member.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{member.name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.executive.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{roleLabels.executive}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedMembers.executive.map((member) => (
                  <div key={member.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{member.name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedMembers.junior_executive.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{roleLabels.junior_executive}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedMembers.junior_executive.map((member) => (
                  <div key={member.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{member.name}</p>
                    <p className="text-xs text-[var(--muted)]">{member.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Images Gallery */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">Moments</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, idx) => (
            <div key={idx} className="relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background-secondary)]">
              <img
                src={`/images/${image}`}
                alt={`Team moment ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
