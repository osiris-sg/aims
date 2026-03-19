import { Controller, Get, Post, Body, Query, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ImportService } from './import.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

@Controller('import')
@UseGuards(ClerkAuthGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get('invoices')
  async getInvoices(
    @Query('status') status?: 'pending' | 'confirmed' | 'skipped',
    @Query('confidence') confidence?: 'high' | 'medium' | 'low' | 'unmatched',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    try {
      return await this.importService.getInvoices(
        status,
        confidence,
        page ? parseInt(page) : 1,
        limit ? parseInt(limit) : 20,
        search,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('stats')
  async getStats() {
    try {
      return await this.importService.getStats();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('confirm')
  async confirmInvoice(
    @Body() body: { invoiceNumber: string; lineItems: any[]; projectLocation: string },
  ) {
    try {
      return await this.importService.confirmInvoice(body.invoiceNumber, body.lineItems, body.projectLocation);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('bulk-confirm')
  async bulkConfirm(@Body() body: { invoiceNumbers: string[] }) {
    try {
      return await this.importService.bulkConfirm(body.invoiceNumbers);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('skip')
  async skipInvoice(@Body() body: { invoiceNumber: string; reason: string }) {
    try {
      return await this.importService.skipInvoice(body.invoiceNumber, body.reason);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('create-asset')
  async createAsset(
    @Body() body: { name: string; skuKey: string; categoryId?: string; categoryName?: string; price?: number; uom: string; isTracked: boolean; description?: string; minQuantity?: number },
  ) {
    try {
      return await this.importService.createAsset(body);
    } catch (error) {
      if (error.code === 'P2002') {
        throw new HttpException('Asset with this SKU already exists in the organization.', HttpStatus.CONFLICT);
      }
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('import-single')
  async importSingle(@Body() body: any) {
    try {
      return await this.importService.importSingleInvoice(body);
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('run-import')
  async runImport() {
    try {
      return await this.importService.runImport();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('assets')
  async getAssets() {
    try {
      return await this.importService.getAssets();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('customers')
  async getCustomers() {
    try {
      return await this.importService.getCustomers();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('projects')
  async getProjects() {
    try {
      return await this.importService.getProjects();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('categories')
  async getCategories() {
    try {
      return await this.importService.getCategories();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('site-offices/:customerId')
  async getSiteOffices(@Param('customerId') customerId: string) {
    try {
      return await this.importService.getSiteOffices(customerId);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('create-site-office')
  async createSiteOffice(
    @Body() body: { name: string; address?: string; customerId: string },
  ) {
    try {
      return await this.importService.createSiteOffice(body);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('create-project')
  async createProject(
    @Body() body: { name: string; customerId: string; siteOfficeId?: string; startDate?: string; endDate?: string },
  ) {
    try {
      return await this.importService.createProject(body);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
