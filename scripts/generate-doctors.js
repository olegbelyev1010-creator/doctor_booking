/**
 * Generates doctors.json with doctors for all clinic specialties.
 * Slots: next 7 calendar days.
 * Run: node scripts/generate-doctors.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'data', 'doctors.json');

/** Специальности клиники (по каталогу сервиса) */
const SPECIALTIES = [
  'Аллерголог-иммунолог',
  'Ветеринар',
  'Врач ЛФК',
  'Гастроэнтеролог',
  'Гинеколог',
  'Дерматолог',
  'Диетолог',
  'Инфекционист',
  'Кардиолог',
  'ЛОР',
  'Маммолог',
  'Невролог',
  'Нефролог',
  'Окулист',
  'Онколог',
  'Педиатр',
  'Психолог',
  'Пульмонолог',
  'Ревматолог',
  'Специалист по грудному вскармливанию',
  'Стоматолог-терапевт',
  'Терапевт',
  'Травматолог-ортопед',
  'Уролог',
  'Флеболог',
  'Хирург',
  'Эндокринолог',
];

const MIN_DOCTORS_PER_SPECIALTY = 2;
const MAX_DOCTORS_PER_SPECIALTY = 10;

const SPECIALTY_PRICES = {
  'Специалист по грудному вскармливанию': { consultationPrice: 1743, consultationPriceOld: 2490 },
};

const MALE_FIRST = [
  'Алексей', 'Дмитрий', 'Иван', 'Михаил', 'Сергей', 'Андрей', 'Николай', 'Павел',
  'Егор', 'Артём', 'Максим', 'Кирилл', 'Олег', 'Владимир', 'Роман',
];
const FEMALE_FIRST = [
  'Анна', 'Елена', 'Мария', 'Ольга', 'Наталья', 'Татьяна', 'Ирина', 'Светлана',
  'Юлия', 'Екатерина', 'Дарья', 'Виктория', 'Алина', 'Полина', 'Ксения',
];
const LAST_NAMES = [
  'Иванов', 'Петров', 'Сидоров', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Соколов',
  'Лебедев', 'Кузнецов', 'Попов', 'Смирнов', 'Фёдоров', 'Михайлов', 'Алексеев',
  'Орлов', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Соловьёв', 'Борисов', 'Яковлев',
];

const PATRONYMICS_M = ['Иванович', 'Петрович', 'Сергеевич', 'Андреевич', 'Дмитриевич', 'Алексеевич'];
const PATRONYMICS_F = ['Ивановна', 'Петровна', 'Сергеевна', 'Андреевна', 'Дмитриевична', 'Алексеевна'];

const WORK_HOURS_WEEKDAY = [9, 10, 11, 12, 14, 15, 16, 17, 18];
const WORK_HOURS_WEEKEND = [10, 11, 12, 14, 15];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

/** Слоты на 7 календарных дней вперёд (с сегодняшнего дня не включая) */
function generateWeekSlots() {
  const slots = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const date = new Date(today);
    date.setDate(date.getDate() + dayOffset);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const pool = isWeekend ? WORK_HOURS_WEEKEND : WORK_HOURS_WEEKDAY;
    const count = isWeekend ? randomInt(2, 4) : randomInt(4, 7);

    const hours = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
    for (const hour of hours) {
      const slot = new Date(date);
      slot.setHours(hour, randomInt(0, 1) * 30, 0, 0);
      slots.push(slot.toISOString());
    }
  }

  return slots.sort();
}

function getConsultationPrice(specialty) {
  const custom = SPECIALTY_PRICES[specialty];
  if (custom?.consultationPrice && typeof custom.consultationPrice === 'number') {
    return { price: custom.consultationPrice, priceOld: custom.consultationPriceOld ?? null };
  }
  return { price: randomInt(1500, 4500), priceOld: null };
}

function generateDoctor(id, specialty) {
  const gender = Math.random() > 0.45 ? 'female' : 'male';
  const first = gender === 'male' ? pick(MALE_FIRST) : pick(FEMALE_FIRST);
  const last = pick(LAST_NAMES);
  const patronymic = gender === 'male' ? pick(PATRONYMICS_M) : pick(PATRONYMICS_F);
  const lastSuffix = gender === 'female' && !last.endsWith('а') ? last + 'а' : last;

  const experienceYears = randomInt(3, 35);
  const reviewsCount = randomInt(12, 890);
  const rating = Math.min(5, Math.max(3.5, Number((3.8 + Math.random() * 1.15).toFixed(1))));
  const { price, priceOld } = getConsultationPrice(specialty);

  const doctor = {
    id: `doc-${String(id).padStart(3, '0')}`,
    name: `${lastSuffix} ${first} ${patronymic}`,
    gender,
    specialty,
    experienceYears,
    reviewsCount,
    rating,
    consultationPrice: price,
    slots: generateWeekSlots(),
    online: true,
  };

  if (priceOld) doctor.consultationPriceOld = priceOld;

  return doctor;
}

const doctors = [];
const doctorsPerSpecialty = {};
let id = 1;

for (const specialty of SPECIALTIES) {
  const count = randomInt(MIN_DOCTORS_PER_SPECIALTY, MAX_DOCTORS_PER_SPECIALTY);
  doctorsPerSpecialty[specialty] = count;
  for (let n = 0; n < count; n++) {
    doctors.push(generateDoctor(id++, specialty));
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      specialties: SPECIALTIES,
      doctorsPerSpecialty,
      doctorsPerSpecialtyRange: [MIN_DOCTORS_PER_SPECIALTY, MAX_DOCTORS_PER_SPECIALTY],
      slotsDaysAhead: 7,
      count: doctors.length,
      doctors,
    },
    null,
    2
  ),
  'utf-8'
);

console.log(
  `Generated ${doctors.length} doctors (${SPECIALTIES.length} specialties, ${MIN_DOCTORS_PER_SPECIALTY}–${MAX_DOCTORS_PER_SPECIALTY} each)`
);
console.log(`Slots: 7 days ahead, ~${Math.round(doctors.reduce((s, d) => s + d.slots.length, 0) / doctors.length)} per doctor on average`);
console.log(`-> ${OUT_PATH}`);
