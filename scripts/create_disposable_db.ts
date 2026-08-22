import { Client } from 'pg';

async function main() {
  const masterClient = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await masterClient.connect();

  console.log('Creating disposable database milk_reception_disposable_test...');
  await masterClient.query('DROP DATABASE IF EXISTS milk_reception_disposable_test;');
  await masterClient.query('CREATE DATABASE milk_reception_disposable_test;');
  console.log('Disposable database milk_reception_disposable_test created cleanly.');

  await masterClient.end();
}

main().catch((err) => {
  console.error('Error creating disposable DB:', err);
  process.exit(1);
});
