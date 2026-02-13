import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { MetricReader } from "@opentelemetry/sdk-metrics";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";

export interface ObservabilityOptions {
  serviceName?: string;
  serviceVersion?: string;

  /**
   * 기본 instrumentation 목록을 받아서 추가/제거/교체할 수 있는 콜백.
   *
   * @example 기본값에 추가
   * instrumentations: (defaults) => [...defaults, new PrismaInstrumentation()]
   *
   * @example 일부 제거
   * instrumentations: (defaults) => defaults.filter(i => !(i instanceof RuntimeNodeInstrumentation))
   *
   * @example 완전 교체
   * instrumentations: () => [new HttpInstrumentation()]
   */
  instrumentations?: (
    defaults: Instrumentation[],
  ) => (Instrumentation | Instrumentation[])[];

  traceExporter?: SpanExporter;
  metricReaders?: MetricReader[];
  logRecordProcessors?: LogRecordProcessor[];

  /**
   * console.log/info/warn/error를 OTel LogRecord + stdout으로 변환. false로 설정하면 console은 원본 유지.
   */
  patchConsole?: boolean;
}
