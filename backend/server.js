const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool, initializeDatabase, withTransaction } = require('./db');
const root = path.resolve(__dirname, '..', 'cake');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const safeName = path.basename(file.originalname, extension).replace(/[^a-z0-9-_]/gi, '-').replace(/-+/g, '-').slice(0, 50);
      cb(null, `${Date.now()}-${safeName || 'image'}${extension}`);
    }
  }),
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)),
  limits: { files: 12, fileSize: 8 * 1024 * 1024 }
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

function productData(item = {}) {
  return {
    name: item.name || 'Untitled',
    description: item.description || '',
    price: item.price || '',
    originalPrice: item.originalPrice || null,
    categories: JSON.stringify(normalizeList(item.categories)),
    images: JSON.stringify(normalizeList(item.images)),
    mainImage: item.mainImage || null
  };
}

async function saveProduct(client, item) {
  const data = productData(item);
  const values = [
    data.name,
    data.description,
    data.price,
    data.originalPrice,
    data.categories,
    data.images,
    data.mainImage
  ];

  if (item.id !== undefined && item.id !== null && item.id !== '') {
    const id = parseId(item.id);
    if (!id) throw new Error('Product id must be a positive integer');
    const result = await client.query(
      `INSERT INTO "Product" ("id", "name", "description", "price", "originalPrice", "categories", "images", "mainImage")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       ON CONFLICT ("id") DO UPDATE SET
         "name" = EXCLUDED."name",
         "description" = EXCLUDED."description",
         "price" = EXCLUDED."price",
         "originalPrice" = EXCLUDED."originalPrice",
         "categories" = EXCLUDED."categories",
         "images" = EXCLUDED."images",
         "mainImage" = EXCLUDED."mainImage",
         "updatedAt" = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, ...values]
    );
    await client.query(
      `SELECT setval(
        pg_get_serial_sequence('"Product"', 'id'),
        COALESCE(MAX("id"), 1),
        MAX("id") IS NOT NULL
      ) FROM "Product"`
    );
    return result.rows[0];
  }

  const result = await client.query(
    `INSERT INTO "Product" ("name", "description", "price", "originalPrice", "categories", "images", "mainImage")
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     RETURNING *`,
    values
  );
  return result.rows[0];
}

app.post('/api/uploads', upload.array('images', 12), (req, res) => {
  res.json({ urls: req.files.map(file => `/uploads/${file.filename}`) });
});

app.get('/api/orders', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM "Order" ORDER BY "createdAt" DESC');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'orders unavailable' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, phone, category, note } = req.body || {};
    if (!customerName || !phone) return res.status(400).json({ error: 'name and phone are required' });
    const { rows } = await pool.query(
      `INSERT INTO "Order" ("customerName", "phone", "category", "note")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        String(customerName).trim(),
        String(phone).trim(),
        category ? String(category).trim() : null,
        note ? String(note).trim() : null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'order failed' });
  }
});

app.patch('/api/orders/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid order id' });
    const status = ['new', 'contacted', 'completed', 'cancelled'].includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'invalid status' });
    const { rows } = await pool.query(
      `UPDATE "Order" SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2 RETURNING *`,
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'order not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'order update failed' });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid order id' });
    const result = await pool.query('DELETE FROM "Order" WHERE "id" = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'order not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'order delete failed' });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM "Product" ORDER BY "id" ASC');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/products/sync', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    await withTransaction(async client => {
      for (const item of items) await saveProduct(client, item);
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'sync failed' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const product = await saveProduct(pool, req.body);
    res.status(201).json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'create failed' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid product id' });
    const data = productData(req.body);
    const { rows } = await pool.query(
      `UPDATE "Product" SET
         "name" = $1, "description" = $2, "price" = $3, "originalPrice" = $4,
         "categories" = $5::jsonb, "images" = $6::jsonb, "mainImage" = $7,
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $8 RETURNING *`,
      [data.name, data.description, data.price, data.originalPrice, data.categories, data.images, data.mainImage, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'product not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'update failed' });
  }
});

app.patch('/api/products/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid product id' });
    const item = req.body || {};
    const fields = {
      name: ['name', value => value],
      description: ['description', value => value],
      price: ['price', value => value],
      originalPrice: ['originalPrice', value => value],
      categories: ['categories', value => JSON.stringify(normalizeList(value))],
      images: ['images', value => JSON.stringify(normalizeList(value))],
      mainImage: ['mainImage', value => value]
    };
    const values = [];
    const assignments = [];
    for (const [key, [column, transform]] of Object.entries(fields)) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        values.push(transform(item[key]));
        assignments.push(`"${column}" = $${values.length}${key === 'categories' || key === 'images' ? '::jsonb' : ''}`);
      }
    }
    if (!assignments.length) return res.status(400).json({ error: 'no product fields provided' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE "Product" SET ${assignments.join(', ')}, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'product not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'patch failed' });
  }
});

app.post('/api/products/upsert', async (req, res) => {
  try {
    const product = await saveProduct(pool, req.body || {});
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'upsert failed' });
  }
});

app.post('/api/products/batch-upsert', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    const results = await withTransaction(async client => {
      const products = [];
      for (const item of items) products.push(await saveProduct(client, item));
      return products;
    });
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'batch upsert failed' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid product id' });
    const result = await pool.query('DELETE FROM "Product" WHERE "id" = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'product not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'delete failed' });
  }
});

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(root));
app.get('*', (req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

async function startServer() {
  await initializeDatabase();
  const port = process.env.PORT || 3000;
  return app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Unable to start server:', error);
    process.exitCode = 1;
    pool.end().catch(closeError => console.error('Unable to close database pool:', closeError));
  });
}

module.exports = { app, startServer };
