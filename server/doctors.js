import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCTORS_PATH = join(__dirname, '..', 'data', 'doctors.json');
const BOOKINGS_PATH = join(__dirname, '..', 'data', 'bookings.json');
const TIMEZONE = 'Europe/Moscow';
const MAX_DOCTORS_IN_SEARCH = 3;
const MAX_SLOTS_LISTED = 12;
const SLOT_HORIZON_DAYS = 14;

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

/** Слот ещё не наступил (сравнение по абсолютному времени ISO). */
export function isSlotInFuture(iso) {
  return new Date(iso).getTime() > Date.now();
}

function sortSlotsAsc(slots) {
  return [...slots].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

/** Слоты в ближайшие N календарных дней (для показа пациенту). */
export function filterSlotsWithinHorizon(slots, days = SLOT_HORIZON_DAYS) {
  const now = Date.now();
  const horizonEnd = now + days * 24 * 60 * 60 * 1000;
  return slots.filter((iso) => {
    const t = new Date(iso).getTime();
    return t > now && t <= horizonEnd;
  });
}

function getAvailableSlotsForDoctor(doctor) {
  const booked = getBookedSlots(doctor.id);
  return doctor.slots.filter((s) => !booked.has(s) && isSlotInFuture(s));
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
  const sortedAll = sortSlotsAsc(matchingSlots);
  const horizonSlots = filterSlotsWithinHorizon(sortedAll);
  const displayPool = horizonSlots.length > 0 ? horizonSlots : sortedAll;
  const earliest = sortedAll[0] ?? null;

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
    availableSlotsCount: sortedAll.length,
    slotsInRequestedWindow: displayPool.slice(0, 6).map((iso) => ({
      iso,
      formatted: formatSlot(iso),
    })),
    nextSlots: displayPool.slice(0, 3).map(formatSlot),
  };
}

function compareDoctorsForSelection(a, b) {
  const aTime = a.earliestSlot?.iso ? new Date(a.earliestSlot.iso).getTime() : Infinity;
  const bTime = b.earliestSlot?.iso ? new Date(b.earliestSlot.iso).getTime() : Infinity;
  if (aTime !== bTime) return aTime - bTime;
  return b.rating - a.rating;
}

function buildSelectionInfo({ totalFound, dateFilterRelaxed, requestedDate }) {
  if (totalFound === 0) {
    return {
      criteria: 'none',
      bannerText: null,
      userHint: 'Свободных врачей по заданным фильтрам не найдено.',
      agentInstruction:
        'Не используйте blockquote про «ближайшее время». Сообщите, что по запросу никого не найдено, и предложите другой день или специальность.',
    };
  }

  if (dateFilterRelaxed) {
    return {
      criteria: 'nearest_time_and_best_rating',
      bannerText: 'Ближайшие свободные слоты',
      userHint: `На запрошенную дату (${requestedDate}) мест нет; показаны ближайшие доступные.`,
      agentInstruction:
        `Начните с blockquote: > На **${requestedDate}** свободных слотов нет. Показаны **ближайшие доступные** варианты. Затем перечислите врачей из doctors с earliestSlot и slotsInRequestedWindow. Не говорите, что врачей нет.`,
    };
  }

  return {
    criteria: 'nearest_time_and_best_rating',
    bannerText: 'На ближайшее время · лучший рейтинг',
    userHint:
      'Показаны до 3 врачей с самым ранним свободным приёмом; при равной дате — с более высоким рейтингом.',
    agentInstruction:
      'Начните ответ строкой (blockquote): > ⏱ Подобраны варианты на **ближайшее время** с **лучшим рейтингом**. Затем список врачей. У каждого врача обязательно укажите earliestSlot и слоты только из slotsInRequestedWindow (уже ближайшие). Не предлагайте даты позже, если в этих полях есть более ранние. Не пропускайте эту пометку.',
  };
}

