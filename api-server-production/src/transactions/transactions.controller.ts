import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TransactionType } from '@prisma/client';

interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
  auth?: {
    userId: string;
  };
}

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
@UseGuards(ClerkAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @Permissions('transactions:create')
  @ApiOperation({ summary: 'Create a manual transaction (adjustment, opening balance, etc.)' })
  @ApiResponse({ status: 201, description: 'Transaction created successfully' })
  create(@Body() createTransactionDto: CreateTransactionDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.transactionsService.create(createTransactionDto, organizationId);
  }

  @Get()
  @Permissions('transactions:read')
  @ApiOperation({ summary: 'Get all transactions with optional filters' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'transactionType', required: false, enum: TransactionType })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns list of transactions' })
  findAll(@Req() req: RequestWithOrganization, @Query() query) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.transactionsService.findAll(organizationId, {
      customerId: query.customerId,
      transactionType: query.transactionType,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  @Get('customer/:customerId')
  @Permissions('transactions:read')
  @ApiOperation({ summary: 'Get transactions for a specific customer' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({ status: 200, description: 'Returns customer transactions' })
  findByCustomer(
    @Param('customerId') customerId: string,
    @Req() req: RequestWithOrganization,
    @Query() query,
  ) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.transactionsService.findByCustomer(customerId, organizationId, {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Post('customer/:customerId/recalculate')
  @Permissions('transactions:update')
  @ApiOperation({ summary: 'Recalculate all transaction balances for a customer' })
  @ApiResponse({ status: 200, description: 'Balances recalculated successfully' })
  recalculateBalances(@Param('customerId') customerId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.transactionsService.recalculateCustomerBalances(customerId, organizationId);
  }

  @Get(':id')
  @Permissions('transactions:read')
  @ApiOperation({ summary: 'Get a transaction by ID' })
  @ApiResponse({ status: 200, description: 'Returns transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  findOne(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.transactionsService.findOne(id, organizationId);
  }

  @Delete(':id')
  @Permissions('transactions:delete')
  @ApiOperation({ summary: 'Delete a manual transaction' })
  @ApiResponse({ status: 200, description: 'Transaction deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete auto-generated transactions' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  remove(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.transactionsService.remove(id, organizationId);
  }
}
