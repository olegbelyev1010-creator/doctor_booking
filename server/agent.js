import {
  searchDoctors,
  buildSearchDoctorsPatientReply,
  getDoctorSlots,
  createBooking,
  getSpecialties,
  listBookingsByPhone,
  getSchedulingContext,
} from './doctors.js';
import { prepareSearchDoctorsArgs, prepareDoctorSlotsArgs } from './scheduling-args.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_doctors',
      description:
        'Поиск врачей. До 3 вариантов: ближайший слот + лучший рейтинг (см. selectionInfo). Если указано время — slotDate/dayOfWeek, slotTimeFrom/slotTimeTo.',
      parameters: {
        type: 'object',
        properties: {
          specialty: {
            type: 'string',
            description: 'Специальность, например: стоматолог, Терапевт, Кардиолог',
          },
          gender: {
            type: 'string',
            enum: ['male', 'female'],
            description:
              'Только если пациент сам попросил врача определённого пола.',
          },
          minRating: { type: 'number', description: 'Минимальный рейтинг (1-5)' },
          minExperience: { type: 'number', description: 'Минимальный стаж в годах' },
          slotDate: {
            type: 'string',
            description:
              'Дата YYYY-MM-DD только если пациент ЯВНО назвал день («сегодня», «завтра», «15 июня»). НЕ передавайте для запросов вроде «запишите к дерматологу» без даты.',
          },
          dayOfWeek: {
            type: 'string',
            enum: [
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
              'sunday',
            ],
            description:
              'Только если пациент ЯВНО назвал день недели («в субботу»). НЕ передавайте, если он просто назвал специальность.',
          },
          slotTimeFrom: {
            type: 'string',
            description: 'Начало окна HH:MM, например 11:00',
          },
          slotTimeTo: {
            type: 'string',
            description: 'Конец окна HH:MM включительно, например 14:00',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_specialties',
      description: 'Получить список всех доступных специальностей',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_doctor_slots',
      description:
        'Свободные слоты врача (до 12 ближайших, отсортированы). Сначала предлагай earliestSlot и первые slots. Передавай slotDate/dayOfWeek/slotTimeFrom/slotTimeTo, если пациент назвал время.',
      parameters: {
        type: 'object',
        properties: {
          doctorId: { type: 'string', description: 'ID врача, например doc-001' },
          slotDate: { type: 'string', description: 'YYYY-MM-DD' },
          dayOfWeek: {
            type: 'string',
            enum: [
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
              'sunday',
            ],
          },
          slotTimeFrom: { type: 'string', description: 'HH:MM' },
          slotTimeTo: { type: 'string', description: 'HH:MM' },
        },
        required: ['doctorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Записать пациента на онлайн-консультацию. Вызывай только когда есть: doctorId, slot (ISO), имя и телефон пациента.',
      parameters: {
        type: 'object',
        properties: {
          doctorId: { type: 'string' },
          slot: { type: 'string', description: 'ISO-дата слота из get_doctor_slots' },
          patientName: { type: 'string' },
          patientPhone: { type: 'string' },
          patientEmail: { type: 'string' },
        },
        required: ['doctorId', 'slot', 'patientName', 'patientPhone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_bookings',
      description: 'Показать записи пациента по номеру телефона',
      parameters: {
        type: 'object',
        properties: {
          patientPhone: { type: 'string' },
        },
        required: ['patientPhone'],
      },
    },
  },
];

function runSearchDoctors(args, conversation) {
  const result = searchDoctors(prepareSearchDoctorsArgs(args, conversation));
  return {
    ...result,
    formattedPatientReply: buildSearchDoctorsPatientReply(result),
  };
}

function executeTool(name, args, conversation) {
  switch (name) {
    case 'search_doctors':
      return runSearchDoctors(args, conversation);
    case 'get_specialties':
      return { specialties: getSpecialties() };
    case 'get_doctor_slots': {
      const prepared = prepareDoctorSlotsArgs(args, conversation);
      const { doctorId, slotDate, slotTimeFrom, slotTimeTo, dayOfWeek } = prepared;
      const result = getDoctorSlots(doctorId, {
        slotDate,
        slotTimeFrom,
        slotTimeTo,
        dayOfWeek,
      });
      if (!result) return { error: 'Врач не найден' };
      return result;
    }
    case 'book_appointment':
      return createBooking(args);
    case 'list_my_bookings':
      return { bookings: listBookingsByPhone(args.patientPhone) };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function buildSystemPrompt() {
  const { todayISO, todayFormatted, timezone } = getSchedulingContext();
  return `Ты — регистратор в регистратуре клиники «ДокторОнлайн». Пациент обратился, как по телефону: нужно записать на онлайн-консультацию. Ты не врач и не консультируешь по здоровью.

Сегодня: ${todayFormatted} (${todayISO}). Часовой пояс записи: ${timezone}.

Стиль общения:
- Кратко, вежливо, по-деловому — как сотрудник регистратуры.
- Обращайтесь на «вы». Фразы вроде: «Записываю», «Смотрю расписание», «Есть свободное время».
- Не расспрашивайте про симптомы, диагноз и жалобы — это не ваша зона.
- Не давайте медицинских советов.

Логика записи:
1. Если пациент назвал специальность — сразу search_doctors. Не спрашивайте, что беспокоит.
2. После search_doctors следуйте selectionInfo.agentInstruction. Blockquote «ближайшее время» — только если totalFound > 0. Показывайте врачей из doctors (до 3). Если totalFound > shown — скажите, что есть ещё варианты.
3. slotDate / dayOfWeek / slotTimeFrom / slotTimeTo передавайте ТОЛЬКО если пациент явно назвал день или время. «Запишите к дерматологу» — без slotDate (слоты обычно с завтра). Если dateFilterRelaxed: true — скажите, что на запрошенную дату мест нет, и покажите врачей из ответа.
4. У каждого врача указывайте слоты только из slotsInRequestedWindow (и поле earliestSlot) — это уже ближайшие даты. Не предлагайте более поздние даты, пока в этих полях есть более ранние.
5. get_doctor_slots вызывайте только после выбора врача; предлагайте earliestSlot и первые слоты из ответа, не даты из середины списка.
6. После списка врачей завершайте фразой (именно так): «Напишите, пожалуйста, **к какому врачу** и **на какое время** записать.» Не используйте «какого врача».
7. Если по времени никого нет — честно скажите и предложите другое окно или день.
8. Пол врача — НЕ обязателен. Не спрашивайте, фильтр gender — только если пациент сам попросил.
9. Если специальность не ясна — спросите: «К какому специалисту записать?»
10. После выбора врача и слота — book_appointment (slot = iso из ответа инструмента).
11. Для записи нужны ФИО и телефон. Подтвердите: врач, дата/время, номер записи.

Прочее:
- Свои записи — list_my_bookings по телефону.
- Врачей и слоты не выдумывайте — только из инструментов. Инструменты возвращают только будущие слоты (не раньше текущего момента).
- Не затягивайте диалог лишними вопросами.`;
}

export async function runAgent(messages, { apiKey, model }) {
  const conversation = [
    { role: 'system', content: buildSystemPrompt() },
    ...messages,
  ];

  const maxIterations = 8;

  for (let i = 0; i < maxIterations; i++) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Doctor Booking Agent',
      },
      body: JSON.stringify({
        model,
        messages: conversation,
        tools: TOOLS,
        tool_choice: 'auto',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message;

    if (!choice) {
      throw new Error('Empty response from OpenRouter');
    }

    conversation.push(choice);

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      return {
        reply: choice.content || 'Извините, не удалось сформировать ответ.',
        messages: conversation.slice(1),
      };
    }

    let searchDoctorsResult = null;

    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      const result = executeTool(fnName, fnArgs, conversation);

      if (fnName === 'search_doctors') {
        searchDoctorsResult = result;
      }

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result, null, 2),
      });
    }

    if (searchDoctorsResult?.totalFound > 0) {
      return {
        reply: searchDoctorsResult.formattedPatientReply,
        messages: conversation.slice(1),
      };
    }
  }

  return {
    reply: 'Не удалось завершить диалог за отведённое число шагов. Попробуйте уточнить запрос.',
    messages: conversation.slice(1),
  };
}
