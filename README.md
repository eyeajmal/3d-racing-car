# Apex Sunset

A self-contained 3D racing game for the browser. Race three laps against AI cars, earn credits based on finishing position, buy faster cars, and compete across three circuits.

## Progression

- Five cars with individual speed, acceleration, and grip ratings
- Persistent credits, purchases, selected car, and selected circuit
- Race prizes: CR 1,200 / 700 / 400 / 200 by finishing position
- Bonus credits for the longer Desert Giant and Coast Sprint circuits
- Three maps: Sunset Oval, the larger Desert Giant, and Coast Sprint
- Populated grandstands, car impacts, particles, camera shake, and engine audio

## Run it

Because the game uses JavaScript modules, serve the folder with a local HTTP server:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Controls

- `W` / `↑`: accelerate
- `S` / `↓`: brake and reverse
- `A D` / `← →`: steer
- `Space`: drift
- `R`: reset to the track
- `Esc`: pause

Touch controls appear automatically on phones and tablets.
