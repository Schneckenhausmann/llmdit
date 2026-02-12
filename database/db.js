const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'simulator.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initdb();
    }
});

function initdb() {
    db.run(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT,
        personality TEXT,
        interests TEXT,
        aggression REAL,
        initiative REAL,
        memory TEXT
    )`);
}

module.exports = db;
