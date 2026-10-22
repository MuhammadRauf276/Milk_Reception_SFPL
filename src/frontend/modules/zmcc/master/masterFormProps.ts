import type {
  AreaItem,
  ChillerOwnershipItem,
  MasterFormData,
  MasterModalType,
  MasterRecord,
  RouteItem,
} from './masterTypes';

export interface MasterFormProps {
  modalType: MasterModalType;
  formData: MasterFormData;
  setFormData: (d: MasterFormData) => void;
  activeRecord: MasterRecord | null;
  helperRoutes: RouteItem[];
  helperAreas: AreaItem[];
  helperChillers: ChillerOwnershipItem[];
}
