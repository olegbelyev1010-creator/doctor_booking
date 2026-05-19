import {
  searchDoctors,
  getDoctorSlots,
  createBooking,
  getSpecialties,
  listBookingsByPhone,
  getSchedulingContext,
} from './doctors.js';

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
            description: 'Дата YYYY-MM-DD (московское время), если пациент назвал день',
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
              'День недели на английском, если пациент сказал «в субботу» и т.п. (можно вместе с slotDate)',
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
        'Свободные слоты врача. Передавай те же slotDate/dayOfWeek/slotTimeFrom/slotTimeTo, если пациент уже назвал время.',
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

function executeTool(name, args) {
  switch (name) {
    case 'search_doctors':
      return searchDoctors(args);
    case 'get_specialties':
      return { specialties: getSpecialties() };
    case 'get_doctor_slots': {
      const { doctorId, slotDate, slotTimeFrom, slotTimeTo, dayOfWeek } = args;
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
2. После search_doctors ОБЯЗАТЕЛЬНО подсветите критерий подбора — начните с blockquote из selectionInfo.agentInstruction (ближайшее время + лучший рейтинг). Показывайте не более 3 врачей. Если totalFound > shown — скажите, что есть ещё варианты.
3. Если пациент указал день и/или время — передайте в search_doctors slotDate, dayOfWeek, slotTimeFrom, slotTimeTo. Показывайте только врачей из ответа со слотами в slotsInRequestedWindow.
4. У каждого врача указывайте конкретные свободные слоты из slotsInRequestedWindow.
5. Если по времени никого нет — честно скажите и предложите другое окно или день.
6. Пол врача — НЕ обязателен. Не спрашивайте, фильтр gender — только если пациент сам попросил.
7. Если специальность не ясна — спросите: «К какому специалисту записать?»
8. После выбора врача и слота — book_appointment (slot = iso из ответа инструмента).
9. Для записи нужны ФИО и телефон. Подтвердите: врач, дата/время, номер записи.

Прочее:
- Свои записи — list_my_bookings по телефону.
- Врачей и слоты не выдумывайте — только из инструментов.
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

    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      const result = executeTool(fnName, fnArgs);

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result, null, 2),
      });
    }
  }

  return {
    reply: 'Не удалось завершить диалог за отведённое число шагов. Попробуйте уточнить запрос.',
    messages: conversation.slice(1),
  };
}
