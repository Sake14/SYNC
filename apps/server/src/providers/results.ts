import type { ProviderFailure, ProviderFailureStatus } from "@sync/shared";

const messages: Record<ProviderFailureStatus, string> = {
  UNSUPPORTED: "Для этой операции нет подключённого разрешённого API Звука.",
  ACCESS_DENIED: "Нет разрешения на доступ к данным музыкального сервиса.",
  TOKEN_EXPIRED: "Доступ к музыкальному сервису истёк. Требуется повторная авторизация разрешённым способом.",
  SERVICE_UNAVAILABLE: "Музыкальный сервис временно недоступен.",
  NETWORK_ERROR: "Не удалось связаться с музыкальным сервисом.",
  RATE_LIMITED: "Музыкальный сервис ограничил частоту запросов. Повторите позже.",
  NOT_FOUND: "Композиция не найдена в доступной библиотеке.",
  INVALID_INPUT: "Некорректные параметры музыкального запроса.",
  INVALID_RESPONSE: "Музыкальный сервис вернул неподдерживаемый ответ.",
};
export function failure(status: ProviderFailureStatus, extra: Pick<ProviderFailure, "officialUrl" | "retryAfterSeconds"> = {}): ProviderFailure {
  return { status, message: messages[status], ...extra };
}
export const providerHttpStatus: Record<ProviderFailureStatus, number> = {
  UNSUPPORTED: 501, ACCESS_DENIED: 403, TOKEN_EXPIRED: 401, SERVICE_UNAVAILABLE: 503,
  NETWORK_ERROR: 502, RATE_LIMITED: 429, NOT_FOUND: 404, INVALID_INPUT: 400, INVALID_RESPONSE: 502,
};
