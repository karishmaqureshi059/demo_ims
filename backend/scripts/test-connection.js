import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, REQUIRED_TABLES, checkAndInitDatabase, ensureDemoAccounts } from '../config/db.js';

async function testConnection() {
  console.log('====================================================');
  console.log('      Supabase / PostgreSQL Connection Tester       ');
  console.log('====================================================');

  const dbUrl = (process.env.DATABASE_URL || '').trim();

  if (!dbUrl) {
    console.error('❌ Error: DATABASE_URL is not set in backend/.env');
    console.error('Please configure DATABASE_URL in backend/.env.');
    process.exit(1);
  }

  // Mask sensitive parts of the URL for safe logging (NEVER display password)
  let maskedUrl = 'Configured';
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const db = parsed.pathname.replace(/^\//, '');
    const user = parsed.username;
    maskedUrl = `${parsed.protocol}//${user ? user + ':****@' : ''}${host}:${port}/${db}`;
  } catch (e) {
    maskedUrl = '(Custom connection string)';
  }

  console.log(`Connecting to: ${maskedUrl}`);

  if (dbUrl.includes('[YOUR-PASSWORD]') || dbUrl.includes('[YOUR-PROJECT-REF]') || dbUrl.includes('[PASSWORD]')) {
    console.error('\n⚠️ Unfilled placeholder detected in DATABASE_URL:');
    console.error('Please update backend/.env with your actual Supabase credentials:');
    console.error('1. Replace [YOUR-PASSWORD] with your Supabase database password.');
    console.error('2. Replace [YOUR-PROJECT-REF] with your Supabase project reference id.');
    console.error('\nExample:');
    console.error('DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres\n');
    process.exit(1);
  }

  try {
    console.log('\nTesting connection...');
    const start = Date.now();
    const result = await pool.query('SELECT NOW() as now, current_database() as db, current_user as user, version()');
    const elapsed = Date.now() - start;

    console.log(`✅ Connection successful! (${elapsed}ms)`);
    console.log(`   Database : ${result.rows[0].db}`);
    console.log(`   User     : ${result.rows[0].user}`);
    console.log(`   Time     : ${result.rows[0].now}`);

    console.log('\nChecking database tables...');
    const tableRes = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const existingTables = new Set(tableRes.rows.map((r) => r.table_name.toLowerCase()));

    const present = REQUIRED_TABLES.filter((t) => existingTables.has(t));
    const missing = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

    console.log(`   Found ${present.length} of ${REQUIRED_TABLES.length} required tables in schema.`);

    if (missing.length > 0) {
      console.log(`   Missing tables: ${missing.join(', ')}`);
      console.log('   Running table initialization now...');
      await checkAndInitDatabase(pool);
      console.log('✅ Missing tables created successfully!');
    } else {
      console.log('✅ All required tables are present:');
      console.log(`   ${present.join(', ')}`);
    }

    // Ensure demo accounts are synchronized
    await ensureDemoAccounts(pool);

    // Check demo accounts
    console.log('\nChecking demo user accounts in "users" table...');
    const usersRes = await pool.query('SELECT email, role, status, password FROM users ORDER BY role');
    console.log(`   Total users registered: ${usersRes.rows.length}`);
    const expectedPass = {
      owner: 'Owner@123',
      product: 'Product@123',
      sales: 'Sales@123',
      stock: 'Stock@123',
      purchase: 'Purchase@123',
      orders: 'Orders@123',
    };
    for (const u of usersRes.rows) {
      const exp = expectedPass[u.role];
      const match = exp && u.password ? await bcrypt.compare(exp, u.password) : false;
      const statusIcon = match ? '✅' : '⚠️';
      console.log(`   ${statusIcon} ${u.email.padEnd(25)} [Role: ${u.role}, Status: ${u.status}] - Password verification: ${match ? 'MATCHES ' + exp : 'MISMATCH or custom password'}`);
    }

    console.log('\n====================================================');
    console.log('🎉 Supabase database is fully configured and ready! ');
    console.log('====================================================\n');
  } catch (error) {
    console.error('\n❌ PostgreSQL connection failed:');
    if (error.code === '28P01' || error.message?.includes('password authentication failed')) {
      console.error('👉 Authentication failed: The database password in backend/.env is incorrect.');
      console.error('   Please double check your Supabase database password.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.error('👉 Host resolution failed: The host in DATABASE_URL could not be found.');
      console.error('   Please verify the Supabase project reference in backend/.env.');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      console.error('👉 Connection timed out or refused.');
      console.error('   Verify that your Supabase project is active (not paused).');
      console.error('   Note: If your local ISP or network does not support IPv6, use the');
      console.error('   Supabase Session / Transaction Pooler on port 6543.');
    } else if (error.message?.includes('SSL')) {
      console.error('👉 SSL Negotiation error: Ensure SSL is enabled in connection options.');
    } else {
      console.error(`👉 Error details: ${error.message} (Code: ${error.code || 'UNKNOWN'})`);
    }
    console.error('');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
