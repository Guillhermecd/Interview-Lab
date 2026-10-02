export const HEALTH_STATUS_OK = 'ok';

export interface HealthResponse {
  status: typeof HEALTH_STATUS_OK;
}
