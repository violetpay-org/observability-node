# @point3/observability

Point3 서비스용 OpenTelemetry SDK 래퍼. import 한 줄로 traces, metrics, logs 수집이 시작된다.

## 설치

```bash
npm install @point3/observability
```

`@opentelemetry/api`는 peer dependency로 자동 설치된다 (npm v7+).

## 사용법

### 기본 (제로 설정)

`main.ts` 최상단에 side-effect import 추가. 반드시 `dotenv/config` 다음, 모든 애플리케이션 import 전에 위치해야 한다. OTel의 monkey-patching이 모듈 로드 전에 적용되어야 하기 때문.

```typescript
import "dotenv/config";
import "@point3/observability";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
```

서비스명은 `package.json`의 `name` 필드에서 자동으로 읽는다. 별도 설정 불필요.

### 커스텀 설정

instrumentation 추가, exporter 교체 등이 필요한 경우 `register()` 함수를 사용한다. **ESM import hoisting 때문에 반드시 별도 파일로 분리해야 한다.**

```typescript
// src/observability.ts
import { register } from "@point3/observability/register";

register({
  instrumentations: (defaults) => [...defaults, new PrismaInstrumentation()],
});
```

```typescript
// src/main.ts
import "dotenv/config";
import "./observability";

import { NestFactory } from "@nestjs/core";
```

## 로깅

`register()` 호출 시 `console.log`, `console.error` 등 표준 콘솔 메서드가 자동으로 패치된다. 패치된 console은 두 가지 일을 동시에 수행한다:

1. **stdout/stderr 출력** — 터미널에서 로그를 바로 확인할 수 있다
2. **OTel LogRecord 전송** — OTLP를 통해 Alloy → Loki로 수집된다

active span이 있으면 `trace_id`와 `span_id`가 자동으로 LogRecord에 주입되어, Loki에서 Tempo 트레이스로 바로 연결할 수 있다.

### console 메서드 → 로그 레벨 매핑

| console 메서드 | 로그 레벨 | 출력 대상 |
|---------------|----------|----------|
| `console.log()` | `info` | stdout |
| `console.info()` | `info` | stdout |
| `console.warn()` | `warn` | stdout |
| `console.error()` | `error` | stderr |
| `console.debug()` | `debug` | stdout (기본 LOG_LEVEL=info에서 필터됨) |

### 구조화 로깅

첫 번째 인자가 객체면 `message` 필드를 로그 메시지로, 나머지 필드를 OTel LogRecord attributes로 자동 추출한다.

```typescript
// 단순 문자열
console.log("서버 시작됨");

// 구조화 로깅 — orderId, amount가 OTel attributes로 추출됨
console.log({ message: "주문 생성", orderId: "123", amount: 50000 });

// Error 객체 — exception.stacktrace, exception.type이 자동 추가됨
console.error(new Error("결제 실패"));
```

### 레벨 필터링

`LOG_LEVEL` 환경변수로 출력할 최소 레벨을 지정한다. 기본값은 `info`.

```bash
# error, fatal만 출력
LOG_LEVEL=error node main.js

# debug 이상 전부 출력
LOG_LEVEL=debug node main.js
```

레벨 우선순위: `fatal` < `error` < `warn` < `info` < `debug` < `verbose`

### 콘솔 패치 비활성화

OTel SDK는 사용하되 console 몽키패치를 원하지 않는 경우:

```typescript
import { register } from "@point3/observability/register";

register({ patchConsole: false });
```

## 커스텀 로거 통합

console 패치 대신 직접 로깅을 제어해야 하는 경우 (예: 컴플라이언스 요구사항으로 PII 로그를 별도 파이프라인으로 분리), 필요 시 `emitLog`를 직접 사용할 수 있다.

```typescript
import { register } from "@point3/observability/register";
import { emitLog } from "@point3/observability/log";
import type { LogLevel } from "@point3/observability/log";

register({ patchConsole: false }); // console 자동 패치 비활성화

// 관측 로그 → OTLP → Loki
emitLog("info", ["이체 요청 수신", { requestId: "abc" }]);

// PII 로그 → 별도 처리 (emitLog를 호출하지 않으므로 Loki에 안 감)
auditLogger.write({ accountNumber: "...", amount: 50000 });
```

## Alloy 설정

`@point3/observability`가 전송하는 OTLP 로그를 Loki로 라우팅하기 위해 Alloy 설정(`config.alloy`)을 수정한다.

기존 config에서 **3줄만 추가**하면 된다:

