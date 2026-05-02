/**
 * AfriQuote — Database Layer
 * File-backed JSON store. Drop-in replaceable with PostgreSQL/MongoDB.
 * Each collection is a JSON file under /data/
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/** Read a collection (JSON array) from disk */
function readCollection(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/** Write a collection back to disk */
function writeCollection(name, data) {
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** Generic CRUD helpers */
const db = {
  /** Return all records (optionally filter by field) */
  find(collection, predicate) {
    const rows = readCollection(collection);
    return predicate ? rows.filter(predicate) : rows;
  },

  /** Return first match */
  findOne(collection, predicate) {
    return readCollection(collection).find(predicate) || null;
  },

  /** Insert a record */
  insert(collection, record) {
    const rows = readCollection(collection);
    rows.push(record);
    writeCollection(collection, rows);
    return record;
  },

  /** Update matching records */
  update(collection, predicate, patch) {
    const rows = readCollection(collection);
    let updated = null;
    const next = rows.map(row => {
      if (predicate(row)) {
        updated = { ...row, ...patch, updatedAt: new Date().toISOString() };
        return updated;
      }
      return row;
    });
    writeCollection(collection, next);
    return updated;
  },

  /** Delete matching records */
  delete(collection, predicate) {
    const rows = readCollection(collection);
    const remaining = rows.filter(r => !predicate(r));
    writeCollection(collection, remaining);
    return rows.length - remaining.length;
  },

  /** Count records */
  count(collection, predicate) {
    return db.find(collection, predicate).length;
  }
};

module.exports = db;
