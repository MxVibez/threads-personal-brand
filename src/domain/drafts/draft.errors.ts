export class DraftNotFoundError extends Error {
  constructor() {
    super("Черновик не найден.");
    this.name = "DraftNotFoundError";
  }
}

export class DraftAccessDeniedError extends Error {
  constructor() {
    super("У вас нет доступа к этому черновику.");
    this.name = "DraftAccessDeniedError";
  }
}

export class DraftVersionConflictError extends Error {
  constructor() {
    super("Черновик уже изменился. Откройте последнюю версию и повторите действие.");
    this.name = "DraftVersionConflictError";
  }
}

export class DraftStateError extends Error {
  constructor(status: string) {
    super(`Действие недоступно для черновика в статусе ${status}.`);
    this.name = "DraftStateError";
  }
}
