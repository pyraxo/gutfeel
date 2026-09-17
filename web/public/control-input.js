(function installControlInput(global) {
  function createKeyOwnership({ keyDown, keyUp, visualState = () => {} }) {
    const owners = new Map();
    const keyOwners = new Map();
    const targetOwners = new Map();

    function acquire(owner, key, target = null) {
      if (owners.has(owner)) return false;
      let heldBy = keyOwners.get(key);
      if (!heldBy) {
        heldBy = new Set();
        keyOwners.set(key, heldBy);
        keyDown(key);
      }
      heldBy.add(owner);
      owners.set(owner, { key, target });
      if (target) {
        const count = (targetOwners.get(target) || 0) + 1;
        targetOwners.set(target, count);
        if (count === 1) visualState(target, true);
      }
      return true;
    }

    function release(owner) {
      const held = owners.get(owner);
      if (!held) return false;
      owners.delete(owner);
      const heldBy = keyOwners.get(held.key);
      heldBy?.delete(owner);
      if (heldBy?.size === 0) {
        keyOwners.delete(held.key);
        keyUp(held.key);
      }
      if (held.target) {
        const count = (targetOwners.get(held.target) || 1) - 1;
        if (count > 0) targetOwners.set(held.target, count);
        else {
          targetOwners.delete(held.target);
          visualState(held.target, false);
        }
      }
      return true;
    }

    function releaseKey(key) {
      for (const [owner, held] of [...owners]) if (held.key === key) release(owner);
    }

    function releaseAll() {
      for (const owner of [...owners.keys()]) release(owner);
    }

    return {
      acquire,
      release,
      releaseKey,
      releaseAll,
      hasOwner: owner => owners.has(owner),
      hasKey: key => keyOwners.has(key),
      ownerCount: () => owners.size,
    };
  }

  global.GutFeelControlInput = Object.freeze({ createKeyOwnership });
})(globalThis);
