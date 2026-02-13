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

`console.log`, `console.error` 등 표준 콘솔 메서드가 자동으로 OTel LogRecord로 변환되어 수집된다.

- **자동 변환**: `console` 출력이 OTel LogRecord로 캡처됨과 동시에 `stdout`/`stderr`로도 출력된다.
- **포맷 제어**: `NODE_ENV=production`일 경우 JSON 형식으로 출력되며, 그 외에는 가독성을 위해 Pretty Print(ANSI color 포함)로 출력된다.
- **레벨 필터링**: `LOG_LEVEL` 환경변수로 출력 레벨을 제어할 수 있다 (기본값: `info`).
- **구조화 로깅**: 첫 번째 인자가 객체일 경우, 해당 객체의 필드들을 OTel LogRecord의 attributes로 자동 추출한다.
- **비활성화**: `register({ patchConsole: false })` 옵션으로 콘솔 패치 기능을 끌 수 있다.

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

수집된 로그를 Loki로 전송하기 위해 Alloy 설정(`config.alloy`)에 아래 내용을 추가한다.

```diff
output {
+   logs = [otelcol.processor.batch.logs.input]
}

+otelcol.processor.batch "logs" {
+  output { logs = [otelcol.exporter.loki.default.input] }
+}

+otelcol.exporter.loki "default" {
+  forward_to = [loki.write.default.receiver]
+}
```

### Grafana Loki 데이터소스 설정

Loki에서 Tempo(Trace)로 바로 이동할 수 있도록 **Derived Fields**를 설정한다.

- **Name**: `trace_id`
- **Regex**: `trace_id=(\w+)`
- **Internal link**: Tempo 데이터소스 선택 및 Query에 `${__value.raw}` 입력

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
