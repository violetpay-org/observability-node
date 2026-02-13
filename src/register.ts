import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { NodeSDK, resources } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { ObservabilityOptions } from "./types";
import { patchConsole } from "./log/console-patch";
import { getOriginalConsole } from "./log/emit";

const DEFAULT_ENDPOINT = "http://alloy:4318";
const METRIC_EXPORT_INTERVAL_MS = 2000;
const RUNTIME_MONITORING_PRECISION_MS = 2000;

let initialized = false;

function getMainModuleFilename(): string | undefined {
  try {
    return require.main?.filename;
  } catch {
    return undefined;
  }
}

function resolveStartDir(): string {
  const mainFilename = getMainModuleFilename();
  if (mainFilename) return dirname(mainFilename);

  if (process.argv[1]) return dirname(resolve(process.argv[1]));

  return process.cwd();
}

function findPackageJsonPath(startDir: string): string | null {
  const { root } = parse(startDir);
  let dir = startDir;

  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

function readConsumerPackageJson(): { name?: string; version?: string } {
  try {
    const pkgPath = findPackageJsonPath(resolveStartDir());
    if (!pkgPath) return {};

    const { name, version } = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return { name, version };
  } catch {
    return {};
  }
}

function createDefaultInstrumentations(): Instrumentation[] {
  return [
    ...getNodeAutoInstrumentations(),
    new RuntimeNodeInstrumentation({
      monitoringPrecision: RUNTIME_MONITORING_PRECISION_MS,
    }),
  ];
}

export function register(options?: ObservabilityOptions): void {
  if (initialized) {
    getOriginalConsole().warn("[@point3/observability] Already initialized. Skipping.");
    return;
  }
  initialized = true;

  const pkg = readConsumerPackageJson();

  const serviceName =
    process.env.OTEL_SERVICE_NAME ?? options?.serviceName ?? pkg.name ?? "unknown_service";

  const serviceVersion =
    process.env.OTEL_SERVICE_VERSION ?? options?.serviceVersion ?? pkg.version ?? "0.0.0";

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_ENDPOINT;

  if (serviceName === "unknown_service") {
    getOriginalConsole().warn(
      "[@point3/observability] OTEL_SERVICE_NAME이 설정되지 않았고 package.json name도 없습니다.",
    );
  }

  const defaultInstrumentations = createDefaultInstrumentations();
  const instrumentations = options?.instrumentations
    ? options.instrumentations(defaultInstrumentations)
    : defaultInstrumentations;

  const sdk = new NodeSDK({
    resource: resources.resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter:
      options?.traceExporter ??
      new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
      }),
    metricReaders:
      options?.metricReaders ?? [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${endpoint}/v1/metrics`,
          }),
          exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
        }),
      ],
    logRecordProcessors:
      options?.logRecordProcessors ?? [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: `${endpoint}/v1/logs`,
          }),
        ),
      ],
    instrumentations,
  });

  sdk.start();

  if (options?.patchConsole !== false) {
    patchConsole();
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    sdk
      .shutdown()
      .then(() => process.exit(0))
      .catch((error) => {
        getOriginalConsole().error("[@point3/observability] SDK Clean-up 실패", error);
        process.exit(1);
      });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export type { ObservabilityOptions } from "./types";
