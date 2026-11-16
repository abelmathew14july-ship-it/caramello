const { pool, initializeDatabase } = require('./db');

async function seed() {
  await initializeDatabase();
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM "Product"');
  if (rows[0].count > 0) {
    console.log('Products already seeded');
    return;
  }

  const samples = [
    {
      name: 'Vanilla Cake',
      description: 'Simple, elegant vanilla cake',
      price: '₹600',
      categories: ['regular'],
      images: ['all items/VANILA Cake/Screenshot 2026-06-21 190732.png'],
      mainImage: 'all items/VANILA Cake/Screenshot 2026-06-21 190732.png'
    },
    {
      name: 'Classic Mango',
      description: 'Indulge in seasonal mango goodness',
      price: '₹700',
      originalPrice: '₹750',
      categories: ['regular'],
      images: ['all items/CLASSIC MANGO/Screenshot 2026-06-21 190254.png'],
      mainImage: 'all items/CLASSIC MANGO/Screenshot 2026-06-21 190254.png'
    }
  ];

  for (const product of samples) {
    await pool.query(
      `INSERT INTO "Product" ("name", "description", "price", "originalPrice", "categories", "images", "mainImage")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        product.name,
        product.description,
        product.price,
        product.originalPrice || null,
        JSON.stringify(product.categories),
        JSON.stringify(product.images),
        product.mainImage
      ]
    );
  }
  console.log('Seed complete');
}

seed()
  .catch(error => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
