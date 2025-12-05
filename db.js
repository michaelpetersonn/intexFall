// db.js - Knex-based DB helper for EB + local c
require('dotenv').config();
const knexLib = require('knex');

const isRds = !!process.env.RDS_HOSTNAME; // true on Elastic Beanstalk aka the beans talking

const knex = knexLib({
  client: 'pg',
  connection: {
    host: process.env.RDS_HOSTNAME || process.env.RDS_HOST || 'localhost',
    port: Number(process.env.RDS_PORT) || 5432,
    user: process.env.RDS_USERNAME || process.env.RDS_USER || 'FallIntex',
    password: process.env.RDS_PASSWORD || 'MichaelMichaelCarson',
    database: process.env.RDS_DB_NAME || 'postgres',

    // This is the important part
    ssl: isRds
      ? { rejectUnauthorized: false }   // use SSL on AWS/RDS
      : false,                          // no SSL for local dev
  },
  pool: { min: 2, max: 10 },
});

// Keep the interface index.js expects: db.query(sql, params)
function query(text, params) {
  if (params && params.length > 0) {
    return knex.raw(text, params);
  } else {
    return knex.raw(text);
  }
}

module.exports = {
  knex,
  query,
};
