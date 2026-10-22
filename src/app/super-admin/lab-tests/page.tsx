import { redirect } from 'next/navigation';

export default function SuperAdminLabTestsPage() {
  redirect('/super-admin/test-policies?tab=catalog');
}
