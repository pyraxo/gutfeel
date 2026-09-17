#!/usr/bin/env node

import fs from 'node:fs';

const DIRECTIONS = ['left', 'up', 'right', 'down'];

export function rotateOnce(grid) {
  if (!Array.isArray(grid) || grid.length !== 4) {
    throw new Error(`Expected four connection bits, got ${JSON.stringify(grid)}`);
  }
  return [grid[1], grid[2], grid[3], grid[0]];
}

function sameGrid(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function rotationsTo(current, target) {
  let rotated = [...current];
  for (let turns = 0; turns < 4; turns += 1) {
    if (sameGrid(rotated, target)) return turns;
    rotated = rotateOnce(rotated);
  }
  throw new Error(`Tile ${JSON.stringify(current)} cannot rotate to ${JSON.stringify(target)}`);
}

function normalizePath(path) {
  return path.map((entry) => {
    if (Array.isArray(entry)) {
      return { row: entry[0][0], col: entry[0][1], target: entry[1] };
    }
    return entry;
  });
}

function moveCursor(actions, cursor, row, col) {
  while (cursor.row > row) { actions.push('up'); cursor.row -= 1; }
  while (cursor.row < row) { actions.push('down'); cursor.row += 1; }
  while (cursor.col > col) { actions.push('left'); cursor.col -= 1; }
  while (cursor.col < col) { actions.push('right'); cursor.col += 1; }
}

export function solvePipe(input) {
  const board = input.board ?? input.grid;
  const path = input.path;
  const selected = input.selected ?? [input.row ?? 1, input.col ?? 1];
  const end = input.end;
  if (!Array.isArray(board) || board.length === 0 || !Array.isArray(board[0])) {
    throw new Error('board must be a non-empty row-major matrix');
  }
  const solutionPath = normalizePath(path);
  if (solutionPath.length > 1) {
    // The recovered generator overwrites pPath[1]'s target with left-only
    // `[1,0,0,0]` after it has generated the route. The start piece is a
    // one-ended source: StartfindPath emits through its sole opening, so that
    // opening must point at path[2] rather than out through the board edge.
    const start = solutionPath[0];
    const next = solutionPath[1];
    const dr = next.row - start.row;
    const dc = next.col - start.col;
    const exitIndex = dr === -1 ? 1 : dc === 1 ? 2 : dr === 1 ? 3 : dc === -1 ? 0 : -1;
    if (exitIndex < 0) throw new Error('First two path cells are not adjacent');
    start.target = [0, 0, 0, 0];
    start.target[exitIndex] = 1;
  }
  const endCell = end ?? [solutionPath.at(-1).row, solutionPath.at(-1).col];
  const cursor = { row: selected[0], col: selected[1] };
  const actions = [];
  const rotations = [];

  // Work from the finish back toward the start. The start tile is therefore
  // connected last, preventing the game from completing and rebuilding the
  // board while later input is still queued.
  for (const tile of [...solutionPath].reverse()) {
    if (tile.row === endCell[0] && tile.col === endCell[1]) {
      const current = board[tile.row - 1][tile.col - 1];
      if (!sameGrid(current, tile.target)) {
        throw new Error(`End tile ${tile.row},${tile.col} is locked but not in its target orientation`);
      }
      continue;
    }
    const current = board[tile.row - 1][tile.col - 1];
    const turns = rotationsTo(current, tile.target);
    if (turns === 0) continue;
    const actionStart = actions.length;
    moveCursor(actions, cursor, tile.row, tile.col);
    for (let i = 0; i < turns; i += 1) actions.push('space');
    rotations.push({
      row: tile.row,
      col: tile.col,
      from: current,
      to: tile.target,
      turns,
      actions: actions.slice(actionStart),
    });
    let rotated = current;
    for (let i = 0; i < turns; i += 1) rotated = rotateOnce(rotated);
    board[tile.row - 1][tile.col - 1] = rotated;
  }

  const keyInfo = {
    left: ['ArrowLeft', 37],
    up: ['ArrowUp', 38],
    right: ['ArrowRight', 39],
    down: ['ArrowDown', 40],
    space: [' ', 32],
  };
  const keyPulses = actions.map((action) => ({
    action,
    key: keyInfo[action][0],
    keyCode: keyInfo[action][1],
    downMs: 80,
    gapMs: 80,
  }));
  return {
    directions: DIRECTIONS,
    actions,
    keyPulses,
    rotations,
    finalSelection: [cursor.row, cursor.col],
  };
}

function selfTest() {
  const result = solvePipe({
    board: [[[0, 0, 0, 1], [1, 0, 0, 0]]],
    path: [
      [[1, 1], [1, 0, 0, 1]],
      [[1, 2], [1, 0, 0, 0]],
    ],
    selected: [1, 1],
    end: [1, 2],
  });
  if (result.actions.join(',') !== 'space') throw new Error('self-test failed');
  console.log('HCL solver self-test passed');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const inputPath = process.argv[2];
    if (!inputPath) {
      console.error('Usage: node tools/solve_hcl_pipe.mjs board.json');
      process.exit(2);
    }
    const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(JSON.stringify(solvePipe(input), null, 2));
  }
}
