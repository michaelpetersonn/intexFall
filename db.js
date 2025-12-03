// db.js - simple pg helper
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.RDS_HOST,
  port: process.env.RDS_PORT ? parseInt(process.env.RDS_PORT, 10) : 5432,
  user: process.env.RDS_USER,
  password: process.env.RDS_PASSWORD,
  database: process.env.RDS_DB_NAME,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
