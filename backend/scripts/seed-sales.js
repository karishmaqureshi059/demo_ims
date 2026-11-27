import { pool } from '../config/db.js';

async function seedHistoricalSales() {
  const client = await pool.connect();
  try {
    // Check if historical seed already executed
    const checkRes = await client.query("SELECT count(*) FROM sales WHERE date < '2026-11-20'");
    if (parseInt(checkRes.rows[0].count, 10) > 0) {
      console.log('Historical sales already exist:', checkRes.rows[0].count);
      return;
    }

    const prods = await client.query(`
      SELECT id, name, price, quantity, min_level 
      FROM products 
      WHERE name IN (
        'Aurora Desk Lamp',
        'Vertex Wireless Mouse',
        'Solstice 27" Monitor',
        'Prism HD Webcam',
        'Nimbus Mechanical Keyboard',
        'Photon Power Bank'
      )
    `);
    const prodMap = {};
    prods.rows.forEach(p => { prodMap[p.name] = p; });

    // Find a salesperson user or owner
    const userRes = await client.query("SELECT id FROM users WHERE role IN ('sales', 'owner') LIMIT 1");
    const userId = userRes.rows[0]?.id;

    if (!userId) {
      console.log('No user found to associate sales.');
      return;
    }

    console.log('Adding historical sales for realistic AI forecasting...');

    // We will generate sales spread across the last 30 days (Oct 26 - Nov 23)
    const now = new Date('2026-11-24T12:00:00Z');
    const salesToAdd = [];

    // 1. Vertex Wireless Mouse: Fast-moving, recent surge (Increasing demand, stockout risk: stock is 8, min is 10)
    const mouse = prodMap['Vertex Wireless Mouse'];
    if (mouse) {
      for (let dayOffset = 25; dayOffset >= 1; dayOffset -= 2) {
        const d = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
        const qty = dayOffset <= 7 ? 3 : 1; // surge in recent 7 days!
        salesToAdd.push({
          productId: mouse.id,
          productName: mouse.name,
          date: d,
          quantity: qty,
          unitPrice: Number(mouse.price) || 29.99
        });
      }
    }

    // 2. Solstice 27" Monitor: Steady weekly demand
    const monitor = prodMap['Solstice 27" Monitor'];
    if (monitor) {
      for (let dayOffset = 28; dayOffset >= 2; dayOffset -= 4) {
        const d = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
        salesToAdd.push({
          productId: monitor.id,
          productName: monitor.name,
          date: d,
          quantity: 2,
          unitPrice: Number(monitor.price) || 329.99
        });
      }
    }

    // 3. Prism HD Webcam: Decreasing demand (was selling well 3-4 weeks ago, dropped recently)
    const webcam = prodMap['Prism HD Webcam'];
    if (webcam) {
      for (let dayOffset = 27; dayOffset >= 1; dayOffset -= 3) {
        const d = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
        const qty = dayOffset > 14 ? 3 : 1; // higher sales earlier, lower sales recently (decreasing trend!)
        if (dayOffset <= 7 && dayOffset % 2 === 0) continue; // fewer recent sales
        salesToAdd.push({
          productId: webcam.id,
          productName: webcam.name,
          date: d,
          quantity: qty,
          unitPrice: Number(webcam.price) || 79.99
        });
      }
    }

    // 4. Photon Power Bank: Moderate steady demand
    const powerBank = prodMap['Photon Power Bank'];
    if (powerBank) {
      for (let dayOffset = 26; dayOffset >= 3; dayOffset -= 5) {
        const d = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
        salesToAdd.push({
          productId: powerBank.id,
          productName: powerBank.name,
          date: d,
          quantity: 2,
          unitPrice: Number(powerBank.price) || 45.00
        });
      }
    }

    // Insert sales in database
    await client.query('BEGIN');
    for (const item of salesToAdd) {
      const itemTotal = Number((item.quantity * item.unitPrice).toFixed(2));
      const saleRes = await client.query(`
        INSERT INTO sales (user_id, total, items_count, status, date, created_at)
        VALUES ($1, $2, $3, 'completed', $4, $4)
        RETURNING id
      `, [userId, itemTotal, item.quantity, item.date]);

      const saleId = saleRes.rows[0].id;
      await client.query(`
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [saleId, item.productId, item.quantity, item.unitPrice, itemTotal, item.date]);
    }
    await client.query('COMMIT');
    console.log(`Successfully seeded ${salesToAdd.length} realistic historical sales!`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding historical sales:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedHistoricalSales();
