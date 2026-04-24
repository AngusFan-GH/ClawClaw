export interface GatewayStartupPreflightStep {
  id: string;
  label: string;
  run: () => Promise<void>;
  fatal?: boolean;
}

/** A group of steps that run in parallel. */
export interface GatewayStartupPreflightPhase {
  id: string;
  label: string;
  steps: GatewayStartupPreflightStep[];
}

export interface GatewayStartupPreflightResult {
  completedStepIds: string[];
  failedStepIds: string[];
}

/**
 * Run a single phase — all steps in parallel.
 * Non-fatal step failures are collected but do not abort the phase.
 * Fatal step failures (step.fatal = true) re-throw after all other
 * parallel promises settle, stopping the overall preflight.
 */
async function runPhase(
  phase: GatewayStartupPreflightPhase,
  onStepError: (step: GatewayStartupPreflightStep, error: unknown) => void,
): Promise<{ completedStepIds: string[]; failedStepIds: string[] }> {
  const completedStepIds: string[] = [];
  const failedStepIds: string[] = [];
  let fatalError: unknown = null;

  const results = await Promise.allSettled(
    phase.steps.map(async (step) => {
      try {
        await step.run();
        return { id: step.id, ok: true };
      } catch (error) {
        onStepError(step, error);
        if (step.fatal) {
          fatalError = error;
        }
        return { id: step.id, ok: false };
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.ok) {
        completedStepIds.push(result.value.id);
      } else {
        failedStepIds.push(result.value.id);
      }
    }
    // Rejected results only occur if the promise itself throws before
    // returning (e.g. an unexpected error outside step.run()). In that
    // case we have no step id — treat it as a non-fatal failure.
  }

  if (fatalError !== null) {
    throw fatalError;
  }

  return { completedStepIds, failedStepIds };
}

/**
 * Run preflight phases sequentially.
 * Each phase runs all its steps in parallel. If any step in a phase is
 * marked `fatal`, a failure aborts the remaining phases immediately.
 */
export async function runGatewayStartupPreflight(params: {
  phases: GatewayStartupPreflightPhase[];
  onStepError: (step: GatewayStartupPreflightStep, error: unknown) => void;
}): Promise<GatewayStartupPreflightResult> {
  const completedStepIds: string[] = [];
  const failedStepIds: string[] = [];

  for (const phase of params.phases) {
    try {
      const result = await runPhase(phase, params.onStepError);
      completedStepIds.push(...result.completedStepIds);
      failedStepIds.push(...result.failedStepIds);
    } catch (fatalError) {
      // A fatal step in this phase threw — record the remaining steps as
      // not-run and propagate the error to abort subsequent phases.
      failedStepIds.push(...phase.steps.map((s) => s.id));
      throw fatalError;
    }
  }

  return { completedStepIds, failedStepIds };
}
