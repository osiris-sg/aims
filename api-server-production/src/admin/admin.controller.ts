import { Controller, Get, Post, Body, Param, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Request } from 'express';
import { CreateUserDto } from './dto/create-user.dto';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('admin')
@UseGuards(ClerkAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Check if user is OsirisAdmin
  private async checkOsirisAdmin(req: RequestWithOrganization) {
    const userOrganization = req.userOrganization;
    if (!userOrganization || userOrganization.name !== 'osiris-platform') {
      throw new ForbiddenException('Access denied. Only OsirisAdmin can access these endpoints.');
    }
  }

  // ===== ASSETS ADMIN ENDPOINTS =====

  @Get('assets')
  async getAllAssets(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllAssets();
  }

  @Get('assets/organization/:organizationId')
  async getAssetsByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAssetsByOrganization(organizationId);
  }

  @Get('assets/:id')
  async getAssetById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAssetById(id);
  }

  // ===== INVENTORY ADMIN ENDPOINTS =====

  @Get('inventories')
  async getAllInventories(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllInventories();
  }

  @Get('inventories/organization/:organizationId')
  async getInventoriesByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getInventoriesByOrganization(organizationId);
  }

  @Get('inventories/:id')
  async getInventoryById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getInventoryById(id);
  }

  // ===== CUSTOMERS ADMIN ENDPOINTS =====

  @Get('customers')
  async getAllCustomers(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllCustomers();
  }

  @Get('customers/organization/:organizationId')
  async getCustomersByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getCustomersByOrganization(organizationId);
  }

  @Get('customers/:id')
  async getCustomerById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getCustomerById(id);
  }

  // ===== DOCUMENTS ADMIN ENDPOINTS =====

  @Get('documents')
  async getAllDocuments(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllDocuments();
  }

  @Get('documents/organization/:organizationId')
  async getDocumentsByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getDocumentsByOrganization(organizationId);
  }

  @Get('documents/:id')
  async getDocumentById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getDocumentById(id);
  }

  // ===== DOCUMENT TEMPLATES ADMIN ENDPOINTS =====

  @Get('document-templates')
  async getAllDocumentTemplates(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllDocumentTemplates();
  }

  @Get('document-templates/organization/:organizationId')
  async getDocumentTemplatesByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getDocumentTemplatesByOrganization(organizationId);
  }

  @Get('document-templates/:id')
  async getDocumentTemplateById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getDocumentTemplateById(id);
  }

  // ===== PROJECTS ADMIN ENDPOINTS =====

  @Get('projects')
  async getAllProjects(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllProjects();
  }

  @Get('projects/organization/:organizationId')
  async getProjectsByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getProjectsByOrganization(organizationId);
  }

  @Get('projects/:id')
  async getProjectById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getProjectById(id);
  }

  // ===== ORGANIZATIONS ADMIN ENDPOINTS =====

  @Get('organizations')
  async getAllOrganizations(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllOrganizations();
  }

  @Get('organizations/:id')
  async getOrganizationById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getOrganizationById(id);
  }

  @Get('organizations/:id/stats')
  async getOrganizationStats(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getOrganizationStats(id);
  }

  // ===== DASHBOARD/STATS ADMIN ENDPOINTS =====

  @Get('dashboard/stats')
  async getDashboardStats(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getDashboardStats();
  }

  @Get('dashboard/recent-activity')
  async getRecentActivity(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getRecentActivity();
  }

  // ===== USER ORGANIZATIONS ADMIN ENDPOINTS =====

  @Get('user-organizations')
  async getAllUserOrganizations(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllUserOrganizations();
  }

  @Get('user-organizations/organization/:organizationId')
  async getUserOrganizationsByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getUserOrganizationsByOrganization(organizationId);
  }

  // ===== USERS ADMIN ENDPOINTS =====

  @Get('users')
  async getAllUsers(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    const users = await this.adminService.getAllUsers();
    console.log('Users', users);
    return {
      success: true,
      data: users,
    };
  }

  @Post('users')
  async createUser(@Body() createUserDto: CreateUserDto, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.createUser(createUserDto);
  }


  // ===== USER ROLES ADMIN ENDPOINTS =====
  @Get('user-permissions')
  async getAllUserPermissions(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllUserPermissions();
  }
  @Get("roles/:organizationId")
  async getUserRolesByOrganization(@Param('organizationId') organizationId: string, @Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getUserRolesByOrganization(organizationId);
  }

  @Get('roles')
  async getAllRoles(@Req() req: RequestWithOrganization) {
    await this.checkOsirisAdmin(req);
    return this.adminService.getAllRoles();
  }
}
