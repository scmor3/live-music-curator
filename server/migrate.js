const { migrate } = require('postgres-migrations');
require('dotenv').config();

const dbConfig = {
  host      : process.env.DB_HOST,
  port      : Number(process.env.DB_PORT),
  database  : process.env.DB_NAME,
  user      : process.env.DB_USER,
  password  : process.env.DB_PASS,
};

async function runMigrations() {
  console.log('Connecting to database and running migrations...');
  
  try {

    await migrate(dbConfig, './migrations'); 
    
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Error running migrations:', err);
    process.exit(1);
  }
}

runMigrations();