function searchDoctorsOnList(list, timeFilter) {
  const filterByTime = hasTimeFilter(timeFilter);
  const results = [];

  for (const d of list) {
    const available = getAvailableSlotsForDoctor(d);
    const matching = filterByTime
      ? available.filter((iso) => slotMatchesTimeFilter(iso, timeFilter))
      : available;

    if (matching.length === 0) continue;

    results.push(mapDoctorSummary(d, matching));
  }

  results.sort(compareDoctorsForSelection);

  const totalFound = results.length;
  const doctors = results.slice(0, MAX_DOCTORS_IN_SEARCH).map((doc, i) => ({
    ...doc,
    rank: i + 1,
  }));

  return { doctors, totalFound, shown: doctors.length };
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

  const timeFilter = { slotDate, slotTimeFrom, slotTimeTo, dayOfWeek };
  let searchResult = searchDoctorsOnList(list, timeFilter);
  let dateFilterRelaxed = false;
  let requestedDate = slotDate ?? null;

  if (searchResult.totalFound === 0 && hasTimeFilter(timeFilter)) {
    const relaxed = searchDoctorsOnList(list, {
      slotDate: undefined,
      slotTimeFrom,
      slotTimeTo,
      dayOfWeek,
    });
    if (relaxed.totalFound > 0) {
      searchResult = relaxed;
      dateFilterRelaxed = true;
    }
  }

  const { doctors, totalFound, shown } = searchResult;

  return {
    doctors,
    totalFound,
    shown,
    maxShown: MAX_DOCTORS_IN_SEARCH,
    dateFilterRelaxed,
    requestedDate: dateFilterRelaxed ? requestedDate : null,
    selectionInfo: buildSelectionInfo({ totalFound, dateFilterRelaxed, requestedDate }),
  };
}

/** Готовый ответ пациенту со списком ближайших слотов (без участия LLM). */
export function buildSearchDoctorsPatientReply(result) {
  if (!result?.totalFound) {
    return (
      'К сожалению, свободных врачей по вашему запросу сейчас нет. ' +
      'Напишите, пожалуйста, удобный день и время — подберу варианты.'
    );
  }

  let intro;
  if (result.dateFilterRelaxed && result.requestedDate) {
    intro =
      `> На **${result.requestedDate}** свободных слотов нет. Показаны **ближайшие доступные** варианты.\n\n`;
  } else {
    intro =
      '> ⏱ Подобраны варианты на **ближайшее время** с **лучшим рейтингом**.\n\n';
  }

  const blocks = result.doctors.map((d) => {
    const slots = d.slotsInRequestedWindow.map((s) => s.formatted).join('; ');
    const price =
      d.consultationPrice != null ? ` · ${d.consultationPrice} ₽` : '';
    return (
      `**${d.rank}. ${d.name}** — ${d.specialty}, рейтинг ${d.rating}${price}\n` +
      `Ближайший приём: **${d.earliestSlot?.formatted ?? '—'}**\n` +
      `Свободно: ${slots}`
    );
  });

  let more = '';
  if (result.totalFound > result.shown) {
    more = `\n\n_Есть ещё ${result.totalFound - result.shown} врач(ей) в базе — уточните, если нужно._`;
  }

  const closing =
    '\n\nНапишите, пожалуйста, **к какому врачу** и **на какое время** записать.';

  return intro + blocks.join('\n\n') + more + closing;
}

export function getDoctorById(doctorId) {
  return loadDoctors().find((d) => d.id === doctorId) ?? null;
}

export function getDoctorSlots(doctorId, timeFilter = {}) {
  const doctor = getDoctorById(doctorId);
  if (!doctor) return null;

  let available = sortSlotsAsc(getAvailableSlotsForDoctor(doctor));

  if (hasTimeFilter(timeFilter)) {
    available = available.filter((iso) => slotMatchesTimeFilter(iso, timeFilter));
  }

  const totalAvailable = available.length;
  const listed = available.slice(0, MAX_SLOTS_LISTED);
  const earliest = listed[0] ?? null;

  return {
    doctorId: doctor.id,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    totalAvailable,
    shown: listed.length,
    earliestSlot: earliest
      ? { iso: earliest, formatted: formatSlot(earliest) }
      : null,
    slots: listed.map((iso) => ({
      iso,
      formatted: formatSlot(iso),
    })),
    hint: 'Список отсортирован от ближайшего времени. Предлагайте пациенту сначала earliestSlot и первые слоты из slots.',
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

  if (!isSlotInFuture(slot)) {
    return { success: false, error: 'Нельзя записаться на прошедшее время' };
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
