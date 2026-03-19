const express = require('express');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const app = express();
app.use(express.json({ limit: '10mb' }));

const prisma = new PrismaClient();
const ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const PREFILLED_PATH = path.resolve(__dirname, '../xero-import-prefilled.json');
const CONFIRMED_PATH = path.resolve(__dirname, './confirmed-invoices.json');

// --- Helpers ---

function loadPrefilled() {
  return JSON.parse(fs.readFileSync(PREFILLED_PATH, 'utf-8'));
}

function loadConfirmed() {
  if (fs.existsSync(CONFIRMED_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIRMED_PATH, 'utf-8'));
  }
  return { confirmed: {}, skipped: {} };
}

function saveConfirmed(data) {
  fs.writeFileSync(CONFIRMED_PATH, JSON.stringify(data, null, 2));
}

function mapXeroStatus(xeroStatus) {
  const s = (xeroStatus || '').toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'approved' || s === 'authorised') return 'confirmed';
  return 'draft';
}

// --- Routes ---

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve any other static files from same directory
app.use(express.static(__dirname));

// GET /api/invoices
app.get('/api/invoices', (req, res) => {
  try {
    const prefilled = loadPrefilled();
    const confirmed = loadConfirmed();
    const { status, confidence } = req.query;

    let invoices = prefilled.invoices || [];

    // Merge review status from confirmed file
    invoices = invoices.map((inv) => {
      const invNum = inv.invoiceNumber || inv.xeroInvoiceNumber;
      if (confirmed.confirmed[invNum]) {
        return { ...inv, reviewStatus: 'confirmed', ...confirmed.confirmed[invNum] };
      }
      if (confirmed.skipped[invNum]) {
        return { ...inv, reviewStatus: 'skipped', skipReason: confirmed.skipped[invNum].reason };
      }
      return { ...inv, reviewStatus: 'pending' };
    });

    // Filter by review status
    if (status) {
      invoices = invoices.filter((inv) => inv.reviewStatus === status);
    }

    // Filter by match confidence
    if (confidence) {
      invoices = invoices.filter((inv) => {
        if (!inv.lineItems) return confidence === 'unmatched';
        const hasConfidence = inv.lineItems.some((li) => li.confidence === confidence);
        if (confidence === 'unmatched') {
          return inv.lineItems.some((li) => !li.assetId && !li.confidence);
        }
        return hasConfidence;
      });
    }

    res.json({
      summary: prefilled.summary || {},
      invoices,
    });
  } catch (err) {
    console.error('GET /api/invoices error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  try {
    const prefilled = loadPrefilled();
    const confirmed = loadConfirmed();
    const invoices = prefilled.invoices || [];
    const confirmedKeys = Object.keys(confirmed.confirmed || {});
    const skippedKeys = Object.keys(confirmed.skipped || {});
    const total = invoices.length;
    const confirmedCount = confirmedKeys.length;
    const skippedCount = skippedKeys.length;
    const pendingCount = total - confirmedCount - skippedCount;

    // Match rate stats
    let totalLines = 0;
    let matchedLines = 0;
    let highConfidence = 0;
    let mediumConfidence = 0;
    let lowConfidence = 0;
    let unmatched = 0;

    invoices.forEach((inv) => {
      (inv.lineItems || []).forEach((li) => {
        totalLines++;
        if (li.assetId) {
          matchedLines++;
          if (li.confidence === 'high') highConfidence++;
          else if (li.confidence === 'medium') mediumConfidence++;
          else if (li.confidence === 'low') lowConfidence++;
          else matchedLines--; // no confidence tag means unmatched even with assetId
        }
        if (!li.assetId) unmatched++;
      });
    });

    res.json({
      total,
      confirmed: confirmedCount,
      skipped: skippedCount,
      pending: pendingCount,
      matchRate: {
        totalLines,
        matchedLines,
        highConfidence,
        mediumConfidence,
        lowConfidence,
        unmatched,
      },
    });
  } catch (err) {
    console.error('GET /api/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/assets
app.get('/api/assets', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { organizationId: ORG_ID, deletedAt: null },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    res.json(
      assets.map((a) => ({
        id: a.id,
        name: a.name,
        skuKey: a.skuKey,
        categoryId: a.categoryId,
        categoryName: a.category?.name || null,
        price: a.price,
        uom: a.uom,
        isTracked: a.isTracked,
      }))
    );
  } catch (err) {
    console.error('GET /api/assets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers
app.get('/api/customers', async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { organizationId: ORG_ID },
      orderBy: { name: 'asc' },
    });

    res.json(
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        customerCode: c.customerCode,
      }))
    );
  } catch (err) {
    console.error('GET /api/customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { organizationId: ORG_ID },
      orderBy: { name: 'asc' },
    });

    res.json(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      }))
    );
  } catch (err) {
    console.error('GET /api/projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { organizationId: ORG_ID },
      orderBy: { name: 'asc' },
    });

    res.json(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
      }))
    );
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/confirm
app.post('/api/confirm', (req, res) => {
  try {
    const { invoiceNumber, lineItems, projectLocation } = req.body;
    if (!invoiceNumber) {
      return res.status(400).json({ error: 'invoiceNumber is required' });
    }

    const confirmed = loadConfirmed();
    confirmed.confirmed[invoiceNumber] = {
      lineItems,
      projectLocation,
      confirmedAt: new Date().toISOString(),
    };
    // Remove from skipped if it was there
    delete confirmed.skipped[invoiceNumber];
    saveConfirmed(confirmed);

    res.json({ success: true, invoiceNumber });
  } catch (err) {
    console.error('POST /api/confirm error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bulk-confirm
app.post('/api/bulk-confirm', (req, res) => {
  try {
    const { invoiceNumbers } = req.body;
    if (!Array.isArray(invoiceNumbers) || invoiceNumbers.length === 0) {
      return res.status(400).json({ error: 'invoiceNumbers array is required' });
    }

    const prefilled = loadPrefilled();
    const confirmed = loadConfirmed();
    const invoiceMap = {};
    (prefilled.invoices || []).forEach((inv) => {
      const key = inv.invoiceNumber || inv.xeroInvoiceNumber;
      invoiceMap[key] = inv;
    });

    let confirmedCount = 0;
    invoiceNumbers.forEach((num) => {
      const inv = invoiceMap[num];
      if (inv && !confirmed.confirmed[num]) {
        confirmed.confirmed[num] = {
          lineItems: inv.lineItems,
          projectLocation: inv.projectLocation || null,
          confirmedAt: new Date().toISOString(),
          bulkConfirmed: true,
        };
        delete confirmed.skipped[num];
        confirmedCount++;
      }
    });

    saveConfirmed(confirmed);
    res.json({ success: true, confirmedCount });
  } catch (err) {
    console.error('POST /api/bulk-confirm error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skip
app.post('/api/skip', (req, res) => {
  try {
    const { invoiceNumber, reason } = req.body;
    if (!invoiceNumber) {
      return res.status(400).json({ error: 'invoiceNumber is required' });
    }

    const confirmed = loadConfirmed();
    confirmed.skipped[invoiceNumber] = {
      reason: reason || '',
      skippedAt: new Date().toISOString(),
    };
    // Remove from confirmed if it was there
    delete confirmed.confirmed[invoiceNumber];
    saveConfirmed(confirmed);

    res.json({ success: true, invoiceNumber });
  } catch (err) {
    console.error('POST /api/skip error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/create-asset
app.post('/api/create-asset', async (req, res) => {
  try {
    const { name, skuKey, categoryId, price, uom, isTracked } = req.body;
    if (!name || !skuKey || !categoryId) {
      return res.status(400).json({ error: 'name, skuKey, and categoryId are required' });
    }

    const asset = await prisma.asset.create({
      data: {
        name,
        skuKey,
        categoryId,
        price: price != null ? parseFloat(price) : null,
        uom: uom || 'PCS',
        isTracked: isTracked != null ? isTracked : false,
        organizationId: ORG_ID,
      },
    });

    res.json(asset);
  } catch (err) {
    // Handle unique constraint violation
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: `Asset with SKU "${req.body.skuKey}" already exists in this organization`,
        code: 'DUPLICATE_SKU',
      });
    }
    console.error('POST /api/create-asset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/create-project
app.post('/api/create-project', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const project = await prisma.project.create({
      data: {
        name,
        description: description || null,
        organizationId: ORG_ID,
        status: 'pending',
      },
    });

    res.json(project);
  } catch (err) {
    console.error('POST /api/create-project error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/run-import
app.post('/api/run-import', async (req, res) => {
  try {
    const confirmed = loadConfirmed();
    const prefilled = loadPrefilled();
    const invoiceMap = {};
    (prefilled.invoices || []).forEach((inv) => {
      const key = inv.invoiceNumber || inv.xeroInvoiceNumber;
      invoiceMap[key] = inv;
    });

    const confirmedNumbers = Object.keys(confirmed.confirmed || {});
    if (confirmedNumbers.length === 0) {
      return res.json({ imported: 0, skipped: 0, errors: [], message: 'No confirmed invoices to import' });
    }

    // Find or create a default INVOICE template for this org
    let template = await prisma.documentTemplate.findFirst({
      where: {
        organizationId: ORG_ID,
        type: 'INVOICE',
      },
      orderBy: { isActive: 'desc' },
    });

    // Fallback: find any TI or TI2 template
    if (!template) {
      template = await prisma.documentTemplate.findFirst({
        where: {
          organizationId: ORG_ID,
          type: { in: ['TI', 'TI2'] },
        },
        orderBy: { isActive: 'desc' },
      });
    }

    if (!template) {
      return res.status(400).json({
        error: 'No INVOICE document template found for this organization. Please create one first.',
      });
    }

    console.log('Using template:', template.id, template.name, 'type:', template.type);

    // Load all customers for name lookup
    const customers = await prisma.customer.findMany({
      where: { organizationId: ORG_ID },
    });
    const customerByName = {};
    customers.forEach((c) => {
      customerByName[c.name.toLowerCase().trim()] = c;
    });

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // Process in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < confirmedNumbers.length; i += BATCH_SIZE) {
      const batch = confirmedNumbers.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (invoiceNumber) => {
          try {
            const originalInvoice = invoiceMap[invoiceNumber];
            const confirmedData = confirmed.confirmed[invoiceNumber];

            if (!originalInvoice) {
              errors.push({ invoiceNumber, error: 'Original invoice data not found in prefilled JSON' });
              return;
            }

            // Check for duplicates - skip if document name already exists
            const existing = await prisma.document.findFirst({
              where: {
                name: invoiceNumber,
                organizationId: ORG_ID,
                documentTemplateId: template.id,
              },
            });

            if (existing) {
              skipped++;
              return;
            }

            // Find customer
            const customerName = (originalInvoice.customerName || originalInvoice.customer || '').toLowerCase().trim();
            const customer = customerByName[customerName];

            // Build line items for config, filtering out reference-only lines
            const lineItems = (confirmedData.lineItems || originalInvoice.lineItems || [])
              .filter((li) => {
                // Skip reference-only lines (quantity 0 or no meaningful data)
                const qty = parseFloat(li.quantity) || 0;
                return qty > 0 || li.assetId;
              })
              .map((li, idx) => ({
                inventoryItemId: li.assetId || null,
                sku: li.sku || li.skuKey || '',
                description: li.description || '',
                quantity: parseFloat(li.quantity) || 0,
                unitPrice: parseFloat(li.unitPrice) || 0,
                discount: parseFloat(li.discount) || 0,
                amount: parseFloat(li.amount) || (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0),
                uom: li.uom || 'PCS',
              }));

            // Build the document config
            const config = {
              customerId: customer ? customer.id : null,
              customer: customer ? { id: customer.id, name: customer.name } : null,
              date: originalInvoice.date || originalInvoice.invoiceDate || null,
              dueDate: originalInvoice.dueDate || null,
              items: lineItems,
              // Xero import metadata
              xeroImported: true,
              xeroInvoiceNumber: invoiceNumber,
              xeroStatus: originalInvoice.status || originalInvoice.xeroStatus || null,
              xeroGross: parseFloat(originalInvoice.total || originalInvoice.gross || originalInvoice.amount || 0),
              xeroBalance: parseFloat(originalInvoice.amountDue || originalInvoice.balance || 0),
            };

            // If there's a project location, add it
            if (confirmedData.projectLocation) {
              config.projectId = confirmedData.projectLocation;
            }

            // Map Xero status to DocumentStatus
            const docStatus = mapXeroStatus(originalInvoice.status || originalInvoice.xeroStatus);

            // Create the Document
            const doc = await prisma.document.create({
              data: {
                documentTemplateId: template.id,
                type: template.type,
                config,
                organizationId: ORG_ID,
                name: invoiceNumber,
                status: docStatus,
              },
            });

            // Create DocumentItem records for non-reference line items
            const documentItemsData = [];
            for (let j = 0; j < lineItems.length; j++) {
              const li = lineItems[j];
              const itemId = li.inventoryItemId;
              if (!itemId) continue;

              // Determine item type by checking if it exists in inventory or asset
              let itemType = 'ASSET'; // Default to ASSET since we're matching to assets
              const inventoryItem = await prisma.inventory.findUnique({ where: { id: itemId } }).catch(() => null);
              if (inventoryItem) {
                itemType = 'INVENTORY';
              }

              documentItemsData.push({
                documentId: doc.id,
                itemId,
                itemType,
                sku: li.sku || null,
                description: li.description || null,
                quantity: li.quantity || 0,
                unitPrice: li.unitPrice || 0,
                discount: li.discount || 0,
                amount: li.amount || 0,
                uom: li.uom || null,
                lineNumber: j + 1,
              });
            }

            if (documentItemsData.length > 0) {
              await prisma.documentItem.createMany({
                data: documentItemsData,
                skipDuplicates: true,
              });
            }

            imported++;
            console.log(`Imported: ${invoiceNumber} -> ${doc.id} (status: ${docStatus})`);
          } catch (err) {
            console.error(`Error importing ${invoiceNumber}:`, err);
            errors.push({ invoiceNumber, error: err.message });
          }
        })
      );
    }

    res.json({
      imported,
      skipped,
      errors,
      total: confirmedNumbers.length,
      message: `Import complete. ${imported} imported, ${skipped} skipped (duplicates), ${errors.length} errors.`,
    });
  } catch (err) {
    console.error('POST /api/run-import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Start server ---

const PORT = 3456;
app.listen(PORT, () => {
  console.log(`\nXero Invoice Import Review Tool`);
  console.log(`================================`);
  console.log(`Running at: http://localhost:${PORT}`);
  console.log(`Organization: ${ORG_ID}`);
  console.log(`Prefilled JSON: ${PREFILLED_PATH}`);
  console.log(`Confirmed file: ${CONFIRMED_PATH}\n`);
});
