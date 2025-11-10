# AIMS Accounting Module - Setup & Usage Guide

## 🎉 Overview

The AIMS system now includes a comprehensive accounting module that tracks customer balances, payments, and generates financial reports. This guide will help you set up and use the new accounting features.

## ✅ What's Included

### Backend (API Server)
- **Payment Management** - Record and track customer payments
- **Transaction Ledger** - Unified financial transaction system
- **Customer Balances** - Opening and running balance tracking
- **Statement of Account** - Generate SOA reports with aging analysis
- **Automatic Integration** - Invoices automatically create accounting transactions

### Frontend (Portal)
- **Payments Page** (`/portal/payments`) - Record and manage payments
- **Statement of Account** (`/portal/reports/statement-of-account`) - View customer SOA with aging

## 📋 Setup Instructions

### Step 1: Database is Already Migrated ✅
The database schema has been updated with the new accounting tables:
- `Payment`
- `Transaction`
- `CustomerBalance`

### Step 2: Permissions Have Been Added ✅
The seed script has been run and added these permissions:
- `payments:create`, `payments:read`, `payments:update`, `payments:delete`
- `transactions:create`, `transactions:read`, `transactions:update`, `transactions:delete`
- `statements:read`

### Step 3: Initialize Modules for Your Organization

Run the module initialization script for your organization:

```bash
cd api-server-production
npx ts-node scripts/init-accounting-modules.ts <YOUR_ORGANIZATION_ID>
```

**To find your organization ID:**
1. Go to the admin panel
2. Navigate to Organizations
3. Copy your organization ID

**Example:**
```bash
npx ts-node scripts/init-accounting-modules.ts org_2abc123xyz
```

This script will:
- Add the "Payments" module to your navigation
- Add "Statement of Account" to your Reports module
- Configure the proper routes and permissions

### Step 4: Assign Permissions to Roles

1. Go to `/portal/admin/roles`
2. Edit the roles you want to grant accounting access to
3. Assign the following permissions:
   - **For Accountants/Finance Team:**
     - `payments:create`, `payments:read`, `payments:update`, `payments:delete`
     - `statements:read`
     - `transactions:read`, `transactions:update` (for balance recalculation)
   - **For Managers:**
     - `payments:read`
     - `statements:read`
   - **For Sales/Regular Users:**
     - `statements:read` (view only)

### Step 5: Refresh Your Browser
After completing the above steps, refresh your browser to see the new menu items in the sidebar.

## 🔄 How It Works

### Automatic Transaction Creation

**When you confirm an invoice:**
1. Invoice is marked as "confirmed"
2. System automatically creates a `Transaction` record:
   - Type: `INVOICE`
   - Debit: Total invoice amount
   - Customer balance increases
3. Price history is saved (existing feature)

**Example:**
```
Invoice for $1,000 confirmed
→ Transaction created: Debit $1,000
→ Customer balance: $0 → $1,000
→ Customer now owes you $1,000
```

### Recording Payments

**To record a payment:**
1. Go to `/portal/payments`
2. Click "Record Payment"
3. Select customer
4. Select the invoice
5. Enter payment amount and method
6. Submit

**What happens:**
1. `Payment` record is created
2. System automatically creates a `Transaction` record:
   - Type: `PAYMENT`
   - Credit: Payment amount
   - Customer balance decreases
3. Running balance is updated

**Example:**
```
Customer pays $500
→ Payment record created
→ Transaction created: Credit $500
→ Customer balance: $1,000 → $500
→ Customer now owes you $500
```

### Viewing Statement of Account

**To generate an SOA:**
1. Go to `/portal/reports/statement-of-account`
2. Select customer
3. Optionally set date range
4. Click "Generate"

**The statement shows:**
- Customer information
- Opening balance
- All transactions (invoices and payments)
- Monthly summaries
- Aging analysis (0-30, 31-60, 61-90, 91-120, 121+ days)
- Current balance
- Export to CSV or Print options

## 📊 Understanding the Ledger

### Transaction Types
- **INVOICE** - When invoice is confirmed (Debit - increases what they owe)
- **PAYMENT** - When customer pays (Credit - decreases what they owe)
- **CREDIT_NOTE** - Refunds or credits (Credit)
- **DEBIT_NOTE** - Additional charges (Debit)
- **ADJUSTMENT** - Manual corrections (Debit or Credit)
- **OPENING_BALANCE** - Import existing balances (Debit or Credit)

### Debit vs Credit (Customer Perspective)
- **Debit** = Money customer OWES you (increases balance)
- **Credit** = Money customer PAID you (decreases balance)
- **Balance** = Running total (what customer owes)

