# @point3/logger 공통 로깅 모듈 개발 명세서

## 배경

Point3 핀테크 플랫폼은 여러 NestJS 마이크로서비스로 구성되어 있으며, Grafana 스택(Tempo, Loki, Prometheus)을 사용한 observability 인프라를 구축 중이다. 현재 각 서비스의 로그가 trace context와 연동되지 않아 분산 추적 시 로그 연결이 어렵다.

## 목표

- 모든 마이크로서비스에서 일관된 JSON 로그 포맷 사용
- OpenTelemetry trace context (trace_id, span_id) 자동 주입
- 각 서비스에서 최소한의 코드 변경으로 적용 가능
- 중앙 집중식 로깅 설정 관리

## 기술 스택

- NestJS (v10+)
- OpenTelemetry SDK (`@opentelemetry/api`)
- TypeScript
- 배포: 내부 NPM registry 또는 Git 기반 패키지

## 요구사항

### 필수 기능

1. **NestJS LoggerService 구현**
   - `@nestjs/common`의 `LoggerService` 인터페이스 구현
   - log, error, warn, debug, verbose 메서드 지원

2. **Trace Context 자동 주입**
   - `@opentelemetry/api`의 현재 active span에서 trace_id, span_id 추출
   - span이 없는 경우에도 정상 동작 (trace 필드만 생략)

3. **JSON 로그 포맷**
   ```json
   {
     "level": "info",
     "time": 1707724800000,
     "service": "payment-capture",
     "context": "PaymentService",
     "trace_id": "abc123def456...",
     "span_id": "xyz789...",
     "msg": "Payment processed successfully",
     "extra": {}
   }
   ```

4. **서비스명 설정**
   - 생성자 또는 환경변수(`SERVICE_NAME`)로 서비스명 지정
   - OTEL resource의 `service.name`과 일치하도록 권장

5. **추가 메타데이터 지원**
   - 로그 호출 시 추가 객체 전달 가능
   - `logger.log({ userId: 123, amount: 50000 }, 'Payment processed', 'PaymentService')`

### 선택 기능

1. **로그 레벨 필터링**
   - 환경변수(`LOG_LEVEL`)로 최소 로그 레벨 설정
   - 기본값: `info`

2. **Pretty Print 모드**
   - 개발 환경에서 가독성 좋은 포맷 출력 옵션
   - 환경변수(`LOG_PRETTY=true`)로 활성화

3. **NestJS 모듈 제공**
   - `Point3LoggerModule.forRoot()` 형태로 전역 설정 가능

## API 설계

### 기본 사용법

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { Point3Logger } from '@point3/logger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new Point3Logger('payment-capture'),
  });
  await app.listen(3000);
}
bootstrap();
```

### 모듈 방식 (선택)

```typescript
// app.module.ts
import { Point3LoggerModule } from '@point3/logger';

@Module({
  imports: [
    Point3LoggerModule.forRoot({
      serviceName: 'payment-capture',
      level: 'debug',
      pretty: process.env.NODE_ENV === 'development',
    }),
  ],
})
export class AppModule {}
```

### 서비스 내 직접 사용

```typescript
import { Injectable } from '@nestjs/common';
import { Point3Logger } from '@point3/logger';

@Injectable()
export class PaymentService {
  private readonly logger = new Point3Logger('payment-capture', 'PaymentService');

  processPayment(dto: PaymentDto) {
    this.logger.log({ userId: dto.userId, amount: dto.amount }, 'Processing payment');
    // ...
    this.logger.log('Payment completed');
  }
}
```

## 구현 상세

### 핵심 클래스 구조

```typescript
import { LoggerService } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';

export interface Point3LoggerOptions {
  serviceName?: string;
  level?: 'verbose' | 'debug' | 'info' | 'warn' | 'error';
  pretty?: boolean;
}

export class Point3Logger implements LoggerService {
  private serviceName: string;
  private contextName?: string;
  private level: string;
  private pretty: boolean;

  constructor(serviceName?: string, contextName?: string);
  constructor(options: Point3LoggerOptions, contextName?: string);
  
  // LoggerService 구현
  log(message: any, context?: string): void;
  log(message: any, extra: object, context?: string): void;
  error(message: any, stack?: string, context?: string): void;
  warn(message: any, context?: string): void;
  debug(message: any, context?: string): void;
  verbose(message: any, context?: string): void;

  // 유틸리티
  private getTraceContext(): { trace_id?: string; span_id?: string };
  private formatLog(level: string, message: any, extra?: object, context?: string): void;
  private shouldLog(level: string): boolean;
}
```

### Trace Context 추출 로직

```typescript
private getTraceContext(): { trace_id?: string; span_id?: string } {
  const span = trace.getSpan(context.active());
  if (span) {
    const spanContext = span.spanContext();
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    };
  }
  return {};
}
```

### 로그 레벨 우선순위

```typescript
const LOG_LEVELS: Record<string, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};
```

## 패키지 구조

```
@point3/logger/
├── src/
│   ├── index.ts              # 공개 API export
│   ├── logger.ts             # Point3Logger 클래스
│   ├── logger.module.ts      # NestJS 모듈 (선택)
│   ├── interfaces.ts         # 타입 정의
│   └── constants.ts          # 로그 레벨 등 상수
├── package.json
├── tsconfig.json
└── README.md
```

## package.json

```json
{
  "name": "@point3/logger",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0",
    "@opentelemetry/api": "^1.0.0"
  },
  "devDependencies": {
    "@nestjs/common": "^10.0.0",
    "@opentelemetry/api": "^1.9.0",
    "typescript": "^5.0.0"
  }
}
```

## 테스트 요구사항

1. **단위 테스트**
   - trace context 있을 때 trace_id, span_id 포함 확인
   - trace context 없을 때 정상 동작 확인
   - 각 로그 레벨 메서드 동작 확인
   - 로그 레벨 필터링 동작 확인

2. **통합 테스트**
   - NestJS 애플리케이션에서 `NestFactory.create()` 옵션으로 사용
   - OTEL SDK와 함께 사용 시 trace_id 주입 확인

## 적용 체크리스트

각 마이크로서비스 적용 시:

- [ ] `@point3/logger` 패키지 설치
- [ ] `main.ts`에서 `Point3Logger` 적용
- [ ] OTEL SDK 초기화가 Logger 사용 전에 실행되는지 확인
- [ ] 기존 `console.log` 호출을 Logger로 점진적 교체 (선택)

## Grafana Loki 연동

이 로거가 출력하는 JSON 포맷은 Loki에서 다음과 같이 파싱됨:

```alloy
// Alloy config
loki.process "containers" {
  forward_to = [loki.write.default.receiver]

  stage.json {
    expressions = {
      level    = "level",
      msg      = "msg",
      trace_id = "trace_id",
      span_id  = "span_id",
      service  = "service",
      context  = "context",
    }
  }

  stage.labels {
    values = {
      level    = "",
      trace_id = "",
      service  = "",
    }
  }
}
```

Grafana Loki 데이터소스 Derived Fields 설정:
- Name: `TraceID`
- Regex: `"trace_id":"([a-f0-9]{32})"`
- Internal link: enabled
- Data source: Tempo

## 참고사항

- OTEL SDK는 각 서비스에서 별도로 초기화함 (이 패키지에 포함하지 않음)
- OTEL SDK 초기화는 반드시 애플리케이션 시작 시점에 Logger보다 먼저 실행되어야 함
- 서드파티 라이브러리(TigerBeetle 등)가 직접 stdout에 쓰는 로그는 trace 연동 불가 (Loki에서 시간 기반 연동 사용)
