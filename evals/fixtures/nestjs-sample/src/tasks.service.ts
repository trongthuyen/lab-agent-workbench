import { Injectable, NotFoundException } from "@nestjs/common";

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

@Injectable()
export class TasksService {
  private readonly tasks = new Map<number, Task>();
  private nextId = 1;

  create(title: string): Task {
    const task: Task = { id: this.nextId++, title, done: false };
    this.tasks.set(task.id, task);
    return task;
  }

  findAll(): Task[] {
    return [...this.tasks.values()];
  }

  findOne(id: number): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    return task;
  }

  complete(id: number): Task {
    const task = this.findOne(id);
    task.done = true;
    return task;
  }
}
