import { useQuery } from "@tanstack/react-query";
import { getAdminToken } from "@/lib/adminToken";

export interface AssignableUser {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
}

interface AssignableUsersResponse {
  users: AssignableUser[];
}

/**
 * Phase 11C — shared roster of admin users for the lead-ownership picker.
 *
 * Fed by `GET /api/admin/assignable-users` (readable by ANY authenticated
 * admin, unlike the superadmin-only "Manage Admins" list). Reused across the
 * lead-detail assignee dropdown, the dashboard "Assigned To" filter, and the
 * dashboard table so a stored `assignedTo` uuid resolves to a human name in
 * exactly one place. Returns:
 *   - `users`        — full list (incl. deactivated, for name resolution)
 *   - `activeUsers`  — assignable subset for dropdown options
 *   - `labelFor(id)` — uuid → "Display Name" / email / short id fallback
 */
export function useAssignableUsers() {
  const query = useQuery<AssignableUser[], Error>({
    queryKey: ["admin", "assignable-users"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const base = (
        import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL
      ).replace(/\/$/, "");
      const res = await fetch(`${base}/api/admin/assignable-users`, {
        credentials: "include",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body = (await res.json()) as AssignableUsersResponse;
      return body.users ?? [];
    },
  });

  const users = query.data ?? [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const labelFor = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const u = byId.get(id);
    if (!u) return `${id.slice(0, 8)}…`;
    return u.displayName?.trim() || u.email;
  };

  return {
    ...query,
    users,
    activeUsers: users.filter((u) => u.isActive),
    labelFor,
  };
}
