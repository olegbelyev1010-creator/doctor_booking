import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCTORS_PATH = join(__dirname, '..', 'data', 'doctors.json');
const BOOKINGS_PATH = join(__dirname, '..', 'data', 'bookings.json');
const TIMEZONE = 'Europe/Moscow';
const MAX_DOCTORS_IN_SEARCH = 3;

const SPECIALTY_ALIASES = {
  стоматолог: 'стоматолог-терапевт',
  стоматолога: 'стоматолог-терапевт',
  терапевта: 'терапевт',
  кардиолога: 'кардиолог',
  гинеколога: 'гинеколог',
  дерматолога: 'дерматолог',
  невролога: 'невролог',
  педиатра: 'педиатр',
  уролога: 'уролог',
  офтальмолог: 'окулист',
  офтальмолога: 'окулист',
  ортопед: 'травматолог-ортопед',
  ортопеда: 'травматолог-ортопед',
  аллерголог: 'аллерголог-иммунолог',
  психотерапевт: 'психолог',
  лор: 'лор',
  'лор-врач': 'лор',
};

let doctorsCache = null;
let bookingsCache = null;

function loadDoctors() {
  if (!doctorsCache) {
    const raw = readFileSync(DOCTORS_PATH, 'utf-8');
    doctorsCache = JSON.parse(raw).doctors;
  }
  return doctorsCache;
}

function loadBookings() {
  if (!bookingsCache) {
    if (existsSync(BOOKINGS_PATH)) {
      bookingsCache = JSON.parse(readFileSync(BOOKINGS_PATH, 'utf-8'));
    } else {
      bookingsCache = [];
    }
  }
  return bookingsCache;
}

function saveBookings() {
  writeFileSync(BOOKINGS_PATH, JSON.stringify(bookingsCache, null, 2), 'utf-8');
}

function normalizeSpecialtyQuery(specialty) {
  const s = specialty.toLowerCase().trim();
  return SPECIALTY_ALIASES[s] || s;
}

function getBookedSlots(doctorId) {
  return new Set(
    loadBookings()
      .filter((b) => b.doctorId === doctorId && b.status === 'confirmed')
      .map((b) => b.slot)
  );
}

function getAvailableSlotsForDoctor(doctor) {
  const booked = getBookedSlots(doctor.id);
  return doctor.slots.filter((s) => !booked.has(s));
}

function getSlotLocalParts(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
  })
    .format(d)
    .toLowerCase();
  return { date, time, weekday };
}

function parseTimeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function slotMatchesTimeFilter(iso, { slotDate, slotTimeFrom, slotTimeTo, dayOfWeek } = {}) {
  const { date, time, weekday } = getSlotLocalParts(iso);

  if (slotDate && date !== slotDate) return false;

  if (dayOfWeek && weekday !== dayOfWeek.toLowerCase()) return false;

  const mins = parseTimeToMinutes(time);
  if (slotTimeFrom && mins < parseTimeToMinutes(slotTimeFrom)) return false;
  if (slotTimeTo && mins > parseTimeToMinutes(slotTimeTo)) return false;

  return true;
}

export function hasTimeFilter(filters) {
  return !!(filters?.slotDate || filters?.slotTimeFrom || filters?.slotTimeTo || filters?.dayOfWeek);
}

