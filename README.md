# The Night Ward

A single-player, first-person horror game built with Three.js.

You are the only overnight attendant at a remote veterinary clinic. Animals arrive at the intake window in the dead of night. Examine them, admit the genuine patients, diagnose and treat them, and keep everyone alive until dawn. Some visitors are not animals at all. They are something wearing an animal's shape.

## Playing

**Play online: https://m1omg.github.io/TestSpace/**

The site is published from the `gh-pages` branch. The *Deploy to GitHub Pages* workflow rebuilds and republishes it whenever `main` changes.

To play locally, open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari with WebGL 2). It also works straight from disk with no server, and every texture and sound is generated procedurally, so nothing has to be downloaded. Headphones are strongly recommended for the 3D audio.

To work on the source:

```bash
npm install
```

```bash
npm run dev     # rebuilds on change and serves at http://localhost:8080
```

```bash
npm run build   # writes dist/night-ward.js
```

## How a night works

1. **Screen.** A visitor sits on the ledge behind the glass. Inspect it three ways:
   - **With your eyes.** Hold *Focus* to zoom in. Look for extra or missing eyes, a missing mouth, wrong teeth when it yawns, distorted proportions, and twitches that repeat *exactly*.
   - **With the instant camera.** Raise it, snap a photo, then compare the photo with the live view. Impostors can have different ears, altered eyes, or a face buried in interference on film.
   - **On the security cameras.** The desk monitor cycles through the vestibule and building feeds. Some impostors only show the truth on CCTV: elongated limbs, a black silhouette, or a head (and glowing eyes) that turns to face every camera you switch to.
2. **Decide.** The green button releases the door. The red lever drops the security shutter. Sick animals look strange too: limping, swelling, shivering, wounds, drooling and exhaustion are illness, and they look the same through every lens. Turning away a real patient costs reputation. Letting an impostor in puts the whole clinic in danger.
3. **Treat.** Escort admitted patients from the waiting area to a free exam room. Read the intake record and run tests: thermometer, stethoscope (you can listen to the heartbeat), scanner and physical exam. Pick a diagnosis (a clinical guide is built in), fetch the listed supplies from the pharmacy, and administer them. Some cases need a short surgery on the surgery table. Patients deteriorate while they wait, so juggle several rooms using the status board and your pager.
4. **Survive the building.** Every threat follows a learnable rule, and the rules are pinned in the staff office and on your pager:
   - Lights fail. Reset the tripped breakers in the utility room. Something you let in may get loose in the dark.
   - A tall figure in the corridor. Don't look straight at it. It leaves if you ignore it.
   - Something on a camera feed walking toward the lens. Switch feeds before it arrives.
   - Scratching under a patient's bed. Crouch and shine your flashlight under it.
   - A creature loose inside. It only moves when nobody is watching it. Restrain it with a catch pole, or drive it off with a steady flashlight beam.
   - If an admitted patient gives impossible readings, report the anomaly to seal the room.
5. **Between nights.** Dr. Adair reviews your work, warns you about what's next, and offers free supplies. Spend your earnings on clearer cameras, faster diagnostics, protection (a backup generator, a better flashlight, catch poles, flares), coffee, and medicine.

There are five nights, each harder than the last, and an ending that depends on how you did. Patients, illnesses, anomaly signs and incidents are randomized every night.

Composure is your other health bar. Darkness, staring at the wrong things and jumpscares wear it down. Coffee, comforting your patients and quiet lit rooms bring it back.

## Default controls (all rebindable in *Controls*)

| Action | Keys |
| --- | --- |
| Move | W A S D / arrow keys |
| Sprint / crouch | Shift / C (or Ctrl) |
| Interact | E (or Space) |
| Take photo, hold to restrain | Left mouse |
| Focus (zoom) | Right mouse (or Z) |
| Raise instant camera | Q |
| Compare last photo | R |
| Flashlight | F |
| Emergency flare | V |
| Pager (patients, objective, rules) | Tab (or P) |
| Close panel | X (or Backspace); Esc pauses |
| Camera feeds / exam tests / breakers | A/D, or the number keys |

Any action can take a keyboard key, mouse button or wheel direction. Binding a key that's already in use swaps the two bindings.

## Settings and accessibility

- **Quality presets** (Low, Medium, High, Custom). The game auto-detects a sensible default.
  - **Low** is meant for integrated graphics and older laptops: 60% render resolution, a cheaper lighting model, and no post-processing.
  - **High** adds full resolution (up to 1.5× on high-DPI screens), 4× MSAA, physically based materials, flashlight shadows and lens effects.
  - **Dynamic resolution** holds your target frame rate automatically.
- **Difficulty**: Gentle, Standard or Graveyard. You can change it at any time.
- **Reduce jumpscares**: no sudden faces or loud stingers.
- **Reduce light flicker** for photosensitive players.
- **Sound captions**, camera-shake intensity, head bob, field of view, invert Y, and mouse sensitivity.

## Technical notes

- **Refresh-rate independence.** Gameplay runs on a fixed 60 Hz simulation step with interpolated rendering. Movement, timers, patient deterioration and threat behaviour are identical at 30, 60, 144 or 240 Hz. Mouse look applies raw input deltas, and visual-only animation uses real elapsed time.
- **Baked, relightable lighting.** Every static vertex stores how much light it gets from each of eight power circuits, plus ambient occlusion, computed once at load. A single uniform array then dims, flickers or cuts circuits at no runtime cost. Moving objects sample the same model as a light probe. The only real-time lights are the flashlight and the camera flash, which keeps fragment cost low on weak GPUs.
- **View layers.** The player's eyes, the instant camera and the security cameras each render a different set of object layers. That's how an impostor can look normal in person and wrong on film or CCTV.
- **Low draw counts.** Static geometry is merged per room and material. The CCTV and photo passes render only when needed (CCTV at 12–15 fps, the desk monitor at 5 fps).
- **Audio.** About 40 sounds are synthesized at startup with the Web Audio API and played through HRTF panners. Sounds from other rooms are muffled, and the music is a procedural pad that tightens with tension.

### Source layout

| File | Purpose |
| --- | --- |
| `src/main.js` | Boot, fixed-step loop, game states, interactions, rendering hooks |
| `src/level.js`, `src/builder.js` | Clinic layout, props, doors, cameras, navigation graph |
| `src/lighting.js`, `src/materials.js` | Baked circuit lighting and the material factory |
| `src/renderer.js` | Quality tiers, post-processing, CCTV and photo rendering |
| `src/animals.js` | Procedural animals, illness traits and anomaly signs |
| `src/patients.js` | Visitors, intake, escorting, health, diagnostics, treatment |
| `src/incidents.js` | Power failures, the watcher, feed presences, under-bed thing, creatures, composure |
| `src/shift.js` | Campaign save data, shift schedule and scoring |
| `src/ui.js`, `src/panels.js` | Menus, settings, rebinding, HUD, exam, pharmacy, breakers, surgery |
| `src/audio.js` | Procedural sound synthesis and spatial audio |
| `src/input.js`, `src/settings.js` | Rebindable input and persistent settings |
| `src/data.js` | Species, illnesses, supplies, upgrades, rules and dialogue |
