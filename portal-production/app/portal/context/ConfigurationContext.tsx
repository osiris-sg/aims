"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "../hooks/useOrganization";

interface ModuleConfig {
  id: string;
  moduleCode: string;
  enabled: boolean;
  displayName?: string;
  icon?: string;
  sortOrder?: number;
  config?: any;
}

interface UIConfig {
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    mode?: 'light' | 'dark';
    fontSize?: 'small' | 'medium' | 'large';
    borderRadius?: number;
  };
  terminology?: Record<string, string>;
  dateFormat?: string;
  timeFormat?: string;
  currency?: string;
  language?: string;
  features?: Record<string, boolean>;
  branding?: any;
  navigationConfig?: any;
  dashboardLayout?: any;
}

interface CustomField {
  id: string;
  entityType: string;
  fieldName: string;
  displayLabel: string;
  fieldType: string;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
  validation?: any;
  sortOrder?: number;
  showInList: boolean;
  showInForm: boolean;
  groupName?: string;
}

interface ConfigurationContextType {
  modules: ModuleConfig[];
  uiConfig: UIConfig;
  customFields: Record<string, CustomField[]>;
  loading: boolean;
  error: string | null;
  refreshConfiguration: () => Promise<void>;
  getModuleByCode: (code: string) => ModuleConfig | undefined;
  isModuleEnabled: (code: string) => boolean;
  getCustomFieldsForEntity: (entityType: string) => CustomField[];
  getTerminology: (key: string) => string;
  getFeatureFlag: (key: string) => boolean;
}

const ConfigurationContext = createContext<ConfigurationContextType | undefined>(undefined);

export const useConfiguration = () => {
  const context = useContext(ConfigurationContext);
  if (!context) {
    throw new Error("useConfiguration must be used within a ConfigurationProvider");
  }
  return context;
};

interface ConfigurationProviderProps {
  children: ReactNode;
}

