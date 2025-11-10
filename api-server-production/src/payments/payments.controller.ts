import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
  auth?: {
    userId: string;
  };
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(ClerkAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Record a new payment' })
  @ApiResponse({ status: 201, description: 'Payment recorded successfully' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  create(@Body() createPaymentDto: CreatePaymentDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    const userId = req.auth?.userId || 'system';

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.paymentsService.create(createPaymentDto, organizationId, userId);
  }

  @Get()
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Get all payments with optional filters' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'paymentMethod', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns list of payments' })
  findAll(@Req() req: RequestWithOrganization, @Query() query) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.paymentsService.findAll(organizationId, {
      customerId: query.customerId,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      paymentMethod: query.paymentMethod,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  @Get('document/:documentId')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Get payments for a specific document' })
  @ApiResponse({ status: 200, description: 'Returns payments for the document' })
  findByDocument(@Param('documentId') documentId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.paymentsService.findByDocument(documentId, organizationId);
  }

  @Get(':id')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Get a payment by ID' })
  @ApiResponse({ status: 200, description: 'Returns payment details' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  findOne(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.paymentsService.findOne(id, organizationId);
  }

  @Patch(':id')
  @Permissions('payments:update')
  @ApiOperation({ summary: 'Update a payment' })
  @ApiResponse({ status: 200, description: 'Payment updated successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.paymentsService.update(id, updatePaymentDto, organizationId);
  }

  @Delete(':id')
  @Permissions('payments:delete')
  @ApiOperation({ summary: 'Delete a payment' })
  @ApiResponse({ status: 200, description: 'Payment deleted successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  remove(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.paymentsService.remove(id, organizationId);
  }
}
