import { Global, Module } from "@nestjs/common";

import { Point3Logger } from "./point3-logger";

@Global()
@Module({
  providers: [Point3Logger],
  exports: [Point3Logger],
})
export class Point3LoggerModule {}
