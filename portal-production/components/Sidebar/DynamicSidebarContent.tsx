/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Collapse,
  Tooltip,
  useTheme,
  CircularProgress,
  Box,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  Dashboard,
  Inventory,
  AnalyticsRounded,
  PeopleRounded,
  Description,
  AssignmentRounded,
  AccountTree,
  AdminPanelSettings,
  SettingsRounded,
  ExpandLess,
  ExpandMore,
  ErrorOutline,
  ShoppingCart,
  LocalShipping,
  Storefront,
  AccountBalance,
  ReceiptLong,
  Build,
} from "@mui/icons-material";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { getListRouteFromPathname } from "@/app/portal/components/documentRoutes";
import { useSidebar } from "./SidebarContext";

// Material UI icon mapping
const iconMap: Record<string, React.ComponentType> = {
  Dashboard,
  Inventory,
  AnalyticsRounded,
  PeopleRounded,
  Description,
  AssignmentRounded,
  AccountTree,
  AdminPanelSettings,
  SettingsRounded,
  ShoppingCart,
  LocalShipping,
  Storefront,
  AccountBalance,
  ReceiptLong,
  Build,
};

const getIcon = (iconName?: string) => {
  if (!iconName) return <Dashboard />;
  const IconComponent = iconMap[iconName];
  return IconComponent ? <IconComponent /> : <Dashboard />;
};

