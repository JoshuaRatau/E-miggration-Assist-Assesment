import { Link } from "wouter";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Users, Settings } from "lucide-react";

/**
 * Admin nav menu rendered in the brand header's rightSlot on every
 * authenticated admin page.  Shows the signed-in identity and exposes
 * profile / manage-admins / logout actions.
 */
export function AdminUserMenu() {
  const { user, logout } = useAdminAuth();
  if (!user) return null;
  const initials = (user.displayName ?? user.email)
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          data-testid="button-admin-menu"
        >
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            {initials || "A"}
          </span>
          <span className="hidden sm:inline">
            {user.displayName ?? user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium truncate">
              {user.displayName ?? "Admin"}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Link href="/admin">
          <DropdownMenuItem data-testid="menu-dashboard">
            <Settings className="mr-2 h-4 w-4" /> Dashboard
          </DropdownMenuItem>
        </Link>
        <Link href="/admin/profile">
          <DropdownMenuItem data-testid="menu-profile">
            <User className="mr-2 h-4 w-4" /> Profile / Change password
          </DropdownMenuItem>
        </Link>
        {user.isSuperadmin ? (
          <Link href="/admin/users">
            <DropdownMenuItem data-testid="menu-users">
              <Users className="mr-2 h-4 w-4" /> Manage Admins
            </DropdownMenuItem>
          </Link>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void logout();
          }}
          data-testid="menu-logout"
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
