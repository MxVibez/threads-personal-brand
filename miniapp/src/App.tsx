import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { useSwipeCard } from "./useSwipeCard";
import {
  approveDraft,
  cancelPlannedPublication,
  loadBootstrap,
  loadExpertSettings,
  loadPlan,
  loadResults,
  rejectDraft,
  saveExpertSettings,
  type DraftApiDto,
  type ExpertSettingsDto,
  type ExpertTimezone,
  type PlannedPublicationDto,
  type ResultsResponse,
  type ThreadsInsightsDto
} from "./api";

type Screen = "feed" | "plan" | "results" | "settings";
type Sheet =
  | { kind: "approve"; topicId: string }
  | { kind: "reject"; topicId: string }
  | { kind: "thread"; topicId: string }
  | { kind: "evidence"; topicId: string }
  | null;

type Topic = {
  id: string;
  version: number;
  format: string;
  signal: string;
  mentions: number;
  freshness: string;
  title: string;
  hook: string;
  goal: string;
  discussionPotential: string;
  risk: string;
  audience: string;
  insight: string;
  segments: string[];
  evidence: string[];
  sources: Array<{ label: string; meta: string; url?: string }>;
};

type LoadState = "loading" | "ready" | "denied" | "error";
type ApprovalChoice = { label: string; scheduledAt: string };

