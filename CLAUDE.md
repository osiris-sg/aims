# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo containing an Asset and Inventory Management System (AIMS) with two main applications:

**Branch topology:** `main` = production (auto-deploys: backend → Render, portal → Vercel `www.ai-ms.io`). `elroy/dev` = staging/work branch (Vercel previews served at `aims-mocha.vercel.app`). The old `yx/dev` was renamed to `main` 2026-07-08; `master` is a stale pre-2026 branch — never target it.

- **api-server-production/**: NestJS backend API server with PostgreSQL/Prisma
- **portal-production/**: Next.js frontend portal with Redux and Material-UI

## Development Commands

### Backend (api-server-production/)
```bash
# Development
npm run start:dev          # Start dev server with watch mode
npm run start:debug        # Start with debug mode

# Database
npm run db:push            # Push schema changes to database
npm run db:studio          # Open Prisma Studio
npm run seed               # Seed the database

# Testing & Quality
npm run test               # Run unit tests
npm run test:e2e          # Run end-to-end tests
npm run lint              # ESLint with auto-fix
npm run format            # Prettier formatting

# Production
npm run build             # Build for production
npm run start:prod        # Start production server

# Database Management Scripts
npm run assign-superadmin    # Assign superadmin role
npm run assign-osirisadmin   # Assign osiris admin role
npm run debug-user-roles     # Debug user roles
npm run setup-database       # Setup database
npm run setup-user          # Setup user
```

### Frontend (portal-production/)
```bash
# Development
npm run dev               # Start Next.js dev server with Turbo

# Production
npm run build             # Build for production
npm run start             # Start production server

# Quality
npm run lint              # Next.js linting
```

### Root Level
The root package.json only contains Xero integration dependencies.

## Architecture Overview

### Backend Architecture (NestJS)
- **Modular Structure**: Each feature has its own module (assets, customers, documents, etc.)
- **Authentication**: Clerk integration with custom guards and decorators
- **Database**: PostgreSQL with Prisma ORM, multi-tenant with organization scoping
- **Key Models**: Organization, Asset, Customer, Document, Inventory, Project, User roles/permissions
- **API Documentation**: Swagger UI available at `/api` endpoint

### Frontend Architecture (Next.js)
- **App Router**: Uses Next.js 14 app directory structure
- **State Management**: Redux Toolkit with Redux Saga for async operations
- **UI Framework**: Material-UI v6 with custom theming
- **Authentication**: Clerk integration for user authentication
- **Organization Context**: Multi-tenant organization switching
- **Document Generation**: Custom document templates with PDF generation

### Key Domain Concepts
- **Organizations**: Multi-tenant structure where all data is organization-scoped
- **Assets**: Hierarchical asset management with parent-child relationships
- **Documents**: Template-based document generation (invoices, quotations, delivery orders)
- **Inventory**: Asset-based inventory tracking with QR codes
- **Projects**: Project management with asset and customer associations
- **Users & Permissions**: Role-based access control with organization-specific roles

## Key Directories

### Backend Structure
- `src/auth/`: Clerk authentication guards and strategies
- `src/common/`: Shared services (Prisma, Xero integration)
- `src/organizations/`: Multi-tenant organization management
- `src/assets/`: Asset hierarchy and management
- `src/documents/`: Document generation and templates
- `src/users/`: User management and role assignments
- `prisma/`: Database schema and migrations

### Frontend Structure
- `app/portal/`: Main portal pages with nested routing
- `containers/`: Feature containers with Redux slices and sagas
- `components/`: Shared UI components
- `form-components/`: Reusable form components
- `helpers/`: Utility functions and API request helpers

## Working with the Codebase

### Database Changes
1. Modify `api-server-production/prisma/schema.prisma`
2. Run `npm run db:push` to apply changes
3. Update DTOs and services accordingly

### Adding New Features
1. Backend: Create new module in `src/` with controller, service, and DTOs
2. Frontend: Add container in `containers/` with Redux slice/saga if needed
3. Add navigation route in `app/portal/routes.ts`

### Authentication & Authorization
- All API endpoints are protected by Clerk authentication
- Use `@Permissions()` decorator for endpoint-level permissions
- Organization context is automatically injected via guards

### Document Templates
- Located in `containers/DocumentTemplates/components/`
- Support dynamic field generation and customization
- PDF generation with signature support

#### Cross-Org Shared Template Library
Document templates are a **cross-org shared pool**, not org-private:
- `DocumentTemplate` rows each have an owner `organizationId`, but the admin
  "Manage Templates" dialog (`app/portal/admin/organizations/[id]/page.tsx`)
  lists **every org's** templates of a type so an admin can activate any of them
  for the current org.
- `OrganizationActiveTemplate(organizationId, type, templateId)` (unique on
  `org,type`) records which shared template each org has activated. Activating a
  template upserts this selection — it no longer flips the legacy `isActive`
  boolean on the shared row.
- Resolution (`getTemplateVariantsByType`, `getDocumentTemplateByType`, and the
  AI-upload path in `documents.service.ts createFromExtraction`) reads the per-org
  selection first, then **falls back to legacy `isActive`** for orgs with no
  selection (so pre-existing orgs work without migration).
- **Propagation:** editing a shared template changes it for every org that
  activated it ("edit once → all orgs update"). It is NOT a clone model.
- The `GET /documentTemplates/variants/:type` endpoint is cross-org; only admin
  pages call it (no user-facing variant switcher), so it doesn't leak other orgs'
  templates to regular users.
- `CleanDocumentPreview` only differentiates designs by
  `tableColumnOrder`/`columnLabels`/`internalColumns` (read from inside its
  `data` prop) — not `styleConfig`/`formFields`/fonts. Seeded defaults live in
  `api-server-production/src/organizations/default-templates.ts`.