function formatSlot(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapDoctorSummary(d, matchingSlots) {
  const sortedSlots = [...matchingSlots].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  const earliest = sortedSlots[0] ?? null;

  return {
    id: d.id,
    name: d.name,
    gender: d.gender === 'male' ? 'мужской' : 'женский',
    specialty: d.specialty,
    experienceYears: d.experienceYears,
    reviewsCount: d.reviewsCount,
    rating: d.rating,
    consultationPrice: d.consultationPrice,
    earliestSlot: earliest
      ? { iso: earliest, formatted: formatSlot(earliest) }
      : null,
    availableSlotsCount: sortedSlots.length,
    slotsInRequestedWindow: sortedSlots.slice(0, 6).map((iso) => ({
      iso,
      formatted: formatSlot(iso),
    })),
    nextSlots: sortedSlots.slice(0, 3).map(formatSlot),
  };
}

function compareDoctorsForSelection(a, b) {
  const aTime = a.earliestSlot?.iso ? new Date(a.earliestSlot.iso).getTime() : Infinity;
  const bTime = b.earliestSlot?.iso ? new Date(b.earliestSlot.iso).getTime() : Infinity;
  if (aTime !== bTime) return aTime - bTime;
  return b.rating - a.rating;
}

export function searchDoctors({
  specialty,
  gender,
  minRating,
  minExperience,
  slotDate,
  slotTimeFrom,
  slotTimeTo,
  dayOfWeek,
} = {}) {
  let list = loadDoctors();
  const timeFilter = { slotDate, slotTimeFrom, slotTimeTo, dayOfWeek };
  const filterByTime = hasTimeFilter(timeFilter);

  if (specialty) {
    const s = normalizeSpecialtyQuery(specialty);
    const exact = list.filter((d) => d.specialty.toLowerCase() === s);
    list = exact.length
      ? exact
      : list.filter((d) => d.specialty.toLowerCase().includes(s));
  }
  if (gender) {
    list = list.filter((d) => d.gender === gender);
  }
  if (minRating != null) {
    list = list.filter((d) => d.rating >= Number(minRating));
  }
  if (minExperience != null) {
    list = list.filter((d) => d.experienceYears >= Number(minExperience));
  }

  const results = [];

  for (const d of list) {
    const available = getAvailableSlotsForDoctor(d);
    const matching = filterByTime
      ? available.filter((iso) => slotMatchesTimeFilter(iso, timeFilter))
      : available;

    if (filterByTime && matching.length === 0) continue;

    results.push(mapDoctorSummary(d, matching));
  }

  results.sort(compareDoctorsForSelection);

  const totalFound = results.length;
  const doctors = results.slice(0, MAX_DOCTORS_IN_SEARCH).map((doc, i) => ({
    ...doc,
    rank: i + 1,
  }));

  return {
    doctors,
    totalFound,
    shown: doctors.length,
    maxShown: MAX_DOCTORS_IN_SEARCH,
    selectionInfo: {
      criteria: 'nearest_time_and_best_rating',
      bannerText: 'На ближайшее время · лучший рейтинг',
      userHint:
        'Показаны до 3 врачей с самым ранним свободным приёмом; при равной дате — с более высоким рейтингом.',
      agentInstruction:
        'Начните ответ строкой (blockquote): > ⏱ Подобраны варианты на **ближайшее время** с **лучшим рейтингом**. Затем список врачей. Не пропускайте эту пометку.',
    },
  };
}

export function getDoctorById(doctorId) {
  return loadDoctors().find((d) => d.id === doctorId) ?? null;
}

export function getDoctorSlots(doctorId, timeFilter = {}) {
  const doctor = getDoctorById(doctorId);
  if (!doctor) return null;

  let available = getAvailableSlotsForDoctor(doctor);

  if (hasTimeFilter(timeFilter)) {
    available = available.filter((iso) => slotMatchesTimeFilter(iso, timeFilter));
  }

  return {
    doctorId: doctor.id,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    slots: available.map((iso) => ({
      iso,
      formatted: formatSlot(iso),
    })),
  };
}

export function createBooking({ doctorId, slot, patientName, patientPhone, patientEmail }) {
  const doctor = getDoctorById(doctorId);
  if (!doctor) {
    return { success: false, error: 'Врач не найден' };
  }

  if (!doctor.slots.includes(slot)) {
    return { success: false, error: 'Слот недоступен у этого врача' };
  }

  const bookings = loadBookings();
  const alreadyBooked = bookings.some(
    (b) => b.doctorId === doctorId && b.slot === slot && b.status === 'confirmed'
  );
  if (alreadyBooked) {
    return { success: false, error: 'Этот слот уже занят' };
  }

  const booking = {
    id: `bk-${Date.now()}`,
    doctorId,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    slot,
    slotFormatted: formatSlot(slot),
    patientName,
    patientPhone,
    patientEmail: patientEmail || null,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };

  bookings.push(booking);
  bookingsCache = bookings;
  saveBookings();

  return { success: true, booking };
}

export function listBookingsByPhone(phone) {
  return loadBookings().filter(
    (b) => b.patientPhone === phone && b.status === 'confirmed'
  );
}

export function getSpecialties() {
  const doctors = loadDoctors();
  return [...new Set(doctors.map((d) => d.specialty))].sort();
}

export function getDatabaseStats() {
  const doctors = loadDoctors();
  return {
    doctorCount: doctors.length,
    specialtyCount: new Set(doctors.map((d) => d.specialty)).size,
  };
}

export function getSchedulingContext() {
  const now = new Date();
  return {
    timezone: TIMEZONE,
    todayISO: now.toLocaleDateString('en-CA', { timeZone: TIMEZONE }),
    todayFormatted: now.toLocaleDateString('ru-RU', {
      timeZone: TIMEZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
}