1. receiver output에 `logs` 추가
2. batch processor output에 `logs` 추가
3. `otelcol.exporter.loki` 컴포넌트 추가

### 전체 표준 config

```alloy
// ─── OTLP 수신 ───
otelcol.receiver.otlp "app_service" {
    grpc {
        endpoint = "0.0.0.0:4317"
    }
    http {
        endpoint = "0.0.0.0:4318"
    }

    output {
        metrics = [otelcol.processor.batch.default.input]
        traces  = [otelcol.processor.batch.default.input]
        logs    = [otelcol.processor.batch.default.input] 
    }
}

// ─── 배치 처리 ───
otelcol.processor.batch "default" {
    output {
        metrics = [otelcol.exporter.prometheus.app_service.input]
        traces  = [otelcol.exporter.otlp.tempo.input]
        logs    = [otelcol.exporter.loki.default.input] 
    }
}

// ─── Metrics → Prometheus ───
otelcol.exporter.prometheus "app_service" {
    forward_to = [prometheus.remote_write.default.receiver]
}

// ─── Traces → Tempo ───
otelcol.exporter.otlp "tempo" {
    client {
        endpoint = "<TEMPO_HOST>:4317"
        tls {
            insecure = true
        }
    }
}

otelcol.exporter.loki "default" {
    forward_to = [loki.write.default.receiver]
}

prometheus.remote_write "default" {
    endpoint {
        url = "http://<PROMETHEUS_HOST>:9090/api/v1/write"
    }
}

loki.write "default" {
    endpoint {
        url = "http://<LOKI_HOST>:3100/loki/api/v1/push"
    }
}
```

### 변경 요약

| # | 위치 | 변경 |
|---|------|------|
| 1 | `otelcol.receiver.otlp` output | `logs = [otelcol.processor.batch.default.input]` 추가 |
| 2 | `otelcol.processor.batch` output | `logs = [otelcol.exporter.loki.default.input]` 추가 |
| 3 | 새 컴포넌트 | `otelcol.exporter.loki "default"` → 기존 `loki.write.default` 재사용 |

`otelcol.exporter.loki`는 OTel 리소스 속성 `service.name`을 Loki 레이블 `service_name`으로 자동 변환한다. 별도 transform 프로세서가 필요 없다.

### 내보내기 목록

| export | 설명 |
|--------|------|
| `emitLog(level, args)` | OTel LogRecord 전송 + stdout/stderr 출력 |
| `shouldLog(level)` | `LOG_LEVEL` 기준 해당 레벨 출력 여부 |
| `getConfiguredLogLevel()` | 현재 설정된 로그 레벨 반환 |
| `getOriginalConsole()` | 패치 이전의 원본 console 메서드 |
| `patchConsole()` / `unpatchConsole()` | console 패치 수동 제어 |
| `LogLevel`, `LogEntry` | 타입 |

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `OTEL_SERVICE_NAME` | 서비스 이름 (최우선) | `package.json` name |
| `OTEL_SERVICE_VERSION` | 서비스 버전 | `package.json` version |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP 수신 엔드포인트 | `http://alloy:4318` |
| `LOG_LEVEL` | 로그 출력 레벨 (error, warn, info, debug, verbose) | `info` |
| `NODE_ENV` | 실행 환경 | — |

설정 우선순위: **환경변수 > `register()` 옵션 > `package.json` > 기본값**

## 기본 동작

설정 없이 import만 하면 아래가 자동으로 구성된다:

- **Exporters**: OTLP HTTP (traces, metrics, logs) → `http://alloy:4318`
- **Instrumentations**: `getNodeAutoInstrumentations()` + `RuntimeNodeInstrumentation`
- **Metric 전송 간격**: 2000ms
- **런타임 계측 정밀도**: 2000ms
- **Graceful Shutdown**: `SIGINT`, `SIGTERM` 시 SDK 종료 후 `process.exit()`

## 진입점

| import 경로 | 동작 |
|------------|------|
| `@point3/observability` | side-effect — import 시 즉시 SDK 시작 |
| `@point3/observability/register` | `register()` 함수만 export, side-effect 없음 |
| `@point3/observability/log` | `emitLog`, `patchConsole` 등 로그 유틸리티 export |

`@point3/observability`를 import하면 내부적으로 `register()`를 옵션 없이 호출한다. 커스텀이 필요하면 `@point3/observability/register`에서 직접 호출.

## 빌드

```bash
npm run build      # tsup으로 ESM + CommonJS 듀얼 빌드
```

출력: `dist/` — `.js`(ESM), `.cjs`(CJS), `.d.ts`(타입), `.map`(소스맵)
