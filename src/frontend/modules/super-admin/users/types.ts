export interface UserSource {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  isActive: boolean;
}

export interface UserItem {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: string;
  department: string;
  scopeType: string;
  phone?: string | null;
  cnic?: string | null;
  procurementSourceId: string | null;
  procurementSource: UserSource | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UsersResponse {
  users: UserItem[];
  pagination?: { page: number; pageSize: number; totalRecords: number; totalPages: number };
}