**Example Ledger:**
| Date | Reference | Description | Debit | Credit | Balance |
|------|-----------|-------------|-------|--------|---------|
| Jan 1 | INV-001 | Invoice | $1,000 | $0 | $1,000 |
| Jan 15 | PAY-001 | Cash payment | $0 | $500 | $500 |
| Feb 1 | INV-002 | Invoice | $800 | $0 | $1,300 |

## 🔧 Manual Adjustments

Sometimes you need to manually adjust balances (opening balances, corrections, etc.):

### Using the API:
```bash
POST /transactions
{
  "customerId": "customer-id",
  "transactionType": "OPENING_BALANCE",
  "transactionDate": "2025-01-01",
  "reference": "Opening Balance",
  "description": "Import existing balance",
  "debit": 5000,  // If customer owed you money
  "credit": 0
}
```

### Recalculate Balances:
If balances get out of sync, you can recalculate:
```bash
POST /transactions/customer/{customerId}/recalculate
```

## 📱 API Endpoints

### Payments
- `POST /payments` - Record new payment
- `GET /payments` - List all payments (with filters)
- `GET /payments/:id` - Get payment details
- `GET /payments/document/:documentId` - Get payments for invoice
- `PATCH /payments/:id` - Update payment
- `DELETE /payments/:id` - Delete payment

### Transactions
- `POST /transactions` - Create manual transaction
- `GET /transactions` - List transactions
- `GET /transactions/customer/:customerId` - Get customer transactions
- `POST /transactions/customer/:customerId/recalculate` - Recalculate balances
- `DELETE /transactions/:id` - Delete manual transaction

### Statements
- `POST /statements/soa` - Generate Statement of Account
- `GET /statements/aging-summary` - Get aging report for all customers

## 🎯 Common Use Cases

### 1. Import Opening Balances
For existing customers with outstanding balances:

```javascript
// Create opening balance transaction
POST /transactions
{
  "customerId": "cust-123",
  "transactionType": "OPENING_BALANCE",
  "transactionDate": "2025-01-01",
  "reference": "Opening Balance 2025",
  "description": "Existing balance brought forward",
  "debit": 10000,
  "credit": 0
}
```

### 2. Partial Payments
Currently, the system supports full payments only. For partial payments:
1. Record the partial amount as a payment
2. The remaining balance will automatically be calculated
3. Record additional payments as customer pays more

### 3. Credit Notes
If you need to issue a credit note (refund):

```javascript
POST /transactions
{
  "customerId": "cust-123",
  "transactionType": "CREDIT_NOTE",
  "documentId": "inv-456",  // Original invoice
  "transactionDate": "2025-01-15",
  "reference": "CN-001",
  "description": "Credit note for returned goods",
  "debit": 0,
  "credit": 500  // Amount to credit
}
```

### 4. Aging Analysis for Collections
To see which customers have overdue invoices:

```javascript
GET /statements/aging-summary
```

Returns a breakdown of outstanding amounts by age for all customers.

## 🔐 Security & Permissions

The system uses role-based permissions:

- **payments:*** - Control payment recording
- **transactions:*** - Control manual transaction creation
- **statements:read** - Control who can view financial reports

Make sure to assign appropriate permissions based on user roles.

## 🐛 Troubleshooting

### Invoices not creating transactions?
Check that:
1. The invoice type is `INVOICE`, `TI`, or `TI2`
2. The invoice is being marked as "confirmed"
3. The invoice has a customer with a valid ID
4. Check backend logs for errors

### Balances don't match?
Run the recalculate command:
```bash
POST /transactions/customer/{customerId}/recalculate
```

### Menu items not showing?
1. Verify you ran the module initialization script
2. Check that permissions are assigned to your role
3. Refresh your browser (hard refresh: Ctrl+F5 or Cmd+Shift+R)
4. Check the configuration in `/portal/admin/configuration`

### Transactions not appearing in SOA?
1. Verify the transaction's organizationId matches
2. Check the date range filter
3. Ensure customer ID is correct

## 📈 Future Enhancements

Potential features for future development:
- Partial payment support
- Recurring invoices
- Payment reminders
- Email SOA to customers
- Multi-currency support
- Tax tracking
- General Ledger reports
- Profit & Loss statements
- Dashboard widgets for AR aging

## 💡 Tips

1. **Always confirm invoices** - Transactions are only created when invoices are confirmed
2. **Use opening balances** - Import existing customer balances when starting
3. **Regular reconciliation** - Use the aging report to track overdue accounts
4. **Backup before adjustments** - Manual adjustments can't be undone easily
5. **Assign proper permissions** - Not everyone needs delete/update access

## 📞 Support

For issues or questions:
1. Check the backend logs: `api-server-production/logs`
2. Check browser console for frontend errors
3. Review the API responses in Network tab
4. Verify database records in Prisma Studio: `npm run db:studio`

---

**Last Updated:** January 2025
**Version:** 1.0.0
