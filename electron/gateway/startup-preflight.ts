export interface GatewayStartupPreflightStep {
  id: string;
  label: string;
  run: () => Promise<void>;
}

export interface GatewayStartupPreflightResult {
  completedStepIds: string[];
  failedStepIds: string[];
}

export async function runGatewayStartupPreflight(params: {
  steps: GatewayStartupPreflightStep[];
  onStepError: (step: GatewayStartupPreflightStep, error: unknown) => void;
}): Promise<GatewayStartupPreflightResult> {
  const completedStepIds: string[] = [];
  const failedStepIds: string[] = [];

  for (const step of params.steps) {
    try {
      await step.run();
      completedStepIds.push(step.id);
    } catch (error) {
      failedStepIds.push(step.id);
      params.onStepError(step, error);
    }
  }

  return {
    completedStepIds,
    failedStepIds,
  };
}
