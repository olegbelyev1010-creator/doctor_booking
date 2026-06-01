import { getSchedulingContext } from './doctors.js';

const SCHEDULE_WORDS = [
  'сегодня',
  'завтра',
  'послезавтра',
  'понедельник',
  'понедельника',
  'вторник',
  'вторника',
  'среду',
  'среда',
  'четверг',
  'пятниц',
  'суббот',
  'воскресен',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DATE_INTENT =
  /\d{1,2}[\s.\-]*(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i;

const TIME_INTENT =
  /(\d{1,2}:\d{2}|\d{1,2}\s*час|утр[оа]|дн[её]м|вечером|после\s+\d|до\s+\d|в\s+\d{1,2})/i;

export function userMentionedSchedule(text) {
  const t = text.toLowerCase();
  if (SCHEDULE_WORDS.some((w) => t.includes(w))) return true;
  return DATE_INTENT.test(t) || TIME_INTENT.test(t);
}

function getLastUserText(conversation) {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const m = conversation[i];
    if (m.role === 'user' && typeof m.content === 'string') {
      return m.content.toLowerCase();
    }
  }
  return '';
}

export function prepareSearchDoctorsArgs(args, conversation) {
  const { todayISO } = getSchedulingContext();
  const prepared = { ...args };
  const lastUser = getLastUserText(conversation);
  const askedSchedule = userMentionedSchedule(lastUser);
  const askedToday = lastUser.includes('сегодня');

  if (!askedSchedule) {
    delete prepared.slotDate;
    delete prepared.dayOfWeek;
    delete prepared.slotTimeFrom;
    delete prepared.slotTimeTo;
    return prepared;
  }

  if (prepared.slotDate === todayISO && !askedToday) {
    delete prepared.slotDate;
  }

  return prepared;
}

export function prepareDoctorSlotsArgs(args, conversation) {
  const prepared = { ...args };
  if (!userMentionedSchedule(getLastUserText(conversation))) {
    delete prepared.slotDate;
    delete prepared.dayOfWeek;
    delete prepared.slotTimeFrom;
    delete prepared.slotTimeTo;
  }
  return prepared;
}
