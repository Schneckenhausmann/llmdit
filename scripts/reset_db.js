const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '../database/simulator.db');
const schemaPath = path.join(__dirname, '../database/schema.sql');

// 1. Delete existing DB
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('Deleted existing database.');
}

// 2. Create new DB
const db = new sqlite3.Database(dbPath);

// 3. Run Schema
const schema = fs.readFileSync(schemaPath, 'utf8');

db.serialize(() => {
    db.exec(schema, (err) => {
        if (err) {
            console.error('Error running schema:', err);
        } else {
            console.log('Database reset successfully.');
        }
        db.close();
    });
});
