import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { TasksService } from "./tasks.service";

test("creates tasks with incrementing ids", () => {
  const service = new TasksService();
  assert.equal(service.create("first").id, 1);
  assert.equal(service.create("second").id, 2);
  assert.equal(service.findAll().length, 2);
});

test("completes an existing task", () => {
  const service = new TasksService();
  const { id } = service.create("write tests");
  assert.equal(service.complete(id).done, true);
});

test("throws NotFoundException for an unknown task", () => {
  assert.throws(() => new TasksService().findOne(99), NotFoundException);
});
