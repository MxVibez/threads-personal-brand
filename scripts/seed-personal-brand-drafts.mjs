import pg from "pg";

const { Client } = pg;
const batchId = "foreign-radar-2026-09-14-v1";

const drafts = [
  {
    title: "AI-поддержка, после которой уходят клиенты",
    signal: "Reddit: бизнес потерял клиентов после замены части поддержки на AI",
    source: {
      label: "Reddit, r/micro_saas",
      url: "https://www.reddit.com/r/micro_saas/comments/1wa9myg/we_lost_56_customers_after_i_tried_to_save_money/",
      meta: "Зарубежный сигнал"
    },
    segments: [
      "На Reddit владелец сервиса написал, что потерял 56 клиентов после попытки сэкономить на поддержке с помощью AI.\n\nБот хорошо отвечал на простые вопросы. Проблемы начинались там, где человек злился, сомневался или хотел нормального разговора.",
      "Я часто вижу одну ошибку. Автоматизацию ставят на место человека целиком.\n\nХотя ей лучше отдать рутину: статус заказа, запись, напоминания, типовые вопросы. Всё спорное сразу передавать сотруднику вместе с контекстом.",
      "Плохая автоматизация экономит время компании и тратит нервы клиента.\n\nГде для вас проходит граница? Какой вопрос вы бы точно не доверили боту?"
    ]
  },
  {
    title: "Когда автоматизация создаёт больше работы",
    signal: "Reddit: AI-автоматизация добавила контроль и исправление ошибок",
    source: {
      label: "Reddit, r/AI_Agents",
      url: "https://www.reddit.com/r/AI_Agents/comments/1wbg5w4/has_ai_automation_ever_created_more_work_for_you/",
      meta: "Зарубежный сигнал"
    },
    segments: [
      "В зарубежных сообществах обсуждают странный эффект: подключили AI, а работы стало больше.\n\nНужно проверять ответы, исправлять ошибки, объяснять клиентам, почему бот понял их не так.",
      "Обычно проблема начинается раньше, чем появился AI.\n\nЕсли процесс держался на памяти менеджера и сообщениях в трёх чатах, автоматизация просто размножает этот бардак быстрее.",
      "Перед разработкой я бы неделю посмотрел, где заявка появляется, кто её подхватывает и на каком шаге она зависает.\n\nКакой процесс в вашем бизнесе давно хочется автоматизировать, но страшно трогать?"
    ]
  },
  {
    title: "Клиентам всё равно, сколько AI внутри продукта",
    signal: "Reddit: владельцы бизнеса покупают решение задачи, а не технологию",
    source: {
      label: "Reddit, r/BusinessPH",
      url: "https://www.reddit.com/r/BusinessPH/comments/1wachje/is_starting_an_ai_business_highly_saturated/",
      meta: "Зарубежный сигнал"
    },
    segments: [
      "На Reddit обсуждали, не поздно ли запускать ещё один бизнес на AI.\n\nОдин ответ попал точно: клиенту обычно всё равно, как вы собрали продукт. Ему важно, перестали ли теряться заявки и стало ли проще покупать.",
      "Можно месяц рассказывать про агентов, модели и интеграции. В голове у владельца бизнеса в это время один вопрос: что изменится в понедельник утром?",
      "Сначала я смотрю, где человек бросает заявку, где менеджер отвечает слишком поздно и что приходится делать руками. Технологию выбираю после.\n\nА вы покупаете технологию или понятный результат?"
    ]
  },
  {
    title: "Контент без вечной жизни перед камерой",
    signal: "Зарубежный сигнал: занятым экспертам нужен повторяемый процесс видеоконтента",
    source: {
      label: "LinkedIn",
      url: "https://www.linkedin.com/posts/bohumilpokstefl_how-do-we-create-video-content-for-some-of-activity-7504075109201010688-ulPi",
      meta: "Зарубежный сигнал"
    },
    segments: [
      "У занятых экспертов контент часто умирает не из-за отсутствия идей.\n\nПросто каждую неделю нужно снова найти время, свет, одежду, настроение и силы говорить в камеру.",
      "AI-аватар тут полезен как запасной съёмочный день. Он не придумывает за человека позицию и не заменяет его характер. Зато может снять с него часть повторяющейся работы.",
      "Мне ближе схема, где эксперт один раз нормально записывает мысли, а дальше команда собирает из них несколько форматов.\n\nКакую часть создания контента вы бы с радостью больше никогда не делали вручную?"
    ]
  },
  {
    title: "Почему приложение не спасает плохой путь клиента",
    signal: "Собственная продуктовая позиция Максима",
    source: {
      label: "Threads Максима",
      url: "https://www.threads.com/@maks.eremenkoo/post/DdQeY5lDN0X",
      meta: "Продолжение собственной темы"
    },
    segments: [
      "Можно сделать красивое приложение, добавить бота и подключить AI. А клиент всё равно уйдёт.\n\nНапример, если после кнопки «Записаться» ему предлагают ждать звонка менеджера.",
      "Я начинаю проект с одного скучного вопроса: что человек должен сделать за первые две минуты?\n\nЗаписаться, выбрать услугу, оплатить или получить расчёт. Одно понятное действие важнее десяти экранов.",
      "Технология работает, когда убирает лишний шаг. Если она добавляет ещё один кабинет, пароль и инструкцию, бизнес купил себе новую проблему.\n\nНа каком шаге ваши клиенты чаще всего пропадают?"
    ]
  }
];

