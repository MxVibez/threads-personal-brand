import { describe, expect, it } from "vitest";
import { scoreTopicCandidate } from "../src/market/topic-relevance";

describe("scoreTopicCandidate", () => {
  it("promotes a fresh business pain with engagement", () => {
    const result = scoreTopicCandidate({
      text: "Владелец салона теряет заявки: менеджер не отвечает клиентам из директа. Кто сталкивался?",
      query: "теряю заявки",
      likeCount: 18,
      replyCount: 11,
      repostCount: 3,
      postedAt: new Date()
    });

    expect(result.excludedReason).toBeUndefined();
    expect(result.sourceMarket).toBe("russian");
    expect(result.opportunityScore).toBeGreaterThanOrEqual(50);
    expect(result.reasons).toContain("есть конкретная боль вокруг заявок или продаж");
  });

  it("prioritizes a relevant international early signal", () => {
    const result = scoreTopicCandidate({
      text: "Small business founders are losing customer leads because manual booking does not work. Why?",
      query: "small business",
      likeCount: 40,
      replyCount: 15,
      repostCount: 8,
      postedAt: new Date()
    });

    expect(result.sourceMarket).toBe("international");
    expect(result.opportunityScore).toBeGreaterThanOrEqual(50);
    expect(result.reasons[0]).toBe("ранний зарубежный сигнал");
  });

  it("filters unrelated high-engagement noise", () => {
    const result = scoreTopicCandidate({
      text: "Розыгрыш призов: подпишись на меня, взаимная подписка всем",
      likeCount: 10_000,
      replyCount: 2_000
    });

    expect(result.opportunityScore).toBe(0);
    expect(result.excludedReason).toBeDefined();
  });

  it("filters non-target-language results before notification", () => {
    const result = scoreTopicCandidate({
      text: "股價跌很多不等於便宜，真正要看公司的獲利、產業趨勢和籌碼有沒有變。",
      query: "приложение",
      likeCount: 500,
      replyCount: 100
    });

    expect(result.opportunityScore).toBe(0);
    expect(result.excludedReason).toBe("нецелевой язык");
  });

  it("penalizes a direct agency pitch", () => {
    const organic = scoreTopicCandidate({
      text: "Почему сайт не приносит заявки владельцу клиники?",
      postedAt: new Date()
    });
    const pitch = scoreTopicCandidate({
      text: "Наша студия: мы разрабатываем сайты. Пишите в личку, чтобы заказать сайт для бизнеса",
      postedAt: new Date()
    });

    expect(organic.opportunityScore).toBeGreaterThan(pitch.opportunityScore);
  });
});