type TelegramWebApp = {
  colorScheme?: "light" | "dark";
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  disableClosingConfirmation?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  openLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred?: (type: "error" | "success" | "warning") => void;
    selectionChanged?: () => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const TOPICS: Topic[] = [
  {
    id: "messenger-sales-route",
    version: 1,
    format: "Ветка · 4 поста",
    signal: "Позиционирование",
    mentions: 0,
    freshness: "без внешних данных",
    title: "Когда бизнесу нужен не ещё один сайт, а приложение внутри мессенджера",
    hook: "Если после рекламы клиент всё равно спрашивает «а что делать дальше?» — дело не в количестве страниц.",
    goal: "Получить запросы на разбор цифровой воронки",
    discussionPotential: "Средний",
    risk: "Низкий",
    audience: "Владельцы бизнеса и эксперты",
    insight:
      "Пост связывает разработку с понятным клиентским маршрутом и не обещает результат без диагностики бизнеса.",
    segments: [
      "Если после рекламы клиент всё равно спрашивает «а что делать дальше?» — дело не в количестве страниц.",
      "Часто нужен короткий маршрут: открыть приложение в Telegram, понять предложение, ответить на несколько вопросов и оставить заявку.",
      "Я проектирую Telegram Mini Apps, веб- и мобильные приложения для бизнеса и экспертов. Сначала собираю путь к продаже, потом выбираю экраны и технологии.",
      "Хочешь понять, где приложение может убрать потери в твоей воронке? Напиши «РАЗБОР»."
    ],
    evidence: [
      "Услуги и подход описаны Максимом.",
      "В тексте нет выдуманных цифр или кейсов.",
      "Перед публикацией требуется финальное одобрение."
    ],
    sources: [
      { label: "Бриф Максима", meta: "позиционирование · без рыночных метрик" }
    ]
  },
  {
    id: "mini-app-vs-site",
    version: 1,
    format: "Ветка · 3 поста",
    signal: "Образование",
    mentions: 0,
    freshness: "без внешних данных",
    title: "Mini App или обычный сайт: что выбрать бизнесу",
    hook: "Telegram Mini App нужен не каждому бизнесу. И это хорошая новость.",
    goal: "Показать честный продуктовый подход",
    discussionPotential: "Высокий",
    risk: "Низкий",
    audience: "Бизнесы, выбирающие формат цифрового продукта",
    insight:
      "Честная граница между сайтом и Mini App помогает отстроиться от продажи технологии ради технологии.",
    segments: [
      "Telegram Mini App нужен не каждому бизнесу. И это хорошая новость.",
      "Если человеку важно найти вас из поиска и прочитать несколько страниц, чаще достаточно хорошего сайта.",
      "Mini App полезнее, когда клиент уже пришёл в Telegram и должен пройти сценарий: подбор, запись, расчёт, заказ, обучение или повторная покупка. Я начинаю именно с этого маршрута, а не с модного формата."
    ],
    evidence: [
      "Сравнение не содержит универсального обещания.",
      "Решение зависит от реального пути клиента.",
      "Перед публикацией можно добавить конкретный кейс Максима."
    ],
    sources: [
      { label: "Продуктовый принцип", meta: "сайт и Mini App решают разные задачи" }
    ]
  },
  {
    id: "ai-avatar-production",
    version: 1,
    format: "Один пост",
    signal: "AI-контент",
    mentions: 0,
    freshness: "без внешних данных",
    title: "Зачем эксперту AI-аватар",
    hook: "AI-аватар не заменяет эксперта. Он убирает зависимость контента от съёмочного дня.",
    goal: "Получить запросы на производство AI-аватара",
    discussionPotential: "Средний",
    risk: "Средний",
    audience: "Эксперты и команды, которым нужен регулярный видеоконтент",
    insight:
      "Позиция подчёркивает роль реального эксперта и не маскирует AI-производство под живую съёмку.",
    segments: [
      "AI-аватар не заменяет эксперта. Он убирает зависимость контента от съёмочного дня: один раз записываем образ и голос, затем собираем ролики под утверждённые сценарии. Позиция, факты и финальное решение всё равно остаются за человеком. Если хочешь посмотреть, подходит ли такой формат твоей задаче, напиши «АВАТАР»."
    ],
    evidence: [
      "Максим занимается созданием AI-аватаров.",
      "В тексте нет обещаний неограниченного или полностью автономного производства.",
      "Перед публикацией нужно согласовать правила маркировки AI-контента."
    ],
    sources: [
      { label: "Бриф Максима", meta: "услуга AI-аватаров" }
    ]
  },
  {
    id: "ai-blogger-brand",
    version: 1,
    format: "Короткий пост",
    signal: "AI-продукт",
    mentions: 0,
    freshness: "без внешних данных",
    title: "AI-блогер как отдельный медиаактив бренда",
    hook: "AI-блогер — это не просто красивое лицо, которое научили говорить.",
    goal: "Получить запросы от брендов на концепцию AI-персонажа",
    discussionPotential: "Средний",
    risk: "Средний",
    audience: "Бренды, которым нужен узнаваемый постоянный персонаж",
    insight:
      "Материал продаёт не визуальный эффект, а управляемую роль персонажа в коммуникации бренда.",
    segments: [
      "AI-блогер — это не просто красивое лицо, которое научили говорить. Бренду нужны характер, границы, темы, визуальная система и понятная роль в воронке. Иначе получится дорогая картинка без причины возвращаться. Если хочешь разобрать идею AI-персонажа для своего бренда, напиши «ПЕРСОНАЖ»."
    ],
    evidence: [
      "Максим создаёт AI-блогеров для брендов.",
      "Реальные результаты ещё не подставлены.",
      "Нельзя выдавать AI-персонажа за реального человека."
    ],
    sources: [
      { label: "Бриф Максима", meta: "услуга AI-блогеров" }
    ]
  }
];

const navItems: Array<{ id: Screen; label: string; icon: IconName }> = [
  { id: "feed", label: "Лента", icon: "stack" },
  { id: "plan", label: "План", icon: "calendar" },
  { id: "results", label: "Результаты", icon: "chart" },
  { id: "settings", label: "Настройки", icon: "settings" }
];

type IconName =
  | "stack"
  | "calendar"
  | "chart"
  | "settings"
  | "close"
  | "check"
  | "arrow"
  | "info"
  | "clock"
  | "link"
  | "reset"
  | "heart"
  | "comment"
  | "repost"
  | "share"
  | "more";

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  const paths: Record<IconName, ReactNode> = {
    stack: <><rect x="4" y="4" width="16" height="13" rx="2" /><path d="M8 21h8" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15.03 1.7 1.7 0 0 0 3.09 14H3v-4h.09A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.09V3h4v.09a1.7 1.7 0 0 0 1.03 1.51 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.91 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="m9 18 6-6-6-6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1" /></>,
    reset: <><path d="M4 4v6h6" /><path d="M5.6 16.5A8 8 0 1 0 5 8" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
    comment: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-4-.9L3 21l1.7-4.6A8.5 8.5 0 1 1 21 11.5Z" />,
    repost: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function ThreadsMark() {
  return (
    <svg
      className="threads-mark"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 3.25C8.55 3.25 4 8.02 4 16.05c0 8.08 4.63 12.7 12.33 12.7 7.07 0 11.42-4.02 11.42-10.24 0-5.42-3.06-8.45-8.02-8.45-5.02 0-8.2 2.18-8.2 5.62 0 2.91 2.23 4.82 5.48 4.82 3.91 0 6.49-2.61 6.49-6.77 0-6.07-3.03-9.73-8.41-9.73-4.86 0-7.99 2.72-8.96 6.78"
        stroke="currentColor"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function telegram(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

function haptic(type: "select" | "success" | "error" | "impact") {
  try {
    const feedback = telegram()?.HapticFeedback;
    if (type === "select") feedback?.selectionChanged?.();
    if (type === "success") feedback?.notificationOccurred?.("success");
    if (type === "error") feedback?.notificationOccurred?.("warning");
    if (type === "impact") feedback?.impactOccurred?.("medium");
  } catch { /* Unsupported native feedback must not interrupt the user's action. */ }
}

function draftToTopic(draft: DraftApiDto): Topic {
  const analysis = draft.analysis ?? {};
  return {
    id: draft.id,
    version: draft.version,
    format:
      analysis.format ??
      (draft.segments.length > 1
        ? `Ветка · ${draft.segments.length} поста`
        : "Один пост"),
    signal: analysis.signal ?? "Материал готов",
    mentions: analysis.mentions ?? 0,
    freshness: analysis.freshness ?? "ожидает решения",
    title: draft.title,
    hook: draft.segments[0] ?? draft.title,
    goal: analysis.goal ?? "Проверить реакцию аудитории",
    discussionPotential: analysis.discussionPotential ?? "На проверке",
    risk: analysis.risk ?? "Нужна проверка",
    audience: analysis.audience ?? "Аудитория эксперта",
    insight:
      analysis.insight ??
      "Материал подготовлен системой и ожидает проверки эксперта.",
    segments: draft.segments,
    evidence: analysis.evidence ?? ["Материал ожидает проверки эксперта."],
    sources: draft.sources.map((source) => ({
      label: source.label,
      meta: source.meta ?? "Публичный источник",
      url: source.url
    }))
  };
}

function nextPublishingSlot(timeZone: ExpertTimezone): ApprovalChoice {
  const date = new Date(Date.now() + 2 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
  const label = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  }).format(date);
  return { label, scheduledAt: date.toISOString() };
}

function dateTimeInputValue(isoDate: string, timeZone: ExpertTimezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone
  }).formatToParts(new Date(isoDate));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function approvalChoiceFromInput(value: string, timeZone: ExpertTimezone): ApprovalChoice | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const offsetHours = timeZone === "Asia/Krasnoyarsk" ? 7 : 3;
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - offsetHours,
    Number(minute)
  ));
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60_000 ||
      date.getTime() > Date.now() + 30 * 24 * 60 * 60_000 ||
      dateTimeInputValue(date.toISOString(), timeZone) !== value) return null;
  const label = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  }).format(date);
  return { label, scheduledAt: date.toISOString() };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("feed");
  const [queue, setQueue] = useState<Topic[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [browseIndex, setBrowseIndex] = useState(0);
  const [approved, setApproved] = useState<Array<{ topic: Topic; time: string; scheduledAt: string }>>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"dry-run" | "live">("dry-run");
  const [publishingSettings, setPublishingSettings] = useState(defaultExpertSettings);
  const [submitting, setSubmitting] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const decisionInFlight = useRef(false);
  const initDataRef = useRef("");
  const activeIdRef = useRef<string | undefined>(undefined);

  const activeTopic = queue[browseIndex];
  activeIdRef.current = activeTopic?.id;
  const activeSheetTopic = sheet
    ? queue.find((topic) => topic.id === sheet.topicId)
    : undefined;

  const loadQueue = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    const initData = telegram()?.initData ?? "";
    initDataRef.current = initData;

    if (!initData) {
      if (import.meta.env.DEV) {
        setQueue(TOPICS);
        setLoadState("ready");
      } else {
        setLoadState("denied");
      }
      return;
    }

    try {
      const bootstrap = await loadBootstrap(initData);
      setQueue(bootstrap.drafts.map(draftToTopic));
      setBrowseIndex(0);
      setMode(bootstrap.mode);
      setPublishingSettings(bootstrap.settings);
      setLoadState("ready");
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить очередь");
      setLoadState(status === 401 || status === 403 ? "denied" : "error");
    }
  }, []);

  useEffect(() => {
    const webApp = telegram();
    webApp?.ready?.();
    webApp?.expand?.();
    document.documentElement.dataset.telegramTheme = webApp?.colorScheme ?? "light";
    try {
      webApp?.setHeaderColor?.(webApp.colorScheme === "dark" ? "#0d0d0d" : "#ffffff");
      webApp?.setBackgroundColor?.(webApp.colorScheme === "dark" ? "#0d0d0d" : "#ffffff");
      if (webApp?.initData) {
        webApp.requestFullscreen?.();
        webApp.disableVerticalSwipes?.();
        webApp.disableClosingConfirmation?.();
      }
    } catch {
      // Старые клиенты Telegram могут не поддерживать управление цветами.
    }
    const sdk = document.getElementById("telegram-sdk");
    const onSdkLoad = () => { void loadQueue(); };
    sdk?.addEventListener("load", onSdkLoad);
    void loadQueue();
    return () => sdk?.removeEventListener("load", onSdkLoad);
  }, [loadQueue]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (loadState === "error") void loadQueue();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadQueue, loadState]);

  useEffect(() => {
    if (loadState !== "ready" || screen !== "feed" || sheet || !initDataRef.current) return;
    let pending = false;
    const controller = new AbortController();
    async function refreshSharedQueue() {
      if (pending || document.hidden || !navigator.onLine || decisionInFlight.current) return;
      pending = true;
      try {
        const data = await loadBootstrap(initDataRef.current, controller.signal);
        if (controller.signal.aborted) return;
        const nextQueue = data.drafts.map(draftToTopic);
        const index = nextQueue.findIndex(item => item.id === activeIdRef.current);
        setQueue(nextQueue);
        setBrowseIndex(Math.max(0, index));
        setPublishingSettings(data.settings);
        setMode(data.mode);
      } catch { /* Keep the last useful queue; explicit actions still report errors. */ }
      finally { pending = false; }
    }
    const timer = window.setInterval(() => void refreshSharedQueue(), 30_000);
    document.addEventListener("visibilitychange", refreshSharedQueue);
    window.addEventListener("online", refreshSharedQueue);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshSharedQueue);
      window.removeEventListener("online", refreshSharedQueue);
    };
  }, [loadState, screen, sheet]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openApprove() {
    if (!activeTopic) return;
    haptic("impact");
    setSheetError("");
    setSheet({ kind: "approve", topicId: activeTopic.id });
  }

  function openReject() {
    if (!activeTopic) return;
    haptic("impact");
    setSheetError("");
    setSheet({ kind: "reject", topicId: activeTopic.id });
  }

  async function completeDecision(
    kind: "approve" | "reject",
    detail: string,
    scheduledAt?: string
  ) {
    if (!activeSheetTopic || decisionInFlight.current) return;
    decisionInFlight.current = true;
    setSubmitting(true);
    setSheetError("");
    try {
      let savedScheduledAt = scheduledAt ?? new Date().toISOString();
      if (initDataRef.current) {
        if (kind === "approve") {
          const approval = await approveDraft(initDataRef.current, {
            draftId: activeSheetTopic.id,
            expectedVersion: activeSheetTopic.version,
            scheduledAt: savedScheduledAt
          });
          savedScheduledAt = approval.scheduledAt;
        } else {
          await rejectDraft(initDataRef.current, {
            draftId: activeSheetTopic.id,
            expectedVersion: activeSheetTopic.version,
            reason: detail
          });
        }
      } else if (!import.meta.env.DEV) {
        throw new Error("Откройте приложение из Telegram и повторите действие.");
      }

      if (kind === "approve") {
        setApproved((items) => [...items, { topic: activeSheetTopic, time: detail, scheduledAt: savedScheduledAt }]);
        setToast(`Поставили в план: ${detail}`);
        haptic("success");
      } else {
        setToast(`Убрали из ленты: ${detail}`);
        haptic("error");
      }
      const nextQueue = queue.filter((item) => item.id !== activeSheetTopic.id);
      setQueue(nextQueue);
      setBrowseIndex((current) => Math.min(current, Math.max(0, nextQueue.length - 1)));
      setSheet(null);
    } catch (error) {
      setSheetError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить решение. Попробуйте ещё раз."
      );
      haptic("error");
    } finally {
      decisionInFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="threads-brand" aria-label="Threads">
          <ThreadsMark />
          <strong>Threads</strong>
        </div>
      </header>

      {!online && <div className="offline-banner">Нет сети. Решение пока не отправится.</div>}
      <main className="main-content">
        {loadState === "loading" && <LoadingScreen />}
        {loadState === "denied" && (
          <AccessScreen
            title="Откройте через Telegram"
            description={loadError || "Очередь доступна только из вашего Telegram-бота."}
            onRetry={loadQueue}
          />
        )}
        {loadState === "error" && (
          <AccessScreen
            title="Не удалось загрузить очередь"
            description={loadError}
            onRetry={loadQueue}
          />
        )}
        {loadState === "ready" && screen === "feed" && (
          <FeedScreen
            queue={queue}
            browseIndex={browseIndex}
            activeTopic={activeTopic}
            onOpenThread={() => activeTopic && setSheet({ kind: "thread", topicId: activeTopic.id })}
            onApprove={openApprove}
            onReject={openReject}
            onEvidence={() => activeTopic && setSheet({ kind: "evidence", topicId: activeTopic.id })}
            onPrevious={() => {
              haptic("select");
              setBrowseIndex((current) => Math.max(0, current - 1));
            }}
            onNext={() => {
              haptic("select");
              setBrowseIndex((current) => Math.min(queue.length - 1, current + 1));
            }}
            onOpenPlan={() => setScreen("plan")}
            mode={mode}
          />
        )}
        {loadState === "ready" && screen === "plan" && (
          <PlanScreen approved={approved} timezone={publishingSettings.timezone} initData={initDataRef.current} mode={mode} />
        )}
        {loadState === "ready" && screen === "results" && (
          <ResultsScreen initData={initDataRef.current} />
        )}
        {loadState === "ready" && screen === "settings" && (
          <SettingsScreen initData={initDataRef.current} onSaved={setPublishingSettings} />
        )}
      </main>

      {loadState === "ready" && <nav className="bottom-nav" aria-label="Основная навигация">
        {navItems.map((item) => (
          <button
            className={screen === item.id ? "nav-item active" : "nav-item"}
            key={item.id}
            onClick={() => {
              haptic("select");
              setScreen(item.id);
            }}
            aria-current={screen === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>}

      {sheet && activeSheetTopic && (
        <BottomSheet onClose={() => !submitting && setSheet(null)}>
          {sheet.kind === "approve" && (
            <ApproveSheet
              topic={activeSheetTopic}
              timezone={publishingSettings.timezone}
              mode={mode}
              submitting={submitting}
              error={sheetError}
              onChoose={(value) => completeDecision("approve", value.label, value.scheduledAt)}
            />
          )}
          {sheet.kind === "reject" && (
            <RejectSheet
              submitting={submitting}
              error={sheetError}
              onChoose={(value) => completeDecision("reject", value)}
            />
          )}
          {sheet.kind === "thread" && <ThreadSheet topic={activeSheetTopic} />}
          {sheet.kind === "evidence" && <EvidenceSheet topic={activeSheetTopic} />}
        </BottomSheet>
      )}

      {toast && <div className="toast" role="status"><Icon name="check" size={18} /> {toast}</div>}
    </div>
  );
}

function LoadingScreen() {
  return (
    <section className="screen loading-screen" aria-label="Загрузка очереди">
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-card">
        <div className="skeleton skeleton-line medium" />
        <div className="skeleton skeleton-copy" />
        <div className="skeleton skeleton-copy small" />
      </div>
    </section>
  );
}

function AccessScreen({
  title,
  description,
  onRetry
}: {
  title: string;
  description: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <section className="screen access-screen">
      <div className="empty-mark"><Icon name="info" size={28} /></div>
      <h1>{title}</h1>
      <p>{description}</p>
      <button className="approve-button" onClick={() => void onRetry()}>
        Попробовать снова
      </button>
    </section>
  );
}

function FeedScreen({
  queue,
  browseIndex,
  activeTopic,
  onOpenThread,
  onApprove,
  onReject,
  onEvidence,
  onPrevious,
  onNext,
  onOpenPlan,
  mode
}: {
  queue: Topic[];
  browseIndex: number;
  activeTopic?: Topic;
  onOpenThread: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEvidence: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onOpenPlan: () => void;
  mode: "dry-run" | "live";
}) {
  return (
    <section className="screen feed-screen">
      <div className="feed-tabs" aria-label="Раздел ленты">
        <div className="active">На согласование</div>
        <button onClick={onOpenPlan}>В работе</button>
      </div>
      {mode === "dry-run" && (
        <div className="test-mode-note"><span>Контроль</span> Первая публикация ждёт подключения Threads</div>
      )}
      <div className="intro-row">
        <div>
          <p className="section-kicker">Очередь на сегодня</p>
          <h1>{activeTopic ? `${queue.length} материала` : "Очередь разобрана"}</h1>
          {activeTopic && <p className="intro-caption">ждут вашего решения</p>}
        </div>
        {activeTopic && <div className="count-badge">{browseIndex + 1}/{queue.length}</div>}
      </div>

      {activeTopic ? (
        <>
          <ProgressDots current={browseIndex} total={queue.length} />
          <div className="browse-controls" aria-label="Просмотр материалов без решения">
            <button
              className="browse-button previous"
              disabled={browseIndex === 0}
              onClick={onPrevious}
              aria-label="Предыдущая ветка"
            >
              <Icon name="arrow" size={19} />
            </button>
            <span>Листайте без решения</span>
            <button
              className="browse-button"
              disabled={browseIndex === queue.length - 1}
              onClick={onNext}
              aria-label="Следующая ветка"
            >
              <Icon name="arrow" size={19} />
            </button>
          </div>
          <SwipeCard
            key={activeTopic.id}
            topic={activeTopic}
            onOpenThread={onOpenThread}
            onApprove={onApprove}
            onReject={onReject}
            onEvidence={onEvidence}
          />
          <p className="swipe-hint"><span>← не подходит</span><span>свайпните карточку</span><span>одобрить →</span></p>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-mark"><Icon name="check" size={30} /></div>
          <h2>Новых материалов пока нет</h2>
          <p>Бот пришлёт уведомление, когда найдёт свежую тему, которая подходит вашему позиционированию.</p>
        </div>
      )}
    </section>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="progress-dots" aria-label={`Материал ${current + 1} из ${total}`}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={index < current ? "done" : index === current ? "current" : ""} />
      ))}
    </div>
  );
}

