-- Evaluator-ready, one-expression-at-a-time fixture sequence.
--
-- `mcp_eval_lingo` cannot define a new handler, so enter these existing-object
-- calls and assignments individually, in the documented order. There are no
-- fixture locals, globals, handler definitions, or direct calls to scoring
-- methods. After setup, use ordinary on-screen Up, then ordinary 1 or 2 input.
--
-- Return the completed Tutorial from Colon to SI using the original transition.
gTutorial.mFlashGotoBlank()
gLIRoom.pScreensList[#Colon2].pTeleportSeatsList[1].mTeleportPlayer(gPlayer)

-- Wait until go("Si_room") completes. Restore the original Absorb hot-seat
-- instruction frame without pausing the actor loop, then position the player
-- in Screen_Absorb's original score rect. Clear the return screen so
-- gPlayer.stepFrame can make the existing screen/camera transition; do not
-- assign the Absorb screen or camera directly.
gTutorial.mFlashGotoFrame(56, 0)
gPlayer.myCurrentScreen = VOID
gPlayer.myLoc = point(1655, 1044)

-- Wait for gPlayer.myCurrentScreen = gSIroom.pScreensList[#Absorb] and for
-- the camera to show the absorption machine. Press ordinary Up once to occupy
-- Absorb1. Confirm gPlayer.pStatus = #onseat before continuing.
-- Hide the authored instruction overlay while retaining the seated control.
gTutorial.mFlashGotoBlank()

-- Correct lane fixture. Precondition: ParticleOBJList.count = 0.
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.CreateSIParticles([[#glu, 900001]])
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].mMoveScreen(3)
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pDigested = 1
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pParticleLoc = [1760, 810]
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].myLoc = point(1760, 810)

-- Send an ordinary physical 1 key press and release. Do not call any handler.

-- Wrong-lane fixture: reload/re-establish the same baseline, then use this
-- block instead. The ordinary physical 2 key is deliberately the wrong lane.
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.CreateSIParticles([[#glu, 900002]])
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].mMoveScreen(3)
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pDigested = 1
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pParticleLoc = [1845, 810]
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].myLoc = point(1845, 810)

-- Send an ordinary physical 2 key press and release. Do not call any handler.
