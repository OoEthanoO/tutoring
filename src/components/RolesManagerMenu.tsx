import { useState, useEffect } from "react";

export default function RolesManagerMenu() {
  const [roleDefinitions, setRoleDefinitions] = useState<{name: string, role_level: string}[]>([]);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleLevel, setNewRoleLevel] = useState("Executive");
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const levels = ["CEO", "COO", "Chief Executive", "Executive", "Junior Executive", "Student"];

  const fetchData = async () => {
    const rolesRes = await fetch("/api/admin/roles");
    if (rolesRes.ok) {
      setRoleDefinitions((await rolesRes.json()).roles);
    }
  };

  useEffect(() => {
    const load = async () => {
      await fetchData();
    };
    void load();
  }, []);

  const createRole = async () => {
    if (!newRoleName) return;
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      body: JSON.stringify({ name: newRoleName, role_level: newRoleLevel })
    });
    if (res.ok) {
      setStatus({ type: "success", message: "Role created successfully." });
      setNewRoleName("");
      fetchData();
    } else {
      const err = await res.json();
      setStatus({ type: "error", message: err.error || "Failed to create role." });
    }
  };

  return (
    <div className="space-y-8">
      {status && (
        <div
          className={
            status.type === "error"
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
          }
        >
          {status.message}
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">Role Manager</h1>
        <p className="text-sm text-[var(--muted)]">Manage role definitions and assign them to users.</p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Create New Role</h2>
        <div className="flex flex-col gap-4 max-w-sm">
          <input
            type="text"
            placeholder="Role Name (e.g. CMO)"
            value={newRoleName}
            onChange={e => setNewRoleName(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none"
          />
          <select
            value={newRoleLevel}
            onChange={e => setNewRoleLevel(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none cursor-pointer"
          >
            {levels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button
            onClick={createRole}
            className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--background)] hover:bg-[var(--foreground)]/90"
          >
            Create Role
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Existing Roles</h2>
        {roleDefinitions.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No custom roles defined.</p>
        ) : (
          <div className="space-y-3">
            {roleDefinitions.map(r => (
              <div key={r.name} className="flex justify-between items-center py-2 border-b border-[var(--border)] border-dashed">
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs uppercase tracking-wider text-[var(--muted)] px-2 py-1 bg-[var(--border)]/30 rounded">{r.role_level}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
