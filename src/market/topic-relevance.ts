export interface TopicCandidateInput {
  text: string;
  query?: string | null;
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  quoteCount?: number;
  viewCount?: number;
  isReply?: boolean;
  postedAt?: Date | null;
}

export interface TopicCandidateScore {
  sourceMarket: "international" | "russian";
  relevanceScore: number;
  reachScore: number;
  commercialScore: number;
  opportunityScore: number;
  reasons: string[];
  suggestedAngle: string;
  excludedReason?: string;
}

const EXCLUDED_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|[^\p{L}\p{N}_])(?:казино|букмекер|ставк(?:и|а)|слот(?:ы|ов)|casino|betting|18\+)(?![\p{L}\p{N}_])/iu, "азартный или взрослый контент"],
  [/(?:^|[^\p{L}\p{N}_])(?:крипт(?:а|о|овалют)|токенсейл|airdrop|арбитраж крипт|crypto)(?![\p{L}\p{N}_])/iu, "криптовалютный шум"],
  [/(?:взаимн(?:ая|ые) подписк|подпишись на меня|розыгрыш призов|гивэвей|follow for follow|giveaway)/iu, "механика искусственного набора аудитории"],
  [/(?:ваканси(?:я|и)|ищу работу|резюме|зарплата от|job opening|hiring|resume)/iu, "поиск работы"],
  [/(?:^|[^\p{L}\p{N}_])(?:войн(?:а|ы|е)|выборы|депутат|президент|геополитик|war|election|politics)(?![\p{L}\p{N}_])/iu, "политическая тема"],
];