function validateDrafts() {
  const forbidden = /[—–]|contentReference|oaicite|turn\d+(?:search|fetch)\d+|\*\*|###/u;
  for (const draft of drafts) {
    if (!draft.title || draft.segments.length < 2) throw new Error("Invalid draft structure");
    for (const segment of draft.segments) {
      if (segment.length > 500) throw new Error(`Segment exceeds 500 characters: ${draft.title}`);
      if (forbidden.test(segment)) throw new Error(`Forbidden editorial marker: ${draft.title}`);
    }
  }
}

async function main() {
  validateDrafts();
  if (process.argv.includes("--validate-only")) {
    process.stdout.write(`Validated ${drafts.length} drafts and ${drafts.reduce((sum, draft) => sum + draft.segments.length, 0)} segments.\n`);
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  const expertTelegramId = (process.env.EXPERT_TELEGRAM_IDS ?? "").split(",")[0]?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!/^\d+$/.test(expertTelegramId ?? "")) throw new Error("EXPERT_TELEGRAM_IDS is required");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [batchId]);
    const existing = await client.query(
      "SELECT count(*)::int AS count FROM drafts WHERE analysis->>'batchId' = $1",
      [batchId]
    );
    const existingCount = existing.rows[0]?.count ?? 0;
    if (existingCount === drafts.length) {
      await client.query("COMMIT");
      process.stdout.write(`Draft batch already exists: ${batchId}\n`);
      return;
    }
    if (existingCount !== 0) throw new Error(`Partial draft batch found: ${existingCount}/${drafts.length}`);

    const createdIds = [];
    for (const draft of drafts) {
      const insertedDraft = await client.query(
        `INSERT INTO drafts (
           expert_telegram_id, title, status, current_version, sources, analysis
         ) VALUES ($1, $2, 'WAITING_APPROVAL', 1, $3::jsonb, $4::jsonb)
         RETURNING id`,
        [
          expertTelegramId,
          draft.title,
          JSON.stringify([draft.source]),
          JSON.stringify({
            batchId,
            format: `Ветка · ${draft.segments.length} поста`,
            signal: draft.signal,
            freshness: "зарубежный радар, последняя неделя",
            goal: "Охват, содержательные ответы и демонстрация продуктового мышления",
            discussionPotential: "Вопрос основан на конкретном конфликте",
            risk: "Без обещаний результата и без выдуманных кейсов",
            audience: "Владельцы бизнеса, эксперты и маркетинговые команды",
            insight: "Технология появляется после проблемы и не занимает первый план.",
            evidence: [
              "Фактический внешний тезис сохранён ссылкой в источниках.",
              "Авторская позиция не выдаётся за подтверждённую статистику.",
              "Текст прошёл Humanizer и Слопотрон в режиме Fix."
            ]
          })
        ]
      );
      const draftId = insertedDraft.rows[0]?.id;
      if (!draftId) throw new Error("Draft insert did not return an id");
      const insertedVersion = await client.query(
        "INSERT INTO draft_versions (draft_id, version) VALUES ($1, 1) RETURNING id",
        [draftId]
      );
      const versionId = insertedVersion.rows[0]?.id;
      if (!versionId) throw new Error("Draft version insert did not return an id");
      for (const [position, text] of draft.segments.entries()) {
        await client.query(
          "INSERT INTO draft_segments (draft_version_id, position, text) VALUES ($1, $2, $3)",
          [versionId, position, text]
        );
      }
      createdIds.push(draftId);
    }

    await client.query(
      `UPDATE experts
       SET voice_profile = jsonb_build_object(
         'description', 'От первого лица. Короткие абзацы, прямой вопрос и конкретный бизнес-сценарий. Экспертность показывается через ход мысли, а не через самопрезентацию.',
         'avoid', 'Длинные тире, нейрослоп, канцелярит, рекламные призывы, гарантии охватов, выдуманные кейсы и цифры, каталог услуг и технологий.',
         'examples', $2::jsonb
       ), updated_at = NOW()
       WHERE telegram_id = $1`,
      [expertTelegramId, JSON.stringify(drafts.slice(0, 3).map((draft) => draft.segments.join("\n\n")))]
    );
    await client.query(
      `INSERT INTO audit_log (actor_telegram_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'CONTENT_BATCH_CREATED', 'draft_batch', $2, $3::jsonb)`,
      [expertTelegramId, batchId, JSON.stringify({ draftIds: createdIds, count: createdIds.length })]
    );
    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({ batchId, created: createdIds.length, draftIds: createdIds })}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
