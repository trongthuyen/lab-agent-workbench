import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  controllers: [HealthController, TasksController],
  providers: [TasksService]
})
export class AppModule {}
