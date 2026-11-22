import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { gzipListMiddleware } from './gzip-list';

@Controller()
class BigController {
  @Get('orders')
  list() {
    return { data: Array.from({ length: 2000 }, (_, i) => ({ id: i, orderNumber: `ORD-Q-${i}`, customer: { name: 'Customer name' } })) };
  }
  @Get('documents')
  docs() {
    return { data: Array.from({ length: 2000 }, (_, i) => ({ id: i })) };
  }
}

@Module({ controllers: [BigController] })
class BigModule {}

describe('gzip middleware in a real Nest / Express app', () => {
  it('GET /orders is gzipped (and reads back the same); other routes are not', async () => {
    const mod = await Test.createTestingModule({ imports: [BigModule] }).compile();
    const app = mod.createNestApplication();
    app.use(gzipListMiddleware);
    await app.init();
    const res = await request(app.getHttpServer()).get('/orders?part=imported').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.data).toHaveLength(2000);
    const other = await request(app.getHttpServer()).get('/documents').set('Accept-Encoding', 'gzip');
    expect(other.headers['content-encoding']).toBeUndefined();
    await app.close();
  });
});
