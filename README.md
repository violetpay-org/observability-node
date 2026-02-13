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

`package.json` 탐색은 `require.main.filename` → `process.argv[1]` → `process.cwd()` 순서로 시작 디렉토리를 결정한 뒤, 상위로 올라가며 가장 가까운 `package.json`을 찾는다. 어디서 `node`를 실행하든 정확한 프로젝트 루트를 찾을 수 있다.

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

### stdout 출력 포맷

`NODE_ENV`에 따라 출력 포맷이 달라진다.

**개발 환경** (`NODE_ENV !== 'production'`) — Pretty Print:
```
INFO    2026-02-13T08:30:00.000Z 주문 생성 완료 trace_id=4bf92f3577b34da6
```

**프로덕션** (`NODE_ENV=production`) — JSON:
```json
{"level":"info","message":"주문 생성 완료","timestamp":"2026-02-13T08:30:00.000Z","trace_id":"4bf92f3577b34da6","span_id":"00f067aa0ba902b7"}
```

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

## NestJS 통합

NestJS 애플리케이션에서 전용 로거 모듈을 사용하여 OTel 로그와 통합할 수 있다.

### Point3LoggerModule 설정

`AppModule`에서 `Point3LoggerModule`을 import 한다.

```typescript
import { Module } from "@nestjs/common";
import { Point3LoggerModule } from "@point3/observability/nest";

@Module({
  imports: [Point3LoggerModule],
})
export class AppModule {}
```

### 전역 로거 적용

`main.ts`에서 `app.useLogger()`를 사용하여 NestJS 시스템 로그를 `Point3Logger`로 교체한다.

```typescript
import { NestFactory } from "@nestjs/core";
import { Point3Logger } from "@point3/observability/nest";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // NestJS 내부 로그를 Point3Logger로 출력
  app.useLogger(app.get(Point3Logger));
  
  await app.listen(3000);
}
bootstrap();
```

### DI 주입 및 사용

서비스나 컨트롤러에서 `Point3Logger`를 주입받아 사용할 수 있다.

```typescript
import { Injectable } from "@nestjs/common";
import { Point3Logger } from "@point3/observability/nest";

@Injectable()
export class AppService {
  constructor(private readonly logger: Point3Logger) {
    this.logger.setContext(AppService.name);
  }

  doSomething() {
    this.logger.log("작업 수행 중...", { detail: "extra info" });
  }
}
```

### Winston 마이그레이션

기존 `nest-winston` 등을 사용하던 환경에서 쉽게 전환할 수 있다.

**Before:**
```typescript
import { WinstonModule } from "nest-winston";
// ... winston 설정 복잡함
```

**After:**
```typescript
import { Point3LoggerModule } from "@point3/observability/nest";

@Module({
  imports: [Point3LoggerModule],
})
export class AppModule {}
```

## Alloy 설정

`@point3/observability`가 전송하는 OTLP 로그를 Loki로 라우팅하기 위해 Alloy 설정(`config.alloy`)을 수정한다.

기존 config에서 **3줄만 추가**하면 된다:

1. receiver output에 `logs` 추가
2. batch processor output에 `logs` 추가
3. `otelcol.exporter.loki` 컴포넌트 추가

### 전체 표준 config

`// [NEW]` 주석이 붙은 라인이 추가분이다. 나머지는 기존과 동일.

```alloy
// ─── OTLP 수신 ───
otelcol.receiver.otlp "app_service" {
    grpc {
        endpoint = "0.0.0.0:4137"
    }
    http {
        endpoint = "0.0.0.0:4138"
    }

    output {
        metrics = [otelcol.processor.batch.default.input]
        traces  = [otelcol.processor.batch.default.input]
        logs    = [otelcol.processor.batch.default.input]    // [NEW] OTLP 로그 라우팅
    }
}

// ─── 배치 처리 ───
otelcol.processor.batch "default" {
    output {
        metrics = [otelcol.exporter.prometheus.app_service.input]
        traces  = [otelcol.exporter.otlp.tempo.input]
        logs    = [otelcol.exporter.loki.default.input]      // [NEW] 로그 → Loki
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

// ─── Logs → Loki ─── [NEW]
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

### Docker 컨테이너 로그 수집이 필요한 경우

OTLP로 앱 로그가 직접 Loki에 전송되므로 Docker socket 스크래핑은 기본 config에 포함하지 않는다. DB, Redis 등 비계측 컨테이너의 로그도 Loki에서 보려면 아래를 추가한다.

```alloy
discovery.docker "local" {
    host = "unix:///var/run/docker.sock"
    filter {
        name   = "label"
        values = ["com.docker.compose.project=" + env("COMPOSE_PROJECT_NAME")]
    }
}

discovery.relabel "local" {
    targets = discovery.docker.local.targets

    rule {
        source_labels = ["__meta_docker_container_name"]
        target_label  = "container"
        regex         = "/(.*)"
    }
    rule {
        source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
        target_label  = "service"
    }
    rule {
        source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
        target_label  = "project"
    }
}

loki.source.docker "local" {
    host       = "unix:///var/run/docker.sock"
    targets    = discovery.relabel.local.output
    forward_to = [loki.write.default.receiver]
}
```

> ⚠️ 앱 컨테이너의 stdout도 수집되므로 OTLP 로그와 중복될 수 있다.

### Grafana Loki 데이터소스 설정

Loki에서 Tempo(Trace)로 바로 이동할 수 있도록 **Derived Fields**를 설정한다.

- **Name**: `trace_id`
- **Regex**: `traceID=(\w+)` (OTLP 로그)
- **Internal link**: Tempo 데이터소스 선택, Query에 `${__value.raw}` 입력

## 환경변수


| 변수 | 설명 | 기본값 |
|------|------|--------|
| `OTEL_SERVICE_NAME` | 서비스 이름 (최우선) | `package.json` name |
| `OTEL_SERVICE_VERSION` | 서비스 버전 | `package.json` version |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP 수신 엔드포인트 | `http://alloy:4318` |
| `LOG_LEVEL` | 로그 출력 레벨 (error, warn, info, debug, verbose) | `info` |
| `NODE_ENV` | 실행 환경 (production일 경우 JSON 로깅 활성화) | `development` |

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
| `@point3/observability/nest` | NestJS 통합용 모듈 및 로거 export |

`@point3/observability`를 import하면 내부적으로 `register()`를 옵션 없이 호출한다. 커스텀이 필요하면 `@point3/observability/register`에서 직접 호출.

## 프로젝트 구조

```
src/
├── index.ts       # side-effect 엔트리: register()를 옵션 없이 호출
├── register.ts    # register() 구현 + export
├── types.ts       # ObservabilityOptions 인터페이스
├── log/           # 로깅 처리 및 콘솔 패치 로직
└── nest/          # NestJS 통합 모듈 및 로거
```

## 빌드

```bash
npm run build      # tsup으로 ESM + CJS 듀얼 빌드
```

출력: `dist/` — `.js`(ESM), `.cjs`(CJS), `.d.ts`(타입), `.map`(소스맵)
