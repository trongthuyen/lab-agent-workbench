import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import { type Task, TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(@Body("title") title: string): Task {
    return this.tasks.create(title);
  }

  @Get()
  findAll(): Task[] {
    return this.tasks.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number): Task {
    return this.tasks.findOne(id);
  }

  @Patch(":id/complete")
  complete(@Param("id", ParseIntPipe) id: number): Task {
    return this.tasks.complete(id);
  }
}
