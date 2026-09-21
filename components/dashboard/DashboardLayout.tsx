import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';

// Deprecated: kept for backwards compat — use AppShell instead
export function DashboardLayout({ children }: { children?: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
