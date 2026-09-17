-- Evaluator-ready Client absorption fixture. Enter one expression at a time.
--
-- Run these setup commands only in the group-host Client (gPhost = 1). The
-- physical Up / 1 / 2 keys below are the only actions that reach the puncher
-- and scoring methods. Do NOT invoke mKeyDown, mCheckCollision,
-- ParticlePunched, mPuncherScore, mAddCPF, mAnimateScore, or addpoint.

-- Arrange the original SI Absorb screen and camera as fixture preconditions.
go("Si_room")
gPlayer.myCurrentRoom = gSIroom
gPlayer.pPlayerCurrRm = "SIRoom"
gPlayer.myCurrentScreen = gSIroom.pScreensList[#Absorb]
gPlayer.myPlatformList = gSIroom.pScreensList[#Absorb].pPlatFormList
gPlayer.myLoc = point(1655, 1044)
gCamera.moveCamera(gSIroom.pScreensList[#Absorb].pCameraLoc, 200)

-- Wait for the Absorb machine to be visible, then press ordinary Up once.
-- Verify gPlayer.pStatus = #onseat and gPhost = 1 before seeding a particle.

-- Correct Client path: #c is the Client pFinalProductList lane-1 material.
-- Precondition: ParticleOBJList.count = 0.
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.CreateSIParticles([[#c, 910001]])
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].mMoveScreen(3)
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pDigested = 1
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pParticleLoc = [1760, 810]
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].myLoc = point(1760, 810)

-- Press/release ordinary physical 1. Wait for particle deletion, then >1.2s
-- for original scorefx2 to reach the score and broadcast to the peer.

-- Wrong Client path: reload/re-establish the same baseline, then use this
-- block and press/release ordinary physical 2.
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.CreateSIParticles([[#c, 910002]])
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].mMoveScreen(3)
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pDigested = 1
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].pParticleLoc = [1845, 810]
gSIroom.pScreensList[#SpecialRmShoot].pParticlesObj.ParticleOBJList[1].myLoc = point(1845, 810)

-- Press/release ordinary physical 2. Again wait for deletion and scorefx2.