export default function DynamicSidebarContent() {
  const theme = useTheme();
  const rawPathname = usePathname();
  const { modules, loading, error, isModuleEnabled } = useConfiguration();
  const { isModuleAllowed } = useUserPermissions();
  const { isDocumentListViewEnabled } = useOrganizationFeatures();
  const { isCollapsed } = useSidebar();
  const [openMenus, setOpenMenus] = React.useState<Record<string, boolean>>({});

  // When the list-view feature is on and we're inside a document editor URL
  // (/portal/documents/<type>/...), behave for sidebar-highlight purposes as if
  // we were still on the originating list page. Keeps e.g. the "Sales Orders"
  // item highlighted while the user is editing a sales-order draft.
  const remappedListRoute = isDocumentListViewEnabled
    ? getListRouteFromPathname(rawPathname)
    : null;
  const pathname = remappedListRoute ?? rawPathname;


  // Handle submenu toggles
  const handleMenuClick = (moduleCode: string) => {
    if (!isCollapsed) {
      setOpenMenus(prev => ({
        ...prev,
        [moduleCode]: !prev[moduleCode],
      }));
    }
  };

  // Check if a navigation item is active
  const isItemActive = (module: any) => {
    const route = module.config?.route;

    // Special case for Dashboard
    if (module.moduleCode === 'DASHBOARD') {
      return pathname === '/portal';
    }

    // Check if current path starts with the module's route
    if (route && pathname.startsWith(route)) {
      // Make sure it's not a false positive (e.g., /portal/documents matching /portal/document-extraction)
      return pathname === route || pathname.startsWith(route + '/');
    }

    return false;
  };

  // Loading state
  if (loading) {
    return (
      <Stack
        sx={{
          flexGrow: 1,
          p: isCollapsed ? 1 : "var(--default-gap)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CircularProgress size={24} sx={{ color: "#FFFFFF" }} />
      </Stack>
    );
  }

  // Error state
  if (error) {
    return (
      <Stack
        sx={{
          flexGrow: 1,
          p: isCollapsed ? 1 : "var(--default-gap)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ErrorOutline sx={{ color: "#FFFFFF", mb: 1 }} />
        {!isCollapsed && (
          <Typography variant="caption" sx={{ color: "rgba(255, 255, 255, 0.7)", textAlign: "center" }}>
            Failed to load navigation
          </Typography>
        )}
      </Stack>
    );
  }

  // Filter and sort enabled modules, then filter by role-based module access
  const enabledModules = modules
    .filter(m => m.enabled)
    .filter(m => isModuleAllowed(m.moduleCode))
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

  // Resolve the URL for a single submenu key — same rules used when rendering
  // the expanded list, used here so the parent click can navigate to a valid
  // sub-page even when the module's bare route doesn't have its own landing.
  const resolveSubmenuRoute = (module: any, submenu: any): string => {
    // An explicit `href` on the submenu wins — used for cross-module deep links
    // (e.g. the Accounting module pointing at /portal/settings/accounting-setup).
    if (typeof submenu === 'object' && submenu?.href) return submenu.href;
    const submenuKey = typeof submenu === 'string' ? submenu : submenu.key;
    if (submenuKey === 'list') return module.config.route;
    if (submenuKey === 'extraction' && module.moduleCode === 'DOCUMENTS') {
      return '/portal/document-extraction';
    }
    return `${module.config.route}/${submenuKey}`;
  };

  const renderMenuItem = (module: any, index: number) => {
    const hasSubMenus = module.config?.subMenus && module.config.subMenus.length > 0;
    const isActive = isItemActive(module);
    // Force the parent open when one of its submenus is the currently-active
    // route, so the highlighted child stays visible after the user navigates in
    // via a deep URL (e.g. a document-editor page remapped to its list view).
    const hasActiveSubmenu = hasSubMenus && module.config.subMenus.some((sm: any) => {
      const r = resolveSubmenuRoute(module, sm);
      return pathname === r || pathname.startsWith(r + "/");
    });
    const isOpen = (openMenus[module.moduleCode] ?? false) || hasActiveSubmenu;

    // Parent click navigates only for the GL module — other parents keep the
    // legacy toggle-only behavior. Add module codes here to opt them in.
    const NAVIGATE_ON_PARENT_CLICK = new Set(['ACCOUNTING']);
    const parentNavigates = hasSubMenus && NAVIGATE_ON_PARENT_CLICK.has(module.moduleCode);
    const parentHref = parentNavigates
      ? resolveSubmenuRoute(module, module.config.subMenus[0])
      : module.config?.route || "#";

    const mintAccent = "#6FFBBE";
    const menuItem = (
      <ListItem
        disablePadding
        sx={{
          display: "block",
          position: "relative",
          borderRadius: 1,
          backgroundColor: isActive ? alpha(mintAccent, 0.08) : "transparent",
          transition: "background-color 160ms ease",
          ":hover": {
            backgroundColor: isActive ? alpha(mintAccent, 0.12) : alpha("#ffffff", 0.05),
          },
          mb: 0.25,
          "&::before": isActive
            ? {
                content: '""',
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "4px",
                backgroundColor: mintAccent,
                borderRadius: "0 4px 4px 0",
              }
            : {},
        }}
      >
        <ListItemButton
          selected={isActive}
          component={parentNavigates || !hasSubMenus || isCollapsed ? Link : "div"}
          href={parentNavigates || !hasSubMenus || isCollapsed ? parentHref : undefined}
          onClick={hasSubMenus && !isCollapsed ? () => handleMenuClick(module.moduleCode) : undefined}
          sx={{
            justifyContent: "center",
            minHeight: 40,
            px: isCollapsed ? 1.5 : 1.5,
            py: 1,
            borderRadius: 1,
            "&.Mui-selected": { backgroundColor: "transparent" },
            "&.Mui-selected:hover": { backgroundColor: "transparent" },
          }}
        >
          <ListItemIcon
            sx={{
              color: isActive ? mintAccent : alpha("#ffffff", 0.78),
              minWidth: "fit-content!important",
              marginRight: isCollapsed ? "0" : 1.5,
              justifyContent: "center",
              display: "flex",
              "& svg": { fontSize: "1.25rem" },
            }}
          >
            {getIcon(module.icon)}
          </ListItemIcon>
          {!isCollapsed && (
            <>
              <ListItemText
                primary={module.displayName || module.moduleCode}
                primaryTypographyProps={{
                  sx: {
                    color: isActive ? "#FFFFFF" : alpha("#ffffff", 0.78),
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 500,
                  },
                }}
              />
              {hasSubMenus && (
                isOpen ? <ExpandLess sx={{ color: alpha("#ffffff", 0.7), fontSize: "1.1rem" }} /> : <ExpandMore sx={{ color: alpha("#ffffff", 0.7), fontSize: "1.1rem" }} />
              )}
            </>
          )}
        </ListItemButton>
      </ListItem>
    );

    if (isCollapsed) {
      return (
        <Tooltip key={module.id} title={module.displayName || module.moduleCode} placement="right">
          {menuItem}
        </Tooltip>
      );
    }

    // Render with submenus if applicable
    if (hasSubMenus && !isCollapsed) {
      return (
        <React.Fragment key={module.id}>
          {menuItem}
          <Collapse in={isOpen} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {module.config.subMenus.map((submenu: any) => {
                const submenuKey = typeof submenu === 'string' ? submenu : submenu.key;
                const submenuLabel = typeof submenu === 'string'
                  ? submenu.charAt(0).toUpperCase() + submenu.slice(1).replace(/-/g, ' ')
                  : submenu.label;
                const submenuRoute = resolveSubmenuRoute(module, submenu);
                const isSubmenuActive = pathname === submenuRoute || pathname.startsWith(submenuRoute + '/');

                return (
                  <ListItemButton
                    key={submenuKey}
                    sx={{
                      pl: 4.5,
                      minHeight: 32,
                      borderRadius: 1,
                      ml: 1,
                      mr: 0.5,
                      my: 0.25,
                      backgroundColor: isSubmenuActive ? alpha("#6FFBBE", 0.08) : "transparent",
                      "&.Mui-selected": { backgroundColor: alpha("#6FFBBE", 0.08) },
                      "&.Mui-selected:hover": { backgroundColor: alpha("#6FFBBE", 0.12) },
                      "&:hover": { backgroundColor: alpha("#ffffff", 0.05) },
                    }}
                    component={Link}
                    href={submenuRoute}
                    selected={isSubmenuActive}
                  >
                    <ListItemText
                      primary={submenuLabel}
                      primaryTypographyProps={{
                        sx: {
                          color: isSubmenuActive ? "#FFFFFF" : alpha("#ffffff", 0.65),
                          fontSize: "0.8125rem",
                          fontWeight: isSubmenuActive ? 600 : 500,
                        },
                      }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Collapse>
        </React.Fragment>
      );
    }

    return menuItem;
  };

  // Secondary items (Settings, etc.) — supports nested submenus like main modules
  const secondaryItems: Array<{
    id: string;
    text: string;
    path?: string;
    icon: string;
    subMenus?: Array<{ key: string; label: string; path: string }>;
  }> = [
    {
      id: 'settings',
      text: 'Organization Settings',
      icon: 'SettingsRounded',
      subMenus: [
        { key: 'company-profile', label: 'Company Profile', path: '/portal/settings/company-profile' },
        { key: 'accounting-setup', label: 'Accounting Setup', path: '/portal/settings/accounting-setup' },
      ],
    },
  ];

  const renderSecondaryItem = (item: typeof secondaryItems[number]) => {
    const hasSubMenus = !!item.subMenus && item.subMenus.length > 0;
    const isOpen = openMenus[item.id] || false;
    const isActive = hasSubMenus
      ? item.subMenus!.some((s) => pathname === s.path || pathname.startsWith(s.path + '/'))
      : !!item.path && (pathname === item.path || pathname.startsWith(item.path + '/'));

    const mintAccent = "#6FFBBE";
    const secondaryItem = (
      <ListItem
        key={item.id}
        disablePadding
        sx={{
          display: "block",
          position: "relative",
          borderRadius: 1,
          backgroundColor: isActive ? alpha(mintAccent, 0.08) : "transparent",
          transition: "background-color 160ms ease",
          ":hover": {
            backgroundColor: isActive ? alpha(mintAccent, 0.12) : alpha("#ffffff", 0.05),
          },
          mb: 0.25,
          "&::before": isActive
            ? {
                content: '""',
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "4px",
                backgroundColor: mintAccent,
                borderRadius: "0 4px 4px 0",
              }
            : {},
        }}
      >
        <ListItemButton
          sx={{
            justifyContent: "center",
            minHeight: 40,
            px: isCollapsed ? 1.5 : 1.5,
            py: 1,
            borderRadius: 1,
            "&.Mui-selected": { backgroundColor: "transparent" },
            "&.Mui-selected:hover": { backgroundColor: "transparent" },
          }}
          component={hasSubMenus && !isCollapsed ? "div" : Link}
          href={hasSubMenus && !isCollapsed ? undefined : (item.path || "#")}
          onClick={hasSubMenus ? () => handleMenuClick(item.id) : undefined}
          selected={isActive}
        >
          <ListItemIcon
            sx={{
              minWidth: "fit-content!important",
              marginRight: isCollapsed ? "0" : 1.5,
              justifyContent: "center",
              display: "flex",
              color: isActive ? mintAccent : alpha("#ffffff", 0.78),
              "& svg": { fontSize: "1.25rem" },
            }}
          >
            {getIcon(item.icon)}
          </ListItemIcon>
          {!isCollapsed && (
            <>
              <ListItemText
                primary={item.text}
                primaryTypographyProps={{
                  sx: {
                    color: isActive ? "#FFFFFF" : alpha("#ffffff", 0.78),
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 500,
                  },
                }}
              />
              {hasSubMenus && (
                isOpen
                  ? <ExpandLess sx={{ color: alpha("#ffffff", 0.7), fontSize: "1.1rem" }} />
                  : <ExpandMore sx={{ color: alpha("#ffffff", 0.7), fontSize: "1.1rem" }} />
              )}
            </>
          )}
        </ListItemButton>
      </ListItem>
    );

    if (isCollapsed) {
      return (
        <Tooltip key={item.id} title={item.text} placement="right">
          {secondaryItem}
        </Tooltip>
      );
    }

    if (hasSubMenus && !isCollapsed) {
      return (
        <React.Fragment key={item.id}>
          {secondaryItem}
          <Collapse in={isOpen} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {item.subMenus!.map((submenu) => {
                const isSubmenuActive = pathname === submenu.path || pathname.startsWith(submenu.path + '/');
                return (
                  <ListItemButton
                    key={submenu.key}
                    sx={{
                      pl: 4.5,
                      minHeight: 32,
                      borderRadius: 1,
                      ml: 1,
                      mr: 0.5,
                      my: 0.25,
                      backgroundColor: isSubmenuActive ? alpha(mintAccent, 0.08) : "transparent",
                      "&.Mui-selected": { backgroundColor: alpha(mintAccent, 0.08) },
                      "&.Mui-selected:hover": { backgroundColor: alpha(mintAccent, 0.12) },
                      "&:hover": { backgroundColor: alpha("#ffffff", 0.05) },
                    }}
                    component={Link}
                    href={submenu.path}
                    selected={isSubmenuActive}
                  >
                    <ListItemText
                      primary={submenu.label}
                      primaryTypographyProps={{
                        sx: {
                          color: isSubmenuActive ? "#FFFFFF" : alpha("#ffffff", 0.65),
                          fontSize: "0.8125rem",
                          fontWeight: isSubmenuActive ? 600 : 500,
                        },
                      }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Collapse>
        </React.Fragment>
      );
    }

    return secondaryItem;
  };

  return (
    <Stack
      sx={{
        flexGrow: 1,
        p: isCollapsed ? 1 : "var(--default-gap)",
      }}
    >
      <List
        dense
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--half-gap)",
        }}
      >
        {enabledModules.map((module, index) => renderMenuItem(module, index))}
        {secondaryItems.map((item) => renderSecondaryItem(item))}
      </List>
    </Stack>
  );
}