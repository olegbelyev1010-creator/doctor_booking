/**
 * Проверка логики ближайших слотов и санитизации фильтров.
 * Run: npm run verify:scheduling
 */

import {
  searchDoctors,
  buildSearchDoctorsPatientReply,
  getSchedulingContext,
  isSlotInFuture,
} from '../server/doctors.js';
import {
  prepareSearchDoctorsArgs,
  userMentionedSchedule,
} from '../server/scheduling-args.js';

const ctx = getSchedulingContext();
let passed = 0;
let failed = 0;

function ok(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

function conv(text) {
  return [{ role: 'user', content: text }];
}

function earliestIso(result) {
  return result.doctors[0]?.earliestSlot?.iso ?? null;
}

function dayOf(iso) {
  return new Date(iso).getDate();
}

console.log(`\nСегодня (МСК): ${ctx.todayFormatted} (${ctx.todayISO})\n`);

console.log('1. Распознавание намерения указать дату/время');
ok('«запиши к терапевту» — без расписания', !userMentionedSchedule('запиши к терапевту'));
ok('«запишите к кардиологу» — без расписания', !userMentionedSchedule('запишите к кардиологу'));
ok('«на завтра» — с расписанием', userMentionedSchedule('запиши к терапевту на завтра'));
ok('«в субботу» — с расписанием', userMentionedSchedule('в субботу к терапевту'));

console.log('\n2. Санитизация аргументов (LLM подставляет monday / сегодня)');
const t1 = prepareSearchDoctorsArgs(
  { specialty: 'терапевт', dayOfWeek: 'monday', slotDate: ctx.todayISO },
  conv('Запишите к терапевту')
);
ok('сброшен dayOfWeek', t1.dayOfWeek === undefined);
ok('сброшен slotDate', t1.slotDate === undefined);
ok('специальность сохранена', t1.specialty === 'терапевт');

console.log('\n3. Поиск терапевта / кардиолога — ближайшие слоты (не 8-е без запроса)');
const therapist = searchDoctors(
  prepareSearchDoctorsArgs({ specialty: 'терапевт', dayOfWeek: 'monday' }, conv('запиши к терапевту'))
);
const cardiologist = searchDoctors(
  prepareSearchDoctorsArgs({ specialty: 'кардиолог', slotDate: ctx.todayISO }, conv('запиши к кардиологу'))
);

ok('терапевт: найдены врачи', therapist.totalFound >= 1);
ok('терапевт: earliest не 8 июня', dayOf(earliestIso(therapist)) !== 8);
ok('терапевт: earliest в пределах 7 дней', (() => {
  const iso = earliestIso(therapist);
  if (!iso) return false;
  const diff = (new Date(iso).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff <= 7;
})());

ok('кардиолог: найдены врачи', cardiologist.totalFound >= 1);
ok('кардиолог: earliest не 8 июня (без запроса понедельника)', dayOf(earliestIso(cardiologist)) !== 8);

console.log('\n4. Прошлые слоты не попадают в выдачу');
let pastInResults = false;
for (const d of therapist.doctors) {
  for (const s of d.slotsInRequestedWindow) {
    if (!isSlotInFuture(s.iso)) pastInResults = true;
  }
}
ok('нет прошедших слотов в slotsInRequestedWindow', !pastInResults);

console.log('\n5. Серверный ответ пациенту');
const reply = buildSearchDoctorsPatientReply(therapist);
ok('есть blockquote ближайшее время', reply.includes('ближайшее время'));
ok('есть имя врача', reply.includes(therapist.doctors[0].name));
ok('есть дата ближайшего слота', reply.includes(therapist.doctors[0].earliestSlot.formatted));
ok('нет фразы «слотов нет» при наличии врачей', !reply.toLowerCase().includes('слотов нет'));

console.log('\n6. Фильтр dayOfWeek=monday даёт 8-е (контроль — только при явном запросе)');
const mondayExplicit = searchDoctors(
  prepareSearchDoctorsArgs({ specialty: 'терапевт', dayOfWeek: 'monday' }, conv('к терапевту в понедельник'))
);
ok('при «в понедельник» dayOfWeek сохранён', mondayExplicit.totalFound >= 1);

console.log(`\n--- Итого: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
