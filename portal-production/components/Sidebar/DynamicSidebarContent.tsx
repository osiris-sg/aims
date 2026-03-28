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
} from "@mui/icons-material";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
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
};

const getIcon = (iconName?: string) => {
  if (!iconName) return <Dashboard />;
  const IconComponent = iconMap[iconName];
  return IconComponent ? <IconComponent /> : <Dashboard />;
};

export default function DynamicSidebarContent() {
  const theme = useTheme();
  const pathname = usePathname();
  const { modules, loading, error, isModuleEnabled } = useConfiguration();
  const { isModuleAllowed } = useUserPermissions();
  const { isCollapsed } = useSidebar();
  const [openMenus, setOpenMenus] = React.useState<Record<string, boolean>>({});


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
        <CircularProgress size={24} sx={{ color: "white" }} />
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
        <ErrorOutline sx={{ color: "white", mb: 1 }} />
        {!isCollapsed && (
          <Typography variant="caption" sx={{ color: "white", textAlign: "center" }}>
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

  const renderMenuItem = (module: any, index: number) => {
    const hasSubMenus = module.config?.subMenus && module.config.subMenus.length > 0;
    const isOpen = openMenus[module.moduleCode] || false;
    const isActive = isItemActive(module);

    const menuItem = (
      <ListItem
        disablePadding
        sx={{
          display: "block",
          borderRadius: "var(--default-border-radius)",
          backgroundColor: isActive ? theme.palette.primary.contrastText : "transparent",
          ":hover": { backgroundColor: theme.palette.primary.light },
          mb: 0.5,
        }}
      >
        <ListItemButton
          selected={isActive}
          component={hasSubMenus && !isCollapsed ? "div" : Link}
          href={hasSubMenus && !isCollapsed ? undefined : module.config?.route || "#"}
          onClick={hasSubMenus ? () => handleMenuClick(module.moduleCode) : undefined}
          sx={{
            justifyContent: "center",
            minHeight: 48,
            px: isCollapsed ? 1.5 : 2,
            borderRadius: "var(--default-border-radius)",
          }}
        >
          <ListItemIcon
            sx={{
              color: isActive ? theme.palette.primary.main : "white",
              minWidth: "fit-content!important",
              marginRight: isCollapsed ? "0" : "var(--default-gap)",
              justifyContent: "center",
              display: "flex",
            }}
          >
            {getIcon(module.icon)}
          </ListItemIcon>
          {!isCollapsed && (
            <>
              <ListItemText
                primary={module.displayName || module.moduleCode}
                sx={{
                  color: isActive ? theme.palette.primary.main : "white",
                }}
              />
              {hasSubMenus && (
                isOpen ? <ExpandLess sx={{ color: "white" }} /> : <ExpandMore sx={{ color: "white" }} />
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
                // Handle both string and object format for submenus
                const submenuKey = typeof submenu === 'string' ? submenu : submenu.key;
                const submenuLabel = typeof submenu === 'string'
                  ? submenu.charAt(0).toUpperCase() + submenu.slice(1).replace(/-/g, ' ')
                  : submenu.label;

                // Special cases:
                // - 'list' submenu links to the main route
                // - 'extraction' links to /portal/document-extraction (standalone route)
                let submenuRoute;
                if (submenuKey === 'list') {
                  submenuRoute = module.config.route;
                } else if (submenuKey === 'extraction' && module.moduleCode === 'DOCUMENTS') {
                  submenuRoute = '/portal/document-extraction';
                } else {
                  submenuRoute = `${module.config.route}/${submenuKey}`;
                }
                const isSubmenuActive = pathname === submenuRoute || pathname.startsWith(submenuRoute + '/');

                return (
                  <ListItemButton
                    key={submenuKey}
                    sx={{
                      pl: 4,
                      backgroundColor: isSubmenuActive ? theme.palette.primary.light : "transparent",
                    }}
                    component={Link}
                    href={submenuRoute}
                    selected={isSubmenuActive}
                  >
                    <ListItemText
                      primary={submenuLabel}
                      sx={{ color: "white" }}
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

  // Secondary items (Settings, etc.)
  const secondaryItems = [
    {
      id: 'settings',
      text: 'Organization Settings',
      path: '/portal/settings/organization',
      icon: 'SettingsRounded',
    },
  ];

  return (
    <Stack
      sx={{
        flexGrow: 1,
        p: isCollapsed ? 1 : "var(--default-gap)",
        justifyContent: "space-between",
      }}
    >
      {/* Main navigation items */}
      <List
        dense
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--half-gap)",
        }}
      >
        {enabledModules.map((module, index) => renderMenuItem(module, index))}
      </List>

      {/* Secondary navigation items */}
      <List
        dense
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--half-gap)",
        }}
      >
        {secondaryItems.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(item.path + '/');
          const secondaryItem = (
            <ListItem
              key={item.id}
              disablePadding
              sx={{
                display: "block",
                borderRadius: "var(--default-border-radius)",
                backgroundColor: isActive ? theme.palette.primary.contrastText : "transparent",
                ":hover": { backgroundColor: theme.palette.primary.light },
                mb: 0.5,
              }}
            >
              <ListItemButton
                sx={{
                  justifyContent: "center",
                  minHeight: 48,
                  px: isCollapsed ? 1.5 : 2,
                  borderRadius: "var(--default-border-radius)",
                }}
                component={Link}
                href={item.path}
                selected={isActive}
              >
                <ListItemIcon
                  sx={{
                    minWidth: "fit-content!important",
                    marginRight: isCollapsed ? "0" : "var(--default-gap)",
                    justifyContent: "center",
                    display: "flex",
                    color: isActive ? theme.palette.primary.main : "white",
                  }}
                >
                  {getIcon(item.icon)}
                </ListItemIcon>
                {!isCollapsed && (
                  <ListItemText
                    primary={item.text}
                    sx={{
                      color: isActive ? theme.palette.primary.main : "white",
                    }}
                  />
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

          return secondaryItem;
        })}
      </List>
    </Stack>
  );
}