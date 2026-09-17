import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const publicFile = name => new URL(`../web/public/${name}`, import.meta.url);

async function loadControlInput() {
  const source = await readFile(publicFile("control-input.js"), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context, { filename: "control-input.js" });
  return context.GutFeelControlInput;
}

test("two touch pointers hold movement and boost independently", async () => {
  const { createKeyOwnership } = await loadControlInput();
  const events = [];
  const visuals = [];
  const controls = createKeyOwnership({
    keyDown: key => events.push(["down", key]),
    keyUp: key => events.push(["up", key]),
    visualState: (target, active) => visuals.push([target, active]),
  });
  const left = { id: "left" };
  const boost = { id: "boost" };

  controls.acquire("pointer:11", "ArrowLeft", left);
  controls.acquire("pointer:12", " ", boost);
  assert.equal(controls.ownerCount(), 2);
  assert.deepEqual(events, [["down", "ArrowLeft"], ["down", " "]]);

  controls.release("pointer:11"); // pointerup/cancel/lostcapture
  assert.equal(controls.hasKey("ArrowLeft"), false);
  assert.equal(controls.hasKey(" "), true, "releasing movement must not release boost");
  controls.releaseAll(); // blur/hidden/pagehide
  assert.deepEqual(events, [
    ["down", "ArrowLeft"], ["down", " "],
    ["up", "ArrowLeft"], ["up", " "],
  ]);
  assert.deepEqual(visuals, [
    [left, true], [boost, true], [left, false], [boost, false],
  ]);
});

test("a key stays down until its final owner releases", async () => {
  const { createKeyOwnership } = await loadControlInput();
  const events = [];
  const controls = createKeyOwnership({
    keyDown: key => events.push(["down", key]),
    keyUp: key => events.push(["up", key]),
  });
  controls.acquire("pointer:1", "ArrowUp");
  controls.acquire("pointer:2", "ArrowUp");
  controls.release("pointer:1");
  assert.deepEqual(events, [["down", "ArrowUp"]]);
  controls.releaseKey("ArrowUp");
  assert.deepEqual(events, [["down", "ArrowUp"], ["up", "ArrowUp"]]);
});
