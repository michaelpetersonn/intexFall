// db.js - Knex-based DB helper
require('dotenv').config();
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.RDS_HOST,
    port: process.env.RDS_PORT,
    user: process.env.RDS_USER,
    password: process.env.RDS_PASSWORD,
    database: process.env.RDS_DB_NAME,
  },
});

// This keeps the same interface as before: db.query(sql, params)
function query(text, params) {
  if (params && params.length > 0) {
    return knex.raw(text, params);   // returns { rows, rowCount, ... }
  } else {
    return knex.raw(text);           // no params
  }
}

module.exports = {
  knex,   // in case you ever want full Knex query builder
  query,  // used everywhere in index.js
};