export const ConfigurationProvider: React.FC<ConfigurationProviderProps> = ({ children }) => {
  const { getToken } = useAuth();
  const { organization, isLoaded: isOrgLoaded, error: orgError } = useOrganization();
  const [modules, setModules] = useState<ModuleConfig[]>([]);
  const [uiConfig, setUIConfig] = useState<UIConfig>({});
  const [customFields, setCustomFields] = useState<Record<string, CustomField[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfiguration = async () => {
    // Wait for the organization fetch to settle before deciding what to render.
    if (!isOrgLoaded) {
      setLoading(true);
      return;
    }

    if (!organization?.id) {
      // Org failed to load (or user has none yet). Show default modules so the
      // sidebar isn't blank — surface the org error so the user knows.
      setError(orgError || "Unable to load your organization. Showing default navigation.");
      setDefaultConfiguration();
      setLoading(false);
      return;
    }

    try {
      console.log("Fetching configuration for org:", organization.id);
      setLoading(true);
      setError(null);

      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token");
      }

      // Build headers — also forward X-Active-Org-Id (the admin org-switch
      // header from sessionStorage) so the backend guard returns modules for
      // the org guru is "Viewing as", not the home org.
      const cfgHeaders: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "x-organization-id": organization.id,
      };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) cfgHeaders["X-Active-Org-Id"] = activeOrgId;
      }
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/complete`,
        { headers: cfgHeaders }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch configuration: ${response.statusText}`);
      }

      const responseData = await response.json();

      console.log("Configuration response data:", responseData);
      console.log("Response data.data:", responseData.data);
      console.log("Modules:", responseData.data?.modules);
      console.log("UIConfig:", responseData.data?.uiConfig);

      // Extract from wrapped response (global interceptor wraps in { success, data, message })
      const data = responseData.data || responseData;

      setModules(data.modules || []);
      setUIConfig(data.uiConfig || {});
      setCustomFields(data.customFields || {});
    } catch (err) {
      console.error("Error fetching configuration:", err);
      setError(err instanceof Error ? err.message : "Failed to load configuration");

      // Set default configuration on error
      setDefaultConfiguration();
    } finally {
      setLoading(false);
    }
  };

  const setDefaultConfiguration = () => {
    // Default modules configuration
    const defaultModules: ModuleConfig[] = [
      { id: '1', moduleCode: 'DASHBOARD', enabled: true, displayName: 'Dashboard', icon: 'Dashboard', sortOrder: 0, config: { route: '/portal' } },
      { id: '2', moduleCode: 'INVENTORY', enabled: true, displayName: 'Inventory', icon: 'Inventory', sortOrder: 1, config: { route: '/portal/inventory' } },
      { id: '3', moduleCode: 'ASSETS', enabled: true, displayName: 'Assets', icon: 'AnalyticsRounded', sortOrder: 2, config: { route: '/portal/assets' } },
      { id: '4', moduleCode: 'CUSTOMERS', enabled: true, displayName: 'Customers', icon: 'PeopleRounded', sortOrder: 3, config: { route: '/portal/customers' } },
      { id: '5', moduleCode: 'DOCUMENTS', enabled: true, displayName: 'Documents', icon: 'Description', sortOrder: 4, config: { route: '/portal/documents', subMenus: ['templates', 'extraction'] } },
      { id: '6', moduleCode: 'INVOICES', enabled: true, displayName: 'Invoices', icon: 'AssignmentRounded', sortOrder: 5, config: { route: '/portal/invoices' } },
      { id: '7', moduleCode: 'PROJECTS', enabled: true, displayName: 'Projects', icon: 'AccountTree', sortOrder: 6, config: { route: '/portal/projects' } },
      { id: '8', moduleCode: 'USER_MANAGEMENT', enabled: true, displayName: 'User Management', icon: 'PeopleRounded', sortOrder: 7, config: { route: '/portal/user-management', subMenus: ['users', 'roles'] } },
      { id: '9', moduleCode: 'AUDIT', enabled: true, displayName: 'Audit', icon: 'AnalyticsRounded', sortOrder: 8, config: { route: '/portal/audit' } },
      {
        id: '10',
        moduleCode: 'ACCOUNTING',
        enabled: true,
        displayName: 'General Ledger',
        icon: 'AccountBalance',
        sortOrder: 9,
        config: {
          route: '/portal/accounting',
          subMenus: [
            { key: 'general-ledger', label: 'General Ledger' },
            { key: 'trial-balance', label: 'Trial Balance' },
            { key: 'audit-trail', label: 'Audit Trail' },
            { key: 'gst', label: 'Goods & Services Tax' },
            { key: 'profit-loss', label: 'Profit / Loss & BS' },
            { key: 'expense-listing', label: 'Expense Listing' },
            { key: 'bank-reconciliation', label: 'Bank Reconciliation' },
            { key: 'foreign-bank', label: 'Foreign Bank Listing' },
          ],
        },
      },
    ];

    setModules(defaultModules);

    // Default UI configuration
    setUIConfig({
      theme: {
        primaryColor: '#1976d2',
        secondaryColor: '#dc004e',
        mode: 'light',
      },
      terminology: {
        asset: 'Asset',
        inventory: 'Inventory',
        customer: 'Customer',
        document: 'Document',
        project: 'Project',
      },
      features: {
        enableProjects: true,
        enableDocumentAI: true,
        enableCustomFields: true,
      },
    });
  };

  useEffect(() => {
    fetchConfiguration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, isOrgLoaded]);

  const refreshConfiguration = async () => {
    await fetchConfiguration();
  };

  const getModuleByCode = (code: string) => {
    return modules.find(m => m.moduleCode === code);
  };

  const isModuleEnabled = (code: string) => {
    const module = getModuleByCode(code);
    return module ? module.enabled : false;
  };

  const getCustomFieldsForEntity = (entityType: string) => {
    return customFields[entityType] || [];
  };

  const getTerminology = (key: string) => {
    return uiConfig.terminology?.[key] || key;
  };

  const getFeatureFlag = (key: string) => {
    return uiConfig.features?.[key] ?? true;
  };

  const value: ConfigurationContextType = {
    modules,
    uiConfig,
    customFields,
    loading,
    error,
    refreshConfiguration,
    getModuleByCode,
    isModuleEnabled,
    getCustomFieldsForEntity,
    getTerminology,
    getFeatureFlag,
  };

  return (
    <ConfigurationContext.Provider value={value}>
      {children}
    </ConfigurationContext.Provider>
  );
};