function SwipeCard({
  topic,
  onOpenThread,
  onApprove,
  onReject,
  onEvidence
}: {
  topic: Topic;
  onOpenThread: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEvidence: () => void;
}) {
  const { cardRef, handlers, decide: decideWithMotion } = useSwipeCard(onApprove, onReject);

  return (
    <article
      ref={cardRef}
      className="topic-card"
      {...handlers}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowRight") decideWithMotion("approve");
        if (event.key === "ArrowLeft") decideWithMotion("reject");
      }}
      tabIndex={0}
      aria-label="Карточка материала. Стрелка вправо одобряет, стрелка влево отклоняет"
    >
      <div className="decision-stamp approve-stamp">В план</div>
      <div className="decision-stamp reject-stamp">Убрать</div>

      <div className="post-author-row">
        <img
          className="expert-avatar"
          src={`${import.meta.env.BASE_URL}maxim-avatar.png`}
          alt="Максим Еременко"
          width="38"
          height="38"
          decoding="async"
          fetchPriority="high"
        />
        <div className="post-author-copy">
          <strong>Максим · Apps &amp; AI</strong>
          <span>Предпросмотр · сейчас</span>
        </div>
        <Icon name="more" size={20} />
      </div>

      <div className="post-copy">
        <div className="card-meta">
          <span className="solid-chip">{topic.signal}</span>
          <span>{topic.mentions} реакций · {topic.freshness}</span>
        </div>
        <p className="topic-label">Тема: {topic.title}</p>
        <h2>{topic.hook}</h2>
        <div className="thread-actions-preview" aria-label="Так действия будут выглядеть в Threads">
          <Icon name="heart" size={20} />
          <Icon name="comment" size={20} />
          <Icon name="repost" size={20} />
          <Icon name="share" size={19} />
        </div>
      </div>

      <div className="score-grid">
        <div><span>Потенциал обсуждения</span><strong>{topic.discussionPotential}</strong></div>
        <div><span>Риск формулировок</span><strong>{topic.risk}</strong></div>
      </div>

      <div className="thread-preview">
        <div className="preview-heading">
          <div><span>Готовый текст</span><strong>{topic.format}</strong></div>
          <button onClick={(event) => { event.stopPropagation(); onOpenThread(); }}>
            Посмотреть всю ветку
          </button>
        </div>
        <div className="segments">
          {topic.segments.slice(0, 1).map((segment, index) => (
            <div className="segment" key={index}>
              <span>{index + 1}/{topic.segments.length}</span>
              <p>{segment}</p>
            </div>
          ))}
        </div>
      </div>

      <button className="evidence-link" onClick={(event) => { event.stopPropagation(); onEvidence(); }}>
        <Icon name="info" size={18} /> Почему система выбрала эту тему <Icon name="arrow" size={17} />
      </button>

      <div className="card-actions" data-no-swipe>
        <button className="round-action reject-action" onClick={() => decideWithMotion("reject")} aria-label="Не подходит"><Icon name="close" size={27} /></button>
        <button className="approve-button" onClick={() => decideWithMotion("approve")}><Icon name="check" size={22} /> Одобрить</button>
      </div>
    </article>
  );
}

