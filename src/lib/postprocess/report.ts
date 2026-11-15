import type { RetargetHistoryEntry } from '../retarget/types';
import type { PostProcessConfig, PostProcessOutput } from './types';

export function buildPostProcessReportPayload(
  entry: RetargetHistoryEntry,
  config: PostProcessConfig,
  output: PostProcessOutput,
) {
  return {
    format: 'rro_postprocess_report_v1',
    exported_at: new Date().toISOString(),
    source: {
      history_id: entry.id,
      bvh_name: entry.bvhName,
      robot_id: entry.robotId,
      robot_label: entry.robotLabel,
      engine: entry.engine,
      created_at: new Date(entry.createdAt).toISOString(),
      fps: entry.result.fps,
      frame_count: entry.result.frameCount,
      nq: entry.result.nq,
      dof_names: entry.result.dofNames,
    },
    config,
    operations: output.operations,
    metrics_before: output.metricsBefore,
    metrics_after: output.metricsAfter,
    trajectory_delta: output.delta,
    anomalies_raw: output.rawDetection.anomalies,
    anomalies_processed: output.processedDetection.anomalies,
  };
}

export function exportPostProcessReportJson(
  entry: RetargetHistoryEntry,
  config: PostProcessConfig,
  output: PostProcessOutput,
): Blob {
  const payload = buildPostProcessReportPayload(entry, config, output);
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
