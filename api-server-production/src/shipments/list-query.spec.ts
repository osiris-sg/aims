import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListOrdersQuery } from './dto/order.dto';
import { ListShipmentsQuery } from './dto/shipment.dto';
import { ListSupplierOrdersQuery } from './dto/supplier-order.dto';

// Round AT: Orders › All sent bucket=all and got "bucket must be one of the following values: pending, completed".
// The app's global pipe (main.ts), fed the query strings the portal sends.
const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } });
const run = (metatype: any, value: Record<string, string>) => pipe.transform(value, { type: 'query', metatype } as ArgumentMetadata);

describe('round AT — list tabs and filters pass validation', () => {
  const C = 'f9da59cf-bc30-403f-9aec-bd2aeccc519e';
  it.each([
    { bucket: 'pending' },
    { bucket: 'completed' },
    { bucket: 'all' },
    { bucket: 'all', q: '#26', page: '1', pageSize: '25' },
    { bucket: 'all', customerId: C, shipMonth: '2026-10' },
    { bucket: 'all', supplierId: C, shipMonth: 'none' },
    { bucket: 'completed', contractId: C, q: '198GX06516' },
  ])('orders %o', async (q) => {
    await expect(run(ListOrdersQuery, q)).resolves.toBeDefined();
  });
  it('shipments and supplier orders take the same tabs', async () => {
    for (const bucket of ['pending', 'completed', 'all']) {
      await expect(run(ListShipmentsQuery, { bucket })).resolves.toBeDefined();
      await expect(run(ListSupplierOrdersQuery, { bucket })).resolves.toBeDefined();
    }
  });
  it('anything else is still refused', async () => {
    await expect(run(ListOrdersQuery, { bucket: 'everything' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
