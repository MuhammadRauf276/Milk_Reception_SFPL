import { redirect } from 'next/navigation';
import { getCurrentUser } from '@core/auth';
import { resolveRoleHome } from '@/lib/role-routing';

export default async function HomePage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect('/login');
  }

  const destination = resolveRoleHome(currentUser.role);
  redirect(destination);
}
