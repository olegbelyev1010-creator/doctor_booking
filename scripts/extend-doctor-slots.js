/**
 * Extends slots in doctors.json through June 30 (keeps existing doctors & slots).
 * Run: node scripts/extend-doctor-slots.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  generateSlotsInRange,
  formatDateYMD,
  getEndOfJune,
  getExtensionStartDate,
  startOfDay,
} from './slot-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCTORS_PATH = join(__dirname, '..', 'data', 'doctors.json');

const raw = JSON.parse(readFileSync(DOCTORS_PATH, 'utf-8'));
const today = startOfDay(new Date());
const endOfJune = getEndOfJune(today);
let totalAdded = 0;

for (const doctor of raw.doctors) {
  const existing = new Set(doctor.slots);
  const before = existing.size;
  const from = getExtensionStartDate(doctor.slots, today);

  if (from <= endOfJune) {
    for (const slot of generateSlotsInRange(from, endOfJune)) {
      existing.add(slot);
    }
  }

  doctor.slots = [...existing].sort();
  totalAdded += doctor.slots.length - before;
}

raw.generatedAt = new Date().toISOString();
raw.slotsThrough = formatDateYMD(endOfJune);
delete raw.slotsDaysAhead;

writeFileSync(DOCTORS_PATH, JSON.stringify(raw, null, 2), 'utf-8');

const avgSlots = Math.round(
  raw.doctors.reduce((s, d) => s + d.slots.length, 0) / raw.doctors.length
);

console.log(`Updated ${raw.doctors.length} doctors`);
console.log(`Slots through: ${raw.slotsThrough} (+${totalAdded} new slot entries)`);
console.log(`Average slots per doctor: ~${avgSlots}`);
console.log(`-> ${DOCTORS_PATH}`);
