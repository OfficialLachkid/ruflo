# Animations

## Hero entrance

Use GSAP stagger for:

- eyebrow
- heading lines
- lede
- chip row
- CTA group
- signal-map container

Suggested timing:

- y: `24`
- opacity: `0 -> 1`
- stagger: `0.08`
- ease: `power3.out`

## Signal-map

Core pieces:

- base path
- active route path
- node circles
- pulse indicator

Behaviors:

- active route draws in on first reveal
- pulse travels on a motion path or timed translation
- nodes brighten briefly as pulse passes
- loop every `2.4s` to `3.2s`

## Reveal masks

Use clipped image or panel reveals for:

- Perspective Split
- Showcase Frames
- CTA image transitions

Avoid revealing everything the same way.

## Capability stack

When the active panel changes:

- opacity shift
- subtle vertical translation
- accent line expansion

## Timeline

- line-draw animation
- step markers scale in
- active step gets a stronger accent fill