function PlanScreen({
  approved,
  timezone,
  initData,
  mode
}: {
  approved: Array<{ topic: Topic; time: string; scheduledAt: string }>;
  timezone: ExpertTimezone;
  initData: string;
  mode: "dry-run" | "live";
}) {
  const [items, setItems] = useState<PlannedPublicationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedForRemoval, setSelectedForRemoval] = useState<PlannedPublicationDto | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!initData && import.meta.env.DEV) {
      setItems(approved.map((item) => ({
        id: item.topic.id,
        draftId: item.topic.id,
        title: item.topic.title,
        scheduledAt: item.scheduledAt,
        status: "PENDING"
      })));
      setLoading(false);
      return;
    }
    if (!initData) {
      setLoading(false);
      return;
    }
    try {
      const response = await loadPlan(initData);
      setItems(response.publications);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить план");
    } finally {
      setLoading(false);
    }
  }, [approved, initData]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(""), 2_000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  async function removeFromPlan() {
    if (!selectedForRemoval) return;
    setRemoving(true);
    setRemovalError("");
    try {
      if (initData) {
        await cancelPlannedPublication(initData, selectedForRemoval.id);
      } else if (!import.meta.env.DEV) {
        throw new Error("Откройте приложение из Telegram и повторите действие.");
      }
      setItems((current) => current.filter((item) => item.id !== selectedForRemoval.id));
      setSelectedForRemoval(null);
      setConfirmation("Публикация удалена из плана");
      haptic("success");
    } catch (removeError) {
      setRemovalError(removeError instanceof Error ? removeError.message : "Не удалось удалить публикацию");
      haptic("error");
    } finally {
      setRemoving(false);
    }
  }

  const formatted = items.map((item) => ({
    ...item,
    time: new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone
    }).format(new Date(item.scheduledAt)),
    date: new Intl.DateTimeFormat("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timezone
    }).format(new Date(item.scheduledAt))
  }));

  return (
    <section className="screen">
      <p className="section-kicker">Публикации</p>
      <div className="plan-title-row"><h1>План публикаций</h1><button onClick={() => void refresh()} disabled={loading}>{loading ? "Проверяем…" : "Обновить"}</button></div>
      <div className="date-strip static-date"><strong>Ближайшие публикации</strong></div>
      {loading && items.length === 0 ? <div className="compact-empty"><p>Загружаем план…</p></div> : formatted.length > 0 ? <div className="timeline">
        {formatted.map((item) => (
          <div className="timeline-item" key={item.id}>
            <div className="timeline-time">{item.time}</div>
            <div className="timeline-line"><span /></div>
            <div className="timeline-card">
              <span className="status-label">{item.date}</span>
              <strong>{item.title}</strong>
              {item.status !== "PENDING" && <p className="plan-status" role="status">{
                item.status === "PROCESSING" ? "Публикация выполняется"
                : item.status === "NEEDS_REVIEW" ? "Нужно проверить результат в Threads. Автоповтор остановлен."
                : item.status === "PARTIAL_FAILED" ? "Опубликована только часть ветки. Проверьте результат."
                : "Не удалось опубликовать. Подробности доступны администратору."
              }</p>}
              {item.status === "PENDING" && (
                <button className="plan-remove-button" onClick={() => { setRemovalError(""); setSelectedForRemoval(item); }}>
                  <Icon name="close" size={15} /> Удалить из плана
                </button>
              )}
            </div>
          </div>
        ))}
      </div> : <div className="compact-empty"><strong>План пока пуст</strong><p>Одобрите материал в ленте — он появится здесь сразу.</p></div>}
      {error && <p className="sheet-error" role="alert">{error}</p>}
      {mode === "dry-run" && <div className="notice-card"><Icon name="clock" /><div><strong>Публикация пока под контролем</strong><p>План сохраняется, а отправка в Threads включится после проверки подключения аккаунта.</p></div></div>}
      {confirmation && <div className="toast" role="status"><Icon name="check" size={18} /> {confirmation}</div>}
      {selectedForRemoval && <BottomSheet onClose={() => !removing && setSelectedForRemoval(null)}>
        <p className="section-kicker">Подтверждение</p>
        <h2>Удалить публикацию из плана?</h2>
        <p className="sheet-description">«{selectedForRemoval.title}» не будет опубликована в Threads.</p>
        <button className="danger-button" disabled={removing} onClick={() => void removeFromPlan()}>
          {removing ? "Удаляем…" : "Да, удалить"}
        </button>
        <button className="text-button" disabled={removing} onClick={() => setSelectedForRemoval(null)}>Оставить в плане</button>
        {removalError && <p className="sheet-error" role="alert">{removalError}</p>}
      </BottomSheet>}
    </section>
  );
}