const SIGNALS = {
  audience: [
    /бизнес/iu, /владел(?:ец|ьц)/iu, /предпринимател/iu, /эксперт/iu,
    /клиник/iu, /стоматолог/iu, /салон/iu, /школ/iu, /магазин/iu, /бренд/iu,
    /business/iu, /founder/iu, /entrepreneur/iu, /creator/iu, /brand/iu, /clinic/iu, /agency/iu
  ],
  salesPain: [
    /заявк/iu, /лид/iu, /продаж/iu, /клиент/iu, /конверси/iu, /воронк/iu,
    /запис(?:ь|аться|ыва)/iu, /менеджер/iu, /директ/iu, /переписк/iu,
    /теря(?:ю|ем|ются|ть)/iu, /не покупа/iu, /не отвеча/iu,
    /lead/iu, /sales/iu, /customer/iu, /client/iu, /conversion/iu, /funnel/iu,
    /booking/iu, /lost/iu, /doesn['’]t buy/iu
  ],
  operations: [
    /ручн/iu, /таблиц/iu, /crm/iu, /автоматизац/iu, /бот/iu, /telegram/iu,
    /threads/iu, /mini[ -]?app/iu, /сайт/iu, /приложен/iu, /сервис/iu,
    /оплат/iu, /брони/iu, /расписан/iu, /уведомлен/iu,
    /manual/iu, /spreadsheet/iu, /automation/iu, /\bapp\b/iu, /website/iu, /payment/iu
  ],
  contentPain: [
    /контент/iu, /с[ъь]емк/iu, /камер/iu, /блог/iu, /рилс/iu, /reels/iu,
    /аватар/iu, /охват/iu, /подписчик/iu, /не хочу сниматься/iu,
    /нет времени (?:на|для) контент/iu, /content/iu, /filming/iu,
    /camera/iu, /audience/iu, /personal brand/iu
  ],
  intent: [
    /(?<![\p{L}\p{N}_])как(?![\p{L}\p{N}_])/iu, /(?<![\p{L}\p{N}_])почему(?![\p{L}\p{N}_])/iu,
    /что делать/iu, /не могу/iu, /не получается/iu,
    /нужен/iu, /сколько стоит/iu, /посоветуйте/iu, /кто сталкивался/iu,
    /(?<![\p{L}\p{N}_])how(?![\p{L}\p{N}_])/iu, /(?<![\p{L}\p{N}_])why(?![\p{L}\p{N}_])/iu,
    /struggl/iu, /need help/iu, /what should/iu, /\?/u
  ],
  tension: [
    /ошибк/iu, /не работает/iu, /устал/iu, /дорог/iu, /бесит/iu,
    /провал/iu, /перестал/iu, /отказ/iu, /хаос/iu, /забыва/iu,
    /потер/iu, /слишком долго/iu, /mistake/iu, /doesn['’]t work/iu,
    /tired/iu, /expensive/iu, /failed/iu, /chaos/iu
  ]
} as const;

const DIRECT_PITCH = [
  /мы разрабатываем/iu,
  /заказать (?:сайт|бот|приложение)/iu,
  /наша студия/iu,
  /оказываем услуги/iu,
  /пишите в личку/iu,
  /успейте купить/iu
];

function hits(value: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((total, pattern) => total + (pattern.test(value) ? 1 : 0), 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function chooseAngle(value: string): string {
  if (hits(value, SIGNALS.salesPain) >= 2) {
    return "Разобрать момент, в котором интерес человека превращается в потерянную заявку.";
  }
  if (hits(value, SIGNALS.contentPain) >= 2) {
    return "Зайти через усталость от контент-гонки и показать управляемую альтернативу без обещаний лёгких охватов.";
  }
  if (hits(value, SIGNALS.operations) >= 2) {
    return "Показать цену ручного процесса на одном бытовом примере, а технологию оставить развязкой.";
  }
  return "Ответить на напряжение автора конкретным наблюдением из продуктовой практики, без продажи в первом абзаце.";
}

export function scoreTopicCandidate(input: TopicCandidateInput): TopicCandidateScore {
  const text = `${input.query ?? ""}\n${input.text}`.trim();
  const latinLetters = (input.text.match(/[A-Za-z]/g) ?? []).length;
  const cyrillicLetters = (input.text.match(/[А-ЯЁа-яё]/g) ?? []).length;
  const allLetters = (input.text.match(/\p{L}/gu) ?? []).length;
  if (allLetters > 20 && allLetters - latinLetters - cyrillicLetters > allLetters * 0.35) {
    return {
      sourceMarket: "international",
      relevanceScore: 0,
      reachScore: 0,
      commercialScore: 0,
      opportunityScore: 0,
      reasons: [],
      suggestedAngle: "",
      excludedReason: "нецелевой язык"
    };
  }
  for (const [pattern, reason] of EXCLUDED_PATTERNS) {
    if (pattern.test(text)) {
      return {
        sourceMarket: /[А-ЯЁа-яё]/u.test(input.text) ? "russian" : "international",
        relevanceScore: 0,
        reachScore: 0,
        commercialScore: 0,
        opportunityScore: 0,
        reasons: [],
        suggestedAngle: "",
        excludedReason: reason
      };
    }
  }

  const audience = hits(text, SIGNALS.audience);
  const salesPain = hits(text, SIGNALS.salesPain);
  const operations = hits(text, SIGNALS.operations);
  const contentPain = hits(text, SIGNALS.contentPain);
  const intent = hits(text, SIGNALS.intent);
  const tension = hits(text, SIGNALS.tension);
  const pitchPenalty = hits(text, DIRECT_PITCH) * 12;
  const sourceMarket = /[А-ЯЁа-яё]/u.test(input.text) ? "russian" : "international";

  const relevanceScore = clamp(
    8 + Math.min(audience, 3) * 9 + Math.min(salesPain, 4) * 11 +
    Math.min(operations, 3) * 8 + Math.min(contentPain, 3) * 9 - pitchPenalty
  );

  const engagement =
    Math.max(0, input.likeCount ?? 0) +
    Math.max(0, input.replyCount ?? 0) * 2 +
    Math.max(0, input.repostCount ?? 0) * 3 +
    Math.max(0, input.quoteCount ?? 0) * 3;
  const engagementSignal = Math.min(42, Math.log2(engagement + 1) * 7);
  const viewSignal = Math.min(18, Math.log10(Math.max(0, input.viewCount ?? 0) + 1) * 6);
  const ageHours = input.postedAt
    ? Math.max(0, (Date.now() - input.postedAt.getTime()) / 3_600_000)
    : 48;
  const freshnessSignal = ageHours <= 12 ? 18 : ageHours <= 24 ? 13 : ageHours <= 48 ? 8 : 2;
  const hookSignal = Math.min(22, intent * 6 + tension * 4 + (/^.{0,100}[.!?]/u.test(input.text) ? 2 : 0));
  const reachScore = clamp(engagementSignal + viewSignal + freshnessSignal + hookSignal - (input.isReply ? 8 : 0));

  const commercialScore = clamp(
    5 + Math.min(salesPain, 4) * 14 + Math.min(contentPain, 3) * 11 +
    Math.min(operations, 3) * 8 + Math.min(intent, 3) * 7 - pitchPenalty
  );
  const opportunityScore = clamp(
    relevanceScore * 0.42 + reachScore * 0.33 + commercialScore * 0.25 +
    (sourceMarket === "international" ? 5 : 0)
  );

  const reasons: string[] = [];
  if (salesPain >= 2) reasons.push("есть конкретная боль вокруг заявок или продаж");
  if (contentPain >= 2) reasons.push("есть напряжение вокруг контента и регулярных съёмок");
  if (operations >= 2) reasons.push("виден ручной или неудобный процесс");
  if (intent >= 1) reasons.push("аудитория задаёт вопрос или ищет решение");
  if (engagement >= 10) reasons.push("публикация уже получила заметную реакцию");
  if (tension >= 1) reasons.push("в заходе есть конфликт или потеря");
  if (sourceMarket === "international") reasons.unshift("ранний зарубежный сигнал");

  return {
    sourceMarket,
    relevanceScore,
    reachScore,
    commercialScore,
    opportunityScore,
    reasons: reasons.slice(0, 3),
    suggestedAngle: chooseAngle(text),
    ...((relevanceScore < 30 || commercialScore < 20)
      ? { excludedReason: "слабая связь с аудиторией или услугами Максима" }
      : {})
  };
}
