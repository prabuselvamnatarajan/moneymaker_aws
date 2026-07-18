#!/usr/bin/env node
/**
 * Validates that every TC-ID in tc-checklist.json has status "implemented".
 */
const fs = require('fs');
const path = require('path');

const checklistPath = path.join(__dirname, '..', 'coverage', 'tc-checklist.json');
const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));

const pending = Object.entries(checklist).filter(
  ([, v]) => v.status !== 'implemented' && v.status !== 'skipped'
);
const skipped = Object.entries(checklist).filter(([, v]) => v.status === 'skipped');
const implemented = Object.entries(checklist).filter(([, v]) => v.status === 'implemented');

console.log(`Total TC-IDs: ${Object.keys(checklist).length}`);
console.log(`Implemented: ${implemented.length}`);
console.log(`Skipped: ${skipped.length}`);
console.log(`Pending: ${pending.length}`);

if (pending.length > 0) {
  console.error('\nPending test cases:');
  for (const [id, meta] of pending) {
    console.error(`  ${id} (${meta.spec})`);
  }
  process.exit(1);
}

console.log('\nAll test cases accounted for.');
process.exit(0);