type ResultsDetail =
  | { kind: "metric"; title: string; value: number; detail: string }
  | null;

const emptyThreadsInsights: ThreadsInsightsDto = {
  available: false,
  periodDays: 7,
  totals: {
    views: 0,
    followersGained: 0,
    interactions: 0,
    engagementRate: 0
  },
  timeline: [],
  topPosts: [],
  themes: []
};

const localPreviewResults: ResultsResponse = {
  counts: {
    waiting: 0,
    approved: 0,
    rejected: 0,
    published: 0,
    failed: 0
  },
  integrations: [
    {
      id: "telegram",
      name: "Telegram",
      state: "setup",
      summary: "Не подключён",
      detail: "Для работы нужен отдельный bot token и настройка Mini App."
    },
    {
      id: "apify",
      name: "Мониторинг рынка",
      state: "setup",
      summary: "Не подключён",
      detail: "Actor, источники и token не настроены; внешний сбор выключен.",
      nextStep: "После отдельного решения выбрать разрешённые источники."
    },
    {
      id: "threads",
      name: "Публикация и аналитика Threads",
      state: "setup",
      summary: "Только dry-run",
      detail: "Реальные публикации и статистика аккаунта не подключены.",
      nextStep: "Подключать аккаунт только после отдельного подтверждения."
    },
    {
      id: "ai",
      name: "Нейросеть и голос",
      state: "setup",
      summary: "API ещё не подключён",
      detail: "Автоматическая генерация и оценка материалов пока не запускаются.",
      nextStep: "Добавить API key и примеры текстов эксперта."
    }
  ],
  insights: emptyThreadsInsights
};

