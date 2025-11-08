import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Req,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PriceHistoryService } from './price-history.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { Request } from 'express';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@ApiTags('price-history')
@Controller('price-history')
@UseGuards(ClerkAuthGuard)
export class PriceHistoryController {
  constructor(private readonly priceHistoryService: PriceHistoryService) {}

  @Get('asset/:assetId/last-price')
  @ApiOperation({ summary: 'Get last sold price for an asset' })
  @ApiQuery({ name: 'customerId', required: false })
  @Permissions('documents:read')
  async getLastSoldPrice(
    @Param('assetId') assetId: string,
    @Req() req: RequestWithOrganization,
    @Query('customerId') customerId?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', 400);
    }

    return await this.priceHistoryService.getLastSoldPrice(
      assetId,
      organizationId,
      customerId,
    );
  }

  @Get('asset/:assetId')
  @ApiOperation({ summary: 'Get price history for an asset' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @Permissions('documents:read')
  async getPriceHistory(
    @Param('assetId') assetId: string,
    @Req() req: RequestWithOrganization,
    @Query('customerId') customerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', 400);
    }

    return await this.priceHistoryService.getPriceHistory(assetId, organizationId, {
      customerId,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('report')
  @ApiOperation({ summary: 'Get price history report for all items' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'itemCode', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Permissions('documents:read')
  async getPriceHistoryReport(
    @Req() req: RequestWithOrganization,
    @Query('customerId') customerId?: string,
    @Query('itemCode') itemCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', 400);
    }

    return await this.priceHistoryService.getPriceHistoryReport(organizationId, {
      customerId,
      itemCode,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 25,
    });
  }

  @Get('export')
  @ApiOperation({ summary: 'Export price history report as CSV' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'itemCode', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'format', required: false })
  @Permissions('documents:read')
  async exportPriceHistory(
    @Req() req: RequestWithOrganization,
    @Query('customerId') customerId?: string,
    @Query('itemCode') itemCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('format') format?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', 400);
    }

    return await this.priceHistoryService.exportPriceHistory(organizationId, {
      customerId,
      itemCode,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      search,
      format: format || 'csv',
    });
  }
}