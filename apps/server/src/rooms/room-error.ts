import type { CommandError, ErrorCode } from "@sync/shared";

export class RoomError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly currentRevision?: number) {
    super(message);
    this.name = "RoomError";
  }

  toPayload(): CommandError {
    return {
      code: this.code,
      message: this.message,
      ...(this.currentRevision === undefined ? {} : { currentRevision: this.currentRevision }),
    };
  }
}