function ResultsScreen({ initData }: { initData: string }) {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ResultsDetail>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!initData && import.meta.env.DEV) {
      setData(localPreviewResults);
      setLoading(false);
      return;
    }
    if (!initData) {
      setLoading(false);
      return;
    }
    try {
      setData(await loadResults(initData));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить результаты");
    } finally {
      setLoading(false);
    }
  }, [initData]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <LoadingScreen />;
  if (!data) {
    return <AccessScreen title="Не удалось загрузить результаты" description={error} onRetry={refresh} />;
  }

  const workflowMetrics = [
    { title: "Ждут решения", value: data.counts.waiting, detail: "Черновики, которые ещё нужно одобрить или отклонить." },
    { title: "Одобрено", value: data.counts.approved, detail: "Материалы, для которых создана задача публикации." },
    { title: "Отклонено", value: data.counts.rejected, detail: "Материалы, которые вы убрали из очереди." },
    { title: "Опубликовано", value: data.counts.published, detail: "Завершённые публикации. В dry-run реальные посты не создаются." }
  ];
  const insights = data.insights;
  const maxDailyViews = Math.max(...insights.timeline.map((item) => item.views), 1);
  const maxThemeViews = Math.max(...insights.themes.map((item) => item.averageViews), 1);

  return (
    <section className="screen results-screen">
      <div className="analytics-title-row">
        <div><p className="section-kicker">Ведение аккаунта</p><h1>Аналитика Threads</h1></div>
        <span className="period-chip">7 дней</span>
      </div>

      {!data.insights?.available && (
        <div className="analytics-preview-note">
          <span>Threads</span>
          <div><strong>Аналитика появится после подключения</strong><p>Здесь будут только реальные данные вашего аккаунта — без подставных цифр.</p></div>
        </div>
      )}

      <article className="reach-hero">
        <div className="reach-hero-heading"><span>Просмотры</span><small>охват публикаций</small></div>
        <div className="reach-total"><strong>{formatCompactNumber(insights.totals.views)}</strong><span>за 7 дней</span></div>
        <div className="reach-bars" aria-label="Просмотры по дням">
          {insights.timeline.map((item) => (
            <div className="reach-day" key={item.label} aria-label={`${item.label}: ${formatNumber(item.views)} просмотров`}>
              <b>{formatCompactNumber(item.views)}</b>
              <div><span style={{ height: `${Math.max(12, item.views / maxDailyViews * 100)}%` }} /></div>
              <small>{item.label}</small>
            </div>
          ))}
        </div>
      </article>

      <div className="thread-kpis">
        <div><span>Новые подписчики</span><strong>+{formatNumber(insights.totals.followersGained)}</strong><small>прирост за период</small></div>
        <div><span>Вовлечение</span><strong>{insights.totals.engagementRate.toFixed(1)}%</strong><small>реакции к просмотрам</small></div>
        <div><span>Взаимодействия</span><strong>{formatCompactNumber(insights.totals.interactions)}</strong><small>лайки, ответы и репосты</small></div>
      </div>

      <div className="results-section-heading"><div><h2>Лучшие публикации</h2><p>Что дало больше всего просмотров</p></div></div>
      <div className="top-threads-list">
        {insights.topPosts.map((post, index) => (
          <article key={post.id}>
            <span className="thread-rank">{index + 1}</span>
            <div className="top-thread-copy">
              <p>{post.text}</p>
              <div><strong>{formatCompactNumber(post.views)} просмотров</strong><span>{formatNumber(post.likes)} отметок «Нравится» · {formatNumber(post.replies)} ответов</span></div>
            </div>
          </article>
        ))}
      </div>

      <div className="results-section-heading"><div><h2>Какие темы заходят</h2><p>Средние просмотры одного поста</p></div></div>
      <div className="theme-performance">
        {insights.themes.map((theme) => (
          <div key={theme.label}>
            <div><strong>{theme.label}</strong><span>{formatCompactNumber(theme.averageViews)} · {theme.posts} {pluralizePosts(theme.posts)}</span></div>
            <div className="theme-track"><span style={{ width: `${Math.max(10, theme.averageViews / maxThemeViews * 100)}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="analytics-takeaway">
        <span>@</span>
        <div><strong>Вывод пока не сформирован</strong><p>Подключите разрешённый источник данных, чтобы сравнивать темы по реальным результатам.</p></div>
      </div>

      <div className="results-section-heading"><div><h2>Работа пульта</h2><p>Очередь и публикации</p></div></div>
      <div className="analytics-grid">
        {workflowMetrics.map((metric) => (
          <button key={metric.title} onClick={() => setDetail({ kind: "metric", ...metric })}>
            <span>{metric.title}</span><strong>{metric.value}</strong><small>Подробнее</small>
          </button>
        ))}
      </div>

      {error && <p className="sheet-error" role="alert">{error}</p>}
      {detail && <BottomSheet onClose={() => setDetail(null)}>
        {detail.kind === "metric" && <>
          <p className="section-kicker">Показатель</p>
          <h2>{detail.title}: {detail.value}</h2>
          <p className="sheet-description">{detail.detail}</p>
        </>}
      </BottomSheet>}
    </section>
  );
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function pluralizePosts(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "постов";
  if (mod10 === 1) return "пост";
  if (mod10 >= 2 && mod10 <= 4) return "поста";
  return "постов";
}

const timezoneOptions: Array<{ value: ExpertTimezone; label: string }> = [
  { value: "Europe/Moscow", label: "Санкт-Петербург · UTC+3" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск · UTC+7" },
];

const defaultExpertSettings: ExpertSettingsDto = {
  timezone: "Asia/Krasnoyarsk",
  dailyPublications: 3,
  voice: {
    description: "От первого лица. Прямо, спокойно и конкретно. Объяснять продукт через путь клиента, продажи и реальную работу бизнеса. Короткие абзацы, живые примеры, без давления.",
    avoid: "Нейрослоп, канцелярит, обещания гарантированного роста, выдуманные кейсы и цифры, перегруз технологиями, агрессивные продажи.",
    examples: []
  }
};

function SettingsScreen({ initData, onSaved }: { initData: string; onSaved: (settings: ExpertSettingsDto) => void }) {
  const [settings, setSettings] = useState<ExpertSettingsDto | null>(null);
  const [savedSettings, setSavedSettings] = useState<ExpertSettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [integrations, setIntegrations] = useState<ResultsResponse["integrations"]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsError, setIntegrationsError] = useState("");
  const [integrationDetail, setIntegrationDetail] = useState<ResultsResponse["integrations"][number] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!initData && import.meta.env.DEV) {
      setSettings(defaultExpertSettings);
      setSavedSettings(defaultExpertSettings);
      setLoading(false);
      return;
    }
    try {
      const loaded = await loadExpertSettings(initData);
      setSettings(loaded);
      setSavedSettings(loaded);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить настройки");
    } finally {
      setLoading(false);
    }
  }, [initData]);

  const refreshIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    setIntegrationsError("");
    if (!initData && import.meta.env.DEV) {
      setIntegrations(localPreviewResults.integrations);
      setIntegrationsLoading(false);
      return;
    }
    if (!initData) {
      setIntegrationsLoading(false);
      return;
    }
    try {
      const results = await loadResults(initData);
      setIntegrations(results.integrations);
    } catch (loadError) {
      setIntegrationsError(loadError instanceof Error ? loadError.message : "Не удалось проверить подключения");
    } finally {
      setIntegrationsLoading(false);
    }
  }, [initData]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshIntegrations();
  }, [refreshIntegrations]);

  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(""), 1_800);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  async function persist(next: ExpertSettingsDto, message: string) {
    setSaving(true);
    setError("");
    try {
      const saved = !initData && import.meta.env.DEV
        ? next
        : await saveExpertSettings(initData, next);
      setSettings(saved);
      setSavedSettings(saved);
      onSaved(saved);
      setVoiceOpen(false);
      setConfirmation(message);
      haptic("success");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить настройки");
      haptic("error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingScreen />;
  if (!settings || !savedSettings) {
    return <AccessScreen title="Не удалось загрузить настройки" description={error} onRetry={refresh} />;
  }

  const preferencesChanged =
    settings.timezone !== savedSettings.timezone ||
    settings.dailyPublications !== savedSettings.dailyPublications;
  const voiceSummary = settings.voice.examples.length > 0
    ? `${settings.voice.examples.length} ${pluralizeExamples(settings.voice.examples.length)}`
    : settings.voice.description
      ? "Описание добавлено"
      : "Не настроен";

  return (
    <section className="screen settings-screen">
      <p className="section-kicker">Под ваш режим работы</p>
      <h1>Настройки</h1>
      <p className="settings-intro">Параметры контента, расписания и подключённых сервисов.</p>

      <div className="settings-card">
        <label className="settings-field" htmlFor="timezone">
          <span>Часовой пояс</span>
          <small>Время в плане и уведомлениях</small>
          <select
            id="timezone"
            value={settings.timezone}
            onChange={(event) => setSettings({ ...settings, timezone: event.target.value as ExpertTimezone })}
          >
            {timezoneOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>

        <div className="settings-field publication-limit">
          <div><span>Публикаций в день</span><small>Дневной объём для подготовки контент-плана</small></div>
          <div className="number-stepper" aria-label="Число публикаций в день">
            <button
              disabled={settings.dailyPublications <= 1}
              onClick={() => setSettings({ ...settings, dailyPublications: Math.max(1, settings.dailyPublications - 1) })}
              aria-label="Уменьшить число публикаций"
            >−</button>
            <strong>{settings.dailyPublications}</strong>
            <button
              disabled={settings.dailyPublications >= 10}
              onClick={() => setSettings({ ...settings, dailyPublications: Math.min(10, settings.dailyPublications + 1) })}
              aria-label="Увеличить число публикаций"
            >+</button>
          </div>
        </div>
      </div>

      {preferencesChanged && (
        <button className="approve-button settings-save" disabled={saving} onClick={() => void persist(settings, "Настройки публикаций сохранены")}>
          {saving ? "Сохраняем…" : "Сохранить изменения"}
        </button>
      )}

      <div className="settings-group">
        <h2>Контент</h2>
        <button className="voice-setting-card" onClick={() => setVoiceOpen(true)}>
          <img
            className="voice-setting-photo"
            src={`${import.meta.env.BASE_URL}maxim-avatar.png`}
            alt=""
            width="46"
            height="46"
            loading="lazy"
            decoding="async"
          />
          <div><strong>Голос эксперта</strong><span>{voiceSummary}</span></div>
          <Icon name="arrow" size={18} />
        </button>
      </div>

      <div className="settings-group settings-connections">
        <div className="settings-group-heading">
          <div><h2>Подключения</h2><p>Сервисы, от которых зависит работа пульта</p></div>
          <button onClick={() => void refreshIntegrations()} disabled={integrationsLoading}>
            {integrationsLoading ? "Проверяем…" : "Обновить"}
          </button>
        </div>
        {integrationsLoading && integrations.length === 0 ? (
          <div className="settings-connections-loading">Проверяем подключения…</div>
        ) : (
          <div className="integration-list">
            {integrations.map((item) => (
              <button key={item.id} onClick={() => setIntegrationDetail(item)}>
                <span className={`health-dot ${item.state}`} />
                <div><strong>{item.name}</strong><small>{item.summary}</small></div>
                <Icon name="arrow" size={17} />
              </button>
            ))}
          </div>
        )}
        {integrationsError && <p className="sheet-error" role="alert">{integrationsError}</p>}
      </div>

      <p className="settings-footnote">Это общие настройки пространства. Все пользователи с доступом видят один голос эксперта, план и результаты.</p>
      {error && <p className="sheet-error" role="alert">{error}</p>}
      {confirmation && <div className="toast" role="status"><Icon name="check" size={18} /> {confirmation}</div>}
      {voiceOpen && <BottomSheet onClose={() => !saving && setVoiceOpen(false)}>
        <VoiceSettingsSheet
          voice={settings.voice}
          saving={saving}
          error={error}
          onSave={(voice) => void persist({ ...settings, voice }, "Голос эксперта сохранён")}
        />
      </BottomSheet>}
      {integrationDetail && <BottomSheet onClose={() => setIntegrationDetail(null)}>
        <p className="section-kicker">Состояние подключения</p>
        <h2>{integrationDetail.name}</h2>
        <p className="sheet-description">{integrationDetail.detail}</p>
        <div className="diagnostic-state"><span className={`health-dot ${integrationDetail.state}`} /><strong>{integrationDetail.summary}</strong></div>
        {integrationDetail.nextStep && <div className="assumption-note"><strong>Следующий шаг</strong><p>{integrationDetail.nextStep}</p></div>}
      </BottomSheet>}
    </section>
  );
}

function VoiceSettingsSheet({
  voice,
  saving,
  error,
  onSave
}: {
  voice: ExpertSettingsDto["voice"];
  saving: boolean;
  error: string;
  onSave: (voice: ExpertSettingsDto["voice"]) => void;
}) {
  const [description, setDescription] = useState(voice.description);
  const [avoid, setAvoid] = useState(voice.avoid);
  const [examplesText, setExamplesText] = useState(voice.examples.join("\n\n---\n\n"));
  const [validationError, setValidationError] = useState("");

  function submit() {
    const examples = examplesText
      .split(/\n\s*---\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (examples.length > 20) {
      setValidationError("Можно сохранить не больше 20 примеров.");
      return;
    }
    if (examples.some((item) => item.length > 5_000)) {
      setValidationError("Один из примеров длиннее 5 000 символов.");
      return;
    }
    setValidationError("");
    onSave({ description: description.trim(), avoid: avoid.trim(), examples });
  }

  return (
    <>
      <p className="section-kicker">Память стиля</p>
      <h2>Голос эксперта</h2>
      <p className="sheet-description">Опишите живую манеру речи и добавьте настоящие тексты. Это станет основой для генерации и проверки материалов.</p>
      <label className="voice-field">
        <span>Как звучит эксперт</span>
        <small>Например: говорит прямо, спокойно, без запугивания и канцелярита</small>
        <textarea maxLength={2_000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Опишите тон, лексику и характер подачи" />
      </label>
      <label className="voice-field">
        <span>Чего избегать</span>
        <small>Слова, обещания и обороты, которые эксперт не использует</small>
        <textarea maxLength={2_000} rows={3} value={avoid} onChange={(event) => setAvoid(event.target.value)} placeholder="Например: гарантированный результат, лучший на рынке…" />
      </label>
      <label className="voice-field">
        <span>Примеры текстов</span>
        <small>Разделяйте разные публикации строкой --- · до 20 примеров</small>
        <textarea maxLength={30_000} rows={8} value={examplesText} onChange={(event) => setExamplesText(event.target.value)} placeholder={"Первый пост эксперта\n\n---\n\nВторой пост эксперта"} />
      </label>
      {(validationError || error) && <p className="sheet-error" role="alert">{validationError || error}</p>}
      <button className="approve-button voice-save" disabled={saving} onClick={submit}>{saving ? "Сохраняем…" : "Сохранить голос"}</button>
    </>
  );
}

function pluralizeExamples(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "примеров";
  if (mod10 === 1) return "пример";
  if (mod10 >= 2 && mod10 <= 4) return "примера";
  return "примеров";
}

function BottomSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    sectionRef.current?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const buttons = sectionRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']");
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sectionRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = wasInert;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="sheet-layer" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sectionRef} className="bottom-sheet" role="dialog" aria-modal="true" aria-label="Подробности материала" tabIndex={-1}>
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><Icon name="close" size={22} /></button>
        {children}
      </section>
    </div>, document.body
  );
}

function ApproveSheet({
  topic,
  timezone,
  mode,
  submitting,
  error,
  onChoose
}: {
  topic: Topic;
  timezone: ExpertTimezone;
  mode: "dry-run" | "live";
  submitting: boolean;
  error: string;
  onChoose: (value: ApprovalChoice) => void;
}) {
  const recommended = useMemo(() => nextPublishingSlot(timezone), [timezone]);
  const [customTime, setCustomTime] = useState(() => dateTimeInputValue(recommended.scheduledAt, timezone));
  const customChoice = useMemo(
    () => approvalChoiceFromInput(customTime, timezone),
    [customTime, timezone]
  );
  const minTime = useMemo(
    () => dateTimeInputValue(new Date(Date.now() + 2 * 60_000).toISOString(), timezone),
    [timezone]
  );
  const maxTime = useMemo(
    () => dateTimeInputValue(new Date(Date.now() + 29 * 24 * 60 * 60_000).toISOString(), timezone),
    [timezone]
  );
  const timezoneLabel = timezone === "Asia/Krasnoyarsk" ? "Красноярск · UTC+7" : "Санкт-Петербург · UTC+3";

  return (
    <>
      <p className="section-kicker">Материал одобрен</p>
      <h2>Когда поставить в план?</h2>
      <p className="sheet-description">{topic.title}</p>
      <button
        className="sheet-option recommended"
        disabled={submitting}
        onClick={() => onChoose(recommended)}
      >
        <div><span>Через два часа</span><strong>{recommended.label}</strong><small>Проверьте выбранное время в плане</small></div><Icon name="arrow" />
      </button>
      <div className="custom-schedule">
        <label htmlFor="custom-publishing-time"><strong>Выбрать своё время</strong><small>{timezoneLabel}</small></label>
        <input
          id="custom-publishing-time"
          type="datetime-local"
          value={customTime}
          min={minTime}
          max={maxTime}
          disabled={submitting}
          onChange={(event) => setCustomTime(event.target.value)}
        />
        <button
          className="approve-button custom-schedule-submit"
          disabled={submitting || !customChoice}
          onClick={() => customChoice && onChoose(customChoice)}
        >
          {submitting ? "Сохраняем…" : "Поставить в план"}
        </button>
      </div>
      <button
        className="sheet-option"
        disabled={submitting}
        onClick={() => onChoose({ label: "сейчас", scheduledAt: new Date().toISOString() })}
      >
        <div><strong>{submitting ? "Сохраняем…" : "Опубликовать сейчас"}</strong><small>{mode === "dry-run" ? "В тестовом режиме публикации в Threads не будет" : "Ветка будет отправлена в подключённый Threads-аккаунт"}</small></div><Icon name="arrow" />
      </button>
      {error && <p className="sheet-error" role="alert">{error}</p>}
    </>
  );
}

function RejectSheet({
  submitting,
  error,
  onChoose
}: {
  submitting: boolean;
  error: string;
  onChoose: (value: string) => void;
}) {
  const reasons = ["Не мой стиль", "Тема уже была", "Слишком рискованно", "Не подходит аудитории"];
  return (
    <>
      <p className="section-kicker">Короткая обратная связь</p>
      <h2>Почему не подходит?</h2>
      <p className="sheet-description">Один ответ поможет следующей очереди точнее попадать в ваш стиль.</p>
      <div className="reason-grid">
        {reasons.map((reason) => <button disabled={submitting} key={reason} onClick={() => onChoose(reason)}>{reason}</button>)}
      </div>
      <button className="text-button" disabled={submitting} onClick={() => onChoose("Без причины")}>
        {submitting ? "Сохраняем…" : "Пропустить вопрос"}
      </button>
      {error && <p className="sheet-error" role="alert">{error}</p>}
    </>
  );
}

function ThreadSheet({ topic }: { topic: Topic }) {
  return (
    <>
      <p className="section-kicker">Готовая публикация</p>
      <h2>Ветка целиком</h2>
      <p className="sheet-description">{topic.title}</p>
      <div className="full-thread" aria-label={`Ветка из ${topic.segments.length} сообщений`}>
        {topic.segments.map((segment, index) => (
          <article className="full-thread-segment" key={index}>
            <span>{index + 1}/{topic.segments.length}</span>
            <p>{segment}</p>
          </article>
        ))}
      </div>
    </>
  );
}

function EvidenceSheet({ topic }: { topic: Topic }) {
  return (
    <>
      <p className="section-kicker">Основание материала</p>
      <h2>Почему тема в ленте</h2>
      <p className="sheet-description">{topic.insight}</p>
      <div className="evidence-list">
        {topic.evidence.map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}
      </div>
      <h3 className="sources-heading">Публичные источники</h3>
      <div className="source-list">
        {topic.sources.map((source) => {
          const url = safeSourceUrl(source.url);
          return (
            <button
              disabled={!url}
              key={source.label}
              onClick={() => url && openSource(url)}
            >
              <Icon name="link" size={17} /><div><strong>{source.label}</strong><span>{source.meta}</span></div>{url && <Icon name="arrow" size={16} />}
            </button>
          );
        })}
      </div>
      <div className="assumption-note"><strong>Важно</strong><p>Источники дают тему и формулировки боли. Текст не копирует чужие публикации, а юридические утверждения проверяются отдельно.</p></div>
    </>
  );
}

function safeSourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function openSource(url: string): void {
  if (telegram()?.openLink) {
    telegram()!.openLink!(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
