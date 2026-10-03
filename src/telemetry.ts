import { Effect, Layer, Logger, Metric, References } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";
import { Settings } from "./config.ts";

export const importedRows = Metric.counter("finance.imported_observations");

export const aiQuestions = Metric.counter("finance.ai_questions");

export const apiRequests = Metric.counter("finance.api_requests");

export const workflowDuration = Metric.timer("finance.workflow_duration");

export const Telemetry = Layer.unwrap(
  Effect.gen(function* () {
    const settings = yield* Settings;

    const local = Layer.mergeAll(
      Logger.layer([Logger.consoleJson]),
      Layer.succeed(References.CurrentLogAnnotations, {
        "service.name": settings.serviceName,
        "service.version": settings.serviceVersion,
      }),
    );

    if (!settings.otlpEndpoint) return local;

    return Layer.merge(
      local,
      Otlp.layerJson({
        baseUrl: settings.otlpEndpoint,
        resource: {
          serviceName: settings.serviceName,
          serviceVersion: settings.serviceVersion,
        },
        loggerMergeWithExisting: true,
      }).pipe(Layer.provide(FetchHttpClient.layer)),
    );
  }),
);
