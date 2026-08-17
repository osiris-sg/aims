/** Ad-hoc harness: exercise the Operator's identity + tool layer without Telegram. */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OperatorAuthService } from '../src/operator/operator-auth.service';
import { OperatorToolsService } from '../src/operator/operator-tools.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const auth = app.get(OperatorAuthService);
  const tools = app.get(OperatorToolsService);

  console.log('\n=== 1. identity resolution ===');
  const res = await auth.resolve('telegram', '999000111');
  if (!res.ok || !res.ctx) {
    console.log('  ❌ resolve failed:', res.reason);
    await app.close();
    return;
  }
  const ctx = res.ctx;
  console.log(`  ✅ org: ${ctx.organizationName} (${ctx.organizationId})`);
  console.log(`     user: ${ctx.clerkUserId} | roles: ${ctx.roles.map((r) => r.name).join(', ')} | osirisAdmin: ${ctx.isOsirisAdmin}`);

  console.log('\n=== 2. permission checks ===');
  for (const p of [['customers:read'], ['documents:create-basic'], ['nonsense:destroy']]) {
    console.log(`  ${p[0]}: ${auth.hasPermission(ctx, p) ? 'ALLOW' : 'DENY'}`);
  }

  console.log('\n=== 3. tools exposed to this user ===');
  const defs = tools.definitions(ctx);
  console.log('  ' + defs.map((d) => d.name).join(', '));

  console.log('\n=== 4. find_customer ===');
  const cust = await tools.execute(ctx, 'find_customer', { query: 'a' });
  const first = Array.isArray(cust.result) ? cust.result[0] : null;
  console.log('  ' + JSON.stringify(Array.isArray(cust.result) ? cust.result.slice(0, 3) : cust.result).slice(0, 300));

  console.log('\n=== 5. find_item ===');
  const item = await tools.execute(ctx, 'find_item', { query: 'a' });
  const firstItem = Array.isArray(item.result) ? item.result[0] : null;
  console.log('  ' + JSON.stringify(Array.isArray(item.result) ? item.result.slice(0, 3) : item.result).slice(0, 300));

  console.log('\n=== 6. list_recent_documents ===');
  const list = await tools.execute(ctx, 'list_recent_documents', { type: 'QUOTATION', limit: 3 });
  console.log('  ' + JSON.stringify(list.result).slice(0, 400));

  if (process.argv.includes('--write') && first && firstItem) {
    console.log('\n=== 7. create_quotation (WRITE) ===');
    const made = await tools.execute(ctx, 'create_quotation', {
      customerId: first.id,
      items: [
        { itemId: firstItem.id, quantity: 2, description: firstItem.name },
        { quantity: 3, description: 'Operator test service line', unitPrice: 100, isService: true },
      ],
      notes: 'Created by the operator test harness',
    });
    console.log('  ' + JSON.stringify(made.result).slice(0, 500));

    if ((made.result as any)?.documentId) {
      console.log('\n=== 8. preview_document ===');
      const prev = await tools.execute(ctx, 'preview_document', { documentId: (made.result as any).documentId });
      console.log('  result: ' + JSON.stringify(prev.result).slice(0, 200));
      console.log('  pdf: ' + (prev.preview?.url ? prev.preview.url.slice(0, 90) + '…' : 'NONE'));

      console.log('\n=== 9. confirm_document (should HOLD for confirmation) ===');
      const conf = await tools.execute(ctx, 'confirm_document', { documentId: (made.result as any).documentId });
      console.log('  result: ' + JSON.stringify(conf.result));
      console.log('  pending: ' + JSON.stringify(conf.pending));
    }
  }

  await app.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
