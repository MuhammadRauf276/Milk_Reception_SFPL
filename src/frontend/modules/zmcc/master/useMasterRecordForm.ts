'use client';

import React, { useState } from 'react';
import type { MasterDataTab, MasterFormData, MasterModalType, MasterRecord } from './masterTypes';

interface Args {
  activeTab: MasterDataTab;
  isSuperAdmin: boolean;
  selectedZmccId: string;
  currentZmccName: string;
  onSaved: () => void;
}

/** Create / edit / toggle drawer state and submit handler. */
export function useMasterRecordForm({ activeTab, isSuperAdmin, selectedZmccId, currentZmccName, onSaved }: Args) {
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [modalType, setModalType] = useState<MasterModalType | null>(null);
  const [activeRecord, setActiveRecord] = useState<MasterRecord | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formData, setFormData] = useState<MasterFormData>({});

  const closeModal = () => {
    setModalType(null);
    setActiveRecord(null);
    setModalError(null);
    setFormData({});
  };

  const openCreate = () => {
    setModalError(null);
    setFormData({});
    if (activeTab === 'LOCAL_SUPPLIERS') setModalType('CREATE_LOCAL_SUPPLIER');
    if (activeTab === 'ROUTES') {
      setFormData({
        origin: currentZmccName,
        destination: 'Main Plant',
      });
      setModalType('CREATE_ROUTE');
    }
    if (activeTab === 'AREAS') setModalType('CREATE_AREA');
    if (activeTab === 'MILK_SOURCES') setModalType('CREATE_MILK_SOURCE');
    if (activeTab === 'CHILLER_OWNERSHIP') setModalType('CREATE_CHILLER');
    if (activeTab === 'SHOPS') setModalType('CREATE_SHOP');
    if (activeTab === 'TANKS') setModalType('CREATE_TANK');
  };

  const openEdit = (item: MasterRecord) => {
    setModalError(null);
    setActiveRecord(item);
    if (activeTab === 'LOCAL_SUPPLIERS') {
      setFormData({
        name: item.name ?? '',
        phone: item.phone || '',
        cnic: item.cnic || '',
      });
      setModalType('EDIT_LOCAL_SUPPLIER');
    } else if (activeTab === 'ROUTES') {
      setFormData({ name: item.name ?? '', origin: item.origin ?? '', destination: item.destination ?? '' });
      setModalType('EDIT_ROUTE');
    } else if (activeTab === 'AREAS') {
      setFormData({ name: item.name ?? '' });
      setModalType('EDIT_AREA');
    } else if (activeTab === 'MILK_SOURCES') {
      setFormData({ name: item.name ?? '', erp_code: item.erp_code ?? '' });
      setModalType('EDIT_MILK_SOURCE');
    } else if (activeTab === 'CHILLER_OWNERSHIP') {
      setFormData({ name: item.name ?? '' });
      setModalType('EDIT_CHILLER');
    } else if (activeTab === 'SHOPS') {
      setFormData({
        shop_name: item.shop_name ?? '',
        owner_name: item.owner_name ?? '',
        phone_number: item.phone_number ?? '',
        cnic: item.cnic ?? '',
        area_id: item.area_id ?? '',
        route_id: item.route_id ?? '',
        chiller_ownership_id: item.chiller_ownership_id ?? '',
        latitude: item.latitude ?? '',
        longitude: item.longitude ?? '',
      });
      setModalType('EDIT_SHOP');
    } else if (activeTab === 'TANKS') {
      setFormData({
        tank_code: item.tank_code ?? '',
        tank_name: item.tank_name ?? '',
        capacity_liters: item.capacity_liters ?? '',
      });
      setModalType('EDIT_TANK');
    }
  };

  const openToggle = (item: MasterRecord) => {
    setModalError(null);
    setActiveRecord(item);
    setModalType('TOGGLE_ACTIVE');
  };

  // Submit handlers
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    if (
      ((modalType === 'CREATE_AREA' || modalType === 'EDIT_AREA') && !formData.route_id) ||
      ((modalType === 'CREATE_SHOP' || modalType === 'EDIT_SHOP') &&
        (!formData.area_id || !formData.chiller_ownership_id))
    ) {
      setModalError('Please fill in all required fields.');
      return;
    }
    setIsSubmitting(true);

    try {
      let url = '';
      let method = 'POST';
      let body: Record<string, unknown> = {};

      if (modalType === 'CREATE_ROUTE') {
        url = '/api/zmcc/routes';
        body = {
          name: formData.name,
          origin: formData.origin || currentZmccName,
          destination: formData.destination || 'Main Plant',
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_ROUTE') {
        url = `/api/zmcc/routes/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          name: formData.name,
          origin: formData.origin,
          destination: formData.destination,
        };
      } else if (modalType === 'CREATE_AREA') {
        url = '/api/zmcc/areas';
        body = {
          name: formData.name,
          route_id: formData.route_id,
        };
      } else if (modalType === 'EDIT_AREA') {
        url = `/api/zmcc/areas/${activeRecord?.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_MILK_SOURCE') {
        url = '/api/zmcc/milk-sources';
        body = {
          erp_code: formData.erp_code,
          name: formData.name,
          zmcc_ids: selectedZmccId ? [selectedZmccId] : [],
        };
      } else if (modalType === 'EDIT_MILK_SOURCE') {
        url = `/api/zmcc/milk-sources/${activeRecord?.id}`;
        method = 'PATCH';
        body = { name: formData.name, erp_code: formData.erp_code };
      } else if (modalType === 'CREATE_CHILLER') {
        url = '/api/zmcc/chiller-ownerships';
        body = {
          ownership_code: formData.ownership_code,
          name: formData.name,
        };
      } else if (modalType === 'EDIT_CHILLER') {
        url = `/api/zmcc/chiller-ownerships/${activeRecord?.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_SHOP') {
        url = '/api/zmcc/shops';
        body = {
          shop_name: formData.shop_name,
          owner_name: formData.owner_name,
          phone_number: formData.phone_number,
          cnic: formData.cnic,
          area_id: formData.area_id,
          chiller_ownership_id: formData.chiller_ownership_id,
          latitude: formData.latitude !== '' && formData.latitude != null ? Number(formData.latitude) : null,
          longitude: formData.longitude !== '' && formData.longitude != null ? Number(formData.longitude) : null,
        };
      } else if (modalType === 'EDIT_SHOP') {
        url = `/api/zmcc/shops/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          shop_name: formData.shop_name,
          owner_name: formData.owner_name,
          phone_number: formData.phone_number,
          cnic: formData.cnic,
          area_id: formData.area_id,
          chiller_ownership_id: formData.chiller_ownership_id,
          latitude: formData.latitude !== '' && formData.latitude != null ? Number(formData.latitude) : null,
          longitude: formData.longitude !== '' && formData.longitude != null ? Number(formData.longitude) : null,
        };
      } else if (modalType === 'CREATE_LOCAL_SUPPLIER') {
        url = '/api/zmcc/hc-suppliers';
        body = {
          name: formData.name,
          phone: formData.phone || undefined,
          cnic: formData.cnic || undefined,
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_LOCAL_SUPPLIER') {
        url = `/api/zmcc/hc-suppliers/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          name: formData.name,
          phone: formData.phone !== undefined ? formData.phone : undefined,
          cnic: formData.cnic !== undefined ? formData.cnic : undefined,
        };
      } else if (modalType === 'CREATE_TANK') {
        url = '/api/zmcc/tanks';
        body = {
          tank_code: formData.tank_code,
          tank_name: formData.tank_name,
          capacity_liters: Number(formData.capacity_liters),
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_TANK') {
        url = `/api/zmcc/tanks/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          tank_code: formData.tank_code,
          tank_name: formData.tank_name,
          capacity_liters: formData.capacity_liters !== undefined ? Number(formData.capacity_liters) : undefined,
        };
      } else if (modalType === 'TOGGLE_ACTIVE') {
        const targetActive = !activeRecord?.is_active;
        if (activeTab === 'LOCAL_SUPPLIERS') url = `/api/zmcc/hc-suppliers/${activeRecord?.id}`;
        else if (activeTab === 'ROUTES') url = `/api/zmcc/routes/${activeRecord?.id}`;
        else if (activeTab === 'AREAS') url = `/api/zmcc/areas/${activeRecord?.id}`;
        else if (activeTab === 'MILK_SOURCES') url = `/api/zmcc/milk-sources/${activeRecord?.id}`;
        else if (activeTab === 'CHILLER_OWNERSHIP') url = `/api/zmcc/chiller-ownerships/${activeRecord?.id}`;
        else if (activeTab === 'SHOPS') url = `/api/zmcc/shops/${activeRecord?.id}`;
        else if (activeTab === 'TANKS') url = `/api/zmcc/tanks/${activeRecord?.id}`;
        method = 'PATCH';
        body = { is_active: targetActive };
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || 'Operation failed.');
      }

      setSuccessMsg('Record saved successfully.');
      setTimeout(() => setSuccessMsg(null), 3000);
      closeModal();
      onSaved();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    successMsg, modalType, activeRecord, modalError, isSubmitting, formData, setFormData,
    closeModal, openCreate, openEdit, openToggle, submit,
  };
}
