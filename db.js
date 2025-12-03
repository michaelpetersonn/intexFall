// db.js - Knex-based DB helper (EB + local)
require('dotenv').config();
const knexLib = require('knex');

const knex = knexLib({
  client: 'pg',
  connection: {
    // Elastic Beanstalk uses RDS_HOSTNAME / RDS_USERNAME
    // Fallbacks let you still use RDS_HOST / RDS_USER locally if you want.
    host: process.env.RDS_HOSTNAME || process.env.RDS_HOST || 'localhost',
    port: Number(process.env.RDS_PORT) || 5432,
    user: process.env.RDS_USERNAME || process.env.RDS_USER || 'postgres',
    password: process.env.RDS_PASSWORD || '',
    database: process.env.RDS_DB_NAME || 'postgres',
  },
  pool: { min: 2, max: 10 },
});

// Keep the same interface used in index.js
function query(text, params) {
  if (params && params.length > 0) {
    return knex.raw(text, params);  // SELECT ... returns { rows, rowCount, ... }
  } else {
    return knex.raw(text);
  }
}

module.exports = {
  knex,
  query,
};
