import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-schema';
import { probeWithPiAi } from '../agent/pi-ai-one-shot';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig
): Promise<ApiTestResult> {
  return probeWithPiAi(payload, config);
}
