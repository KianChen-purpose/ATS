/** Thrown when the actor may not perform an action. Message is safe to show to the user. */
export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Thrown when a record doesn't exist or isn't visible to the actor (we don't reveal which). */
export class NotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}
